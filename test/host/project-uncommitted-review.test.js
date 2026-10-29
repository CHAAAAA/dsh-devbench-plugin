import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHarness, expectOk, waitForTaskStatus } from './helpers.js'
import { createFakeAgentServices, createProjectAgentServices } from './fake-agents.js'
import { git, makeGitProject } from './project-helpers.js'
import { listReviews, writeReview } from '../../src/host/domain/reviews.js'
import { captureProjectSnapshot, showWorktreeDiff } from '../../src/host/integrations/git.js'
import { messages } from '../../src/host/messages/index.js'

function projectHarness(options) {
  let harness = null
  const fake = createProjectAgentServices(function () { return harness }, options || {})
  return createHarness([], { services: fake.services }).then(function (value) {
    harness = value
    value.agentFake = fake
    return value
  })
}

/** 制造三种未提交变更：已暂存新文件、未暂存修改、未跟踪新文件。 */
async function makeUncommittedChanges(project) {
  await fsp.writeFile(path.join(project.projectPath, 'staged.txt'), 'staged content line\n')
  await git(project.projectPath, ['add', 'staged.txt'])
  await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'unstaged content line\n')
  await fsp.writeFile(path.join(project.projectPath, 'untracked.txt'), 'untracked content line\n')
}

function uncommittedReview(harness, workspaceId) {
  return harness.request('POST', '/project/review/uncommitted', { workspaceId })
}

function tasksUrl(workspaceId) {
  return '/project/tasks?workspaceId=' + encodeURIComponent(workspaceId)
}

function overviewUrl(workspaceId) {
  return '/project/overview?workspaceId=' + encodeURIComponent(workspaceId)
}

test('uncommitted review covers staged, unstaged and untracked changes end to end',
  async function () {
    const harness = await projectHarness()
    try {
      const project = await makeGitProject(harness, { commits: 1, title: 'Uncommitted Project' })
      await makeUncommittedChanges(project)

      const started = expectOk(await uncommittedReview(harness, project.workspaceId))
      const task = started.task
      assert.equal(task.kind, 'review')
      assert.equal(task.reviewTarget, 'uncommitted')
      assert.equal(task.commitHash, '')
      assert.equal(task.commitShort, '')
      assert.equal(task.commitSubject, '')
      assert.equal(task.baseHead.length > 0, true)
      for (const file of ['file.txt', 'staged.txt', 'untracked.txt']) {
        assert.equal(task.changedFiles.includes(file), true, 'changedFiles 缺少 ' + file)
      }

      const done = await waitForTaskStatus(harness, project.workspaceId, task.id, ['succeeded'])
      assert.equal(done.reviewFile.endsWith('.md'), true)

      // 任务列表 DTO 暴露 reviewTarget，供任务中心显示「评审目标：未提交变更」。
      const listed = expectOk(await harness.request('GET', tasksUrl(project.workspaceId)))
      const listedTask = listed.tasks.find(function (item) { return item.id === task.id })
      assert.equal(listedTask.reviewTarget, 'uncommitted')
      assert.equal(listedTask.commitHash, '')

      // fake agent 通过 project_git_show 取到的组合 diff 含三部分内容。
      const reviewCall = harness.agentFake.calls.reviews.find(function (item) {
        return item.taskId === task.id
      })
      assert.notEqual(reviewCall, undefined)
      assert.equal(reviewCall.shown.ok, true)
      assert.equal(reviewCall.shown.message, 'uncommitted changes')
      const diff = reviewCall.shown.content
      assert.equal(diff.includes('STAGED DIFF:'), true)
      assert.equal(diff.includes('UNSTAGED DIFF:'), true)
      assert.equal(diff.includes('UNTRACKED FILES:'), true)
      assert.equal(diff.includes('staged content line'), true)
      assert.equal(diff.includes('unstaged content line'), true)
      assert.equal(diff.includes('untracked content line'), true)
      assert.equal(diff.includes('--- untracked.txt ---'), true)
      assert.equal(diff.includes('.dsh-reviews'), false)

      // 评审文件 frontmatter 带 target: "uncommitted"，commit 仍为空字符串。
      const reviewPath = path.join(project.projectPath, '.dsh-reviews', done.reviewFile)
      const reviewText = await fsp.readFile(reviewPath, 'utf8')
      assert.equal(reviewText.includes('target: "uncommitted"'), true)
      assert.equal(reviewText.includes('commit: ""'), true)

      // 概览的最近评审返回 target/commit；未提交评审不得标记任何提交已评审。
      const overview = expectOk(await harness.request('GET', overviewUrl(project.workspaceId)))
      assert.equal(overview.reviews.length, 1)
      assert.equal(overview.reviews[0].name, done.reviewFile)
      assert.equal(overview.reviews[0].target, 'uncommitted')
      assert.equal(overview.reviews[0].commit, '')
      assert.equal(overview.commits[0].reviewed, false)
      assert.equal(overview.commits[0].reviewName, null)

      // 评审内容接口同样返回未提交目标。
      const content = expectOk(await harness.request('GET',
        '/project/review/content?workspaceId=' + encodeURIComponent(project.workspaceId) +
        '&name=' + encodeURIComponent(done.reviewFile)))
      assert.equal(content.target, 'uncommitted')
      assert.equal(content.commit, '')
      assert.equal(content.content.includes('Looks good'), true)

      // prompt 含任务 ID、项目路径、未提交说明与变更文件，且没有未渲染占位符。
      assert.equal(harness.agentFake.followupMessages.length, 1)
      const prompt = harness.agentFake.followupMessages[0].content[0].text
      assert.equal(prompt.includes(task.id), true)
      assert.equal(prompt.includes(project.project.canonicalPath), true)
      assert.equal(prompt.includes('未提交'), true)
      for (const file of ['file.txt', 'staged.txt', 'untracked.txt']) {
        assert.equal(prompt.includes(file), true, 'prompt 缺少变更文件 ' + file)
      }
      assert.equal(prompt.includes('{'), false)
    } finally {
      await harness.close()
    }
  })

