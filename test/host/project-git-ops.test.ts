import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHarness, expectOk } from './helpers.js'
import { addProject, git, makeGitProject } from './project-helpers.js'
import { sanitizeGitDetail } from '../../src/host/integrations/git.js'
import { createTask } from '../../src/host/storage/tasks.js'

function changesUrl(workspaceId) {
  return '/project/changes?workspaceId=' + encodeURIComponent(workspaceId)
}

async function projectBranch(projectPath) {
  return (await git(projectPath, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim()
}

async function headOf(cwd) {
  return (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim()
}

async function makeBareRemote(harness, name) {
  const remotePath = path.join(harness.tempRoot, name || 'remote.git')
  await git(harness.tempRoot, ['init', '--bare', remotePath])
  return remotePath
}

/**
 * A Git project whose checked-out branch is published to a local bare origin,
 * so pull/push tests never touch the network.
 */
async function setupRemoteProject(harness: any, options: any = {}) {
  const project = await makeGitProject(harness, {
    commits: options.commits === undefined ? 1 : options.commits,
    title: options.title || 'Remote Project',
    name: options.name,
  })
  const remotePath = await makeBareRemote(harness, options.remoteName || 'origin.git')
  const branch = await projectBranch(project.projectPath)
  await git(project.projectPath, ['remote', 'add', 'origin', remotePath])
  await git(project.projectPath, ['push', '-u', 'origin', branch])
  // Point the bare repository HEAD at the published branch so clones check it out.
  await git(remotePath, ['symbolic-ref', 'HEAD', 'refs/heads/' + branch])
  return { project, remotePath, branch }
}

/** Commit and publish one change from an independent clone (a second user). */
async function commitFromOtherClone(harness, remotePath, cloneName, fileName, content) {
  const clonePath = path.join(harness.tempRoot, cloneName)
  await git(harness.tempRoot, ['clone', remotePath, clonePath])
  await git(clonePath, ['config', 'user.name', 'Other User'])
  await git(clonePath, ['config', 'user.email', 'other@example.com'])
  await fsp.writeFile(path.join(clonePath, fileName), content)
  await git(clonePath, ['add', '-A'])
  await git(clonePath, ['commit', '-m', 'remote update'])
  const branch = await projectBranch(clonePath)
  await git(clonePath, ['push', 'origin', branch])
  return { clonePath, head: await headOf(clonePath) }
}

test('project changes report a clean repository without upstream', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Clean Project' })
    const branch = await projectBranch(project.projectPath)
    const head = await headOf(project.projectPath)
    const value = expectOk(await harness.request('GET', changesUrl(project.workspaceId)))
    assert.equal(value.initialized, true)
    assert.equal(value.branch, branch)
    assert.equal(value.head, head)
    assert.equal(value.head.length, 40)
    assert.equal(value.detached, false)
    assert.equal(value.statusKnown, true)
    assert.equal(value.hasChanges, false)
    assert.deepEqual(value.files, [])
    assert.deepEqual(value.changedFiles, [])
    assert.equal(value.diffText, '')
    assert.equal(value.truncated, false)
    assert.deepEqual(value.remotes, [])
    assert.equal(value.remote, null)
    assert.equal(value.upstream, null)
    assert.equal(value.ahead, 0)
    assert.equal(value.behind, 0)
    assert.equal(value.aheadKnown, true)
    assert.equal(value.behindKnown, true)

    // Detached HEAD keeps the workspace readable: empty branch, real HEAD.
    await git(project.projectPath, ['checkout', '--detach', 'HEAD'])
    const detached = expectOk(await harness.request('GET', changesUrl(project.workspaceId)))
    assert.equal(detached.detached, true)
    assert.equal(detached.branch, '')
    assert.equal(detached.head, head)
    assert.equal(detached.hasChanges, false)
  } finally {
    await harness.close()
  }
})

test('project changes report files, segmented diffs and exclude review artifacts', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Dirty Project' })
    await fsp.writeFile(path.join(project.projectPath, 'old.txt'), 'old\n')
    await fsp.writeFile(path.join(project.projectPath, 'tracked.txt'), 'tracked\n')
    await git(project.projectPath, ['add', 'old.txt', 'tracked.txt'])
    await git(project.projectPath, ['commit', '-m', 'extra files'])
    // Staged rename with a non-ASCII, space-containing target path.
    await git(project.projectPath, ['mv', 'old.txt', '重命名 文件.txt'])
    // Staged modification.
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'staged change\n')
    await git(project.projectPath, ['add', 'file.txt'])
    // Unstaged modification.
    await fsp.writeFile(path.join(project.projectPath, 'tracked.txt'), 'unstaged change\n')
    // Untracked file with a non-ASCII, space-containing path.
    await fsp.writeFile(path.join(project.projectPath, '中文 文件.txt'), '内容\n')
    // Review artifacts are generated by the plugin; force-adding one proves the filter.
    await fsp.mkdir(path.join(project.projectPath, '.dsh-reviews'), { recursive: true })
    await fsp.writeFile(path.join(project.projectPath, '.dsh-reviews', 'review.md'), '# review\n')
    await git(project.projectPath, ['add', '-f', '.dsh-reviews/review.md'])

    const value = expectOk(await harness.request('GET', changesUrl(project.workspaceId)))
    assert.equal(value.initialized, true)
    assert.equal(value.hasChanges, true)
    assert.equal(value.statusKnown, true)
    assert.equal(value.truncated, false)

    const paths = value.files.map(function (entry) { return entry.path })
    assert.equal(paths.includes('.dsh-reviews/review.md'), false)
    assert.equal(value.changedFiles.includes('.dsh-reviews/review.md'), false)
    assert.deepEqual(paths.slice().sort(function (left, right) {
      return left.localeCompare(right)
    }), paths)
    assert.equal(paths.length, 4)

    const renamed = value.files.find(function (entry) { return entry.path === '重命名 文件.txt' })
    assert.equal(Boolean(renamed), true)
    assert.equal(renamed.status, 'R')
    assert.equal(renamed.from, 'old.txt')
    assert.equal(value.files.find(function (entry) { return entry.path === 'tracked.txt' }).status, 'M')
    assert.equal(value.files.find(function (entry) { return entry.path === '中文 文件.txt' }).status, '??')
    assert.deepEqual(value.changedFiles, paths)

    assert.equal(value.diffText.includes('STAGED DIFF:'), true)
    assert.equal(value.diffText.includes('UNSTAGED DIFF:'), true)
    assert.equal(value.diffText.includes('UNTRACKED FILES:'), true)
    assert.equal(value.diffText.includes('中文 文件.txt'), true)
    // NUL parsing must not leave quoted/escaped non-ASCII paths in the file lists.
    assert.equal(JSON.stringify({ files: value.files, changedFiles: value.changedFiles })
      .includes('\\346'), false)
  } finally {
    await harness.close()
  }
})

