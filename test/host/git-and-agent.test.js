import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  createHarness,
  makeWorkspace,
  configureRoot,
  initWorkspace,
  createRequirement,
  expectOk,
  runTool,
} from './helpers.js'

const execFileAsync = promisify(execFile)

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, windowsHide: true })
}

test('uninitialized requirement root never operates on a parent repository', async function () {
  const harness = await createHarness([])
  try {
    const parent = path.join(harness.tempRoot, 'parent-project')
    await fsp.mkdir(parent, { recursive: true })
    await git(parent, ['init'])
    await fsp.writeFile(path.join(parent, 'baseline.txt'), 'baseline\n')
    await git(parent, ['add', 'baseline.txt'])
    await git(parent, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com',
      'commit', '-m', 'baseline'])
    const before = (await git(parent, ['rev-parse', 'HEAD'])).stdout.trim()
    await fsp.writeFile(path.join(parent, 'dirty.txt'), 'dirty\n')

    const rootDir = path.join(parent, 'requirements')
    await configureRoot(harness, rootDir)
    let response = await harness.request('POST', '/git/commit', { message: 'must not commit' })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'git-not-initialized')
    assert.equal((await git(parent, ['rev-parse', 'HEAD'])).stdout.trim(), before)
    assert.equal((await fsp.readFile(path.join(parent, 'dirty.txt'), 'utf8')), 'dirty\n')

    response = await harness.request('GET', '/git/log')
    let value = expectOk(response)
    assert.equal(value.git.initialized, false)
    assert.deepEqual(value.entries, [])
    value = expectOk(await harness.request('GET', '/git/status'))
    assert.equal(value.initialized, false)

    value = expectOk(await harness.request('POST', '/git/init', {}))
    assert.equal(value.initialized, true)
    await fsp.access(path.join(rootDir, '.git'))
    await git(rootDir, ['config', 'user.name', 'Test'])
    await git(rootDir, ['config', 'user.email', 'test@example.com'])
    await fsp.writeFile(path.join(rootDir, 'note.txt'), 'note\n')
    value = expectOk(await harness.request('POST', '/git/commit', { message: 'own repo commit' }))
    assert.equal(value.committed, true)
    assert.notEqual((await git(rootDir, ['rev-parse', 'HEAD'])).stdout.trim(), before)
  } finally {
    await harness.close()
  }
})

test('agent tools return structured failures and reject invalid status', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
    harness.addWorkspace(workspace)
    const rootDir = path.join(harness.tempRoot, 'requirements')
    await configureRoot(harness, rootDir)
    await initWorkspace(harness, 'w1')
    const created = await createRequirement(harness, 'w1', 'Agent target', '# Original\n')
    const id = created.requirement.id
    const document = path.join(created.requirement.folder, 'requirement.md')
    const before = await fsp.readFile(document, 'utf8')

    let result = await runTool(harness, 'requirement_update', {
      requirement_id: id,
      workspace_id: 'w1',
      content: '# Changed\n',
      status: 'done',
    })
    assert.equal(result.ok, false)
    assert.equal(await fsp.readFile(document, 'utf8'), before)

    result = await runTool(harness, 'requirement_update', {
      requirement_id: id,
      workspace_id: 'w1',
      content: 42,
    })
    assert.equal(result.ok, false)
    assert.equal(await fsp.readFile(document, 'utf8'), before)
  } finally {
    await harness.close()
  }
})

test('agent tools return structured failure without configuration', async function () {
  const harness = await createHarness([])
  try {
    const result = await runTool(harness, 'requirement_list', {})
    assert.equal(result.ok, false)
    assert.equal(typeof result.message, 'string')
  } finally {
    await harness.close()
  }
})
