import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROMPT_TEMPLATE } from '../../src/host/constants.js'
import {
  createHarness,
  makeWorkspace,
  configureRoot,
  initWorkspace,
  expectOk,
  createRequirement,
} from './helpers.js'

test('core HTTP routes preserve their request and response shapes', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
    harness.addWorkspace(workspace)
    const rootDir = path.join(harness.tempRoot, 'requirements')
    const configured = await configureRoot(harness, rootDir)
    assert.equal(configured.rootDir, rootDir)
    assert.equal(configured.config.promptTemplate, DEFAULT_PROMPT_TEMPLATE)

    expectOk(await harness.request('POST', '/config', { rootDir }))
    const rawConfig = JSON.parse(await fsp.readFile(
      path.join(harness.configDir, 'config.json'), 'utf8'))
    assert.equal(rawConfig.promptTemplate, '')

    const state = expectOk(await harness.request('GET', '/state'))
    assert.equal(state.config.promptTemplate, DEFAULT_PROMPT_TEMPLATE)
    const initialized = await initWorkspace(harness, 'w1')
    assert.equal(typeof initialized.folder, 'string')
    assert.equal(path.isAbsolute(initialized.folderPath), true)

    let invalid = await harness.request('POST', '/requirement/create', {
      workspaceId: 'w1',
      title: '',
      body: '',
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.data.error.code, 'missing-title')

    const created = expectOk(await harness.request('POST', '/requirement/create', {
      workspaceId: 'w1',
      title: 'Compatibility',
      body: '# Compatibility\n\nBody\n',
    }))
    const id = created.requirement.id
    assert.match(id, /^REQ-\d{8}-\d{3,}$/)
    assert.equal(created.body.includes('Compatibility'), true)

    let detail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: 'w1',
      id,
    }))
    assert.equal(detail.body.includes('Body'), true)
    assert.equal(Array.isArray(detail.files), true)
    assert.equal(Array.isArray(detail.requirement.commits), true)
    assert.equal(Object.prototype.hasOwnProperty.call(detail, 'gitLog'), false)

    const saved = expectOk(await harness.request('POST', '/requirement/save', {
      workspaceId: 'w1',
      id,
      title: 'Edited title',
      status: 'done',
      body: '# Edited title\n\nEdited body\n',
    }))
    assert.equal(saved.requirement.title, 'Edited title')
    assert.equal(saved.requirement.status, 'done')

    const planned = expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: 'w1',
      id,
      markRunning: false,
    }))
    assert.equal(planned.requirement.status, 'done')
    assert.equal(planned.prompt.includes('Edited body'), true)

    const executed = expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: 'w1',
      id,
    }))
    assert.equal(executed.requirement.status, 'running')
    assert.equal(executed.prompt.includes('Edited title'), true)
    assert.equal(executed.prompt.includes('Edited body'), true)

    expectOk(await harness.request('POST', '/files/create', {
      workspaceId: 'w1',
      id,
      path: 'docs',
      type: 'dir',
    }))
    expectOk(await harness.request('POST', '/files/create', {
      workspaceId: 'w1',
      id,
      path: 'docs/notes.md',
      type: 'file',
      content: 'first\n',
    }))
    const tree = expectOk(await harness.request('GET',
      '/files?workspaceId=w1&id=' + encodeURIComponent(id)))
    assert.equal(tree.kind, 'dir')
    assert.equal(tree.entries.some(function (entry) { return entry.path === 'docs' }), true)
    expectOk(await harness.request('POST', '/files/write', {
      workspaceId: 'w1',
      id,
      path: 'docs/notes.md',
      content: 'second\n',
    }))
    const file = expectOk(await harness.request('GET',
      '/files?workspaceId=w1&id=' + encodeURIComponent(id) +
      '&path=' + encodeURIComponent('docs/notes.md')))
    assert.equal(file.kind, 'file')
    assert.equal(file.content, 'second\n')

    invalid = await harness.request('POST', '/requirement/link-session', {
      workspaceId: 'w1',
      id,
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.data.error.code, 'missing-session')

    const linked = expectOk(await harness.request('POST', '/requirement/link-session', {
      workspaceId: 'w1',
      id,
      sessionId: 'session-1',
    }))
    assert.deepEqual(linked.requirement.sessions, ['session-1'])
    const sessionLink = expectOk(await harness.request('GET', '/session-link?sessionId=session-1'))
    assert.equal(sessionLink.link.workspaceId, 'w1')
    assert.equal(sessionLink.link.id, id)

    const unlinked = expectOk(await harness.request('POST', '/requirement/unlink-session', {
      workspaceId: 'w1',
      id,
      sessionId: 'session-1',
    }))
    assert.deepEqual(unlinked.requirement.sessions, [])
    expectOk(await harness.request('POST', '/requirement/save', {
      workspaceId: 'w1',
      id,
      status: 'done',
    }))

    const deleted = expectOk(await harness.request('POST', '/requirement/delete', {
      workspaceId: 'w1',
      id,
    }))
    assert.equal(deleted.deleted, true)
    assert.equal(deleted.filesPreserved, true)
    await fsp.access(path.join(deleted.folder, 'requirement.md'))
    await fsp.access(path.join(deleted.folder, 'docs', 'notes.md'))
    const missing = await harness.request('POST', '/requirement/get', { workspaceId: 'w1', id })
    assert.equal(missing.status, 404)
    const finalState = expectOk(await harness.request('GET', '/state'))
    assert.equal(finalState.workspaces[0].requirements.length, 0)
  } finally {
    await harness.close()
  }
})

test('running requirements cannot be deleted and stay in the list', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
    harness.addWorkspace(workspace)
    const rootDir = path.join(harness.tempRoot, 'requirements')
    await configureRoot(harness, rootDir)
    await initWorkspace(harness, 'w1')
    const created = await createRequirement(harness, 'w1', 'Running', '# Running\n')
    const id = created.requirement.id
    expectOk(await harness.request('POST', '/requirement/execute', { workspaceId: 'w1', id }))
    const deleted = await harness.request('POST', '/requirement/delete', { workspaceId: 'w1', id })
    assert.equal(deleted.status, 409)
    assert.equal(deleted.data.error.code, 'requirement-running')
    const found = expectOk(await harness.request('POST', '/requirement/get', { workspaceId: 'w1', id }))
    assert.equal(found.requirement.status, 'running')
    const state = expectOk(await harness.request('GET', '/state'))
    assert.equal(state.workspaces[0].requirements.length, 1)
  } finally {
    await harness.close()
  }
})