test('uncommitted review rejects a clean worktree without creating a task', async function () {
  const harness = await projectHarness()
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Clean Project' })
    const response = await uncommittedReview(harness, project.workspaceId)
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'no-uncommitted-changes')
    assert.equal(response.data.error.message, messages.projectNoUncommittedChanges)

    const listed = expectOk(await harness.request('GET', tasksUrl(project.workspaceId)))
    assert.deepEqual(listed.tasks, [])
    assert.equal(harness.agentFake.followupMessages.length, 0)
  } finally {
    await harness.close()
  }
})

test('uncommitted review returns a conflict while another one is running', async function () {
  const fake = createFakeAgentServices({ waitForCancel: true })
  const harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Running Project' })
    await makeUncommittedChanges(project)
    const started = expectOk(await uncommittedReview(harness, project.workspaceId))
    await waitForTaskStatus(harness, project.workspaceId, started.task.id, ['running'])

    const duplicate = await uncommittedReview(harness, project.workspaceId)
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.data.error.code, 'uncommitted-review-in-progress')
    assert.equal(duplicate.data.error.message, messages.projectUncommittedReviewInProgress)

    const listed = expectOk(await harness.request('GET', tasksUrl(project.workspaceId)))
    assert.equal(listed.tasks.length, 1)

    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: started.task.id,
    }))
    await harness.waitTask(started.task.id)
  } finally {
    await harness.close()
  }
})

test('uncommitted review works on a detached HEAD while snapshot capture still rejects it',
  async function () {
    const harness = await projectHarness()
    try {
      const project = await makeGitProject(harness, { commits: 1, title: 'Detached Project' })
      await git(project.projectPath, ['checkout', '--detach', 'HEAD'])
      await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'detached change\n')
      await fsp.writeFile(path.join(project.projectPath, 'detached-untracked.txt'), 'detached 未跟踪\n')

      // 默认快照行为保持不变：detached HEAD 仍抛 detached-head。
      await assert.rejects(captureProjectSnapshot(project.projectPath), function (error) {
        return error.code === 'detached-head'
      })

      const started = expectOk(await uncommittedReview(harness, project.workspaceId))
      assert.equal(started.task.reviewTarget, 'uncommitted')
      assert.equal(started.task.commitHash, '')
      const done = await waitForTaskStatus(harness, project.workspaceId,
        started.task.id, ['succeeded'])
      assert.equal(done.reviewFile.endsWith('.md'), true)
      const reviewText = await fsp.readFile(
        path.join(project.projectPath, '.dsh-reviews', done.reviewFile), 'utf8')
      assert.equal(reviewText.includes('target: "uncommitted"'), true)
    } finally {
      await harness.close()
    }
  })

