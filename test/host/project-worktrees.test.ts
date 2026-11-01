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
import { addProject, git, makeGitProject } from './project-helpers.js'

function projectHarness(options: any = {}) {
  let harness = null
  const opts = options || {}
  const fake = createProjectAgentServices(function () { return harness }, opts)
  return createHarness([], Object.assign({ services: fake.services }, opts.harness))
    .then(function (value) {
      harness = value
      value.agentFake = fake
      return value
    })
}

async function canonical(value) {
  try {
    return await fsp.realpath(value)
  } catch {
    return path.resolve(value)
  }
}

/** A git project with one worktree-flagged requirement whose worktree is created. */
async function setupWorktree(options: any = {}) {
  const harness = await projectHarness(options)
  const project = await makeGitProject(harness, {
    commits: options.commits === undefined ? 1 : options.commits,
    title: options.title || 'Worktree Project',
  })
  await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
  await initWorkspace(harness, project.workspaceId)
  const created = expectOk(await harness.request('POST', '/requirement/create', {
    workspaceId: project.workspaceId,
    title: options.requirementTitle || 'Worktree Requirement',
    body: '# 工作树需求\n',
    worktree: true,
  }))
  const executed = expectOk(await harness.request('POST', '/requirement/execute', {
    workspaceId: project.workspaceId,
    id: created.requirement.id,
    markRunning: false,
  }))
  const branch = (await git(project.projectPath, ['symbolic-ref', '--short', 'HEAD']))
    .stdout.trim()
  return {
    harness,
    project,
    requirement: created.requirement,
    worktreePath: executed.cwd,
    branch,
  }
}

async function listWorktrees(harness, workspaceId) {
  return expectOk(await harness.request('GET',
    '/project/worktrees?workspaceId=' + encodeURIComponent(workspaceId)))
}

async function worktreeChanges(harness, workspaceId, id) {
  return expectOk(await harness.request('GET',
    '/project/worktree/changes?workspaceId=' + encodeURIComponent(workspaceId) +
    '&id=' + encodeURIComponent(id)))
}

async function projectTasks(harness, workspaceId) {
  return expectOk(await harness.request('GET',
    '/project/tasks?workspaceId=' + encodeURIComponent(workspaceId))).tasks
}

async function makeBareRemote(harness, name) {
  const remotePath = path.join(harness.tempRoot, name || 'remote.git')
  await git(harness.tempRoot, ['init', '--bare', remotePath])
  return remotePath
}

test('worktree list exposes plugin worktrees with requirement and git metadata', async function () {
  const { harness, project, requirement, worktreePath, branch } = await setupWorktree({
    title: 'List Project',
    requirementTitle: 'Listed Requirement',
  })
  try {
    const listed = await listWorktrees(harness, project.workspaceId)
    assert.equal(listed.git.available, true)
    assert.equal(listed.git.initialized, true)
    assert.equal(listed.remote, null)
    assert.equal(path.isAbsolute(listed.defaultRoot), true)
    assert.equal(listed.defaultRoot.endsWith(path.sep + 'worktrees'), true)

    const row = listed.worktrees.find(function (item) {
      return item.requirementId === requirement.id
    })
    assert.notEqual(row, undefined)
    assert.equal(row.branch, 'devbench/' + requirement.id)
    assert.equal(row.title, 'Listed Requirement')
    assert.equal(row.status, 'new')
    assert.equal(row.base, branch)
    assert.equal(row.exists, true)
    assert.equal(row.dirty, false)
    assert.equal(row.changesCount, 0)
    assert.equal(row.ahead, 0)
    assert.equal(row.behind, 0)
    assert.equal(row.upstream, null)
    assert.equal(row.remote, null)
    assert.equal(row.path, await canonical(worktreePath))
    const head = (await git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
    assert.equal(row.lastCommit.hash, head)
    assert.equal(row.lastCommit.short.length > 0, true)
    assert.equal(row.lastCommit.subject, 'commit 1')
    assert.equal(row.lastCommit.date.length > 0, true)

    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'dirty worktree\n')
    await fsp.writeFile(path.join(worktreePath, 'untracked.txt'), 'untracked\n')
    const dirty = await listWorktrees(harness, project.workspaceId)
    const dirtyRow = dirty.worktrees.find(function (item) {
      return item.requirementId === requirement.id
    })
    assert.equal(dirtyRow.dirty, true)
    assert.equal(dirtyRow.changesCount, 2)
    assert.equal(dirtyRow.ahead, 0)

    // Only `devbench/*` branches inside the configured root are plugin worktrees.
    await fsp.mkdir(listed.defaultRoot, { recursive: true })
    await git(project.projectPath, ['worktree', 'add', '-b', 'feature-only',
      path.join(listed.defaultRoot, 'feature-only')])
    await git(project.projectPath, ['worktree', 'add', '-b', 'devbench/REQ-20990101-999',
      path.join(harness.tempRoot, 'outside-worktree')])
    await git(project.projectPath, ['worktree', 'add', '-b', 'devbench/REQ-20990101-001',
      path.join(listed.defaultRoot, 'missing-requirement')])
    await git(project.projectPath, ['worktree', 'add', '-b', 'dsh-req/REQ-20990101-002',
      path.join(listed.defaultRoot, 'legacy-requirement')])

    const filtered = await listWorktrees(harness, project.workspaceId)
    const ids = filtered.worktrees.map(function (item) { return item.requirementId })
    assert.deepEqual(ids.slice().sort(),
      ['REQ-20990101-001', 'REQ-20990101-002', requirement.id].sort())
    const legacy = filtered.worktrees.find(function (item) {
      return item.requirementId === 'REQ-20990101-002'
    })
    assert.notEqual(legacy, undefined)
    assert.equal(legacy.branch, 'dsh-req/REQ-20990101-002')
    const missing = filtered.worktrees.find(function (item) {
      return item.requirementId === 'REQ-20990101-001'
    })
    assert.equal(missing.title, 'REQ-20990101-001')
    assert.equal(missing.status, 'missing')
    assert.equal(missing.exists, true)
    const outside = filtered.worktrees.find(function (item) {
      return item.requirementId === 'REQ-20990101-999'
    })
    assert.equal(outside, undefined)
  } finally {
    await harness.close()
  }
})

