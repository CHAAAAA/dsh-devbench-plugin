import { promises as fsp } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  createHarness,
  makeWorkspace,
  configureRoot,
  initWorkspace,
  createRequirement,
  expectOk,
  runTool,
} from './helpers.js'

test('requirements are isolated by workspace and duplicate IDs are ambiguous', async function () {
  const harness = await createHarness([])
  try {
    const workspaceA = await makeWorkspace(harness.tempRoot, 'a', 'Workspace A')
    const workspaceB = await makeWorkspace(harness.tempRoot, 'b', 'Workspace B')
    harness.addWorkspace(workspaceA)
    harness.addWorkspace(workspaceB)
    const rootDir = path.join(harness.tempRoot, 'requirements')
    await configureRoot(harness, rootDir)
    await initWorkspace(harness, 'a')
    await initWorkspace(harness, 'b')

    const bFirst = await createRequirement(harness, 'b', 'B first', '# B first workspace-only\n')
    const bSecond = await createRequirement(harness, 'b', 'B second', '# B second workspace-only\n')
    const id = bFirst.requirement.id

    let response = await harness.request('POST', '/requirement/get', {
      workspaceId: 'a',
      id,
    })
    assert.equal(response.status, 404)
    response = await harness.request('POST', '/requirement/delete', {
      workspaceId: 'a',
      id: bSecond.requirement.id,
    })
    assert.equal(response.status, 404)
    await fsp.access(path.join(bSecond.requirement.folder, 'requirement.md'))

    const aFirst = await createRequirement(harness, 'a', 'A first', '# A first workspace-only\n')
    assert.equal(aFirst.requirement.id, id)

    const aDetail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: 'a',
      id,
    }))
    assert.equal(aDetail.body.includes('A first workspace-only'), true)
    assert.equal(aDetail.body.includes('B first workspace-only'), false)

    const aDocument = path.join(aFirst.requirement.folder, 'requirement.md')
    const bDocument = path.join(bFirst.requirement.folder, 'requirement.md')
    const aBefore = await fsp.readFile(aDocument, 'utf8')
    const bBefore = await fsp.readFile(bDocument, 'utf8')
    let result = await runTool(harness, 'requirement_update', {
      requirement_id: id,
      content: '# changed\n',
    })
    assert.equal(result.ok, false)
    assert.equal(await fsp.readFile(aDocument, 'utf8'), aBefore)
    assert.equal(await fsp.readFile(bDocument, 'utf8'), bBefore)

    result = await runTool(harness, 'requirement_update', {
      requirement_id: id,
      workspace_id: 'b',
      content: '# changed in B\n',
    })
    assert.equal(result.ok, true)
    assert.equal((await fsp.readFile(aDocument, 'utf8')), aBefore)
    assert.equal((await fsp.readFile(bDocument, 'utf8')).includes('changed in B'), true)
  } finally {
    await harness.close()
  }
})