test('worktree diff never follows symlinks and caps binary and oversized content',
  async function () {
    const harness = await createHarness([])
    try {
      const project = await makeGitProject(harness, { commits: 1, title: 'Diff Safety' })
      const secret = path.join(harness.tempRoot, 'outside-secret.txt')
      await fsp.writeFile(secret, 'outside secret content\n')
      await fsp.symlink(secret, path.join(project.projectPath, 'link.txt'))
      await fsp.writeFile(path.join(project.projectPath, 'binary.bin'),
        Buffer.from([0, 1, 2, 3, 4]))
      await fsp.writeFile(path.join(project.projectPath, 'big.txt'),
        'x'.repeat(70 * 1024))

      const result = await showWorktreeDiff(project.projectPath)
      assert.equal(result.hasChanges, true)
      assert.equal(result.text.includes('outside secret content'), false)
      assert.equal(result.text.includes('[symlink -> ' + secret + ']'), true)
      assert.equal(result.text.includes('[binary file]'), true)
      // 单文件内容上限 64KB：完整内容不出现，超出部分以 [truncated] 标记。
      assert.equal(result.text.includes('x'.repeat(70 * 1024)), false)
      assert.equal(result.text.includes('x'.repeat(64 * 1024)), true)
      assert.equal(result.text.includes('[truncated]'), true)
      assert.equal(result.truncated, false)
      for (const file of ['link.txt', 'binary.bin', 'big.txt']) {
        assert.equal(result.changedFiles.includes(file), true, 'changedFiles 缺少 ' + file)
      }
    } finally {
      await harness.close()
    }
  })

test('worktree diff caps the combined text at 200000 characters', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Diff Cap' })
    for (let index = 1; index <= 5; index += 1) {
      await fsp.writeFile(path.join(project.projectPath, 'a-' + index + '.txt'),
        'y'.repeat(50 * 1024))
    }
    const result = await showWorktreeDiff(project.projectPath)
    assert.equal(result.hasChanges, true)
    assert.equal(result.truncated, true)
    assert.equal(result.text.length, 200000 + '\n[truncated]\n'.length)
    assert.equal(result.text.endsWith('\n[truncated]\n'), true)
  } finally {
    await harness.close()
  }
})

test('review files without a target marker are treated as commit reviews', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Legacy Project' })
    const head = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    const reviewsDir = path.join(project.projectPath, '.dsh-reviews')
    await fsp.mkdir(reviewsDir, { recursive: true })
    const legacy = [
      '---',
      'task: "TASK-20261026-001"',
      'project: "Legacy Project"',
      'workspaceId: ' + JSON.stringify(project.workspaceId),
      'commit: ' + JSON.stringify(head),
      'commitSubject: "commit 1"',
      'createdAt: "2026-10-26T00:00:00.000Z"',
      'summary: "legacy review"',
      '---',
      '',
      '# Legacy review',
      '',
    ].join('\n')
    await fsp.writeFile(path.join(reviewsDir, '20261026-legacy.md'), legacy)

    const reviews = await listReviews(project.projectPath)
    assert.equal(reviews.length, 1)
    assert.equal(reviews[0].target, 'commit')

    const content = expectOk(await harness.request('GET',
      '/project/review/content?workspaceId=' + encodeURIComponent(project.workspaceId) +
      '&name=20261026-legacy.md'))
    assert.equal(content.target, 'commit')
    assert.equal(content.commit, head)

    const overview = expectOk(await harness.request('GET', overviewUrl(project.workspaceId)))
    assert.equal(overview.reviews[0].target, 'commit')
    // 旧格式评审仍按提交匹配，把对应提交标记为已评审。
    assert.equal(overview.commits[0].reviewed, true)

    // 普通提交评审写出的新文件保持原有 frontmatter 格式（不出现 target 字段）。
    const written = await writeReview(project.projectPath, {
      id: 'TASK-20261027-001',
      projectTitle: 'Legacy Project',
      workspaceId: project.workspaceId,
      commitHash: head,
      commitSubject: 'commit 1',
    }, 'commit review', '# Commit review\n')
    const writtenText = await fsp.readFile(path.join(reviewsDir, written.name), 'utf8')
    assert.equal(writtenText.includes('target:'), false)
    const allReviews = await listReviews(project.projectPath)
    const writtenReview = allReviews.find(function (review) { return review.name === written.name })
    assert.equal(writtenReview.target, 'commit')
  } finally {
    await harness.close()
  }
})