test('worktree list degrades for non-git projects and validates the workspace', async function () {
  const harness = await projectHarness()
  try {
    const plainPath = path.join(harness.tempRoot, 'plain-project')
    await fsp.mkdir(plainPath)
    const plain = await addProject(harness, plainPath, 'Plain Project')
    const listed = await listWorktrees(harness, plain.project.workspaceId)
    assert.equal(listed.git.available, true)
    assert.equal(listed.git.initialized, false)
    assert.deepEqual(listed.worktrees, [])
    assert.equal(listed.remote, null)
    assert.equal(path.isAbsolute(listed.defaultRoot), true)

    const gitProject = await makeGitProject(harness, { commits: 1, title: 'No Worktrees' })
    const withoutWorktrees = await listWorktrees(harness, gitProject.workspaceId)
    assert.equal(withoutWorktrees.git.initialized, true)
    assert.deepEqual(withoutWorktrees.worktrees, [])
    assert.equal(withoutWorktrees.remote, null)

    const unknown = await harness.request('GET', '/project/worktrees?workspaceId=missing')
    assert.equal(unknown.status, 404)
    assert.equal(unknown.data.error.code, 'workspace-not-found')

    const gone = await makeWorkspace(harness.tempRoot, 'gone-project', 'Gone Project')
    harness.addWorkspace(gone)
    await fsp.rm(gone.path, { recursive: true, force: true })
    const missingPath = await harness.request('GET',
      '/project/worktrees?workspaceId=gone-project')
    assert.equal(missingPath.status, 400)
    assert.equal(missingPath.data.error.code, 'project-path-missing')
  } finally {
    await harness.close()
  }
})

test('worktree changes report clean, modified, untracked and rename states', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Changes Project',
  })
  try {
    let changes = await worktreeChanges(harness, project.workspaceId, requirement.id)
    assert.equal(changes.hasChanges, false)
    assert.deepEqual(changes.files, [])
    assert.deepEqual(changes.changedFiles, [])
    assert.equal(changes.diffText, '')
    assert.equal(changes.truncated, false)
    assert.equal(changes.branch, 'devbench/' + requirement.id)
    assert.equal(changes.head, (await git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim())
    assert.equal(changes.worktree.requirementId, requirement.id)
    assert.equal(changes.worktree.path, await canonical(worktreePath))

    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'changed in worktree\n')
    await fsp.writeFile(path.join(worktreePath, 'new-file.txt'), 'untracked content\n')
    changes = await worktreeChanges(harness, project.workspaceId, requirement.id)
    assert.equal(changes.hasChanges, true)
    assert.equal(changes.changedFiles.includes('file.txt'), true)
    assert.equal(changes.changedFiles.includes('new-file.txt'), true)
    const modified = changes.files.find(function (item) { return item.path === 'file.txt' })
    assert.equal(modified.status, 'M')
    assert.equal('from' in modified, false)
    const untracked = changes.files.find(function (item) { return item.path === 'new-file.txt' })
    assert.equal(untracked.status, '??')
    assert.equal(changes.diffText.includes('UNSTAGED DIFF:'), true)
    assert.equal(changes.diffText.includes('UNTRACKED FILES:'), true)
    assert.equal(changes.diffText.includes('new-file.txt'), true)

    await git(worktreePath, ['mv', 'file.txt', 'renamed.txt'])
    changes = await worktreeChanges(harness, project.workspaceId, requirement.id)
    const renamed = changes.files.find(function (item) { return item.path === 'renamed.txt' })
    // Staged rename plus the still-unstaged content edit of the renamed file.
    assert.equal(renamed.status, 'RM')
    assert.equal(renamed.from, 'file.txt')
    assert.equal(changes.diffText.includes('STAGED DIFF:'), true)

    const missing = await harness.request('GET',
      '/project/worktree/changes?workspaceId=' + encodeURIComponent(project.workspaceId) +
      '&id=REQ-20000101-001')
    assert.equal(missing.status, 404)
    assert.equal(missing.data.error.code, 'worktree-not-found')
  } finally {
    await harness.close()
  }
})

test('worktree changes truncate oversized diffs', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Truncate Project',
  })
  try {
    const content = 'x'.repeat(250000) + '\n'
    await fsp.writeFile(path.join(worktreePath, 'file.txt'), content)
    const changes = await worktreeChanges(harness, project.workspaceId, requirement.id)
    assert.equal(changes.hasChanges, true)
    assert.equal(changes.truncated, true)
    assert.equal(changes.diffText.endsWith('\n[truncated]\n'), true)
    assert.equal(changes.diffText.length <= 200013, true)
  } finally {
    await harness.close()
  }
})

