import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  configureRoot,
  createHarness,
  expectOk,
  initWorkspace,
} from './helpers.js'
import { makeGitProject } from './project-helpers.js'
import {
  DERIVED_TASK_ID_PREFIX,
  waitForRequirementTask,
} from '../../src/host/services/requirement-tasks.js'

async function setup(options: any = {}) {
  const live = new Map()
  const harness = await createHarness([], {
    services: {
      agents: {
        get(sessionId) { return live.get(sessionId) || null },
      },
    },
  })
  const project = await makeGitProject(harness, {
    commits: options.commits === undefined ? 1 : options.commits,
    title: options.title || 'Requirement Project',
  })
  await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
  await initWorkspace(harness, project.workspaceId)
  return { harness, project, live }
}

function fakeAgent(status) {
  return {
    status: status,
    async whenIdle() {},
  }
}

async function createRequirement(harness: any, workspaceId: any, title: any, worktree?: any) {
  const created = expectOk(await harness.request('POST', '/requirement/create', {
    workspaceId,
    title,
    body: '# ' + title + '\n',
    worktree: worktree === true,
  }))
  return created.requirement
}

async function linkSession(harness, workspaceId, requirementId, sessionId) {
  return expectOk(await harness.request('POST', '/requirement/link-session', {
    workspaceId,
    id: requirementId,
    sessionId,
  }))
}

async function listTasks(harness, workspaceId) {
  return expectOk(await harness.request('GET',
    '/project/tasks?workspaceId=' + encodeURIComponent(workspaceId))).tasks
}

async function canonical(value) {
  try {
    return await fsp.realpath(value)
  } catch {
    return path.resolve(value)
  }
}

test('requirement session is recorded as a running task and completes when idle', async function () {
  const { harness, project, live } = await setup()
  try {
    const requirement = await createRequirement(harness, project.workspaceId, 'Recorded Requirement')
    const sessionId = 'session-requirement-1'
    let releaseIdle = null
    const idle = new Promise(function (resolve) { releaseIdle = resolve })
    live.set(sessionId, { status: 'running', whenIdle() { return idle } })
    await linkSession(harness, project.workspaceId, requirement.id, sessionId)

    const recorded = expectOk(await harness.request('POST', '/requirement/execute/task', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      sessionId: sessionId,
    })).task
    assert.equal(recorded.kind, 'requirement')
    assert.equal(recorded.status, 'running')
    assert.equal(recorded.title, 'Recorded Requirement')
    assert.equal(recorded.requirementId, requirement.id)
    assert.equal(recorded.sessionId, sessionId)
    assert.equal(recorded.workspaceId, project.workspaceId)
    assert.equal(recorded.projectTitle, 'Requirement Project')
    assert.equal(await canonical(recorded.projectPath), await canonical(project.projectPath))

    // While the requirement session runs, the workspace carries an active task
    // (workbench sidebar red dot) and the home dashboard lists it in both
    // recent and active tasks.
    const runningState = expectOk(await harness.request('GET', '/state'))
    const runningWorkspace = runningState.workspaces.find(function (workspace) {
      return workspace.workspaceId === project.workspaceId
    })
    assert.equal(runningWorkspace.activeTaskCount >= 1, true)
    const runningDashboard = expectOk(await harness.request('GET', '/dashboard'))
    assert.equal(runningDashboard.activeTasks.some(function (task) {
      return task.id === recorded.id && task.kind === 'requirement'
    }), true)
    assert.equal(runningDashboard.recentTasks.some(function (task) {
      return task.id === recorded.id && task.kind === 'requirement'
    }), true)
    assert.equal(runningDashboard.totals.activeTasks >= 1, true)

    releaseIdle()
    await waitForRequirementTask(recorded.id)
    const tasks = await listTasks(harness, project.workspaceId)
    const completed = tasks.find(function (task) { return task.id === recorded.id })
    assert.equal(completed.status, 'succeeded')
    assert.equal(completed.title, 'Recorded Requirement')
    const doneState = expectOk(await harness.request('GET', '/state'))
    const doneWorkspace = doneState.workspaces.find(function (workspace) {
      return workspace.workspaceId === project.workspaceId
    })
    assert.equal(doneWorkspace.activeTaskCount, 0)

    const again = expectOk(await harness.request('POST', '/requirement/execute/task', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      sessionId: sessionId,
    })).task
    assert.equal(again.id, recorded.id)
    assert.equal(tasks.filter(function (task) {
      return task.kind === 'requirement' && task.sessionId === sessionId
    }).length, 1)
  } finally {
    await harness.close()
  }
})

