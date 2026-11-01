import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getProjectOverview, addProject, initProjectGit, previewProjectCommit,
  confirmProjectCommit, startProjectReview, startUncommittedReview, getProjectTasks,
  cancelProjectTask, retryProjectTask, getReviewContent,
  getProjectWorktrees, getProjectWorktreeChanges, previewWorktreeCommit,
  confirmWorktreeCommit, pushWorktree, revealProjectWorktree, removeProjectWorktree,
  createProjectWorktree, pruneProjectWorktree,
  recordRequirementTask, getProjectCommitDetail, getProjectOpenTargets,
  openProjectDirectory, linkRequirementCommit, unlinkRequirementCommit,
  getProjectChanges, manualProjectCommit, pullProject, pushProject,
  searchRequirements,
} from '../../src/client/core/api.js'
import {
  projectRows, canonicalPath, activeTasks, findAwaitingCommitTask,
  findReviewForCommit, findActiveReviewTask, findActiveUncommittedReviewTask,
  taskCanCancel, taskCanRetry, changedFiles, mergeTasks,
  taskKindKey, isRequirementTask,
} from '../../src/client/core/project-utils.js'
import { createTaskRequestGate } from '../../src/client/core/task-request-gate.js'

const anyGlobal: any = globalThis

async function callWith(payload, fn) {
  const original = globalThis.fetch
  let seen = null
  anyGlobal.fetch = async function (url, init) {
    seen = {
      url: url,
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : null,
    }
    return { status: 200, json: async function () { return { ok: true, value: payload } } }
  }
  try {
    const value = await fn()
    return { value: value, seen: seen }
  } finally {
    anyGlobal.fetch = original
  }
}
test('project overview wrapper uses GET query', async function () {
  const out = await callWith({ project: {} }, function () { return getProjectOverview('w 1') })
  assert.equal(out.seen.method, 'GET')
  assert.equal(out.seen.url.indexOf('/project/overview?workspaceId=w%201') > 0, true)
  assert.deepEqual(out.value, { project: {} })
})
test('add project wrapper posts path and title', async function () {
  const out = await callWith({ created: true }, function () { return addProject({ path: '/tmp/a', title: 'A' }) })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.body.path, '/tmp/a')
  assert.equal(out.seen.body.title, 'A')
})
test('git init wrapper posts workspace id', async function () {
  const out = await callWith({ initialized: true }, function () { return initProjectGit('w1') })
  assert.deepEqual(out.seen.body, { workspaceId: 'w1' })
  assert.equal(out.seen.url.indexOf('/project/git/init') > 0, true)
})
test('commit preview wrapper posts workspace id', async function () {
  const out = await callWith({ task: { id: 't1' } }, function () { return previewProjectCommit('w1') })
  assert.deepEqual(out.seen.body, { workspaceId: 'w1' })
  assert.equal(out.seen.url.indexOf('/project/commit/preview') > 0, true)
})
test('commit confirm wrapper sends task and message', async function () {
  const out = await callWith({ commit: {} }, function () {
    return confirmProjectCommit({ workspaceId: 'w1', taskId: 't1', message: 'feat: x' })
  })
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', taskId: 't1', message: 'feat: x' })
  assert.equal(out.seen.url.indexOf('/project/commit/confirm') > 0, true)
})
test('project changes wrapper uses a GET query', async function () {
  const out = await callWith({ initialized: true, hasChanges: false }, function () {
    return getProjectChanges('w 1')
  })
  assert.equal(out.seen.method, 'GET')
  assert.equal(out.seen.url.indexOf('/project/changes?workspaceId=w%201') > 0, true)
  assert.equal(out.seen.body, null)
  assert.deepEqual(out.value, { initialized: true, hasChanges: false })
})
test('manual commit wrapper posts workspace and message', async function () {
  const out = await callWith({ commit: { short: 'abc1234' } }, function () {
    return manualProjectCommit({ workspaceId: 'w1', message: 'feat: 手动提交' })
  })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/project/commit/manual') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', message: 'feat: 手动提交' })
  assert.equal(out.value.commit.short, 'abc1234')
})
test('project pull wrapper posts workspace id', async function () {
  const out = await callWith({ pulled: true, alreadyUpToDate: false }, function () {
    return pullProject('w1')
  })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/project/pull') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1' })
})
test('project push wrapper posts workspace id', async function () {
  const out = await callWith({ pushed: true, remote: 'origin' }, function () {
    return pushProject('w1')
  })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/project/push') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1' })
  assert.equal(out.value.remote, 'origin')
})
test('review start wrapper sends commit', async function () {
  const out = await callWith({ task: { id: 't2' } }, function () {
    return startProjectReview({ workspaceId: 'w1', commit: 'abc' })
  })
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', commit: 'abc' })
  assert.equal(out.seen.url.indexOf('/project/review/start') > 0, true)
})
test('uncommitted review wrapper posts workspace id', async function () {
  const out = await callWith({ task: { id: 't3' } }, function () { return startUncommittedReview('w1') })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/project/review/uncommitted') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1' })
  assert.equal(out.value.task.id, 't3')
})
test('project tasks wrapper uses GET query', async function () {
  const out = await callWith({ tasks: [] }, function () { return getProjectTasks('w 1') })
  assert.equal(out.seen.method, 'GET')
  assert.equal(out.seen.url.indexOf('/project/tasks?workspaceId=w%201') > 0, true)
})
test('requirement task wrapper posts requirement and session identities', async function () {
  const out = await callWith({ task: { id: 'TASK-1' } }, function () {
    return recordRequirementTask({ workspaceId: 'w1', id: 'REQ-1', sessionId: 'session-1' })
  })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/requirement/execute/task') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', id: 'REQ-1', sessionId: 'session-1' })
  assert.equal(out.value.task.id, 'TASK-1')
})
test('requirement search wrapper uses a GET query with encoded scope', async function () {
  const out = await callWith({ items: [] }, function () {
    return searchRequirements('w 1', 'needle & co', 'full')
  })
  assert.equal(out.seen.method, 'GET')
  assert.equal(out.seen.url.indexOf('/requirement/search?') > 0, true)
  assert.equal(out.seen.url.indexOf('workspaceId=w%201') > 0, true)
  assert.equal(out.seen.url.indexOf('q=needle%20%26%20co') > 0, true)
  assert.equal(out.seen.url.indexOf('scope=full') > 0, true)
  assert.equal(out.seen.body, null)
  assert.deepEqual(out.value, { items: [] })
})
test('requirement search wrapper omits the scope when it is not supplied', async function () {
  const out = await callWith({ total: 0 }, function () { return searchRequirements('w1', 'needle') })
  assert.equal(out.seen.method, 'GET')
  assert.equal(out.seen.url.indexOf('workspaceId=w1') > 0, true)
  assert.equal(out.seen.url.indexOf('q=needle') > 0, true)
  assert.equal(out.seen.url.indexOf('scope=') > 0, false)
})
test('task cancel wrapper posts ids', async function () {
  const out = await callWith({ task: {} }, function () {
    return cancelProjectTask({ workspaceId: 'w1', taskId: 't1' })
  })
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', taskId: 't1' })
  assert.equal(out.seen.url.indexOf('/project/task/cancel') > 0, true)
})
test('task retry wrapper posts ids', async function () {
  const out = await callWith({ task: {} }, function () {
    return retryProjectTask({ workspaceId: 'w1', taskId: 't1' })
  })
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', taskId: 't1' })
  assert.equal(out.seen.url.indexOf('/project/task/retry') > 0, true)
})
test('review content wrapper encodes name and workspace', async function () {
  const out = await callWith({ name: 'a b.md' }, function () { return getReviewContent('w 1', 'a b.md') })
  assert.equal(out.seen.method, 'GET')
  assert.equal(out.seen.url.indexOf('workspaceId=w%201') > 0, true)
  assert.equal(out.seen.url.indexOf('name=a%20b.md') > 0, true)
})
test('project worktrees wrapper uses GET query', async function () {
  const out = await callWith({ worktrees: [] }, function () { return getProjectWorktrees('w 1') })
  assert.equal(out.seen.method, 'GET')
  assert.equal(out.seen.url.indexOf('/project/worktrees?workspaceId=w%201') > 0, true)
  assert.deepEqual(out.value, { worktrees: [] })
})
test('worktree changes wrapper uses GET query with id', async function () {
  const out = await callWith({ hasChanges: true }, function () { return getProjectWorktreeChanges('w 1', 'REQ-1') })
  assert.equal(out.seen.method, 'GET')
  assert.equal(out.seen.url.indexOf('/project/worktree/changes?') > 0, true)
  assert.equal(out.seen.url.indexOf('workspaceId=w%201') > 0, true)
  assert.equal(out.seen.url.indexOf('id=REQ-1') > 0, true)
  assert.equal(out.seen.body, null)
})
test('worktree commit preview posts workspace id and requirement id', async function () {
  const out = await callWith({ task: { id: 't1' } }, function () { return previewWorktreeCommit('w1', 'REQ-1') })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/project/worktree/commit/preview') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', id: 'REQ-1' })
})
test('worktree commit confirm posts task and message', async function () {
  const out = await callWith({ commit: {} }, function () {
    return confirmWorktreeCommit({ workspaceId: 'w1', taskId: 't1', message: 'feat: x' })
  })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/project/worktree/commit/confirm') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', taskId: 't1', message: 'feat: x' })
})
test('worktree push wrapper posts workspace and requirement id', async function () {
  const out = await callWith({ pushed: true }, function () { return pushWorktree('w1', 'REQ-1') })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/project/worktree/push') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', id: 'REQ-1' })
})
test('worktree reveal wrapper posts workspace and requirement id', async function () {
  const out = await callWith({ opened: true }, function () { return revealProjectWorktree('w1', 'REQ-1') })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/project/worktree/reveal') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', id: 'REQ-1' })
})
test('worktree reveal wrapper forwards an optional launcher target', async function () {
  const out = await callWith({ opened: true }, function () {
    return revealProjectWorktree('w1', 'REQ-1', 'vscode')
  })
  assert.equal(out.seen.method, 'POST')
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', id: 'REQ-1', target: 'vscode' })
})
test('worktree create wrapper posts workspace and requirement id', async function () {
  const out = await callWith({ worktree: {} }, function () {
    return createProjectWorktree('w1', 'REQ-1')
  })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/project/worktree/create') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', id: 'REQ-1' })
})
test('worktree prune wrapper omits the id when cleaning every missing worktree', async function () {
  const single = await callWith({ pruned: [] }, function () {
    return pruneProjectWorktree('w1', 'REQ-1')
  })
  assert.equal(single.seen.method, 'POST')
  assert.equal(single.seen.url.indexOf('/project/worktree/prune') > 0, true)
  assert.deepEqual(single.seen.body, { workspaceId: 'w1', id: 'REQ-1' })
  const all = await callWith({ pruned: [] }, function () {
    return pruneProjectWorktree('w1')
  })
  assert.deepEqual(all.seen.body, { workspaceId: 'w1' })
})
const projects = [
  { workspaceId: 'a', title: 'A', path: '/work/a', canonicalPath: '/work/a' },
  { workspaceId: 'a1', title: 'A1', path: '/work/a/sub', canonicalPath: '/work/a/sub' },
  { workspaceId: 'b', title: 'B', path: '/work/b/', canonicalPath: '/work/b/' },
  { workspaceId: 'b1', title: 'B1', path: '/work/b/c', canonicalPath: '/work/b/c' },
]
test('project rows indent nested projects and preserve ancestors on search', function () {
  const all = projectRows(projects, '')
  assert.deepEqual(all.map(function (row) { return row.project.workspaceId }), ['a', 'a1', 'b', 'b1'])
  assert.equal(all.find(function (row) { return row.project.workspaceId === 'a1' }).depth, 1)
  const found = projectRows(projects, 'sub')
  assert.deepEqual(found.map(function (row) { return row.project.workspaceId }), ['a', 'a1'])
})
test('canonical path removes trailing separators', function () {
  assert.equal(canonicalPath(projects[2]), '/work/b')
  assert.equal(canonicalPath({ path: '/x/y/' }), '/x/y')
})
test('active and awaiting commit tasks are detected', function () {
  const tasks = [
    { id: '1', kind: 'review', status: 'running' },
    { id: '2', kind: 'commit', status: 'awaiting_confirmation' },
    { id: '3', kind: 'commit', status: 'succeeded' },
  ]
  assert.deepEqual(activeTasks(tasks).map(function (task) { return task.id }), ['1', '2'])
  assert.equal(findAwaitingCommitTask(tasks).id, '2')
  assert.equal(taskCanCancel(tasks[1]), true)
  assert.equal(taskCanRetry(tasks[2]), false)
  assert.equal(taskCanRetry({ status: 'failed' }), true)
})
test('requirement tasks are labelled and expose no cancel or retry actions', function () {
  const requirementTask = { id: 'r1', kind: 'requirement', status: 'running', sessionId: 's1' }
  assert.equal(taskKindKey('requirement'), 'task.kind.requirement')
  assert.equal(taskKindKey('commit'), 'task.kind.commit')
  assert.equal(taskKindKey('review'), 'task.kind.review')
  assert.equal(isRequirementTask(requirementTask), true)
  assert.equal(isRequirementTask({ kind: 'review' }), false)
  assert.equal(taskCanCancel(requirementTask), false)
  assert.equal(taskCanRetry(Object.assign({}, requirementTask, { status: 'failed' })), false)
})
test('review lookup supports full and short commit hashes', function () {
  const reviews = [{ name: 'r.md', commit: 'abcdef123456' }]
  assert.equal(findReviewForCommit(reviews, 'abcdef123456').name, 'r.md')
  assert.equal(findReviewForCommit(reviews, 'abcdef1').name, 'r.md')
  assert.equal(findReviewForCommit(reviews, 'ffffff'), null)
  const tasks = [{ id: 'r1', kind: 'review', status: 'running', commitHash: 'abcdef123456' }]
  assert.equal(findActiveReviewTask(tasks, 'abcdef1').id, 'r1')
  assert.equal(findActiveReviewTask(tasks, 'ffffff'), null)
})
test('active uncommitted review tasks are detected separately from commit reviews', function () {
  const tasks = [
    { id: '1', kind: 'review', status: 'running', commitHash: 'abcdef123456' },
    { id: '2', kind: 'review', status: 'running', reviewTarget: 'uncommitted', commitHash: '' },
    { id: '3', kind: 'review', status: 'succeeded', reviewTarget: 'uncommitted' },
    { id: '4', kind: 'commit', status: 'awaiting_confirmation', reviewTarget: 'uncommitted' },
  ]
  assert.equal(findActiveUncommittedReviewTask(tasks).id, '2')
  assert.equal(findActiveUncommittedReviewTask([tasks[0]]), null)
  assert.equal(findActiveUncommittedReviewTask([]), null)
  assert.equal(findActiveUncommittedReviewTask(null), null)
})
test('changed files and task merging normalize task data', function () {
  assert.deepEqual(changedFiles({ changedFiles: 'a.js\nb.js' }), ['a.js', 'b.js'])
  const merged = mergeTasks(
    [{ id: '1', status: 'queued', updatedAt: '2026-01-01T00:00:00.000Z' }],
    [{ id: '1', status: 'running', updatedAt: '2026-01-02T00:00:00.000Z' }, { id: '2', status: 'queued' }],
  )
  assert.equal(merged.length, 2)
  assert.equal(merged.find(function (task) { return task.id === '1' }).status, 'running')
  const stale = mergeTasks(
    [{ id: '1', status: 'running', updatedAt: '2026-01-02T00:00:00.000Z' }],
    [{ id: '1', status: 'queued', updatedAt: '2026-01-01T00:00:00.000Z' }],
  )
  assert.equal(stale[0].status, 'running')
})