test('worktree commit preview and confirm commit only on the worktree branch', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Commit Project',
    requirementTitle: 'Commit Requirement',
  })
  try {
    const projectHeadBefore = (await git(project.projectPath, ['rev-parse', 'HEAD']))
      .stdout.trim()
    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'worktree commit content\n')
    const preview = expectOk(await harness.request('POST',
      '/project/worktree/commit/preview', {
        workspaceId: project.workspaceId,
        id: requirement.id,
      }))
    assert.equal(preview.task.kind, 'commit')
    assert.equal(preview.task.status, 'queued')
    assert.equal(preview.task.requirementId, requirement.id)
    assert.equal(preview.task.worktreeBranch, 'devbench/' + requirement.id)
    assert.equal(preview.task.worktreePath, await canonical(worktreePath))
    assert.equal(preview.task.projectPath, await canonical(worktreePath))
    assert.equal(preview.task.pushed, false)
    assert.equal(preview.task.changedFiles.includes('file.txt'), true)
    assert.equal('prompt' in preview.task, false)
    assert.equal('diffText' in preview.task, false)

    await waitForTaskStatus(harness, project.workspaceId, preview.task.id,
      ['awaiting_confirmation'])
    assert.equal(harness.agentFake.createCalls[0].meta.cwd, await canonical(worktreePath))
    const prompt = harness.agentFake.followupMessages[0].content[0].text
    assert.equal(prompt.includes('工作树: ' + await canonical(worktreePath)), true)
    assert.equal(prompt.includes('工作树分支: devbench/' + requirement.id), true)
    assert.equal(prompt.includes('project_commit_propose'), true)

    const confirm = expectOk(await harness.request('POST',
      '/project/worktree/commit/confirm', {
        workspaceId: project.workspaceId,
        taskId: preview.task.id,
      }))
    assert.equal(confirm.task.status, 'succeeded')
    assert.equal(confirm.task.commitHash, confirm.commit.hash)
    assert.equal(confirm.task.commitShort, confirm.commit.short)
    assert.equal(confirm.task.commitSubject, confirm.commit.subject)
    assert.equal(confirm.task.requirementId, requirement.id)
    assert.equal(confirm.task.worktreeBranch, 'devbench/' + requirement.id)
    assert.equal(confirm.pushed, false)
    assert.equal(confirm.warning, '')
    assert.equal(confirm.commit.subject, '\u63d0\u4ea4\u6d4b\u8bd5')
    assert.equal((await git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim(),
      confirm.commit.hash)
    assert.equal((await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim(),
      projectHeadBefore)
    assert.equal((await git(project.projectPath, ['status', '--porcelain'])).stdout.trim(), '')

    const tasks = await projectTasks(harness, project.workspaceId)
    assert.equal(tasks.filter(function (task) { return task.kind === 'review' }).length, 0)
    assert.equal(tasks.filter(function (task) { return task.kind === 'commit' }).length, 1)

    const again = await harness.request('POST', '/project/worktree/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId: preview.task.id,
    })
    assert.equal(again.status, 409)
    assert.equal(again.data.error.code, 'invalid-task-state')
  } finally {
    await harness.close()
  }
})

test('worktree commit skips the workspace session attach DSH rejects for worktree cwd', async function () {
  const attachCalls = []
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Attach Project',
    requirementTitle: 'Attach Requirement',
    harness: {
      // DSH `workspace.attachSession()` only accepts a session whose header cwd
      // equals the workspace path; a worktree cwd is always rejected. Model that
      // strict behavior so the worktree task would fail if it still tried.
      async createWorkspace(projectPath, title) {
        return {
          id: 'workspace-worktree-attach',
          title: title || 'Attach Project',
          path: projectPath,
          sessionIds: [],
          async attachSession(sessionId) {
            attachCalls.push(sessionId)
            throw new Error("cannot attach session '" + sessionId +
              "' to workspace '" + projectPath +
              "': its cwd resolves to another directory")
          },
        }
      },
    },
  })
  try {
    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'worktree attach content\n')
    const preview = expectOk(await harness.request('POST',
      '/project/worktree/commit/preview', {
        workspaceId: project.workspaceId,
        id: requirement.id,
      }))
    const task = await waitForTaskStatus(harness, project.workspaceId,
      preview.task.id, ['awaiting_confirmation'])
    assert.equal(task.error, '')
    assert.equal(attachCalls.length, 0)
    assert.equal(harness.agentFake.createCalls[0].meta.cwd, await canonical(worktreePath))
    const workspace = harness.ctx.workspaceRegistry.get(project.workspaceId)
    assert.equal(workspace.sessionIds.includes(task.sessionId), false)

    const confirm = expectOk(await harness.request('POST',
      '/project/worktree/commit/confirm', {
        workspaceId: project.workspaceId,
        taskId: preview.task.id,
      }))
    assert.equal(confirm.task.status, 'succeeded')
    assert.equal((await git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim(),
      confirm.commit.hash)
  } finally {
    await harness.close()
  }
})

test('worktree commit preview rejects no changes, active tasks and unknown worktrees', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Preview Error Project',
  })
  try {
    let response = await harness.request('POST', '/project/worktree/commit/preview', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'no-changes')

    response = await harness.request('POST', '/project/worktree/commit/preview', {
      workspaceId: project.workspaceId,
      id: 'REQ-20000101-001',
    })
    assert.equal(response.status, 404)
    assert.equal(response.data.error.code, 'worktree-not-found')

    response = await harness.request('POST', '/project/worktree/commit/preview', {
      workspaceId: 'missing-workspace',
      id: requirement.id,
    })
    assert.equal(response.status, 404)
    assert.equal(response.data.error.code, 'workspace-not-found')

    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'pending worktree change\n')
    const first = expectOk(await harness.request('POST', '/project/worktree/commit/preview', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    await waitForTaskStatus(harness, project.workspaceId, first.task.id,
      ['awaiting_confirmation'])
    const second = await harness.request('POST', '/project/worktree/commit/preview', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(second.status, 409)
    assert.equal(second.data.error.code, 'project-task-active')

    // Project-level preview shares the same per-workspace exclusion.
    const projectPreview = await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    })
    assert.equal(projectPreview.status, 409)
    assert.equal(projectPreview.data.error.code, 'project-task-active')

    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: first.task.id,
    }))
    await harness.waitTask(first.task.id)
  } finally {
    await harness.close()
  }
})