test('requirement task recording requires a session linked to the requirement', async function () {
  const { harness, project } = await setup()
  try {
    const requirement = await createRequirement(harness, project.workspaceId, 'Unlinked Requirement')
    const response = await harness.request('POST', '/requirement/execute/task', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      sessionId: 'session-not-linked',
    })
    assert.equal(response.status, 409)
    assert.equal(response.data.error.code, 'session-not-linked')
    const missing = await harness.request('POST', '/requirement/execute/task', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      sessionId: '',
    })
    assert.equal(missing.status, 400)
    assert.equal(missing.data.error.code, 'missing-session')
  } finally {
    await harness.close()
  }
})

test('historical requirement sessions are exposed as derived tasks and count toward the red dot', async function () {
  const { harness, project, live } = await setup()
  try {
    const finished = await createRequirement(harness, project.workspaceId, 'Historical Requirement')
    const finishedSession = 'session-history-finished'
    await linkSession(harness, project.workspaceId, finished.id, finishedSession)

    const running = await createRequirement(harness, project.workspaceId, 'Active Requirement')
    const runningSession = 'session-history-running'
    await linkSession(harness, project.workspaceId, running.id, runningSession)
    live.set(runningSession, fakeAgent('running'))

    const tasks = await listTasks(harness, project.workspaceId)
    const derivedFinished = tasks.find(function (task) {
      return task.sessionId === finishedSession
    })
    assert.equal(derivedFinished.kind, 'requirement')
    assert.equal(derivedFinished.status, 'succeeded')
    assert.equal(derivedFinished.requirementId, finished.id)
    assert.equal(derivedFinished.title, 'Historical Requirement')
    assert.equal(derivedFinished.id.startsWith(DERIVED_TASK_ID_PREFIX), true)

    const derivedRunning = tasks.find(function (task) {
      return task.sessionId === runningSession
    })
    assert.equal(derivedRunning.status, 'running')
    assert.equal(derivedRunning.title, 'Active Requirement')

    const state = expectOk(await harness.request('GET', '/state'))
    const workspace = state.workspaces.find(function (item) {
      return item.workspaceId === project.workspaceId
    })
    assert.equal(workspace.activeTaskCount, 1)

    const dashboard = expectOk(await harness.request('GET', '/dashboard'))
    assert.equal(dashboard.activeTasks.some(function (task) {
      return task.sessionId === runningSession && task.status === 'running'
    }), true)
    assert.equal(dashboard.recentTasks.some(function (task) {
      return task.sessionId === finishedSession
    }), true)
  } finally {
    await harness.close()
  }
})

test('recorded requirement tasks win over derived rows and keep the worktree project path', async function () {
  const { harness, project, live } = await setup()
  try {
    const requirement = await createRequirement(harness, project.workspaceId, 'Worktree Requirement', true)
    const executed = expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      markRunning: false,
    }))
    assert.equal(executed.worktree.enabled, true)
    assert.equal(executed.worktree.exists, true)
    const sessionId = 'session-worktree-1'
    live.set(sessionId, fakeAgent('idle'))
    await linkSession(harness, project.workspaceId, requirement.id, sessionId)

    const recorded = expectOk(await harness.request('POST', '/requirement/execute/task', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      sessionId: sessionId,
    })).task
    assert.equal(await canonical(recorded.projectPath), await canonical(executed.worktree.path))
    await waitForRequirementTask(recorded.id)

    const tasks = await listTasks(harness, project.workspaceId)
    const matching = tasks.filter(function (task) { return task.sessionId === sessionId })
    assert.equal(matching.length, 1)
    assert.equal(matching[0].id, recorded.id)
    assert.equal(matching[0].id.startsWith(DERIVED_TASK_ID_PREFIX), false)
  } finally {
    await harness.close()
  }
})
