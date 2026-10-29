import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  createHarness,
  makeWorkspace,
  configureRoot,
  initWorkspace,
  createRequirement,
  runTool,
} from './helpers.js'

test('files and workspace mapping cannot escape through symlinks', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
    harness.addWorkspace(workspace)
    const rootDir = path.join(harness.tempRoot, 'requirements')
    await configureRoot(harness, rootDir)
    const workspaceFolder = (await initWorkspace(harness, 'w1')).folderPath
    const created = await createRequirement(harness, 'w1', 'Safe files', '# Safe\n')
    const id = created.requirement.id
    const requirementFolder = created.requirement.folder
    const outside = path.join(harness.tempRoot, 'outside')
    const docs = path.join(requirementFolder, 'docs')
    await fsp.mkdir(outside, { recursive: true })
    await fsp.mkdir(docs, { recursive: true })
    await fsp.writeFile(path.join(outside, 'secret.txt'), 'secret')
    await fsp.writeFile(path.join(outside, 'victim.txt'), 'keep')
    await fsp.symlink(outside, path.join(docs, 'out'), 'dir')

    const evil = path.join(outside, 'evil-requirement')
    await fsp.mkdir(evil, { recursive: true })
    await fsp.writeFile(path.join(evil, 'requirement.md'), '# external\n')
    await fsp.symlink(evil, path.join(workspaceFolder, 'REQ-SYMLINK'), 'dir')
    let response = await harness.request('POST', '/requirement/get', {
      workspaceId: 'w1',
      id: 'REQ-SYMLINK',
    })
    assert.equal(response.status, 400)
    assert.equal(response.raw.includes('external'), false)
    response = await harness.request('POST', '/files/write', {
      workspaceId: 'w1',
      id,
      path: 'docs/out/pwn.txt',
      content: 'owned',
    })
    assert.equal(response.status, 400)
    await assert.rejects(fsp.access(path.join(outside, 'pwn.txt')))

    const query = '/files?workspaceId=w1&id=' + encodeURIComponent(id) +
      '&path=' + encodeURIComponent('docs/out/secret.txt')
    response = await harness.request('GET', query)
    assert.equal(response.status, 400)
    assert.equal(response.raw.includes('secret'), false)

    const toolResult = await runTool(harness, 'requirement_read', {
      requirement_id: id,
      workspace_id: 'w1',
      file: 'docs/out/secret.txt',
    })
    assert.equal(toolResult.ok, false)

    response = await harness.request('POST', '/files/delete', {
      workspaceId: 'w1',
      id,
      path: 'docs/out/victim.txt',
    })
    assert.equal(response.status, 400)
    await fsp.access(path.join(outside, 'victim.txt'))

    const document = path.join(requirementFolder, 'requirement.md')
    const documentBefore = await fsp.readFile(document, 'utf8')
    response = await harness.request('POST', '/files/write', {
      workspaceId: 'w1',
      id,
      path: 'requirement.md',
      content: 'changed document',
    })
    assert.equal(response.status, 400)
    response = await harness.request('POST', '/files/delete', {
      workspaceId: 'w1',
      id,
      path: 'requirement.md',
    })
    assert.equal(response.status, 400)
    assert.equal(await fsp.readFile(document, 'utf8'), documentBefore)

    response = await harness.request('POST', '/files/delete', {
      workspaceId: 'w1',
      id,
      path: '.',
    })
    assert.equal(response.status, 400)
    await fsp.access(document)
    response = await harness.request('POST', '/files/delete', {
      workspaceId: 'w1',
      id,
      path: 'docs/..',
    })
    assert.equal(response.status, 400)
    await fsp.access(document)

    const alias = path.join(docs, 'alias.md')
    await fsp.symlink('../requirement.md', alias, 'file')
    response = await harness.request('POST', '/files/write', {
      workspaceId: 'w1',
      id,
      path: 'docs/alias.md',
      content: 'overwritten',
    })
    assert.equal(response.status, 400)
    assert.equal(await fsp.readFile(document, 'utf8'), documentBefore)

    response = await harness.request('POST', '/files/delete', {
      workspaceId: 'w1',
      id,
      path: 'docs/alias.md',
    })
    assert.equal(response.status, 400)

    const w2 = await makeWorkspace(harness.tempRoot, 'w2', 'Workspace 2')
    harness.addWorkspace(w2)
    const gitignoreTarget = path.join(outside, 'gitignore-target')
    await fsp.writeFile(gitignoreTarget, 'target-content\n')
    const gitignorePath = path.join(rootDir, '.gitignore')
    await fsp.rm(gitignorePath, { force: true })
    await fsp.symlink(gitignoreTarget, gitignorePath, 'file')
    response = await harness.request('POST', '/workspace/init', { workspaceId: 'w2' })
    assert.equal(response.status, 400)
    assert.equal(await fsp.readFile(gitignoreTarget, 'utf8'), 'target-content\n')

    const root2 = path.join(harness.tempRoot, 'requirements-2')
    const metaTarget = path.join(outside, 'meta-target')
    await fsp.mkdir(root2, { recursive: true })
    await fsp.mkdir(metaTarget, { recursive: true })
    await fsp.symlink(metaTarget, path.join(root2, '.dsh-devbench'), 'dir')
    response = await harness.request('POST', '/config', {
      rootDir: root2,
      promptTemplate: '',
    })
    assert.equal(response.status, 500)
    assert.equal(response.data.error.code, 'mapping-corrupt')
    assert.deepEqual(await fsp.readdir(metaTarget), [])

    const mappingFile = path.join(rootDir, '.dsh-devbench', 'workspaces.json')
    await fsp.writeFile(mappingFile, JSON.stringify({
      version: 1,
      workspaces: { w1: { folder: '../../outside2', title: 'bad', path: '' } },
    }))
    response = await harness.request('POST', '/workspace/init', { workspaceId: 'w1' })
    assert.equal(response.status, 500)
    assert.equal(response.data.error.code, 'mapping-corrupt')
    await assert.rejects(fsp.access(path.join(harness.tempRoot, 'outside2')))
  } finally {
    await harness.close()
  }
})