test('worktree commit confirm rejects stale previews and invalid state', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Stale Project',
  })
  try {
    const missing = await harness.request('POST', '/project/worktree/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId: 'TASK-20000101-001',
    })
    assert.equal(missing.status, 404)
    assert.equal(missing.data.error.code, 'task-not-found')

    // A project-level commit task is not a worktree task.
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'project change\n')
    const projectPreview = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    }))
    await waitForTaskStatus(harness, project.workspaceId, projectPreview.task.id,
      ['awaiting_confirmation'])
    const rejected = await harness.request('POST', '/project/worktree/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId: projectPreview.task.id,
    })
    assert.equal(rejected.status, 404)
    assert.equal(rejected.data.error.code, 'task-not-found')
    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: projectPreview.task.id,
    }))
    await harness.waitTask(projectPreview.task.id)
    await git(project.projectPath, ['checkout', '--', 'file.txt'])

    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'first worktree change\n')
    const preview = expectOk(await harness.request('POST',
      '/project/worktree/commit/preview', {
        workspaceId: project.workspaceId,
        id: requirement.id,
      }))
    await waitForTaskStatus(harness, project.workspaceId, preview.task.id,
      ['awaiting_confirmation'])

    const badMessage = await harness.request('POST', '/project/worktree/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId: preview.task.id,
      message: 'english message only',
    })
    assert.equal(badMessage.status, 400)
    assert.equal(badMessage.data.error.code, 'bad-commit-message')
    let tasks = await projectTasks(harness, project.workspaceId)
    assert.equal(tasks.find(function (task) {
      return task.id === preview.task.id
    }).status, 'awaiting_confirmation')

    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'second worktree change\n')
    const stale = await harness.request('POST', '/project/worktree/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId: preview.task.id,
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.data.error.code, 'stale-preview')
    tasks = await projectTasks(harness, project.workspaceId)
    const failed = tasks.find(function (task) { return task.id === preview.task.id })
    assert.equal(failed.status, 'failed')
    assert.equal(failed.error.length > 0, true)
  } finally {
    await harness.close()
  }
})