test('project changes truncate an oversized diff', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Big Diff Project' })
    await fsp.writeFile(path.join(project.projectPath, 'big.txt'), 'x'.repeat(250000) + '\n')
    await git(project.projectPath, ['add', 'big.txt'])
    const value = expectOk(await harness.request('GET', changesUrl(project.workspaceId)))
    assert.equal(value.hasChanges, true)
    assert.equal(value.truncated, true)
    assert.equal(value.diffText.endsWith('\n[truncated]\n'), true)
    assert.equal(value.diffText.length <= 200000 + '\n[truncated]\n'.length, true)
  } finally {
    await harness.close()
  }
})

test('project changes degrade for non-git and missing projects', async function () {
  const harness = await createHarness([])
  try {
    const plainPath = path.join(harness.tempRoot, 'plain-project')
    await fsp.mkdir(plainPath)
    const plain = await addProject(harness, plainPath, 'Plain Project')
    const value = expectOk(await harness.request('GET', changesUrl(plain.project.workspaceId)))
    assert.deepEqual(value, {
      initialized: false,
      branch: '',
      head: '',
      detached: false,
      statusKnown: false,
      hasChanges: false,
      files: [],
      changedFiles: [],
      diffText: '',
      truncated: false,
      remotes: [],
      remote: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      aheadKnown: false,
      behindKnown: false,
    })

    let response = await harness.request('GET', '/project/changes')
    assert.equal(response.status, 404)
    assert.equal(response.data.error.code, 'workspace-not-found')

    const gonePath = path.join(harness.tempRoot, 'gone-project')
    await fsp.mkdir(gonePath)
    const gone = await addProject(harness, gonePath, 'Gone Project')
    await fsp.rm(gonePath, { recursive: true, force: true })
    response = await harness.request('GET', changesUrl(gone.project.workspaceId))
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'project-path-missing')
  } finally {
    await harness.close()
  }
})

