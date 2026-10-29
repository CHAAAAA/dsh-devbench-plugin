import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHarness, expectOk, waitForTaskStatus } from './helpers.js'
import { createFakeAgentServices } from './fake-agents.js'
import { git, makeGitProject } from './project-helpers.js'
import { runTool } from './helpers.js'

async function taskById(harness, workspaceId, taskId) {
  const value = expectOk(await harness.request('GET',
    '/project/tasks?workspaceId=' + encodeURIComponent(workspaceId)))
  return value.tasks.find(function (task) { return task.id === taskId })
}

test('commit propose tool enforces kind, state, session and Chinese message', async function () {
  const fake = createFakeAgentServices({ waitForCancel: true })
  const harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Tool Commit' })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'tool change\n')
    const preview = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    }))
    const taskId = preview.task.id
    await waitForTaskStatus(harness, project.workspaceId, taskId, ['running'])
    const task = await taskById(harness, project.workspaceId, taskId)
    assert.equal(task.sessionId.length > 0, true)
    assert.equal(harness.tools.has('project_commit_propose'), true)
    assert.equal(harness.tools.has('project_review_write'), true)
    assert.equal(harness.tools.has('project_git_show'), true)

    let result = await runTool(harness, 'project_commit_propose', {
      task_id: taskId,
      message: '\u63d0\u4ea4\u6d4b\u8bd5',
    }, { agent: { session: { id: 'wrong' } } })
    assert.equal(result.ok, false)
    result = await runTool(harness, 'project_commit_propose', {
      task_id: taskId,
      message: 'english message',
    }, { agent: { session: { id: task.sessionId } } })
    assert.equal(result.ok, false)
    result = await runTool(harness, 'project_git_show', { task_id: taskId },
      { agent: { session: { id: task.sessionId } } })
    assert.equal(result.ok, false)
    result = await runTool(harness, 'project_commit_propose', {
      task_id: taskId,
      message: '\u63d0\u4ea4\u6d4b\u8bd5',
    }, { agent: { session: { id: task.sessionId } } })
    assert.equal(result.ok, true)
    await waitForTaskStatus(harness, project.workspaceId, taskId, ['awaiting_confirmation'])
    result = await runTool(harness, 'project_commit_propose', {
      task_id: taskId,
      message: '\u7b2c\u4e8c\u6b21',
    }, { agent: { session: { id: task.sessionId } } })
    assert.equal(result.ok, false)
    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId,
    }))
    await harness.waitTask(taskId)
  } finally {
    await harness.close()
  }
})

test('review tools are session-bound and write a review only once', async function () {
  const fake = createFakeAgentServices({ waitForCancel: true })
  const harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Tool Review' })
    const commit = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    const started = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit,
    }))
    const taskId = started.task.id
    await waitForTaskStatus(harness, project.workspaceId, taskId, ['running'])
    const task = await taskById(harness, project.workspaceId, taskId)

    let result = await runTool(harness, 'project_git_show', { task_id: taskId },
      { agent: { session: { id: 'wrong' } } })
    assert.equal(result.ok, false)
    result = await runTool(harness, 'project_git_show', { task_id: taskId },
      { agent: { session: { id: task.sessionId } } })
    assert.equal(result.ok, true)
    assert.equal(result.content.includes('file.txt'), true)
    result = await runTool(harness, 'project_commit_propose', {
      task_id: taskId,
      message: '\u63d0\u4ea4',
    }, { agent: { session: { id: task.sessionId } } })
    assert.equal(result.ok, false)
    result = await runTool(harness, 'project_review_write', {
      task_id: taskId,
      summary: 'bound review',
      content: '# Bound review\n',
    }, { agent: { session: { id: 'wrong' } } })
    assert.equal(result.ok, false)
    result = await runTool(harness, 'project_review_write', {
      task_id: taskId,
      summary: 'bound review',
      content: '# Bound review\n',
    }, { agent: { session: { id: task.sessionId } } })
    assert.equal(result.ok, true)
    const done = await waitForTaskStatus(harness, project.workspaceId, taskId, ['succeeded'])
    assert.equal(done.reviewFile.endsWith('.md'), true)
    await fsp.access(path.join(project.projectPath, '.dsh-reviews', done.reviewFile))
    result = await runTool(harness, 'project_review_write', {
      task_id: taskId,
      summary: 'second',
      content: '# second\n',
    }, { agent: { session: { id: task.sessionId } } })
    assert.equal(result.ok, false)
    await fake.handles[0].agent.cancel({ kind: 'user' })
    await harness.waitTask(taskId)
  } finally {
    await harness.close()
  }
})