test('worktree push publishes, falls back to a single remote and detects up-to-date', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Push Project',
  })
  try {
    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'push content\n')
    const preview = expectOk(await harness.request('POST',
      '/project/worktree/commit/preview', {
        workspaceId: project.workspaceId,
        id: requirement.id,
      }))
    await waitForTaskStatus(harness, project.workspaceId, preview.task.id,
      ['awaiting_confirmation'])
    const confirm = expectOk(await harness.request('POST',
      '/project/worktree/commit/confirm', {
        workspaceId: project.workspaceId,
        taskId: preview.task.id,
      }))

    const remotePath = await makeBareRemote(harness, 'origin.git')
    await git(project.projectPath, ['remote', 'add', 'origin', remotePath])
    const listed = await listWorktrees(harness, project.workspaceId)
    assert.equal(listed.remote, 'origin')
    const row = listed.worktrees.find(function (item) {
      return item.requirementId === requirement.id
    })
    assert.equal(row.remote, 'origin')
    assert.equal(row.dirty, false)
    assert.equal(row.ahead, 1)
    assert.equal(row.behind, 0)
    assert.equal(row.lastCommit.hash, confirm.commit.hash)
    assert.equal(row.upstream, null)

    const pushed = expectOk(await harness.request('POST', '/project/worktree/push', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(pushed.pushed, true)
    assert.equal(pushed.remote, 'origin')
    assert.equal(pushed.branch, 'devbench/' + requirement.id)
    assert.equal(pushed.alreadyUpToDate, false)
    assert.equal(typeof pushed.detail, 'string')
    assert.equal(pushed.upstream.remote, 'origin')
    assert.equal(pushed.upstream.branch, 'devbench/' + requirement.id)
    assert.equal(pushed.upstream.ahead, 0)
    assert.equal(pushed.upstream.behind, 0)
    const originHead = (await git(remotePath,
      ['rev-parse', 'refs/heads/devbench/' + requirement.id])).stdout.trim()
    assert.equal(originHead, confirm.commit.hash)

    const afterPush = await listWorktrees(harness, project.workspaceId)
    const upstreamRow = afterPush.worktrees.find(function (item) {
      return item.requirementId === requirement.id
    })
    assert.equal(upstreamRow.upstream.remote, 'origin')
    assert.equal(upstreamRow.upstream.branch, 'devbench/' + requirement.id)
    assert.equal(upstreamRow.upstream.ahead, 0)
    assert.equal(upstreamRow.upstream.behind, 0)

    const again = expectOk(await harness.request('POST', '/project/worktree/push', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(again.pushed, true)
    assert.equal(again.alreadyUpToDate, true)

    const backupPath = await makeBareRemote(harness, 'backup.git')
    await git(project.projectPath, ['remote', 'remove', 'origin'])
    await git(project.projectPath, ['remote', 'add', 'backup', backupPath])
    const fallback = expectOk(await harness.request('POST', '/project/worktree/push', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(fallback.remote, 'backup')
    assert.equal(fallback.alreadyUpToDate, false)
    const backupHead = (await git(backupPath,
      ['rev-parse', 'refs/heads/devbench/' + requirement.id])).stdout.trim()
    assert.equal(backupHead, confirm.commit.hash)
  } finally {
    await harness.close()
  }
})

test('worktree push reports missing and failing remotes', async function () {
  const { harness, project, requirement } = await setupWorktree({
    title: 'Push Error Project',
  })
  try {
    const noRemote = await harness.request('POST', '/project/worktree/push', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(noRemote.status, 400)
    assert.equal(noRemote.data.error.code, 'push-no-remote')
    assert.equal(noRemote.data.error.message.length > 0, true)

    await git(project.projectPath, ['remote', 'add', 'origin',
      path.join(harness.tempRoot, 'missing-remote.git')])
    const failed = await harness.request('POST', '/project/worktree/push', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(failed.status, 400)
    assert.equal(failed.data.error.code, 'push-failed')
    assert.equal(failed.data.error.message.length > 0, true)
    assert.equal(failed.data.error.message.length <= 400, true)

    const listed = await listWorktrees(harness, project.workspaceId)
    assert.equal(listed.remote, 'origin')

    const missingWorkspace = await harness.request('POST', '/project/worktree/push', {
      workspaceId: 'missing-workspace',
      id: requirement.id,
    })
    assert.equal(missingWorkspace.status, 404)
    assert.equal(missingWorkspace.data.error.code, 'workspace-not-found')
  } finally {
    await harness.close()
  }
})

test('worktree reveal requires an existing worktree', async function () {
  const { harness, project, requirement } = await setupWorktree({
    title: 'Reveal Project',
  })
  try {
    const missing = await harness.request('POST', '/project/worktree/reveal', {
      workspaceId: project.workspaceId,
      id: 'REQ-20000101-001',
    })
    assert.equal(missing.status, 404)
    assert.equal(missing.data.error.code, 'worktree-not-found')

    const missingWorkspace = await harness.request('POST', '/project/worktree/reveal', {
      workspaceId: 'missing-workspace',
      id: requirement.id,
    })
    assert.equal(missingWorkspace.status, 404)
    assert.equal(missingWorkspace.data.error.code, 'workspace-not-found')
  } finally {
    await harness.close()
  }
})

/** POST /project/worktree/remove for the given workspace and requirement. */
async function removeWorktree(harness, workspaceId, id) {
  return harness.request('POST', '/project/worktree/remove', {
    workspaceId: workspaceId,
    id: id,
  })
}

test('worktree remove deletes the directory, keeps the branch and allows repeats to 404', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Remove Project',
    requirementTitle: 'Removable Requirement',
  })
  try {
    const expectedPath = await canonical(worktreePath)
    await fsp.writeFile(path.join(worktreePath, 'worktree-only.txt'), 'worktree content\n')
    await git(worktreePath, ['add', '-A'])
    await git(worktreePath, ['commit', '-m', 'worktree commit'])
    const branchRef = 'refs/heads/devbench/' + requirement.id
    const worktreeHead = (await git(worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
    const projectHeadBefore = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()

    const removed = expectOk(await removeWorktree(harness, project.workspaceId, requirement.id))
    assert.equal(removed.removed, true)
    assert.equal(removed.branch, 'devbench/' + requirement.id)
    assert.equal(removed.path, expectedPath)
    assert.equal(removed.requirementId, requirement.id)
    await assert.rejects(fsp.stat(worktreePath))

    const retainedHead = (await git(project.projectPath,
      ['rev-parse', '--verify', branchRef])).stdout.trim()
    assert.equal(retainedHead, worktreeHead)
    const projectHeadAfter = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    assert.equal(projectHeadAfter, projectHeadBefore)
    const registered = (await git(project.projectPath, ['worktree', 'list', '--porcelain'])).stdout
    assert.equal(registered.includes('devbench/' + requirement.id), false)

    const listed = await listWorktrees(harness, project.workspaceId)
    const absent = listed.worktrees.find(function (item) {
      return item.requirementId === requirement.id
    })
    // The directory is gone but the requirement still enables worktrees, so the
    // tab keeps it visible as an `absent` row that can be created again.
    assert.equal(Boolean(absent), true)
    assert.equal(absent.state, 'absent')
    assert.equal(absent.exists, false)
    assert.equal(absent.canCreate, true)

    const detail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(detail.worktree.enabled, true)
    assert.equal(detail.worktree.exists, false)

    const again = await removeWorktree(harness, project.workspaceId, requirement.id)
    assert.equal(again.status, 404)
    assert.equal(again.data.error.code, 'worktree-not-found')
  } finally {
    await harness.close()
  }
})

test('worktree remove refuses dirty worktrees and keeps the directory', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Dirty Remove Project',
  })
  try {
    await fsp.writeFile(path.join(worktreePath, 'dirty.txt'), 'uncommitted\n')
    const dirty = await removeWorktree(harness, project.workspaceId, requirement.id)
    assert.equal(dirty.status, 409)
    assert.equal(dirty.data.error.code, 'worktree-dirty')
    assert.equal(dirty.data.error.message.length > 0, true)
    const stat = await fsp.stat(worktreePath)
    assert.equal(stat.isDirectory(), true)
    const listed = await listWorktrees(harness, project.workspaceId)
    const row = listed.worktrees.find(function (item) {
      return item.requirementId === requirement.id
    })
    assert.equal(row.exists, true)
    assert.equal(row.dirty, true)
  } finally {
    await harness.close()
  }
})

test('worktree remove rejects unknown ids, missing workspaces and deleted directories', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Remove Errors Project',
  })
  try {
    const unknown = await removeWorktree(harness, project.workspaceId, 'REQ-20000101-001')
    assert.equal(unknown.status, 404)
    assert.equal(unknown.data.error.code, 'worktree-not-found')

    const missingWorkspace = await removeWorktree(harness, 'missing-workspace', requirement.id)
    assert.equal(missingWorkspace.status, 404)
    assert.equal(missingWorkspace.data.error.code, 'workspace-not-found')

    await fsp.rm(worktreePath, { recursive: true, force: true })
    const gone = await removeWorktree(harness, project.workspaceId, requirement.id)
    // A directory deleted outside the plugin is cleaned up by pruning its stale
    // registration instead of leaving an unremovable row behind.
    assert.equal(gone.status, 200)
    assert.equal(gone.data.value.removed, true)
    assert.equal(gone.data.value.pruned, true)
    assert.equal(gone.data.value.branch, 'devbench/' + requirement.id)
    const registered = (await git(project.projectPath, ['worktree', 'list', '--porcelain'])).stdout
    assert.equal(registered.includes('devbench/' + requirement.id), false)
    const branchStill = (await git(project.projectPath,
      ['rev-parse', '--verify', 'refs/heads/devbench/' + requirement.id])).stdout.trim()
    assert.equal(branchStill.length > 0, true)
  } finally {
    await harness.close()
  }
})