test('project changes report upstream ahead and behind counts', async function () {
  const harness = await createHarness([])
  try {
    const { project, remotePath, branch } = await setupRemoteProject(harness, {
      title: 'Ahead Behind Project',
    })
    const base = await headOf(project.projectPath)
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'local one\n')
    await git(project.projectPath, ['add', '-A'])
    await git(project.projectPath, ['commit', '-m', 'local one'])
    await fsp.writeFile(path.join(project.projectPath, 'local-two.txt'), 'local two\n')
    await git(project.projectPath, ['add', '-A'])
    await git(project.projectPath, ['commit', '-m', 'local two'])
    await commitFromOtherClone(harness, remotePath, 'ahead-behind-clone', 'remote.txt', 'remote\n')
    await git(project.projectPath, ['fetch', 'origin'])

    const value = expectOk(await harness.request('GET', changesUrl(project.workspaceId)))
    assert.deepEqual(value.remotes, ['origin'])
    assert.equal(value.remote, 'origin')
    assert.deepEqual(value.upstream, { remote: 'origin', branch: branch, ahead: 2, behind: 1 })
    assert.equal(value.ahead, 2)
    assert.equal(value.behind, 1)
    assert.equal(value.aheadKnown, true)
    assert.equal(value.behindKnown, true)
    const localHead = await headOf(project.projectPath)
    assert.notEqual(localHead, base)
    assert.equal(value.head, localHead)
  } finally {
    await harness.close()
  }
})

test('manual commit commits all workspace changes with the user message', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Manual Commit Project' })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'manual change\n')
    await fsp.writeFile(path.join(project.projectPath, '新 文件.txt'), 'new\n')
    const value = expectOk(await harness.request('POST', '/project/commit/manual', {
      workspaceId: project.workspaceId,
      message: '  手动提交工作区  ',
    }))
    assert.equal(value.commit.hash.length, 40)
    assert.equal(value.commit.short.length > 0, true)
    assert.equal(value.commit.subject, '手动提交工作区')
    assert.equal(await headOf(project.projectPath), value.commit.hash)
    assert.equal((await git(project.projectPath, ['log', '-1', '--pretty=%s'])).stdout.trim(),
      '手动提交工作区')
    assert.equal((await git(project.projectPath, ['status', '--porcelain'])).stdout.trim(), '')
    const changes = expectOk(await harness.request('GET', changesUrl(project.workspaceId)))
    assert.equal(changes.hasChanges, false)
    assert.equal(changes.head, value.commit.hash)

    // English messages are allowed too (no Chinese requirement for manual commits).
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'english change\n')
    const english = expectOk(await harness.request('POST', '/project/commit/manual', {
      workspaceId: project.workspaceId,
      message: 'english message',
    }))
    assert.equal(english.commit.subject, 'english message')

    // 2000 characters is the inclusive upper bound.
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'long message change\n')
    const longest = expectOk(await harness.request('POST', '/project/commit/manual', {
      workspaceId: project.workspaceId,
      message: 'x'.repeat(2000),
    }))
    assert.equal(longest.commit.subject, 'x'.repeat(2000))
  } finally {
    await harness.close()
  }
})

