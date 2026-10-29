import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHarness, expectOk, makeWorkspace, waitForTaskStatus } from './helpers.js'
import { createFakeAgentServices } from './fake-agents.js'
import { git, makeGitProject } from './project-helpers.js'
import { createTask, readTasks, tasksFilePath, toTaskDto, updateTask } from '../../src/host/storage/tasks.js'
import { messages } from '../../src/host/messages/index.js'

function taskFixture(index, status) {
  const date = '2026-10-26T00:00:00.000Z'
  return {
    id: 'TASK-20261026-' + String(index).padStart(3, '0'),
    kind: 'commit',
    status,
    workspaceId: 'w1',
    projectPath: '/tmp/project',
    projectTitle: 'Project',
    sessionId: '',
    prompt: 'secret prompt',
    diffText: 'secret diff',
    baseHead: '',
    fingerprint: '',
    changedFiles: [],
    proposedMessage: '',
    commitHash: '',
    commitShort: '',
    commitSubject: '',
    reviewFile: '',
    error: '',
    createdAt: date,
    updatedAt: date,
  }
}

test('startup recovery fails interrupted tasks and preserves awaiting confirmation', async function () {
  const harness = await createHarness([], {
    async beforeApply(context) {
      await fsp.mkdir(context.configDir, { recursive: true })
      const tasks = [
        taskFixture(1, 'queued'),
        taskFixture(2, 'running'),
        taskFixture(3, 'awaiting_confirmation'),
        taskFixture(4, 'succeeded'),
      ]
      await fsp.writeFile(path.join(context.configDir, 'tasks.json'),
        JSON.stringify({ version: 1, tasks }))
    },
  })
  try {
    const tasks = await readTasks()
    const byId = new Map(tasks.map(function (task) { return [task.id, task] }))
    assert.equal(byId.get('TASK-20261026-001').status, 'failed')
    assert.equal(byId.get('TASK-20261026-002').status, 'failed')
    assert.equal(byId.get('TASK-20261026-003').status, 'awaiting_confirmation')
    assert.equal(byId.get('TASK-20261026-004').status, 'succeeded')
    assert.equal(byId.get('TASK-20261026-001').error.length > 0, true)
    const dto = toTaskDto(byId.get('TASK-20261026-003'))
    assert.equal('prompt' in dto, false)
    assert.equal('diffText' in dto, false)
  } finally {
    await harness.close()
  }
})

test('state counts queued, running and awaiting tasks only', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
    harness.addWorkspace(workspace)
    for (const status of ['queued', 'running', 'awaiting_confirmation', 'succeeded', 'failed', 'cancelled']) {
      await createTask({
        kind: 'review',
        status,
        workspaceId: 'w1',
        projectPath: workspace.path,
        projectTitle: workspace.title,
      })
    }
    const state = expectOk(await harness.request('GET', '/state'))
    const projectState = state.workspaces.find(function (item) {
      return item.workspaceId === 'w1'
    })
    assert.equal(projectState.activeTaskCount, 3)
  } finally {
    await harness.close()
  }
})

test('background tasks fail clearly when agent services are missing', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'No Agent' })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'changed\n')
    const preview = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    }))
    const failed = await waitForTaskStatus(harness, project.workspaceId, preview.task.id, ['failed'])
    assert.equal(failed.error.includes(messages.agentServiceUnavailable), true)
    assert.equal('prompt' in failed, false)
    assert.equal('diffText' in failed, false)
  } finally {
    await harness.close()
  }
})

test('running tasks can be cancelled and retried with the original prompt', async function () {
  const fake = createFakeAgentServices({ waitForCancel: true })
  const harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Retry Project' })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'changed\n')
    const preview = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    }))
    const taskId = preview.task.id
    await waitForTaskStatus(harness, project.workspaceId, taskId, ['running'])
    const listed = expectOk(await harness.request('GET',
      '/project/tasks?workspaceId=' + encodeURIComponent(project.workspaceId)))
    const runningTask = listed.tasks.find(function (item) { return item.id === taskId })
    const workspace = harness.ctx.workspaceRegistry.get(project.workspaceId)
    assert.equal(workspace.sessionIds.includes(runningTask.sessionId), true)
    let result = expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId,
    }))
    assert.equal(result.task.status, 'cancelled')
    assert.equal(fake.cancelCalls.length, 1)

    result = expectOk(await harness.request('POST', '/project/task/retry', {
      workspaceId: project.workspaceId,
      taskId,
    }))
    assert.equal(result.task.status, 'queued')
    await waitForTaskStatus(harness, project.workspaceId, taskId, ['running'])
    assert.equal(fake.followupMessages.length, 2)
    const firstText = fake.followupMessages[0].content[0].text
    const secondText = fake.followupMessages[1].content[0].text
    assert.equal(secondText, firstText)
    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId,
    }))
    await harness.waitTask(taskId)
  } finally {
    await harness.close()
  }
})

