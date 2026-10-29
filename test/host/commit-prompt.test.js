import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { DEFAULT_COMMIT_PROMPT_TEMPLATE } from '../../src/host/constants.js'
import { buildCommitPrompt } from '../../src/host/prompts/project.js'
import { createHarness, expectOk, waitForTaskStatus } from './helpers.js'
import { createProjectAgentServices } from './fake-agents.js'
import { makeGitProject } from './project-helpers.js'

function projectHarness(options) {
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

async function previewCommit(harness, project) {
  const preview = expectOk(await harness.request('POST', '/project/commit/preview', {
    workspaceId: project.workspaceId,
  }))
  await waitForTaskStatus(harness, project.workspaceId, preview.task.id, ['awaiting_confirmation'])
  return preview
}

async function readStoredConfig(harness) {
  return JSON.parse(await fsp.readFile(path.join(harness.configDir, 'config.json'), 'utf8'))
}

test('default commit prompt keeps the shipped template with all placeholders rendered',
  async function () {
    const harness = await projectHarness()
    try {
      const project = await makeGitProject(harness, { commits: 1, title: 'Default Commit Prompt' })
      const file = path.join(project.projectPath, 'file.txt')
      await fsp.writeFile(file, 'default commit prompt change\n')
      const preview = await previewCommit(harness, project)
      const prompt = lastPrompt(harness)
      assert.equal(prompt.includes('项目提交助手'), true)
      assert.equal(prompt.includes('任务 ID: ' + preview.task.id), true)
      assert.equal(prompt.includes('项目路径: ' + project.project.canonicalPath), true)
      assert.equal(prompt.includes('变更文件:'), true)
      assert.equal(prompt.includes('- file.txt'), true)
      assert.equal(prompt.includes('暂存、未暂存变更和未跟踪文件:'), true)
      assert.equal(prompt.includes('default commit prompt change'), true)
      assert.equal(prompt.includes('UNSTAGED DIFF:'), true)
      assert.equal(prompt.includes('project_commit_propose'), true)
      assert.equal(prompt.includes('Conventional Commit'), true)
      assert.equal(prompt.includes('要求:'), true)
      // 占位符全部替换，且没有回退到需求执行模板。
      assert.equal(prompt.includes('{'), false)
      assert.equal(prompt.includes('需求文档'), false)

      const state = expectOk(await harness.request('GET', '/state'))
      assert.equal(state.config.commitPromptTemplate.length > 0, true)
      assert.equal(state.config.commitPromptTemplate, state.config.defaultCommitPromptTemplate)
      assert.equal(
        state.config.defaultCommitPromptTemplate,
        DEFAULT_COMMIT_PROMPT_TEMPLATE,
      )
    } finally {
      await harness.close()
    }
  })

test('custom commit prompt is persisted and rendered for a commit preview', async function () {
  const harness = await projectHarness()
  const template = '自定义提交标记 CUSTOM-COMMIT 任务 {taskId} 路径 {projectPath}\n' +
    '文件 {changedFiles}\n差异 {diffText}\n只调用 project_commit_propose 一次'
  try {
    const saved = expectOk(await harness.request('POST', '/config', {
      commitPromptTemplate: template,
    }))
    assert.equal(saved.config.commitPromptTemplate, template)
    assert.equal(typeof saved.config.defaultCommitPromptTemplate, 'string')
    assert.equal(saved.config.defaultCommitPromptTemplate.length > 0, true)

    const raw = await readStoredConfig(harness)
    assert.equal(raw.commitPromptTemplate, template)

    const project = await makeGitProject(harness, { commits: 1, title: 'Custom Commit Prompt' })
    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'custom prompt change\n')
    const preview = await previewCommit(harness, project)
    const prompt = lastPrompt(harness)
    assert.equal(prompt.includes('CUSTOM-COMMIT'), true)
    assert.equal(prompt.includes('自定义提交标记'), true)
    assert.equal(prompt.includes(preview.task.id), true)
    assert.equal(prompt.includes(project.project.canonicalPath), true)
    assert.equal(prompt.includes('- file.txt'), true)
    assert.equal(prompt.includes('custom prompt change'), true)
    assert.equal(prompt.includes('UNSTAGED DIFF:'), true)
    assert.equal(prompt.includes('{'), false)
    // 自定义模板替换掉默认模板内容。
    assert.equal(prompt.includes('你是项目提交助手'), false)
    assert.equal(prompt.includes('要求:'), false)

    const state = expectOk(await harness.request('GET', '/state'))
    assert.equal(state.config.commitPromptTemplate, template)
    assert.equal(state.config.defaultCommitPromptTemplate, DEFAULT_COMMIT_PROMPT_TEMPLATE)
  } finally {
    await harness.close()
  }
})