/** A git project with a worktree-enabled requirement whose worktree was NOT created yet. */
async function setupPendingWorktree(options: any = {}) {
  const harness = await projectHarness(options)
  const project = await makeGitProject(harness, {
    commits: options.commits === undefined ? 1 : options.commits,
    title: options.title || 'Pending Worktree Project',
  })
  await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
  await initWorkspace(harness, project.workspaceId)
  const created = expectOk(await harness.request('POST', '/requirement/create', {
    workspaceId: project.workspaceId,
    title: options.requirementTitle || 'Pending Requirement',
    body: '# 待创建工作树\n',
    worktree: options.worktree === undefined ? true : options.worktree,
  }))
  return { harness, project, requirement: created.requirement }
}

test('worktree list exposes enabled requirements that are not created yet', async function () {
  const { harness, project, requirement } = await setupPendingWorktree({ title: 'Absent Project' })
  try {
    const listed = await listWorktrees(harness, project.workspaceId)
    assert.equal(listed.worktrees.length, 1)
    const row = listed.worktrees[0]
    assert.equal(row.requirementId, requirement.id)
    assert.equal(row.state, 'absent')
    assert.equal(row.created, false)
    assert.equal(row.exists, false)
    assert.equal(row.canCreate, true)
    assert.equal(row.canPrune, false)
    assert.equal(row.branch, 'devbench/' + requirement.id)
    assert.equal(path.isAbsolute(row.path), true)
    assert.equal(row.path.startsWith(path.join(harness.configDir, 'worktrees') + path.sep), true)
    assert.equal(row.title, 'Pending Requirement')
  } finally {
    await harness.close()
  }
})

