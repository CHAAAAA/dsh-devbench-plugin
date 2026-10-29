/** Regression: background tasks must prompt with a complete, identified UserMessage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHarness, expectOk } from './helpers.js'
import { createProjectAgentServices } from './fake-agents.js'
import { git, makeGitProject } from './project-helpers.js'

/**
 * The stored-session validator of DSH 0.2.x rejects a `user/message` event
 * whose data is not a complete message: it requires a non-empty `id`, the
 * `user` role, a `source` with a non-empty `kind`, and a content array. A
 * malformed prompt is persisted silently and only fails on the next history
 * load ("session event at seq N lacks an identified message"), so assert the
 * shape here before it can regress.
 */
function assertIdentifiedUserMessage(message) {
  assert.equal(typeof message, 'object')
  assert.equal(typeof message.id, 'string')
  assert.notEqual(message.id, '')
  assert.equal(message.role, 'user')
  assert.equal(typeof message.source, 'object')
  assert.equal(message.source.kind, 'user')
  assert.equal(Array.isArray(message.content), true)
  assert.equal(message.content.length > 0, true)
  assert.equal(message.content[0].type, 'text')
  assert.equal(typeof message.content[0].text, 'string')
}

test('commit task prompts a complete identified user message', async function () {
  let harness = null
  const fake = createProjectAgentServices(function () { return harness })
  harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1 })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'changed\n')
    const preview = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    }))
    await harness.waitTask(preview.task.id)
    assert.equal(fake.followupMessages.length, 1)
    assertIdentifiedUserMessage(fake.followupMessages[0])
  } finally {
    await harness.close()
  }
})

test('review task prompts a complete identified user message', async function () {
  let harness = null
  const fake = createProjectAgentServices(function () { return harness })
  harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1 })
    const head = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    const started = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit: head,
    }))
    await harness.waitTask(started.task.id)
    assert.equal(fake.followupMessages.length, 1)
    assertIdentifiedUserMessage(fake.followupMessages[0])
  } finally {
    await harness.close()
  }
})