test('deleted requirement metadata cannot escape through a symlink', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
    harness.addWorkspace(workspace)
    const rootDir = path.join(harness.tempRoot, 'requirements')
    await configureRoot(harness, rootDir)
    await initWorkspace(harness, 'w1')
    const created = await createRequirement(harness, 'w1', 'Safe delete', '# Safe\n')
    const target = path.join(harness.tempRoot, 'outside-deleted.json')
    await fsp.writeFile(target, '{"version":1,"workspaces":{}}\n')
    const marker = path.join(rootDir, '.dsh-devbench', 'deleted-requirements.json')
    await fsp.symlink(target, marker, 'file')
    const response = await harness.request('POST', '/requirement/delete', {
      workspaceId: 'w1',
      id: created.requirement.id,
    })
    assert.equal(response.status, 500)
    assert.equal(response.data.error.code, 'deleted-requirements-corrupt')
    assert.equal(await fsp.readFile(target, 'utf8'), '{"version":1,"workspaces":{}}\n')
    await fsp.access(path.join(created.requirement.folder, 'requirement.md'))
  } finally {
    await harness.close()
  }
})

test('mapped workspace folders cannot be symlinks', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
    harness.addWorkspace(workspace)
    const rootDir = path.join(harness.tempRoot, 'requirements')
    await configureRoot(harness, rootDir)
    const initialized = await initWorkspace(harness, 'w1')
    const outside = path.join(harness.tempRoot, 'outside-workspace')
    await fsp.mkdir(outside, { recursive: true })
    await fsp.rm(initialized.folderPath, { recursive: true, force: true })
    await fsp.symlink(outside, initialized.folderPath, 'dir')

    const response = await harness.request('POST', '/workspace/init', { workspaceId: 'w1' })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'symlink-not-allowed')
    const state = await harness.request('GET', '/state')
    assert.equal(state.status, 400)
  } finally {
    await harness.close()
  }
})