test('task request gate prevents overlap and keeps new controller after abort', function () {
  const gate = createTaskRequestGate()
  const first = gate.begin()
  assert.equal(first === null, false)
  assert.equal(gate.begin(), null)
  gate.stop()
  assert.equal(first.signal.aborted, true)
  const second = gate.begin()
  assert.equal(second === null, false)
  gate.finish(first)
  assert.equal(gate.active(), true)
  gate.finish(second)
  assert.equal(gate.active(), false)
})
test('worktree remove wrapper posts workspace and requirement id', async function () {
  const out = await callWith({ removed: true }, function () { return removeProjectWorktree('w1', 'REQ-1') })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/project/worktree/remove') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', id: 'REQ-1' })
  assert.deepEqual(out.value, { removed: true })
})
test('commit detail wrapper encodes workspace and commit', async function () {
  const out = await callWith({ files: [] }, function () {
    return getProjectCommitDetail('w 1', 'abc1234')
  })
  assert.equal(out.seen.method, 'GET')
  assert.equal(out.seen.url.indexOf('/project/commit/detail?') > 0, true)
  assert.equal(out.seen.url.indexOf('workspaceId=w%201') > 0, true)
  assert.equal(out.seen.url.indexOf('commit=abc1234') > 0, true)
  assert.equal(out.seen.body, null)
})
test('project launcher wrappers use detection and post endpoints', async function () {
  let out = await callWith({ targets: ['system'] }, function () { return getProjectOpenTargets() })
  assert.equal(out.seen.method, 'GET')
  assert.equal(out.seen.url.indexOf('/project/open-targets') > 0, true)
  assert.deepEqual(out.value, { targets: ['system'] })
  out = await callWith({ opened: true }, function () {
    return openProjectDirectory({ workspaceId: 'w1', target: 'vscode' })
  })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/project/open') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', target: 'vscode' })
})
test('requirement commit link wrappers post identities and hash', async function () {
  let out = await callWith({ requirement: {} }, function () {
    return linkRequirementCommit({ workspaceId: 'w1', id: 'REQ-1', commit: 'abc1234' })
  })
  assert.equal(out.seen.method, 'POST')
  assert.equal(out.seen.url.indexOf('/requirement/link-commit') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', id: 'REQ-1', commit: 'abc1234' })
  out = await callWith({ requirement: {} }, function () {
    return unlinkRequirementCommit({ workspaceId: 'w1', id: 'REQ-1', commit: 'abc1234' })
  })
  assert.equal(out.seen.url.indexOf('/requirement/unlink-commit') > 0, true)
  assert.deepEqual(out.seen.body, { workspaceId: 'w1', id: 'REQ-1', commit: 'abc1234' })
})
