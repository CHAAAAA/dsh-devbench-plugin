import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  configureRoot,
  createHarness,
  createRequirement,
  expectOk,
  initWorkspace,
  waitForTaskStatus,
} from './helpers.js'
import { createProjectAgentServices } from './fake-agents.js'
import { addProject, makeGitProject } from './project-helpers.js'
import { messages } from '../../src/host/messages/index.js'

const DAY_MS = 24 * 60 * 60 * 1000
const REQUIREMENT_TITLE = '\u4e3b\u9875\u9700\u6c42'
const COMMIT_MESSAGE = '\u63d0\u4ea4\u6d4b\u8bd5'

function projectHarness(options: any = {}) {
  let harness = null
  const fake = createProjectAgentServices(function () { return harness }, options || {})
  return createHarness([], { services: fake.services }).then(function (value) {
    harness = value
    value.agentFake = fake
    return value
  })
}

test('dashboard reports the empty state and weekly report validates days', async function () {
  const harness = await createHarness([])
  try {
    const value = expectOk(await harness.request('GET', '/dashboard'))
    assert.equal(typeof value.generatedAt, 'string')
    assert.equal(value.generatedAt.length > 0, true)
    assert.equal(value.week.end, value.generatedAt)
    assert.equal(new Date(value.week.end).getTime() - new Date(value.week.start).getTime(),
      7 * DAY_MS)
    assert.deepEqual(value.totals, {
      projects: 0,
      requirements: 0,
      activeTasks: 0,
      tasksThisWeek: 0,
      runningRequirements: 0,
    })
    assert.deepEqual(value.projects, [])
    assert.deepEqual(value.recentTasks, [])
    assert.deepEqual(value.activeTasks, [])
    assert.deepEqual(value.runningRequirements, [])

    const report = expectOk(await harness.request('POST', '/weekly-report', {}))
    assert.equal(report.days, 7)
    assert.equal(report.week.end, report.generatedAt)
    assert.equal(report.markdown.includes(messages.weeklyReportTitle), true)
    assert.equal(report.markdown.includes(messages.weeklyReportEmpty), true)
    assert.deepEqual(report.counts, {
      projects: 0,
      commits: 0,
      reviews: 0,
      tasks: 0,
      requirementsCreated: 0,
      requirementsUpdated: 0,
      runningRequirements: 0,
    })
    assert.deepEqual(report.projects, [])
    assert.deepEqual(report.skippedProjects, [])

    const custom = expectOk(await harness.request('POST', '/weekly-report', { days: 30 }))
    assert.equal(custom.days, 30)
    assert.equal(new Date(custom.week.start).getTime(),
      new Date(custom.week.end).getTime() - 30 * DAY_MS)

    for (const days of [0, 91, 2.5, 'abc', null]) {
      const response = await harness.request('POST', '/weekly-report', { days })
      assert.equal(response.status, 400)
      assert.equal(response.data.ok, false)
    }
  } finally {
    await harness.close()
  }
})

