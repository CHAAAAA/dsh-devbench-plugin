import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHarness, expectOk, waitForTaskStatus } from './helpers.js'
import { createProjectAgentServices } from './fake-agents.js'
import { addProject, git, makeGitProject } from './project-helpers.js'

function projectHarness(options) {
  let harness = null
  const fake = createProjectAgentServices(function () { return harness }, options || {})
  return createHarness([], { services: fake.services }).then(function (value) {
    harness = value
    value.agentFake = fake
    return value
  })
}

test('commit preview rejects non-git, no-change and detached projects', async function () {
  const harness = await projectHarness()
  try {
    const gitProject = await makeGitProject(harness, { commits: 1, title: 'Git Project' })
    let response = await harness.request('POST', '/project/commit/preview', {
      workspaceId: gitProject.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'no-changes')

    await fsp.writeFile(path.join(gitProject.projectPath, 'file.txt'), 'dirty\n')
    await git(gitProject.projectPath, ['checkout', '--detach', 'HEAD'])
    response = await harness.request('POST', '/project/commit/preview', {
      workspaceId: gitProject.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'detached-head')

    const plainPath = path.join(harness.tempRoot, 'plain-project')
    await fsp.mkdir(plainPath)
    const plain = await addProject(harness, plainPath, 'Plain Project')
    response = await harness.request('POST', '/project/commit/preview', {
      workspaceId: plain.project.workspaceId,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'git-not-initialized')
  } finally {
    await harness.close()
  }
})

test('commit confirmation detects stale preview and fails the task', async function () {
  const harness = await projectHarness()
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Stale Project' })
    const file = path.join(project.projectPath, 'file.txt')
    await fsp.writeFile(file, 'first change\n')
    const preview = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    }))
    const taskId = preview.task.id
    await waitForTaskStatus(harness, project.workspaceId, taskId, ['awaiting_confirmation'])
    await fsp.writeFile(file, 'second change\n')
    const confirm = await harness.request('POST', '/project/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId,
    })
    assert.equal(confirm.status, 409)
    assert.equal(confirm.data.error.code, 'stale-preview')
    const tasks = expectOk(await harness.request('GET',
      '/project/tasks?workspaceId=' + encodeURIComponent(project.workspaceId)))
    const failed = tasks.tasks.find(function (task) { return task.id === taskId })
    assert.equal(failed.status, 'failed')
    assert.equal(failed.error.length > 0, true)
  } finally {
    await harness.close()
  }
})