test('manual commit validates messages and the Git state', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Manual Commit Guards' })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'guard change\n')
    for (const message of ['', '   ', 'x'.repeat(2001)]) {
      const response = await harness.request('POST', '/project/commit/manual', {
        workspaceId: project.workspaceId,
        message: message,
      })
      assert.equal(response.status, 400, 'message length ' + message.length)
      assert.equal(response.data.error.code, 'bad-manual-commit-message')
    }
    let response = await harness.request('POST', '/project/commit/manual', {
      workspaceId: project.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'bad-manual-commit-message')

    const plainPath = path.join(harness.tempRoot, 'manual-plain-project')
    await fsp.mkdir(plainPath)
    const plain = await addProject(harness, plainPath, 'Manual Plain Project')
    response = await harness.request('POST', '/project/commit/manual', {
      workspaceId: plain.project.workspaceId,
      message: 'manual guard',
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'git-not-initialized')

    const branch = await projectBranch(project.projectPath)
    await git(project.projectPath, ['checkout', '--detach', 'HEAD'])
    response = await harness.request('POST', '/project/commit/manual', {
      workspaceId: project.workspaceId,
      message: 'manual guard',
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'detached-head')

    // Clean workspace: the contract reports no-changes for a valid message.
    await git(project.projectPath, ['checkout', branch])
    await git(project.projectPath, ['checkout', '--', 'file.txt'])
    response = await harness.request('POST', '/project/commit/manual', {
      workspaceId: project.workspaceId,
      message: 'manual guard',
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'no-changes')
  } finally {
    await harness.close()
  }
})

test('manual commit is blocked by active commit and main-workspace requirement tasks', async function () {
  const harness = await createHarness([])
  try {
    const commitGuard = await makeGitProject(harness, {
      commits: 1,
      title: 'Manual Commit Task Guard',
      name: 'manual-commit-task-guard',
    })
    await fsp.writeFile(path.join(commitGuard.projectPath, 'file.txt'), 'task guard\n')
    await createTask({
      kind: 'commit',
      status: 'awaiting_confirmation',
      workspaceId: commitGuard.workspaceId,
      projectPath: commitGuard.projectPath,
      projectTitle: commitGuard.project.title,
    })
    let response = await harness.request('POST', '/project/commit/manual', {
      workspaceId: commitGuard.workspaceId,
      message: 'manual guard',
    })
    assert.equal(response.status, 409)
    assert.equal(response.data.error.code, 'project-task-active')

    const requirementGuard = await makeGitProject(harness, {
      commits: 1,
      title: 'Manual Requirement Guard',
      name: 'manual-requirement-guard',
    })
    await fsp.writeFile(path.join(requirementGuard.projectPath, 'file.txt'), 'requirement guard\n')
    await createTask({
      kind: 'requirement',
      status: 'running',
      workspaceId: requirementGuard.workspaceId,
      projectPath: requirementGuard.projectPath,
      projectTitle: requirementGuard.project.title,
      requirementId: 'REQ-20261027-997',
      sessionId: 'session-manual-guard',
    })
    response = await harness.request('POST', '/project/commit/manual', {
      workspaceId: requirementGuard.workspaceId,
      message: 'manual guard',
    })
    assert.equal(response.status, 409)
    assert.equal(response.data.error.code, 'requirement-running')

    // A requirement running inside its own worktree does not block main-workspace
    // commits: its task cwd (projectPath) is the worktree, not the project root.
    const worktreeGuard = await makeGitProject(harness, {
      commits: 1,
      title: 'Manual Worktree Requirement Guard',
      name: 'manual-worktree-requirement-guard',
    })
    await fsp.writeFile(path.join(worktreeGuard.projectPath, 'file.txt'), 'worktree guard\n')
    const worktreePath = path.join(harness.tempRoot, 'some-requirement-worktree')
    await createTask({
      kind: 'requirement',
      status: 'running',
      workspaceId: worktreeGuard.workspaceId,
      projectPath: worktreePath,
      projectTitle: worktreeGuard.project.title,
      requirementId: 'REQ-20261027-996',
      sessionId: 'session-worktree-guard',
    })
    const committed = expectOk(await harness.request('POST', '/project/commit/manual', {
      workspaceId: worktreeGuard.workspaceId,
      message: 'worktree guard commit',
    }))
    assert.equal(committed.commit.subject, 'worktree guard commit')

    // Legacy record: `worktreePath` set (no projectPath match) is also non-blocking.
    await fsp.writeFile(path.join(worktreeGuard.projectPath, 'file.txt'), 'legacy guard\n')
    await createTask({
      kind: 'requirement',
      status: 'running',
      workspaceId: worktreeGuard.workspaceId,
      projectPath: '',
      projectTitle: worktreeGuard.project.title,
      requirementId: 'REQ-20261027-994',
      worktreePath: worktreePath,
      sessionId: 'session-legacy-worktree-guard',
    })
    const legacy = expectOk(await harness.request('POST', '/project/commit/manual', {
      workspaceId: worktreeGuard.workspaceId,
      message: 'legacy worktree guard commit',
    }))
    assert.equal(legacy.commit.subject, 'legacy worktree guard commit')
  } finally {
    await harness.close()
  }
})

test('pull fast-forwards the project branch and reports up-to-date pulls', async function () {
  const harness = await createHarness([])
  try {
    const { project, remotePath, branch } = await setupRemoteProject(harness, {
      title: 'Pull Project',
    })
    const before = await headOf(project.projectPath)
    const other = await commitFromOtherClone(harness, remotePath, 'pull-clone',
      'remote.txt', 'remote content\n')
    const pulled = expectOk(await harness.request('POST', '/project/pull', {
      workspaceId: project.workspaceId,
    }))
    assert.equal(pulled.pulled, true)
    assert.equal(pulled.alreadyUpToDate, false)
    assert.equal(pulled.before, before)
    assert.equal(pulled.after, other.head)
    assert.equal(pulled.branch, branch)
    assert.deepEqual(pulled.upstream, { remote: 'origin', branch: branch, ahead: 0, behind: 0 })
    assert.equal(typeof pulled.detail, 'string')
    assert.equal(await headOf(project.projectPath), other.head)
    assert.equal(await fsp.readFile(path.join(project.projectPath, 'remote.txt'), 'utf8'),
      'remote content\n')

    const again = expectOk(await harness.request('POST', '/project/pull', {
      workspaceId: project.workspaceId,
    }))
    assert.equal(again.pulled, false)
    assert.equal(again.alreadyUpToDate, true)
    assert.equal(again.before, other.head)
    assert.equal(again.after, other.head)
    assert.equal(again.branch, branch)
    assert.deepEqual(again.upstream, { remote: 'origin', branch: branch, ahead: 0, behind: 0 })
  } finally {
    await harness.close()
  }
})

test('pull rejects missing upstream, detached HEAD and diverged branches', async function () {
  const harness = await createHarness([])
  try {
    const noUpstream = await makeGitProject(harness, {
      commits: 1,
      title: 'Pull No Upstream',
      name: 'pull-no-upstream',
    })
    let response = await harness.request('POST', '/project/pull', {
      workspaceId: noUpstream.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'pull-no-upstream')

    await git(noUpstream.projectPath, ['checkout', '--detach', 'HEAD'])
    response = await harness.request('POST', '/project/pull', {
      workspaceId: noUpstream.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'detached-head')

    const plainPath = path.join(harness.tempRoot, 'pull-plain-project')
    await fsp.mkdir(plainPath)
    const plain = await addProject(harness, plainPath, 'Pull Plain Project')
    response = await harness.request('POST', '/project/pull', {
      workspaceId: plain.project.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'git-not-initialized')

    const { project, remotePath } = await setupRemoteProject(harness, {
      title: 'Diverged Pull',
      name: 'pull-diverged',
      remoteName: 'diverged-origin.git',
    })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'local update\n')
    await git(project.projectPath, ['add', '-A'])
    await git(project.projectPath, ['commit', '-m', 'local update'])
    await commitFromOtherClone(harness, remotePath, 'diverged-clone', 'remote.txt', 'remote\n')
    response = await harness.request('POST', '/project/pull', {
      workspaceId: project.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'pull-failed')
    assert.equal(response.data.error.message.length > 0, true)
    // Fast-forward-only: the local commit stays and no merge commit is created.
    assert.equal((await git(project.projectPath, ['log', '-1', '--pretty=%s'])).stdout.trim(),
      'local update')
    assert.equal((await git(project.projectPath, ['rev-list', '--count', 'HEAD'])).stdout.trim(), '2')
  } finally {
    await harness.close()
  }
})

test('pull is blocked by active commit and main-workspace requirement tasks', async function () {
  const harness = await createHarness([])
  try {
    const { project } = await setupRemoteProject(harness, { title: 'Pull Task Guard' })
    await createTask({
      kind: 'commit',
      status: 'queued',
      workspaceId: project.workspaceId,
      projectPath: project.projectPath,
      projectTitle: 'Pull Task Guard',
    })
    let response = await harness.request('POST', '/project/pull', {
      workspaceId: project.workspaceId,
    })
    assert.equal(response.status, 409, JSON.stringify(response.data))
    assert.equal(response.data.error.code, 'project-task-active')

    const { project: requirement } = await setupRemoteProject(harness, {
      title: 'Pull Requirement Guard',
      name: 'pull-requirement-project',
      remoteName: 'pull-requirement-origin.git',
    })
    await createTask({
      kind: 'requirement',
      status: 'running',
      workspaceId: requirement.workspaceId,
      projectPath: requirement.projectPath,
      projectTitle: 'Pull Requirement Guard',
      requirementId: 'REQ-20261027-995',
      sessionId: 'session-pull-guard',
    })
    response = await harness.request('POST', '/project/pull', {
      workspaceId: requirement.workspaceId,
    })
    assert.equal(response.status, 409)
    assert.equal(response.data.error.code, 'requirement-running')

    // A requirement running in its own worktree must not block main-workspace pulls.
    const { project: worktreeRequirement } = await setupRemoteProject(harness, {
      title: 'Pull Worktree Requirement Guard',
      name: 'pull-worktree-requirement-project',
      remoteName: 'pull-worktree-requirement-origin.git',
    })
    await createTask({
      kind: 'requirement',
      status: 'running',
      workspaceId: worktreeRequirement.workspaceId,
      projectPath: path.join(harness.tempRoot, 'pull-requirement-worktree'),
      projectTitle: 'Pull Worktree Requirement Guard',
      requirementId: 'REQ-20261027-993',
      sessionId: 'session-pull-worktree-guard',
    })
    const pulled = expectOk(await harness.request('POST', '/project/pull', {
      workspaceId: worktreeRequirement.workspaceId,
    }))
    assert.equal(pulled.pulled, false)
  } finally {
    await harness.close()
  }
})

test('push establishes upstream and reports up-to-date pushes', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Push Project' })
    const remotePath = await makeBareRemote(harness, 'push-origin.git')
    const branch = await projectBranch(project.projectPath)
    await git(project.projectPath, ['remote', 'add', 'origin', remotePath])
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'push me\n')
    await git(project.projectPath, ['add', '-A'])
    await git(project.projectPath, ['commit', '-m', 'push commit'])
    const head = await headOf(project.projectPath)

    const pushed = expectOk(await harness.request('POST', '/project/push', {
      workspaceId: project.workspaceId,
    }))
    assert.equal(pushed.pushed, true)
    assert.equal(pushed.remote, 'origin')
    assert.equal(pushed.branch, branch)
    assert.equal(pushed.alreadyUpToDate, false)
    assert.equal(typeof pushed.detail, 'string')
    assert.deepEqual(pushed.upstream, { remote: 'origin', branch: branch, ahead: 0, behind: 0 })
    assert.equal((await git(remotePath, ['rev-parse', 'refs/heads/' + branch])).stdout.trim(), head)

    const again = expectOk(await harness.request('POST', '/project/push', {
      workspaceId: project.workspaceId,
    }))
    assert.equal(again.pushed, true)
    assert.equal(again.remote, 'origin')
    assert.equal(again.alreadyUpToDate, true)
  } finally {
    await harness.close()
  }
})

test('push rejects missing, ambiguous and unreachable remotes', async function () {
  const harness = await createHarness([])
  try {
    const noRemote = await makeGitProject(harness, {
      commits: 1,
      title: 'Push No Remote',
      name: 'push-no-remote',
    })
    let response = await harness.request('POST', '/project/push', {
      workspaceId: noRemote.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'push-no-remote')

    await git(noRemote.projectPath, ['checkout', '--detach', 'HEAD'])
    response = await harness.request('POST', '/project/push', {
      workspaceId: noRemote.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'detached-head')

    const ambiguous = await makeGitProject(harness, {
      commits: 1,
      title: 'Push Ambiguous',
      name: 'push-ambiguous',
    })
    const remoteA = await makeBareRemote(harness, 'push-a.git')
    const remoteB = await makeBareRemote(harness, 'push-b.git')
    await git(ambiguous.projectPath, ['remote', 'add', 'a', remoteA])
    await git(ambiguous.projectPath, ['remote', 'add', 'b', remoteB])
    response = await harness.request('POST', '/project/push', {
      workspaceId: ambiguous.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'push-remote-ambiguous')

    const failing = await makeGitProject(harness, {
      commits: 1,
      title: 'Push Failing',
      name: 'push-failing',
    })
    await git(failing.projectPath, ['remote', 'add', 'origin',
      path.join(harness.tempRoot, 'missing-remote.git')])
    response = await harness.request('POST', '/project/push', {
      workspaceId: failing.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'push-failed')
    assert.equal(response.data.error.message.length > 0, true)
    assert.equal(response.data.error.message.length <= 400, true)

    const plainPath = path.join(harness.tempRoot, 'push-plain-project')
    await fsp.mkdir(plainPath)
    const plain = await addProject(harness, plainPath, 'Push Plain Project')
    response = await harness.request('POST', '/project/push', {
      workspaceId: plain.project.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'git-not-initialized')
  } finally {
    await harness.close()
  }
})

test('git detail sanitization strips credentials and bounds the text', function () {
  const detail = sanitizeGitDetail(
    "fatal: unable to access 'https://user:secret@example.com/repo.git/'")
  assert.equal(detail.includes('secret'), false)
  assert.equal(detail.includes('//***@example.com'), true)
  assert.equal(sanitizeGitDetail('x'.repeat(500)).length, 300)
})