test('dashboard and weekly report summarize project activity', async function () {
  const harness = await projectHarness({ waitForCancel: true })
  try {
    const project = await makeGitProject(harness, { commits: 3, title: 'Home Project' })
    await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
    await initWorkspace(harness, project.workspaceId)
    const created = await createRequirement(harness, project.workspaceId, REQUIREMENT_TITLE,
      '# ' + REQUIREMENT_TITLE + '\n')
    assert.equal(created.requirement.status, 'new')

    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'home change\n')
    const preview = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    }))
    await waitForTaskStatus(harness, project.workspaceId, preview.task.id, ['awaiting_confirmation'])
    const confirmed = expectOk(await harness.request('POST', '/project/commit/confirm', {
      workspaceId: project.workspaceId,
      taskId: preview.task.id,
    }))
    assert.equal(confirmed.task.status, 'succeeded')
    assert.equal('reviewTask' in confirmed, false)
    const startedReview = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit: confirmed.commit.hash,
    }))
    const reviewTask = await waitForTaskStatus(harness, project.workspaceId,
      startedReview.task.id, ['succeeded'])
    assert.equal(reviewTask.reviewFile.endsWith('.md'), true)

    await fsp.writeFile(path.join(project.projectPath, 'file.txt'), 'pending change\n')
    const activePreview = expectOk(await harness.request('POST', '/project/commit/preview', {
      workspaceId: project.workspaceId,
    }))
    await waitForTaskStatus(harness, project.workspaceId,
      activePreview.task.id, ['awaiting_confirmation'])

    const dashboard = expectOk(await harness.request('GET', '/dashboard'))
    assert.equal(dashboard.week.end, dashboard.generatedAt)
    assert.equal(dashboard.totals.projects, 1)
    assert.equal(dashboard.totals.requirements >= 1, true)
    assert.equal(dashboard.totals.activeTasks >= 1, true)
    assert.equal(dashboard.totals.tasksThisWeek >= 2, true)
    assert.equal(dashboard.projects.length, 1)
    assert.equal(dashboard.projects[0].workspaceId, project.workspaceId)
    assert.equal(dashboard.projects[0].title, 'Home Project')
    assert.equal(dashboard.projects[0].path, await fsp.realpath(project.projectPath))
    assert.equal(dashboard.projects[0].requirementsCount, 1)
    assert.equal(dashboard.projects[0].activeTaskCount >= 1, true)
    assert.equal(dashboard.projects[0].missingPath, false)
    assert.equal(dashboard.recentTasks.length >= 2, true)
    assert.equal(dashboard.recentTasks[0].id, activePreview.task.id)
    for (const task of dashboard.recentTasks) {
      assert.equal(task.projectTitle, 'Home Project')
      assert.equal(typeof task.id, 'string')
      assert.equal(typeof task.status, 'string')
    }
    const activeIds = dashboard.activeTasks.map(function (task) { return task.id })
    assert.equal(activeIds.includes(activePreview.task.id), true)
    assert.deepEqual(dashboard.runningRequirements, [])

    expectOk(await harness.request('POST', '/requirement/save', {
      workspaceId: project.workspaceId,
      id: created.requirement.id,
      status: 'running',
    }))
    const running = expectOk(await harness.request('GET', '/dashboard'))
    assert.equal(running.totals.runningRequirements, 1)
    assert.equal(running.projects[0].runningRequirementsCount, 1)
    const entry = running.runningRequirements.find(function (item) {
      return item.id === created.requirement.id
    })
    assert.notEqual(entry, undefined)
    assert.equal(entry.workspaceId, project.workspaceId)
    assert.equal(entry.title, REQUIREMENT_TITLE)
    assert.equal(entry.projectTitle, 'Home Project')
    assert.equal(typeof entry.updatedAt, 'string')
    assert.equal(typeof entry.folder, 'string')

    const report = expectOk(await harness.request('POST', '/weekly-report', {}))
    assert.equal(report.days, 7)
    assert.equal(report.counts.projects, 1)
    assert.equal(report.counts.commits >= 1, true)
    assert.equal(report.counts.reviews >= 1, true)
    assert.equal(report.counts.tasks >= 2, true)
    assert.equal(report.counts.requirementsCreated, 1)
    assert.equal(report.counts.requirementsUpdated, 1)
    assert.equal(report.counts.runningRequirements, 1)
    assert.equal(report.projects.length, 1)
    assert.equal(report.projects[0].workspaceId, project.workspaceId)
    assert.equal(report.projects[0].title, 'Home Project')
    assert.equal(report.projects[0].commits.length >= 1, true)
    assert.equal(report.projects[0].commits[0].hash.length > 0, true)
    assert.equal(report.projects[0].reviews.length >= 1, true)
    assert.equal(report.projects[0].reviews[0].name, reviewTask.reviewFile)
    assert.equal(report.projects[0].tasks.succeeded >= 1, true)
    assert.equal(report.projects[0].tasks.active, 1)
    assert.equal(report.projects[0].requirements.created, 1)
    assert.equal(report.projects[0].requirements.updated, 1)
    assert.deepEqual(report.projects[0].requirements.running, [{
      id: created.requirement.id,
      title: REQUIREMENT_TITLE,
      status: 'running',
    }])
    assert.equal(report.markdown.includes(messages.weeklyReportTitle), true)
    assert.equal(report.markdown.includes('Home Project'), true)
    assert.equal(report.markdown.includes(COMMIT_MESSAGE), true)
    assert.equal(report.markdown.includes(reviewTask.reviewFile), true)
    assert.equal(report.markdown.includes(REQUIREMENT_TITLE), true)
    assert.equal(report.markdown.includes('\u9879\u76ee\u8be6\u60c5'), true)
    assert.equal(report.markdown.includes('[\u65b0\u5efa]'), true)
    assert.equal(report.markdown.includes(messages.weeklyReportEmpty), false)

    expectOk(await harness.request('POST', '/project/task/cancel', {
      workspaceId: project.workspaceId,
      taskId: activePreview.task.id,
    }))
    await harness.waitTask(activePreview.task.id)
    const afterCancel = expectOk(await harness.request('GET', '/dashboard'))
    assert.deepEqual(afterCancel.activeTasks, [])
  } finally {
    await harness.close()
  }
})