test('commit confirmation commits without automatically creating a review task', async function () {
  const harness = await projectHarness()
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Commit Project' })
    const file = path.join(project.projectPath, 'file.txt')
    const gitignore = path.join(project.projectPath, '.gitignore')
    await fsp.writeFile(gitignore, 'node_modules/\n')
    const gitignoreBefore = await fsp.readFile(gitignore, 'utf8')
    await fsp.writeFile(file, 'changed content\n')
    await fsp.writeFile(path.join(project.projectPath, 'new.txt'), 'new file\n')
    const exclude = await fsp.readFile(path.join(project.projectPath, '.git', 'info', 'exclude'), 'utf8')
    assert.equal(exclude.includes('.dsh-reviews/'), true)

    const preview = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    }))
    assert.equal(preview.task.status, 'queued')
    assert.equal('prompt' in preview.task, false)
    assert.equal('diffText' in preview.task, false)
    assert.equal(preview.task.changedFiles.includes('file.txt'), true)
    assert.equal(preview.task.changedFiles.includes('new.txt'), true)
    await waitForTaskStatus(harness, project.workspaceId, preview.task.id, ['awaiting_confirmation'])
    const commitPrompt = harness.agentFake.followupMessages[0].content[0].text
    assert.equal(commitPrompt.includes('changed content'), true)
    assert.equal(commitPrompt.includes('new.txt'), true)
    assert.equal(commitPrompt.includes('UNSTAGED DIFF:'), true)
    assert.equal(commitPrompt.includes('project_commit_propose'), true)
    assert.equal(commitPrompt.includes('\u5fc5\u987b\u8c03\u7528'), true)
    assert.equal(commitPrompt.includes('Conventional Commit'), true)
    assert.equal(commitPrompt.includes('git push'), true)
    assert.equal(commitPrompt.includes('\u505c\u6b62'), true)

    assert.equal(harness.agentFake.createCalls[0].agentOptions.provider, 'fake-provider')
    assert.equal(harness.agentFake.createCalls[0].meta.cwd, project.project.canonicalPath)
    assert.equal(harness.agentFake.mountCalls.includes('fake-preset'), true)
    const restricted = harness.agentFake.restrictCalls[0].deny
    assert.equal(restricted.includes('bash'), true)
    assert.equal(restricted.includes('write'), true)
    assert.equal(restricted.includes('read'), false)

    const confirm = expectOk(await harness.request('POST', '/project/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId: preview.task.id,
    }))
    assert.equal(confirm.task.status, 'succeeded')
    assert.equal(confirm.commit.hash.length > 0, true)
    assert.equal('reviewTask' in confirm, false)
    assert.equal('warning' in confirm, false)

    // 提交成功后不再自动创建评审任务：任务列表只有该提交对应的 succeeded 提交任务
    const tasksAfterCommit = expectOk(await harness.request('GET',
      '/project/tasks?workspaceId=' + encodeURIComponent(project.workspaceId)))
    const commitTasks = tasksAfterCommit.tasks.filter(function (task) {
      return task.kind === 'commit'
    })
    assert.equal(commitTasks.length, 1)
    assert.equal(commitTasks[0].id, preview.task.id)
    assert.equal(commitTasks[0].status, 'succeeded')
    assert.equal(tasksAfterCommit.tasks.some(function (task) {
      return task.kind === 'review'
    }), false)

    // 需要评审时改为手动发起
    const started = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit: confirm.commit.hash,
    }))
    assert.equal(started.task.kind, 'review')
    assert.equal(started.task.status, 'queued')
    const reviewDone = await waitForTaskStatus(harness, project.workspaceId,
      started.task.id, ['succeeded'])
    const promptTexts = harness.agentFake.followupMessages.map(function (message) {
      return message.content[0].text
    })
    const reviewPrompt = promptTexts.find(function (text) {
      return text.includes('project_git_show')
    })
    assert.equal(reviewPrompt.includes('project_review_write'), true)
    assert.equal(reviewPrompt.includes('\u5fc5\u987b\u8c03\u7528'), true)
    assert.equal(reviewPrompt.includes('\u6b63\u786e\u6027'), true)
    assert.equal(reviewPrompt.includes('\u4e25\u91cd\u7ea7\u522b'), true)
    assert.equal(reviewPrompt.includes('\u4fee\u590d\u5efa\u8bae'), true)
    assert.equal(reviewDone.reviewFile.endsWith('.md'), true)
    const head = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    assert.equal(head, confirm.commit.hash)
    const reviewPath = path.join(project.projectPath, '.dsh-reviews', reviewDone.reviewFile)
    const reviewText = await fsp.readFile(reviewPath, 'utf8')
    assert.equal(reviewText.includes('task: ' + JSON.stringify(started.task.id)), true)
    assert.equal(reviewText.includes('commit: ' + JSON.stringify(confirm.commit.hash)), true)
    assert.equal(reviewText.includes('Looks good.'), true)

    const content = expectOk(await harness.request('GET',
      '/project/review/content?workspaceId=' + encodeURIComponent(project.workspaceId) +
      '&name=' + encodeURIComponent(reviewDone.reviewFile)))
    assert.equal(content.name, reviewDone.reviewFile)
    assert.equal(content.content.includes('Looks good.'), true)

    const overview = expectOk(await harness.request('GET',
      '/project/overview?workspaceId=' + encodeURIComponent(project.workspaceId)))
    const reviewedCommit = overview.commits.find(function (commit) {
      return commit.hash === confirm.commit.hash
    })
    assert.equal(reviewedCommit.reviewed, true)
    assert.equal(reviewedCommit.reviewName, reviewDone.reviewFile)
    assert.equal(overview.reviews.length, 1)
    assert.equal(overview.reviews[0].modifiedAt.length > 0, true)
    assert.equal(overview.reviews[0].size > 0, true)

    const repeat = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit: confirm.commit.hash,
    }))
    assert.equal(repeat.alreadyReviewed, true)
    assert.equal(repeat.task.reviewFile, reviewDone.reviewFile)
    assert.equal(await fsp.readFile(gitignore, 'utf8'), gitignoreBefore)
    assert.equal((await git(project.projectPath, ['status', '--porcelain'])).stdout.trim(), '')
  } finally {
    await harness.close()
  }
})