test('worktree create works on demand, enables the flag and is idempotent', async function () {
  const { harness, project, requirement } = await setupPendingWorktree({
    title: 'Create Project',
    worktree: false,
  })
  try {
    const listedBefore = await listWorktrees(harness, project.workspaceId)
    assert.deepEqual(listedBefore.worktrees, [])

    const created = expectOk(await harness.request('POST', '/project/worktree/create', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(created.worktree.exists, true)
    assert.equal(created.worktree.enabled, true)
    assert.equal(created.worktree.branch, 'devbench/' + requirement.id)
    assert.equal(created.requirement.worktree, true)
    await fsp.stat(created.worktree.path)
    const branch = (await git(project.projectPath,
      ['rev-parse', '--verify', 'refs/heads/devbench/' + requirement.id])).stdout.trim()
    assert.equal(branch.length > 0, true)

    const detail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(detail.requirement.worktree, true)
    assert.equal(detail.worktree.exists, true)
    const text = await fsp.readFile(detail.requirement.path, 'utf8')
    assert.match(text, /^worktree: true$/m)

    const listedAfter = await listWorktrees(harness, project.workspaceId)
    assert.equal(listedAfter.worktrees.length, 1)
    assert.equal(listedAfter.worktrees[0].state, 'ready')

    const again = expectOk(await harness.request('POST', '/project/worktree/create', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(again.worktree.exists, true)
    const registered = (await git(project.projectPath, ['worktree', 'list', '--porcelain'])).stdout
    assert.equal(registered.split('\n').filter(function (line) {
      return line.indexOf('devbench/' + requirement.id) >= 0
    }).length, 1)

    const unknown = await harness.request('POST', '/project/worktree/create', {
      workspaceId: project.workspaceId,
      id: 'REQ-20000101-001',
    })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.data.error.code, 'requirement-not-found')

    const missingField = await harness.request('POST', '/project/worktree/create', {
      workspaceId: project.workspaceId,
    })
    assert.equal(missingField.status, 400)
    assert.equal(missingField.data.error.code, 'bad-field')
  } finally {
    await harness.close()
  }
})

test('worktree create rejects non-git projects', async function () {
  const harness = await projectHarness()
  try {
    const plainPath = path.join(harness.tempRoot, 'plain-create-project')
    await fsp.mkdir(plainPath)
    const plain = await addProject(harness, plainPath, 'Plain Create Project')
    await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
    await initWorkspace(harness, plain.project.workspaceId)
    const requirement = expectOk(await harness.request('POST', '/requirement/create', {
      workspaceId: plain.project.workspaceId,
      title: 'Plain Requirement',
      body: 'x',
      worktree: true,
    })).requirement
    const failed = await harness.request('POST', '/project/worktree/create', {
      workspaceId: plain.project.workspaceId,
      id: requirement.id,
    })
    assert.equal(failed.status, 400)
    assert.equal(failed.data.error.code, 'worktree-not-git')
  } finally {
    await harness.close()
  }
})

test('worktree prune cleans stale registrations and keeps branches', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Prune Project',
  })
  try {
    await fsp.rm(worktreePath, { recursive: true, force: true })
    let listed = await listWorktrees(harness, project.workspaceId)
    let row = listed.worktrees.find(function (item) {
      return item.requirementId === requirement.id
    })
    assert.equal(row.state, 'missing')
    assert.equal(row.canPrune, true)
    assert.equal(row.canCreate, false)

    const pruned = expectOk(await harness.request('POST', '/project/worktree/prune', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(Array.isArray(pruned.pruned), true)
    assert.equal(pruned.pruned.length, 1)
    assert.equal(pruned.pruned[0].requirementId, requirement.id)
    assert.equal(pruned.pruned[0].branch, 'devbench/' + requirement.id)
    const registered = (await git(project.projectPath, ['worktree', 'list', '--porcelain'])).stdout
    assert.equal(registered.includes('devbench/' + requirement.id), false)
    const branch = (await git(project.projectPath,
      ['rev-parse', '--verify', 'refs/heads/devbench/' + requirement.id])).stdout.trim()
    assert.equal(branch.length > 0, true)

    listed = await listWorktrees(harness, project.workspaceId)
    row = listed.worktrees.find(function (item) {
      return item.requirementId === requirement.id
    })
    assert.equal(row.state, 'absent')

    const nothing = expectOk(await harness.request('POST', '/project/worktree/prune', {
      workspaceId: project.workspaceId,
    }))
    assert.deepEqual(nothing.pruned, [])

    const unknown = await harness.request('POST', '/project/worktree/prune', {
      workspaceId: project.workspaceId,
      id: 'REQ-20000101-001',
    })
    assert.equal(unknown.status, 404)
    assert.equal(unknown.data.error.code, 'worktree-not-found')
  } finally {
    await harness.close()
  }
})

test('worktree changes keep non-ASCII and space paths readable', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Unicode Project',
  })
  try {
    await fsp.writeFile(path.join(worktreePath, '中文 文件.txt'), '内容\n')
    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'changed\n')
    let changes = await worktreeChanges(harness, project.workspaceId, requirement.id)
    const unicode = changes.files.find(function (item) { return item.path === '中文 文件.txt' })
    assert.equal(Boolean(unicode), true)
    assert.equal(unicode.status, '??')
    assert.equal(changes.changedFiles.includes('中文 文件.txt'), true)
    assert.equal(changes.diffText.includes('中文 文件.txt'), true)
    assert.equal(JSON.stringify(changes).includes('\\346'), false)

    await git(worktreePath, ['mv', 'file.txt', '重命名 文件.txt'])
    changes = await worktreeChanges(harness, project.workspaceId, requirement.id)
    const renamed = changes.files.find(function (item) { return item.path === '重命名 文件.txt' })
    assert.equal(Boolean(renamed), true)
    assert.equal(renamed.from, 'file.txt')
    assert.equal(changes.changedFiles.includes('重命名 文件.txt'), true)
  } finally {
    await harness.close()
  }
})

test('worktree push reports ambiguous remotes instead of pretending none exist', async function () {
  const { harness, project, requirement } = await setupWorktree({ title: 'Ambiguous Remote Project' })
  try {
    const a = await makeBareRemote(harness, 'a.git')
    const b = await makeBareRemote(harness, 'b.git')
    await git(project.projectPath, ['remote', 'add', 'a', a])
    await git(project.projectPath, ['remote', 'add', 'b', b])
    const listed = await listWorktrees(harness, project.workspaceId)
    assert.deepEqual(listed.remotes.sort(), ['a', 'b'])
    assert.equal(listed.remote, null)
    const push = await harness.request('POST', '/project/worktree/push', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(push.status, 400)
    assert.equal(push.data.error.code, 'push-remote-ambiguous')
  } finally {
    await harness.close()
  }
})

test('worktree commit preview rejects while the requirement is running', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Running Guard Project',
  })
  try {
    const { createTask } = await import('../../src/host/storage/tasks.js')
    await createTask({
      kind: 'requirement',
      status: 'running',
      workspaceId: project.workspaceId,
      projectPath: worktreePath,
      projectTitle: project.project.title,
      title: requirement.title,
      requirementId: requirement.id,
      sessionId: 'session-running',
    })
    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'running change\n')
    const preview = await harness.request('POST', '/project/worktree/commit/preview', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(preview.status, 409)
    assert.equal(preview.data.error.code, 'worktree-requirement-running')
  } finally {
    await harness.close()
  }
})

test('worktree commit confirm ends the task when the project disappears', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Vanishing Project',
  })
  try {
    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'vanish change\n')
    const preview = expectOk(await harness.request('POST', '/project/worktree/commit/preview', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    await waitForTaskStatus(harness, project.workspaceId, preview.task.id,
      ['awaiting_confirmation'])
    await fsp.rename(project.projectPath, project.projectPath + '-moved')
    const confirm = await harness.request('POST', '/project/worktree/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId: preview.task.id,
    })
    assert.equal(confirm.status >= 400, true)
    const tasks = await projectTasks(harness, project.workspaceId)
    const task = tasks.find(function (item) { return item.id === preview.task.id })
    assert.equal(task.status, 'failed')
    assert.equal(task.error.length > 0, true)
  } finally {
    await harness.close()
  }
})

