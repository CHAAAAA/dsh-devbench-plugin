import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHarness, expectOk, waitForTaskStatus } from './helpers.js'
import { createProjectAgentServices } from './fake-agents.js'
import { git, makeGitProject } from './project-helpers.js'

function projectHarness(options: any = {}) {
  let harness = null
  const fake = createProjectAgentServices(function () { return harness }, options || {})
  return createHarness([], { services: fake.services }).then(function (value) {
    harness = value
    value.agentFake = fake
    return value
  })
}

function promptTexts(harness) {
  return harness.agentFake.followupMessages.map(function (message) {
    return message.content[0].text
  })
}

function lastPrompt(harness) {
  const texts = promptTexts(harness)
  assert.equal(texts.length > 0, true, 'expected at least one agent followup prompt')
  return texts[texts.length - 1]
}

async function startReview(harness, project) {
  const head = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
  const started = expectOk(await harness.request('POST', '/project/review/start', {
    workspaceId: project.workspaceId,
    commit: head,
  }))
  await waitForTaskStatus(harness, project.workspaceId, started.task.id, ['succeeded'])
  return { started, head }
}

test('default review prompt keeps the shipped template with all placeholders rendered',
  async function () {
    const harness = await projectHarness()
    try {
      const project = await makeGitProject(harness, { commits: 1, title: 'Default Prompt' })
      const { started, head } = await startReview(harness, project)
      const prompt = lastPrompt(harness)
      assert.equal(prompt.includes('项目代码评审员'), true)
      assert.equal(prompt.includes('project_git_show'), true)
      assert.equal(prompt.includes('project_review_write'), true)
      assert.equal(prompt.includes('正确性'), true)
      assert.equal(prompt.includes(started.task.id), true)
      assert.equal(prompt.includes(head), true)
      assert.equal(prompt.includes(project.project.canonicalPath), true)
      assert.equal(prompt.includes('{'), false)

      const state = expectOk(await harness.request('GET', '/state'))
      assert.equal(state.config.reviewPromptTemplate.length > 0, true)
      assert.equal(
        state.config.reviewPromptTemplate,
        state.config.defaultReviewPromptTemplate,
      )
    } finally {
      await harness.close()
    }
  })

test('default review prompt is used by a review started manually after a commit',
  async function () {
    const harness = await projectHarness()
    try {
      const project = await makeGitProject(harness, { commits: 1, title: 'Manual Review' })
      await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'manual review change\n')
      const preview = expectOk(await harness.request('POST', '/project/commit/preview', {
        workspaceId: project.workspaceId,
      }))
      await waitForTaskStatus(harness, project.workspaceId, preview.task.id,
        ['awaiting_confirmation'])
      const confirm = expectOk(await harness.request('POST', '/project/commit/confirm', {
        workspaceId: project.workspaceId,
        taskId: preview.task.id,
      }))
      const started = expectOk(await harness.request('POST', '/project/review/start', {
        workspaceId: project.workspaceId,
        commit: confirm.commit.hash,
      }))
      assert.equal(started.task.kind, 'review')
      await waitForTaskStatus(harness, project.workspaceId, started.task.id, ['succeeded'])
      const reviewPrompt = promptTexts(harness).find(function (text) {
        return text.includes('项目代码评审员')
      })
      assert.notEqual(reviewPrompt, undefined)
      assert.equal(reviewPrompt.includes('project_git_show'), true)
      assert.equal(reviewPrompt.includes('project_review_write'), true)
      assert.equal(reviewPrompt.includes(started.task.id), true)
      assert.equal(reviewPrompt.includes(confirm.commit.hash), true)
      assert.equal(reviewPrompt.includes('{'), false)
    } finally {
      await harness.close()
    }
  })

test('custom review template is persisted and rendered for a started review', async function () {
  const harness = await projectHarness()
  const template = '自定义评审 {taskId} 项目 {projectTitle} 提交 {commitHash} ' +
    '路径 {projectPath} 摘要 {commitSubject}'
  try {
    const saved = expectOk(await harness.request('POST', '/config', {
      reviewPromptTemplate: template,
    }))
    assert.equal(saved.config.reviewPromptTemplate, template)
    assert.equal(typeof saved.config.defaultReviewPromptTemplate, 'string')
    assert.equal(saved.config.defaultReviewPromptTemplate.length > 0, true)

    const project = await makeGitProject(harness, { commits: 1, title: 'Custom Prompt Project' })
    const { started } = await startReview(harness, project)
    const task = started.task
    const expected = '自定义评审 ' + task.id + ' 项目 ' + task.projectTitle +
      ' 提交 ' + task.commitHash + ' 路径 ' + task.projectPath +
      ' 摘要 ' + task.commitSubject
    const prompt = lastPrompt(harness)
    assert.equal(prompt, expected)
    assert.equal(prompt.includes('{'), false)
    assert.equal(prompt.includes('project_git_show'), false)

    const state = expectOk(await harness.request('GET', '/state'))
    assert.equal(state.config.reviewPromptTemplate, template)
    assert.equal(state.config.defaultReviewPromptTemplate.length > 0, true)
  } finally {
    await harness.close()
  }
})