test('commit preview rejects a second active commit task', async function () {
  const harness = await projectHarness({ waitForCancel: true })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Active Commit' })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'active change\n')
    const first = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    }))
    await waitForTaskStatus(harness, project.workspaceId, first.task.id, ['awaiting_confirmation'])
    const second = await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    })
    assert.equal(second.status, 409)
    assert.equal(second.data.error.code, 'project-task-active')
    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: first.task.id,
    }))
    await harness.waitTask(first.task.id)
  } finally {
    await harness.close()
  }
})

test('review start uses actual review files for already-reviewed detection', async function () {
  const harness = await projectHarness()
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Review File Check' })
    const commit = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    const first = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit,
    }))
    const firstDone = await waitForTaskStatus(harness, project.workspaceId,
      first.task.id, ['succeeded'])
    await fsp.rm(path.join(project.projectPath, '.dsh-reviews', firstDone.reviewFile))
    const second = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit,
    }))
    assert.equal(second.alreadyReviewed, undefined)
    const secondDone = await waitForTaskStatus(harness, project.workspaceId,
      second.task.id, ['succeeded'])
    await fsp.access(path.join(project.projectPath, '.dsh-reviews', secondDone.reviewFile))
  } finally {
    await harness.close()
  }
})

test('commit preview adds the reviews exclude for an existing repository', async function () {
  const harness = await projectHarness()
  try {
    const projectPath = path.join(harness.tempRoot, 'existing-repo')
    await fsp.mkdir(projectPath)
    await git(projectPath, ['init'])
    await git(projectPath, ['config', 'user.name', 'Existing User'])
    await git(projectPath, ['config', 'user.email', 'existing@example.com'])
    const gitignore = path.join(projectPath, '.gitignore')
    await fsp.writeFile(gitignore, 'node_modules/\n')
    await fsp.writeFile(path.join(projectPath, 'file.txt'), 'baseline\n')
    await git(projectPath, ['add', '-A'])
    await git(projectPath, ['commit', '-m', 'baseline'])
    const added = await addProject(harness, projectPath, 'Existing Repo')
    await fsp.writeFile(path.join(projectPath, 'file.txt'), 'preview change\n')
    const preview = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: added.project.workspaceId,
    }))
    const exclude = await fsp.readFile(path.join(projectPath, '.git', 'info', 'exclude'), 'utf8')
    assert.equal(exclude.split(/\r?\n/).includes('.dsh-reviews/'), true)
    assert.equal(await fsp.readFile(gitignore, 'utf8'), 'node_modules/\n')
    await waitForTaskStatus(harness, added.project.workspaceId, preview.task.id,
      ['awaiting_confirmation'])
    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: added.project.workspaceId,
      taskId: preview.task.id,
    }))
    await harness.waitTask(preview.task.id)
  } finally {
    await harness.close()
  }
})

test('concurrent commit preview creates only one active task', async function () {
  const harness = await projectHarness({ waitForCancel: true })
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Concurrent Preview' })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'parallel preview\n')
    const body = { workspaceId: project.workspaceId }
    const responses = await Promise.all([
      harness.request('POST', '/project/commit/preview', body),
      harness.request('POST', '/project/commit/preview', body),
    ])
    const ok = responses.filter(function (item) { return item.status === 200 })
    const conflicts = responses.filter(function (item) { return item.status === 409 })
    assert.equal(ok.length, 1)
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0].data.error.code, 'project-task-active')
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