test('concurrent uncommitted review starts create only one task', async function () {
  const fake = createFakeAgentServices({ waitForCancel: true })
  const harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Concurrent Uncommitted' })
    await makeUncommittedChanges(project)
    const responses = await Promise.all([
      uncommittedReview(harness, project.workspaceId),
      uncommittedReview(harness, project.workspaceId),
    ])
    const ok = responses.filter(function (item) { return item.status === 200 })
    const conflicts = responses.filter(function (item) { return item.status === 409 })
    assert.equal(ok.length, 1)
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0].data.error.code, 'uncommitted-review-in-progress')
    const task = ok[0].data.value.task
    await waitForTaskStatus(harness, project.workspaceId, task.id, ['running'])
    const listed = expectOk(await harness.request('GET', tasksUrl(project.workspaceId)))
    const active = listed.tasks.filter(function (item) {
      return item.status === 'queued' || item.status === 'running'
    })
    assert.equal(active.length, 1)
    assert.equal(active[0].id, task.id)
    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: task.id,
    }))
    await harness.waitTask(task.id)
  } finally {
    await harness.close()
  }
})

test('retry keeps one active uncommitted review and re-snapshots the worktree', async function () {
  const fake = createFakeAgentServices({ waitForCancel: true })
  const harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Retry Uncommitted' })
    await makeUncommittedChanges(project)
    const first = expectOk(await uncommittedReview(harness, project.workspaceId)).task
    await waitForTaskStatus(harness, project.workspaceId, first.id, ['running'])
    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: first.id,
    }))
    await harness.waitTask(first.id)

    const second = expectOk(await uncommittedReview(harness, project.workspaceId)).task
    await waitForTaskStatus(harness, project.workspaceId, second.id, ['running'])
    const conflict = await harness.request('POST', '/project/task/retry', {
      workspaceId: project.workspaceId,
      taskId: first.id,
    })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.data.error.code, 'uncommitted-review-in-progress')

    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: second.id,
    }))
    await harness.waitTask(second.id)

    // The retried review must use the current worktree, not the first prompt.
    await fsp.writeFile(path.join(project.projectPath, 'retry-later.txt'), 'later change\n')
    const retried = expectOk(await harness.request('POST', '/project/task/retry', {
      workspaceId: project.workspaceId,
      taskId: first.id,
    })).task
    assert.equal(retried.id, first.id)
    assert.equal(retried.reviewTarget, 'uncommitted')
    assert.equal(retried.status, 'queued')
    assert.equal(retried.reviewFile, '')
    assert.equal(retried.changedFiles.includes('retry-later.txt'), true)
    assert.equal(retried.changedFiles.includes('untracked.txt'), true)
    await waitForTaskStatus(harness, project.workspaceId, first.id, ['running'])
    const prompt = fake.followupMessages[2].content[0].text
    assert.equal(prompt.includes(first.id), true)
    assert.equal(prompt.includes('retry-later.txt'), true)
    assert.equal(prompt.includes('{'), false)
    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: first.id,
    }))
    await harness.waitTask(first.id)
  } finally {
    await harness.close()
  }
})

test('retrying an uncommitted review on a clean worktree is rejected', async function () {
  const fake = createFakeAgentServices({ waitForCancel: true })
  const harness = await createHarness([], { services: fake.services })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Clean Retry' })
    await makeUncommittedChanges(project)
    const first = expectOk(await uncommittedReview(harness, project.workspaceId)).task
    await waitForTaskStatus(harness, project.workspaceId, first.id, ['running'])
    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: first.id,
    }))
    await harness.waitTask(first.id)

    await git(project.projectPath, ['checkout', '--', 'file.txt'])
    await git(project.projectPath, ['reset', '--', 'staged.txt'])
    await git(project.projectPath, ['clean', '-fd'])
    const response = await harness.request('POST', '/project/task/retry', {
      workspaceId: project.workspaceId,
      taskId: first.id,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'no-uncommitted-changes')
  } finally {
    await harness.close()
  }
})