test('custom review template is used by a review started manually after a commit', async function () {
  const harness = await projectHarness()
  const template = '提交后评审 {taskId} 提交 {commitHash} 摘要 {commitSubject} 路径 {projectPath}'
  try {
    expectOk(await harness.request('POST', '/config', { reviewPromptTemplate: template }))
    const project = await makeGitProject(harness, { commits: 1, title: 'Custom Commit Review' })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'custom review change\n')
    const preview = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    }))
    await waitForTaskStatus(harness, project.workspaceId, preview.task.id, ['awaiting_confirmation'])
    const confirm = expectOk(await harness.request('POST', '/project/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId: preview.task.id,
    }))
    const started = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit: confirm.commit.hash,
    }))
    await waitForTaskStatus(harness, project.workspaceId, started.task.id, ['succeeded'])
    const task = started.task
    const expected = '提交后评审 ' + task.id + ' 提交 ' + task.commitHash +
      ' 摘要 ' + task.commitSubject + ' 路径 ' + task.projectPath
    const prompt = lastPrompt(harness)
    assert.equal(prompt, expected)
    assert.equal(prompt.includes('{'), false)
  } finally {
    await harness.close()
  }
})

test('review template without a taskId placeholder is rejected', async function () {
  const harness = await projectHarness()
  try {
    const response = await harness.request('POST', '/config', {
      reviewPromptTemplate: '自定义评审 没有占位符',
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'bad-review-template')
  } finally {
    await harness.close()
  }
})

test('default review prompt marks the target as uncommitted changes', async function () {
  const harness = await projectHarness()
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Uncommitted Default' })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'worktree change\n')
    const started = expectOk(await harness.request('POST', '/project/review/uncommitted', {
      workspaceId: project.workspaceId,
    }))
    assert.equal(started.task.reviewTarget, 'uncommitted')
    assert.equal(started.task.commitHash, '')
    await waitForTaskStatus(harness, project.workspaceId, started.task.id, ['succeeded'])
    const prompt = lastPrompt(harness)
    assert.equal(prompt.includes('项目代码评审员'), true)
    assert.equal(prompt.includes('（未提交变更）'), true)
    assert.equal(prompt.includes('当前工作区未提交的变更'), true)
    assert.equal(prompt.includes(started.task.id), true)
    assert.equal(prompt.includes(project.project.canonicalPath), true)
    assert.equal(prompt.includes('补充说明：'), true)
    assert.equal(prompt.includes('project_git_show'), true)
    assert.equal(prompt.includes('{'), false)
  } finally {
    await harness.close()
  }
})

test('custom review template is reused for an uncommitted review', async function () {
  const harness = await projectHarness()
  const template = '未提交评审 {taskId} 项目 {projectTitle} 路径 {projectPath} ' +
    '目标 {commitHash} 短 {commitShort} 摘要 {commitSubject}'
  try {
    expectOk(await harness.request('POST', '/config', { reviewPromptTemplate: template }))
    const project = await makeGitProject(harness, { commits: 1, title: 'Uncommitted Custom' })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'custom worktree change\n')
    await fsp.writeFile(path.join(project.projectPath, 'custom-untracked.txt'), 'custom untracked\n')
    const started = expectOk(await harness.request('POST', '/project/review/uncommitted', {
      workspaceId: project.workspaceId,
    }))
    await waitForTaskStatus(harness, project.workspaceId, started.task.id, ['succeeded'])
    const task = started.task
    const rendered = '未提交评审 ' + task.id + ' 项目 ' + task.projectTitle +
      ' 路径 ' + task.projectPath + ' 目标 （未提交变更） 短 worktree 摘要 当前工作区未提交的变更'
    const prompt = lastPrompt(harness)
    assert.equal(prompt.startsWith(rendered), true)
    const appended = prompt.slice(rendered.length)
    assert.equal(appended.includes('补充说明：'), true)
    assert.equal(appended.includes('file.txt'), true)
    assert.equal(appended.includes('custom-untracked.txt'), true)
    assert.equal(appended.includes('project_git_show'), true)
    assert.equal(prompt.includes('{'), false)
  } finally {
    await harness.close()
  }
})