test('custom commit prompt without the required placeholders is rejected', async function () {
  const harness = await projectHarness()
  try {
    let response = await harness.request('POST', '/config', {
      commitPromptTemplate: '只有任务 {taskId} 的自定义模板',
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'bad-commit-template')
    assert.equal(response.data.error.message.includes('提交提示词模板'), true)

    // 缺少 {diffText} 同样拒绝。
    response = await harness.request('POST', '/config', {
      commitPromptTemplate: '任务 {taskId} 文件 {changedFiles}',
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'bad-commit-template')

    const state = expectOk(await harness.request('GET', '/state'))
    assert.equal(state.config.commitPromptTemplate, state.config.defaultCommitPromptTemplate)
  } finally {
    await harness.close()
  }
})

test('empty or default commit prompt stores the sentinel and falls back to the default template',
  async function () {
    const harness = await projectHarness()
    try {
      // 空串：存空串哨兵，读回默认模板。
      let saved = expectOk(await harness.request('POST', '/config', {
        commitPromptTemplate: '',
      }))
      assert.equal(saved.config.commitPromptTemplate, DEFAULT_COMMIT_PROMPT_TEMPLATE)
      assert.equal((await readStoredConfig(harness)).commitPromptTemplate, '')

      // 等于默认模板同样存空串哨兵。
      saved = expectOk(await harness.request('POST', '/config', {
        commitPromptTemplate: DEFAULT_COMMIT_PROMPT_TEMPLATE,
      }))
      assert.equal(saved.config.commitPromptTemplate, DEFAULT_COMMIT_PROMPT_TEMPLATE)
      assert.equal((await readStoredConfig(harness)).commitPromptTemplate, '')

      const project = await makeGitProject(harness, { commits: 1, title: 'Empty Commit Prompt' })
      await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'empty template change\n')
      await previewCommit(harness, project)
      const prompt = lastPrompt(harness)
      assert.equal(prompt.includes('你是项目提交助手'), true)
      assert.equal(prompt.includes('project_commit_propose'), true)
      assert.equal(prompt.includes('{'), false)
      assert.equal(prompt.includes('需求文档'), false)
    } finally {
      await harness.close()
    }
  })

test('legacy config without commitPromptTemplate falls back to the default template',
  async function () {
    const harness = await projectHarness()
    try {
      await fsp.mkdir(harness.configDir, { recursive: true })
      await fsp.writeFile(path.join(harness.configDir, 'config.json'),
        JSON.stringify({ version: 1, rootDir: '', promptTemplate: '', reviewPromptTemplate: '' }))
      const state = expectOk(await harness.request('GET', '/state'))
      assert.equal(state.config.commitPromptTemplate, DEFAULT_COMMIT_PROMPT_TEMPLATE)
      assert.equal(state.config.defaultCommitPromptTemplate, DEFAULT_COMMIT_PROMPT_TEMPLATE)
    } finally {
      await harness.close()
    }
  })

test('buildCommitPrompt renders worktree information for worktree commit tasks', function () {
  const task = {
    id: 'TASK-20261028-001',
    projectPath: '/tmp/project',
    worktreePath: '/tmp/worktrees/REQ-20261028-001',
    worktreeBranch: 'devbench/REQ-20261028-001',
    changedFiles: ['src/example.js'],
    diffText: 'UNSTAGED DIFF:\n+const value = 1',
  }
  const prompt = buildCommitPrompt(task)
  const lines = prompt.split('\n')
  assert.equal(lines.includes('工作树: /tmp/worktrees/REQ-20261028-001'), true)
  assert.equal(lines.includes('工作树分支: devbench/REQ-20261028-001'), true)
  assert.equal(prompt.includes('任务 ID: TASK-20261028-001'), true)
  assert.equal(prompt.includes('项目路径: /tmp/project'), true)
  assert.equal(prompt.includes('- src/example.js'), true)
  assert.equal(prompt.includes('+const value = 1'), true)
  assert.equal(prompt.includes('{'), false)

  // 主工作区任务没有工作树信息行。
  const mainPrompt = buildCommitPrompt({
    id: 'TASK-20261028-002',
    projectPath: '/tmp/project',
    changedFiles: [],
    diffText: '',
  })
  assert.equal(mainPrompt.includes('工作树:'), false)
  assert.equal(mainPrompt.includes('工作树分支:'), false)
  assert.equal(mainPrompt.includes('- (无)'), true)
  assert.equal(mainPrompt.includes('(无)'), true)
  assert.equal(mainPrompt.includes('{'), false)
})
