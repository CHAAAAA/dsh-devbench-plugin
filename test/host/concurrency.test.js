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
  expectOk,
} from './helpers.js'
import {
  deleteRequirement,
  findRequirementInWorkspace,
  updateRequirement,
} from '../../src/host/domain/requirements.js'
import { readMapping } from '../../src/host/storage/workspaces.js'

test('concurrent create, link and workspace init preserve data', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
    harness.addWorkspace(workspace)
    const rootDir = path.join(harness.tempRoot, 'requirements')
    await configureRoot(harness, rootDir)
    const folder = await initWorkspace(harness, 'w1')

    const createResponses = await Promise.all(Array.from({ length: 20 }, function (_, index) {
      return harness.request('POST', '/requirement/create', {
        workspaceId: 'w1',
        title: 'Concurrent ' + index,
        body: '# Concurrent ' + index + '\n\nmarker-' + index + '\n',
      })
    }))
    const createdValues = createResponses.map(expectOk)
    const ids = createdValues.map(function (value) { return value.requirement.id })
    assert.equal(new Set(ids).size, 20)
    for (let index = 0; index < 20; index += 1) {
      assert.equal(createdValues[index].body.includes('marker-' + index), true)
    }
    const entries = await fsp.readdir(folder.folderPath, { withFileTypes: true })
    const requirementDirs = entries.filter(function (entry) { return entry.isDirectory() })
    assert.equal(requirementDirs.length, 20)

    const id = ids[0]
    const linkResponses = await Promise.all(['s1', 's2', 's3'].map(function (sessionId) {
      return harness.request('POST', '/requirement/link-session', {
        workspaceId: 'w1',
        id,
        sessionId,
      })
    }))
    linkResponses.forEach(expectOk)
    const detail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: 'w1',
      id,
    }))
    assert.deepEqual(detail.requirement.sessions.slice().sort(), ['s1', 's2', 's3'])

    const w2 = await makeWorkspace(harness.tempRoot, 'w2', 'Workspace 2')
    const w3 = await makeWorkspace(harness.tempRoot, 'w3', 'Workspace 3')
    harness.addWorkspace(w2)
    harness.addWorkspace(w3)
    const initResponses = await Promise.all([
      harness.request('POST', '/workspace/init', { workspaceId: 'w1' }),
      harness.request('POST', '/workspace/init', { workspaceId: 'w2' }),
      harness.request('POST', '/workspace/init', { workspaceId: 'w3' }),
    ])
    initResponses.forEach(expectOk)
    const mappingFile = path.join(rootDir, '.dsh-devbench', 'workspaces.json')
    const mapping = JSON.parse(await fsp.readFile(mappingFile, 'utf8'))
    assert.deepEqual(Object.keys(mapping.workspaces).sort(), ['w1', 'w2', 'w3'])
  } finally {
    await harness.close()
  }
})


test('a stale requirement handle cannot write back after deletion', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
    harness.addWorkspace(workspace)
    const rootDir = path.join(harness.tempRoot, 'requirements')
    await configureRoot(harness, rootDir)
    await initWorkspace(harness, 'w1')
    const created = await createRequirement(harness, 'w1', 'Delete race', '# Delete race\n')
    const id = created.requirement.id
    const found = await findRequirementInWorkspace(rootDir, 'w1', id)
    const mapping = await readMapping(rootDir)
    const deleted = await deleteRequirement(rootDir, found, mapping)
    assert.equal(deleted.deleted, true)
    await fsp.access(path.join(created.requirement.folder, 'requirement.md'))
    await assert.rejects(
      updateRequirement(found, function () { return { meta: { status: 'running' } } }),
      function (error) {
        assert.equal(error.code, 'requirement-not-found')
        return true
      },
    )
    const state = expectOk(await harness.request('GET', '/state'))
    assert.equal(state.workspaces[0].requirements.length, 0)
  } finally {
    await harness.close()
  }
})
