/**
 * Host safety hardening regression tests (P0/P1 of the UX implementation contract):
 * task-kind restrictions, active-task delete/worktree guards, worktree-gone,
 * markRunning semantics, expectedUpdatedAt conflicts, per-session task dedupe,
 * worktreeRoot guard, and corrupt task storage degradation.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  configureRoot,
  createHarness,
  expectOk,
  initWorkspace,
  makeWorkspace,
  waitForTaskStatus,
} from './helpers.js'
import { createProjectAgentServices } from './fake-agents.js'
import { git, makeGitProject } from './project-helpers.js'
import {
  createTask,
  readTasks,
  updateTask,
} from '../../src/host/storage/tasks.js'
import { messages } from '../../src/host/messages/index.js'

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

async function createReq(harness, workspaceId, title, worktree) {
  const created = expectOk(await harness.request('POST', '/requirement/create', {
    workspaceId,
    title,
    body: '# ' + title + '\n',
    worktree: worktree === true,
  }))
  return created.requirement
}

async function setupPlainRequirement() {
  const harness = await createHarness([])
  const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
  harness.addWorkspace(workspace)
  await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
  await initWorkspace(harness, 'w1')
  return { harness, workspace }
}

async function setupGitRequirement(options = {}) {
  let harness = null
  const fake = createProjectAgentServices(function () { return harness })
  harness = await createHarness([], { services: fake.services })
  const project = await makeGitProject(harness, {
    commits: 1,
    title: options.title || 'Safety Project',
  })
  await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
  await initWorkspace(harness, project.workspaceId)
  const requirement = await createReq(harness, project.workspaceId, options.requirementTitle || 'Safety Requirement', true)
  const executed = expectOk(await harness.request('POST', '/requirement/execute', {
    workspaceId: project.workspaceId,
    id: requirement.id,
    markRunning: false,
  }))
  return { harness, project, requirement, executed, fake }
}

async function requirementWorktreePath(projectPath, requirementId) {
  const result = await git(projectPath, ['worktree', 'list', '--porcelain'])
  const line = result.stdout.split('\n').find(function (item) {
    return item.startsWith('worktree ') && item.includes(requirementId)
  })
  return line === undefined ? '' : line.slice('worktree '.length).trim()
}

test('task cancel and retry reject requirement tasks with task-kind-mismatch', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
    harness.addWorkspace(workspace)
    const running = await createTask({
      kind: 'requirement',
      status: 'running',
      workspaceId: 'w1',
      projectPath: workspace.path,
      requirementId: 'REQ-20261026-001',
      title: 'Requirement task',
    })
    const failed = await createTask({
      kind: 'requirement',
      status: 'failed',
      workspaceId: 'w1',
      projectPath: workspace.path,
      requirementId: 'REQ-20261026-002',
      title: 'Failed requirement task',
    })

    let response = await harness.request('POST', '/project/task/cancel', {
      workspaceId: 'w1',
      taskId: running.id,
    })
    assert.equal(response.status, 409)
    assert.equal(response.data.error.code, 'task-kind-mismatch')
    assert.equal(response.data.error.message, messages.projectTaskKindMismatch)

    response = await harness.request('POST', '/project/task/retry', {
      workspaceId: 'w1',
      taskId: failed.id,
    })
    assert.equal(response.status, 409)
    assert.equal(response.data.error.code, 'task-kind-mismatch')

    // Commit/review tasks keep their existing cancel/retry behaviour.
    const commitTask = await createTask({
      kind: 'commit',
      status: 'running',
      workspaceId: 'w1',
      projectPath: workspace.path,
    })
    response = await harness.request('POST', '/project/task/cancel', {
      workspaceId: 'w1',
      taskId: commitTask.id,
    })
    assert.equal(response.status, 200)
    assert.equal(response.data.value.task.status, 'cancelled')
  } finally {
    await harness.close()
  }
})

test('requirement delete is blocked while one of its tasks is active', async function () {
  const { harness } = await setupPlainRequirement()
  try {
    const requirement = await createReq(harness, 'w1', 'Delete Guard')
    const task = await createTask({
      kind: 'requirement',
      status: 'running',
      workspaceId: 'w1',
      projectPath: '/tmp/project',
      requirementId: requirement.id,
    })

    let response = await harness.request('POST', '/requirement/delete', {
      workspaceId: 'w1',
      id: requirement.id,
    })
    assert.equal(response.status, 409)
    assert.equal(response.data.error.code, 'requirement-task-active')
    assert.equal(response.data.error.message, messages.requirementTaskActive)
    expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: 'w1',
      id: requirement.id,
    }))

    await updateTask(task.id, 'w1', function () { return { status: 'succeeded' } })
    response = await harness.request('POST', '/requirement/delete', {
      workspaceId: 'w1',
      id: requirement.id,
    })
    const value = expectOk(response)
    assert.equal(value.deleted, true)
    assert.equal(value.filesPreserved, true)
  } finally {
    await harness.close()
  }
})

test('requirement worktree removal is blocked while a requirement task is running', async function () {
  const { harness, project, requirement, executed } = await setupGitRequirement()
  try {
    const task = await createTask({
      kind: 'requirement',
      status: 'running',
      workspaceId: project.workspaceId,
      projectPath: executed.cwd,
      requirementId: requirement.id,
    })
    const response = await harness.request('POST', '/requirement/worktree/remove', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(response.status, 409)
    assert.equal(response.data.error.code, 'worktree-in-use')
    assert.equal(response.data.error.message, messages.worktreeInUse)
    await fsp.access(executed.cwd)

    await updateTask(task.id, project.workspaceId, function () { return { status: 'succeeded' } })
    const removed = expectOk(await harness.request('POST', '/requirement/worktree/remove', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(removed.removed, true)
  } finally {
    await harness.close()
  }
})

test('project worktree removal is blocked while its commit task awaits confirmation', async function () {
  const { harness, project, requirement, executed } = await setupGitRequirement()
  try {
    await fsp.writeFile(path.join(executed.cwd, 'pending.txt'), 'pending\n')
    const preview = expectOk(await harness.request('POST', '/project/worktree/commit/preview', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    await waitForTaskStatus(harness, project.workspaceId, preview.task.id, ['awaiting_confirmation'])

    let response = await harness.request('POST', '/project/worktree/remove', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(response.status, 409)
    assert.equal(response.data.error.code, 'worktree-in-use')

    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: preview.task.id,
    }))
    await harness.waitTask(preview.task.id)
    await git(executed.cwd, ['add', '-A'])
    await git(executed.cwd, ['commit', '-m', 'manual commit'])
    response = await harness.request('POST', '/project/worktree/remove', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(response.status, 200)
    assert.equal(response.data.value.removed, true)
  } finally {
    await harness.close()
  }
})

test('confirming a worktree commit whose worktree vanished fails the task with worktree-gone', async function () {
  const { harness, project, requirement, executed } = await setupGitRequirement()
  try {
    await fsp.writeFile(path.join(executed.cwd, 'gone.txt'), 'gone\n')
    const preview = expectOk(await harness.request('POST', '/project/worktree/commit/preview', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    await waitForTaskStatus(harness, project.workspaceId, preview.task.id, ['awaiting_confirmation'])
    const registered = await requirementWorktreePath(project.projectPath, requirement.id)
    assert.notEqual(registered, '')
    await git(project.projectPath, ['worktree', 'remove', '--force', registered])

    const response = await harness.request('POST', '/project/worktree/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId: preview.task.id,
    })
    assert.equal(response.status, 404)
    assert.equal(response.data.error.code, 'worktree-gone')
    const tasks = expectOk(await harness.request('GET',
      '/project/tasks?workspaceId=' + encodeURIComponent(project.workspaceId))).tasks
    const failed = tasks.find(function (task) { return task.id === preview.task.id })
    assert.equal(failed.status, 'failed')
    assert.equal(failed.error, messages.worktreeGone)
  } finally {
    await harness.close()
  }
})

test('requirement execute honours markRunning:false and defaults to running', async function () {
  const { harness } = await setupPlainRequirement()
  try {
    const requirement = await createReq(harness, 'w1', 'Execute Semantics')
    let value = expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: 'w1',
      id: requirement.id,
      markRunning: false,
    }))
    assert.equal(value.requirement.status, 'new')
    assert.equal(value.prompt.includes('Execute Semantics'), true)

    value = expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: 'w1',
      id: requirement.id,
    }))
    assert.equal(value.requirement.status, 'running')

    const invalid = await harness.request('POST', '/requirement/execute', {
      workspaceId: 'w1',
      id: requirement.id,
      markRunning: 'yes',
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.data.error.code, 'bad-field')
  } finally {
    await harness.close()
  }
})

test('requirement save rejects stale expectedUpdatedAt and force bypasses it', async function () {
  const { harness } = await setupPlainRequirement()
  try {
    const requirement = await createReq(harness, 'w1', 'Conflict Guard')
    const detail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: 'w1',
      id: requirement.id,
    }))
    const firstUpdatedAt = detail.requirement.updatedAt
    await delay(20)

    let response = await harness.request('POST', '/requirement/save', {
      workspaceId: 'w1',
      id: requirement.id,
      title: 'Conflict Guard v2',
      expectedUpdatedAt: firstUpdatedAt,
    })
    let saved = expectOk(response)
    assert.equal(saved.requirement.title, 'Conflict Guard v2')
    assert.notEqual(saved.requirement.updatedAt, firstUpdatedAt)

    response = await harness.request('POST', '/requirement/save', {
      workspaceId: 'w1',
      id: requirement.id,
      body: '# stale overwrite\n',
      expectedUpdatedAt: firstUpdatedAt,
    })
    assert.equal(response.status, 409)
    assert.equal(response.data.error.code, 'requirement-conflict')
    assert.equal(response.data.error.message, messages.requirementConflict)

    response = await harness.request('POST', '/requirement/save', {
      workspaceId: 'w1',
      id: requirement.id,
      body: '# forced overwrite\n',
      expectedUpdatedAt: firstUpdatedAt,
      force: true,
    })
    saved = expectOk(response)
    assert.equal(saved.requirement.id, requirement.id)
    const finalDetail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: 'w1',
      id: requirement.id,
    }))
    assert.equal(finalDetail.body.includes('forced overwrite'), true)
  } finally {
    await harness.close()
  }
})

test('recordRequirementTask deduplicates concurrent reports of one session', async function () {
  const live = new Map()
  const harness = await createHarness([], {
    services: {
      agents: {
        get(sessionId) { return live.get(sessionId) || null },
      },
    },
  })
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
    harness.addWorkspace(workspace)
    await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
    await initWorkspace(harness, 'w1')
    const requirement = await createReq(harness, 'w1', 'Dedupe Requirement')
    const sessionId = 'session-dedupe-1'
    live.set(sessionId, {
      status: 'running',
      whenIdle() { return new Promise(function () {}) },
    })
    expectOk(await harness.request('POST', '/requirement/link-session', {
      workspaceId: 'w1',
      id: requirement.id,
      sessionId,
    }))

    const responses = await Promise.all([
      harness.request('POST', '/requirement/execute/task', {
        workspaceId: 'w1', id: requirement.id, sessionId,
      }),
      harness.request('POST', '/requirement/execute/task', {
        workspaceId: 'w1', id: requirement.id, sessionId,
      }),
    ])
    assert.deepEqual(responses.map(function (item) { return item.status }), [200, 200])
    const ids = responses.map(function (item) {
      return item.data.value.task.id
    })
    assert.equal(ids[0], ids[1])
    const tasks = await readTasks()
    const matching = tasks.filter(function (task) { return task.sessionId === sessionId })
    assert.equal(matching.length, 1)
  } finally {
    await harness.close()
  }
})

test('config rejects worktreeRoot changes while plugin worktrees exist', async function () {
  const { harness, project, requirement } = await setupGitRequirement()
  try {
    const newRoot = path.join(harness.tempRoot, 'other-worktrees')
    let response = await harness.request('POST', '/config', { worktreeRoot: newRoot })
    assert.equal(response.status, 409)
    assert.equal(response.data.error.code, 'worktree-root-in-use')
    assert.equal(response.data.error.message, messages.worktreeRootInUse)

    expectOk(await harness.request('POST', '/requirement/worktree/remove', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    response = await harness.request('POST', '/config', { worktreeRoot: newRoot })
    let state = expectOk(response)
    assert.equal(path.isAbsolute(state.config.worktreeRoot), true)

    // A worktree created under the custom root blocks clearing it back to default.
    const executed = expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      markRunning: false,
    }))
    assert.equal(executed.worktree.exists, true)
    response = await harness.request('POST', '/config', { worktreeRoot: '' })
    assert.equal(response.status, 409)
    assert.equal(response.data.error.code, 'worktree-root-in-use')

    expectOk(await harness.request('POST', '/requirement/worktree/remove', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    response = await harness.request('POST', '/config', { worktreeRoot: '' })
    state = expectOk(response)
    assert.equal(state.config.worktreeRoot, '')
  } finally {
    await harness.close()
  }
})

test('project task endpoints degrade to 503 tasks-unavailable on corrupt task storage', async function () {
  const harness = await createHarness([], {
    async beforeApply(context) {
      await fsp.mkdir(context.configDir, { recursive: true })
      await fsp.writeFile(path.join(context.configDir, 'tasks.json'), '{not valid json')
    },
  })
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Workspace 1')
    harness.addWorkspace(workspace)

    let response = await harness.request('GET',
      '/project/tasks?workspaceId=' + encodeURIComponent('w1'))
    assert.equal(response.status, 503)
    assert.equal(response.data.error.code, 'tasks-unavailable')
    assert.equal(response.data.error.message, messages.tasksUnavailable)

    response = await harness.request('GET',
      '/project/overview?workspaceId=' + encodeURIComponent('w1'))
    assert.equal(response.status, 503)
    assert.equal(response.data.error.code, 'tasks-unavailable')

    // /state stays tolerant and reports no task indicators instead of failing.
    const state = expectOk(await harness.request('GET', '/state'))
    assert.equal(state.workspaces.length, 1)
    assert.equal(state.workspaces[0].activeTaskCount, 0)
  } finally {
    await harness.close()
  }
})