test('weekly report skips projects whose path disappeared', async function () {
  const harness = await createHarness([])
  try {
    const projectPath = path.join(harness.tempRoot, 'vanishing-project')
    await fsp.mkdir(projectPath)
    const added = await addProject(harness, projectPath, 'Vanishing Project')
    await fsp.rm(projectPath, { recursive: true, force: true })

    const dashboard = expectOk(await harness.request('GET', '/dashboard'))
    assert.equal(dashboard.projects.length, 1)
    assert.equal(dashboard.projects[0].workspaceId, added.project.workspaceId)
    assert.equal(dashboard.projects[0].missingPath, true)

    const report = expectOk(await harness.request('POST', '/weekly-report', {}))
    assert.equal(report.counts.projects, 0)
    assert.equal(report.skippedProjects.length, 1)
    assert.equal(report.skippedProjects[0].workspaceId, added.project.workspaceId)
    assert.equal(report.skippedProjects[0].reason, 'missing-path')
    assert.equal(report.markdown.includes(messages.weeklyReportEmpty), true)
  } finally {
    await harness.close()
  }
})

test('dashboard returns every retained task so the home pager can reveal older rows', async function () {
  function fixture(index, now) {
    const stamp = new Date(now - (25 - index) * 1000).toISOString()
    return {
      id: 'TASK-20261026-' + String(index).padStart(3, '0'),
      kind: 'review',
      status: 'succeeded',
      workspaceId: 'w1',
      projectPath: '/tmp/project',
      projectTitle: 'Paged project',
      sessionId: '',
      proposedMessage: '',
      createdAt: stamp,
      updatedAt: stamp,
    }
  }
  const now = Date.now()
  const harness = await createHarness([], {
    async beforeApply(context) {
      await fsp.mkdir(context.configDir, { recursive: true })
      const tasks = []
      for (let index = 1; index <= 25; index += 1) tasks.push(fixture(index, now))
      await fsp.writeFile(path.join(context.configDir, 'tasks.json'),
        JSON.stringify({ version: 1, tasks }))
    },
  })
  try {
    const dashboard = expectOk(await harness.request('GET', '/dashboard'))
    assert.equal(dashboard.recentTasks.length, 25)
    assert.equal(dashboard.recentTasks[0].id, 'TASK-20261026-025')
    assert.equal(dashboard.recentTasks[24].id, 'TASK-20261026-001')
    assert.equal(dashboard.totals.tasksThisWeek, 25)
    assert.deepEqual(dashboard.activeTasks, [])
  } finally {
    await harness.close()
  }
})