test('state reports active task dots and review sessions attach to the project workspace', async function () {
  const fake = createFakeAgentServices({ waitForCancel: true })
  const harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Active Indicator' })
    const commit = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    const started = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit,
    }))
    await waitForTaskStatus(harness, project.workspaceId, started.task.id, ['running'])
    const workspace = harness.ctx.workspaceRegistry.get(project.workspaceId)
    const deadline = Date.now() + 1000
    while (workspace.sessionIds.length === 0 && Date.now() < deadline) {
      await new Promise(function (resolve) { setTimeout(resolve, 10) })
    }
    const listed = expectOk(await harness.request('GET',
      '/project/tasks?workspaceId=' + encodeURIComponent(project.workspaceId)))
    const task = listed.tasks.find(function (item) { return item.id === started.task.id })
    assert.equal(task.sessionId.length > 0, true)
    assert.equal(workspace.sessionIds.includes(task.sessionId), true)
    let state = expectOk(await harness.request('GET', '/state'))
    let projectState = state.workspaces.find(function (item) {
      return item.workspaceId === project.workspaceId
    })
    assert.equal(projectState.activeTaskCount, 1)
    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: started.task.id,
    }))
    await harness.waitTask(started.task.id)
    state = expectOk(await harness.request('GET', '/state'))
    projectState = state.workspaces.find(function (item) {
      return item.workspaceId === project.workspaceId
    })
    assert.equal(projectState.activeTaskCount, 0)
  } finally {
    await harness.close()
  }
})

test('task fails before prompt when its session cannot attach to the workspace', async function () {
  const fake = createFakeAgentServices()
  const harness = await createHarness([], {
    services: fake.services,
    async createWorkspace(projectPath, title) {
      return {
        id: 'workspace-attach-failure',
        title: title || 'Attach Failure',
        path: projectPath,
        sessionIds: [],
        async attachSession() {
          throw new Error('attach failed')
        },
      }
    },
  })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Attach Failure' })
    const commit = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    const started = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit,
    }))
    const failed = await waitForTaskStatus(harness, project.workspaceId,
      started.task.id, ['failed'])
    assert.equal(failed.error.includes('attach failed'), true)
    await harness.waitTask(started.task.id)
    assert.equal(fake.followupMessages.length, 0)
    assert.equal(fake.disposeCalls.length > 0, true)
  } finally {
    await harness.close()
  }
})

test('review start returns conflict while a review task is already active', async function () {
  const fake = createFakeAgentServices({ waitForCancel: true })
  const harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Active Review' })
    const commit = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    const started = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit,
    }))
    await waitForTaskStatus(harness, project.workspaceId, started.task.id, ['running'])
    const duplicate = await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit,
    })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.data.error.code, 'review-in-progress')
    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: started.task.id,
    }))
    await harness.waitTask(started.task.id)
  } finally {
    await harness.close()
  }
})

test('task storage keeps only the most recent 200 records', async function () {
  const harness = await createHarness([])
  try {
    const tasks = []
    for (let index = 1; index <= 205; index += 1) {
      tasks.push(taskFixture(index, 'succeeded'))
    }
    const file = tasksFilePath()
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, JSON.stringify({ version: 1, tasks }))
    await updateTask('TASK-20261026-205', 'w1', function () { return { error: 'updated' } })
    const stored = await readTasks()
    assert.equal(stored.length, 200)
    assert.equal(stored.some(function (task) { return task.id === 'TASK-20261026-001' }), false)
    assert.equal(stored.some(function (task) { return task.id === 'TASK-20261026-205' }), true)
  } finally {
    await harness.close()
  }
})

test('idle background agents fail tasks that did not complete their tool call', async function () {
  const fake = createFakeAgentServices()
  const harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Idle Agents' })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'idle change\n')
    const preview = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    }))
    const commitFailed = await waitForTaskStatus(harness, project.workspaceId,
      preview.task.id, ['failed'])
    assert.equal(commitFailed.error, messages.commitTaskIdle)
    const commit = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    const review = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit,
    }))
    const reviewFailed = await waitForTaskStatus(harness, project.workspaceId,
      review.task.id, ['failed'])
    assert.equal(reviewFailed.error, messages.reviewTaskIdle)
  } finally {
    await harness.close()
  }
})

test('concurrent review start creates only one task', async function () {
  const fake = createFakeAgentServices({ waitForCancel: true })
  const harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Concurrent Review' })
    const commit = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    const body = { workspaceId: project.workspaceId, commit }
    const responses = await Promise.all([
      harness.request('POST', '/project/review/start', body),
      harness.request('POST', '/project/review/start', body),
    ])
    const ok = responses.filter(function (item) { return item.status === 200 })
    const conflicts = responses.filter(function (item) { return item.status === 409 })
    assert.equal(ok.length, 1)
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0].data.error.code, 'review-in-progress')
    const task = ok[0].data.value.task
    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: task.id,
    }))
    await harness.waitTask(task.id)
  } finally {
    await harness.close()
  }
})