test('worktree reveal rejects unsupported launchers', async function () {
  const { harness, project, requirement } = await setupWorktree({ title: 'Reveal Target Project' })
  try {
    const reveal = await harness.request('POST', '/project/worktree/reveal', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      target: 'nope',
    })
    assert.equal(reveal.status, 400)
    assert.equal(reveal.data.error.code, 'bad-open-target')
  } finally {
    await harness.close()
  }
})

test('worktree commit confirm handles an unstaged move collapsed into a rename', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Rename Commit Project',
  })
  try {
    // Plain filesystem move (not `git mv`): preview sees "deleted + untracked",
    // while `git add -A` records a rename. Confirm must not loop on stale-preview.
    await fsp.rename(path.join(worktreePath, 'file.txt'), path.join(worktreePath, 'moved.txt'))
    const preview = expectOk(await harness.request('POST', '/project/worktree/commit/preview', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(preview.task.changedFiles.includes('file.txt'), true)
    assert.equal(preview.task.changedFiles.includes('moved.txt'), true)
    await waitForTaskStatus(harness, project.workspaceId, preview.task.id,
      ['awaiting_confirmation'])
    const confirm = expectOk(await harness.request('POST', '/project/worktree/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId: preview.task.id,
    }))
    assert.equal(confirm.task.status, 'succeeded')
    const files = (await git(worktreePath, ['show', '--name-only', '--pretty=format:', 'HEAD'])).stdout
    assert.equal(files.includes('moved.txt'), true)
    assert.equal(files.includes('file.txt'), false)
  } finally {
    await harness.close()
  }
})

test('worktree commit confirm refuses after the requirement starts executing', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Confirm Guard Project',
  })
  try {
    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'guarded change\n')
    const preview = expectOk(await harness.request('POST', '/project/worktree/commit/preview', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    await waitForTaskStatus(harness, project.workspaceId, preview.task.id,
      ['awaiting_confirmation'])
    const { createTask } = await import('../../src/host/storage/tasks.js')
    await createTask({
      kind: 'requirement',
      status: 'running',
      workspaceId: project.workspaceId,
      projectPath: worktreePath,
      projectTitle: project.project.title,
      title: requirement.title,
      requirementId: requirement.id,
      sessionId: 'session-guard',
    })
    const confirm = await harness.request('POST', '/project/worktree/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId: preview.task.id,
    })
    assert.equal(confirm.status, 409)
    assert.equal(confirm.data.error.code, 'worktree-requirement-running')
    const tasks = await projectTasks(harness, project.workspaceId)
    const task = tasks.find(function (item) { return item.id === preview.task.id })
    // The preview must stay confirmable after the execution ends.
    assert.equal(task.status, 'awaiting_confirmation')
  } finally {
    await harness.close()
  }
})

test('requirement execute refuses while a worktree commit preview is pending', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Execute Guard Project',
  })
  try {
    await fsp.writeFile(path.join(worktreePath, 'file.txt'), 'pending change\n')
    const preview = expectOk(await harness.request('POST', '/project/worktree/commit/preview', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    await waitForTaskStatus(harness, project.workspaceId, preview.task.id,
      ['awaiting_confirmation'])
    const executed = await harness.request('POST', '/requirement/execute', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      markRunning: false,
    })
    assert.equal(executed.status, 409)
    assert.equal(executed.data.error.code, 'worktree-commit-active')
  } finally {
    await harness.close()
  }
})

test('worktree create and execute refuse branches checked out outside worktreeRoot', async function () {
  const { harness, project, requirement } = await setupPendingWorktree({
    title: 'Outside Root Project',
  })
  try {
    const outsidePath = path.join(harness.tempRoot, 'outside-worktree')
    await git(project.projectPath, ['worktree', 'add', '-b', 'devbench/' + requirement.id,
      outsidePath, 'HEAD'])
    const listed = await listWorktrees(harness, project.workspaceId)
    const row = listed.worktrees.find(function (item) {
      return item.requirementId === requirement.id
    })
    assert.equal(row.state, 'absent')
    const created = await harness.request('POST', '/project/worktree/create', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(created.status, 400)
    assert.equal(created.data.error.code, 'worktree-outside-root')
    const executed = await harness.request('POST', '/requirement/execute', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      markRunning: false,
    })
    assert.equal(executed.status, 400)
    assert.equal(executed.data.error.code, 'worktree-outside-root')
  } finally {
    await harness.close()
  }
})

test('worktree description and execute follow the registered path after a workspace rename', async function () {
  const { harness, project, requirement, worktreePath } = await setupWorktree({
    title: 'Rename Workspace Project',
  })
  try {
    const actualPath = await canonical(worktreePath)
    const workspace = harness.ctx.workspaceRegistry.get(project.workspaceId)
    workspace.title = 'Renamed Workspace Title'
    const detail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(detail.worktree.registered, true)
    assert.equal(detail.worktree.exists, true)
    assert.equal(detail.worktree.path, actualPath)
    assert.equal(detail.worktree.targetPath === actualPath, false)
    assert.equal(detail.worktree.targetPath.startsWith(path.join(harness.configDir, 'worktrees')), true)
    const executed = expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      markRunning: false,
    }))
    assert.equal(executed.cwd, actualPath)
  } finally {
    await harness.close()
  }
})
