/** Home dashboard data and deterministic local weekly reports. */
import path from 'node:path'
import { DEFAULT_WEEKLY_REPORT_DAYS } from '../constants.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import { buildState } from './state.js'
import { ACTIVE_TASK_STATUSES, readTasks, toTaskDto } from '../storage/tasks.js'
import {
  getWorkspaceEntry,
  readMapping,
  resolveWorkspaceFolder,
} from '../storage/workspaces.js'
import { assertGitRoot, runGit } from '../integrations/git.js'
import { workspaceProjectDto } from './projects.js'
import { mergeDerivedRequirementTasks } from './requirement-tasks.js'
import { scanRequirements } from '../domain/requirements.js'
import { listReviews } from '../domain/reviews.js'

const DAY_MS = 24 * 60 * 60 * 1000
const DASHBOARD_WINDOW_DAYS = 7
// Home renders each task list in client-side pages of 10. tasks.json retains at
// most 200 recorded tasks; derived requirement rows do not count toward that cap.
// Return the first 200 rows after merging and sorting by updatedAt desc so
// "load more" can reveal older rows without a second request.
const MAX_DASHBOARD_TASKS = 200
const MAX_WEEKLY_COMMITS = 100
const MAX_REPORT_DAYS = 90

function compareUpdatedAtDesc(left, right) {
  return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
}

function warn(ctx, label, error) {
  const detail = error && error.message ? error.message : String(error)
  ctx?.logger?.warn?.('devbench-manager: weekly report ' + label + ': ' + detail)
}

async function readTasksSafely(ctx) {
  try {
    return await readTasks()
  } catch (error) {
    const detail = error && error.message ? error.message : String(error)
    ctx?.logger?.warn?.('devbench-manager: unable to read dashboard tasks: ' + detail)
    return []
  }
}

function taskProjectTitle(task, workspaceById) {
  const recorded = typeof task.projectTitle === 'string' ? task.projectTitle : ''
  if (recorded.length > 0) return recorded
  const workspace = workspaceById.get(task.workspaceId || '')
  if (workspace !== undefined) {
    const title = typeof workspace.title === 'string' ? workspace.title : ''
    if (title.length > 0) return title
    const workspacePath = typeof workspace.path === 'string' ? workspace.path : ''
    if (workspacePath.length > 0) return path.basename(workspacePath)
  }
  const taskPath = typeof task.projectPath === 'string' ? task.projectPath : ''
  return taskPath.length > 0 ? path.basename(taskPath) : ''
}

function dashboardTask(task, workspaceById) {
  return Object.assign(toTaskDto(task), {
    projectTitle: taskProjectTitle(task, workspaceById),
  })
}

function workspaceTitle(workspace) {
  const title = typeof workspace.title === 'string' ? workspace.title : ''
  if (title.length > 0) return title
  const workspacePath = typeof workspace.path === 'string' ? workspace.path : ''
  return workspacePath.length > 0 ? path.basename(workspacePath) : ''
}

/** Build the workbench home payload: projects, recent tasks, and running requirements. */
export async function buildDashboard(ctx, config) {
  const generatedAt = new Date()
  const weekStart = new Date(generatedAt.getTime() - DASHBOARD_WINDOW_DAYS * DAY_MS)
  const weekStartIso = weekStart.toISOString()
  const state = await buildState(ctx, config)
  const workspaceById = new Map()
  const projects = []
  const runningRequirements = []
  let requirementsTotal = 0
  for (const workspace of state.workspaces) {
    workspaceById.set(workspace.workspaceId, workspace)
    const title = workspaceTitle(workspace)
    const requirements = Array.isArray(workspace.requirements) ? workspace.requirements : []
    const running = requirements.filter(function (item) { return item.status === 'running' })
    for (const item of running) {
      runningRequirements.push({
        workspaceId: workspace.workspaceId,
        projectTitle: title,
        id: item.id,
        title: item.title,
        updatedAt: item.updatedAt,
        folder: item.folder,
      })
    }
    const activeTaskCount = Number.isInteger(workspace.activeTaskCount) ? workspace.activeTaskCount : 0
    requirementsTotal += requirements.length
    projects.push({
      workspaceId: workspace.workspaceId,
      title,
      path: workspace.path,
      requirementsCount: requirements.length,
      activeTaskCount,
      runningRequirementsCount: running.length,
      missingPath: workspace.missingPath === true,
    })
  }
  runningRequirements.sort(compareUpdatedAtDesc)
  const recordedTasks = await readTasksSafely(ctx)
  const tasks = mergeDerivedRequirementTasks(ctx, state.workspaces, recordedTasks)
  const sortedTasks = tasks.slice().sort(compareUpdatedAtDesc)
  const activeTasks = sortedTasks.filter(function (task) {
    return ACTIVE_TASK_STATUSES.includes(task.status)
  })
  const tasksThisWeek = recordedTasks.filter(function (task) {
    const value = typeof task.updatedAt === 'string' && task.updatedAt.length > 0
      ? task.updatedAt
      : task.createdAt
    return typeof value === 'string' && value >= weekStartIso
  }).length
  return {
    generatedAt: generatedAt.toISOString(),
    week: { start: weekStartIso, end: generatedAt.toISOString() },
    totals: {
      projects: projects.length,
      requirements: requirementsTotal,
      activeTasks: activeTasks.length,
      tasksThisWeek,
      runningRequirements: runningRequirements.length,
    },
    projects,
    recentTasks: sortedTasks.slice(0, MAX_DASHBOARD_TASKS).map(function (task) {
      return dashboardTask(task, workspaceById)
    }),
    activeTasks: activeTasks.map(function (task) {
      return dashboardTask(task, workspaceById)
    }),
    runningRequirements,
  }
}

function reportDays(value) {
  if (value === undefined) return DEFAULT_WEEKLY_REPORT_DAYS
  if (typeof value !== 'number' || Number.isInteger(value) === false) {
    throw apiError(400, 'bad-weekly-days', messages.weeklyReportDaysInvalid)
  }
  if (value < 1 || value > MAX_REPORT_DAYS) {
    throw apiError(400, 'bad-weekly-days', messages.weeklyReportDaysInvalid)
  }
  return value
}

function localDateText(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return String(date.getFullYear()) + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0')
}

function localDateTimeText(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return localDateText(date) + ' ' +
    String(date.getHours()).padStart(2, '0') + ':' +
    String(date.getMinutes()).padStart(2, '0')
}

function shortHash(value) {
  const text = String(value || '')
  return text.length > 7 ? text.slice(0, 7) : text
}

async function projectCommits(root, startIso) {
  try {
    await assertGitRoot(root)
  } catch {
    return []
  }
  const format = '%H%x1f%h%x1f%s%x1f%aI'
  const result = await runGit(root, [
    'log',
    '--since=' + startIso,
    '--date=iso',
    '--pretty=format:' + format,
    '-n',
    String(MAX_WEEKLY_COMMITS),
  ])
  if (result.code !== 0) return []
  return result.stdout.split('\n').filter(function (line) {
    return line.length > 0
  }).map(function (line) {
    const values = line.split('\x1f')
    return {
      hash: values[0] || '',
      short: values[1] || '',
      subject: values[2] || '',
      date: values[3] || '',
    }
  })
}

async function projectReviews(root, startIso, ctx) {
  try {
    const reviews = await listReviews(root)
    return reviews.filter(function (review) {
      return typeof review.modifiedAt === 'string' && review.modifiedAt >= startIso
    }).map(function (review) {
      return {
        name: review.name,
        commit: review.commit || '',
        commitSubject: review.commitSubject || '',
        modifiedAt: review.modifiedAt,
      }
    })
  } catch (error) {
    warn(ctx, 'reviews', error)
    return []
  }
}

function tallyProjectTasks(tasks, workspaceId, startIso) {
  const tally = { succeeded: 0, failed: 0, cancelled: 0, active: 0, total: 0 }
  for (const task of tasks) {
    if (task.workspaceId !== workspaceId) continue
    if (typeof task.createdAt !== 'string' || task.createdAt < startIso) continue
    tally.total += 1
    if (task.status === 'succeeded') tally.succeeded += 1
    else if (task.status === 'failed') tally.failed += 1
    else if (task.status === 'cancelled') tally.cancelled += 1
    else if (ACTIVE_TASK_STATUSES.includes(task.status)) tally.active += 1
  }
  return tally
}

async function projectRequirementActivity(config, mapping, workspaceId, startIso, ctx) {
  const empty = { created: [], updated: [], running: [] }
  const rootDir = typeof config.rootDir === 'string' ? config.rootDir : ''
  if (rootDir.length === 0 || mapping === null) return empty
  try {
    const entry = getWorkspaceEntry(mapping, workspaceId)
    if (entry === null) return empty
    const folder = await resolveWorkspaceFolder(rootDir, entry.folder, { mustExist: false })
    const requirements = await scanRequirements(folder, workspaceId)
    const created = []
    const updated = []
    const running = []
    for (const requirement of requirements) {
      if (typeof requirement.createdAt === 'string' && requirement.createdAt >= startIso) {
        created.push(requirement)
      }
      if (typeof requirement.updatedAt === 'string' && requirement.updatedAt >= startIso) {
        updated.push(requirement)
      }
      if (requirement.status === 'running') running.push(requirement)
    }
    return { created, updated, running }
  } catch (error) {
    warn(ctx, 'requirements', error)
    return empty
  }
}

function requirementLine(prefix, requirement) {
  return '  - ' + prefix + ' ' + requirement.id + ' ' + requirement.title
}

function renderProjectSection(detail) {
  const groups = []
  if (detail.commits.length > 0) {
    const group = ['- 提交：']
    for (const commit of detail.commits) {
      if (commit.short.length > 0) group.push('  - `' + commit.short + '` ' + commit.subject)
      else group.push('  - ' + commit.subject)
    }
    groups.push(group)
  }
  if (detail.reviews.length > 0) {
    const group = ['- 评审：']
    for (const review of detail.reviews) {
      const commit = shortHash(review.commit)
      group.push('  - ' + review.name + (commit.length > 0 ? '（提交 ' + commit + '）' : ''))
    }
    groups.push(group)
  }
  const tasks = detail.tasks
  if (tasks.total > 0) {
    groups.push(['- 任务：成功 ' + tasks.succeeded + ' 个、失败 ' + tasks.failed +
      ' 个、取消 ' + tasks.cancelled + ' 个、进行中 ' + tasks.active + ' 个'])
  }
  const created = detail.requirementCreated
  const updated = detail.requirementUpdated
  const running = detail.requirementRunning
  if (created.length > 0 || updated.length > 0 || running.length > 0) {
    const group = ['- 需求：']
    const createdIds = new Set(created.map(function (item) { return item.id }))
    const updatedIds = new Set()
    for (const item of updated) {
      updatedIds.add(item.id)
      if (createdIds.has(item.id)) continue
      group.push(requirementLine('[更新]', item))
    }
    for (const item of created) group.push(requirementLine('[新建]', item))
    for (const item of running) {
      if (createdIds.has(item.id) || updatedIds.has(item.id)) continue
      group.push(requirementLine('[执行中]', item))
    }
    groups.push(group)
  }
  const lines = ['### ' + detail.title]
  if (groups.length === 0) return lines
  lines.push('')
  for (const group of groups) lines.push(...group)
  return lines
}

function renderWeeklyMarkdown(input) {
  const counts = input.counts
  const succeeded = input.details.reduce(function (total, detail) {
    return total + detail.tasks.succeeded
  }, 0)
  const failed = input.details.reduce(function (total, detail) {
    return total + detail.tasks.failed
  }, 0)
  const lines = [
    '# ' + messages.weeklyReportTitle + '（' + localDateText(input.start) +
      ' ~ ' + localDateText(input.end) + '）',
    '',
    '- 生成时间：' + localDateTimeText(input.generatedAt),
    '- 统计范围：最近 ' + input.days + ' 天',
    '',
    '## 总览',
    '',
    '- 项目：' + counts.projects + ' 个',
    '- 提交：' + counts.commits + ' 个',
    '- 评审：' + counts.reviews + ' 份',
    '- 任务：' + counts.tasks + ' 个（成功 ' + succeeded + ' 个、失败 ' + failed + ' 个）',
    '- 需求：新建 ' + counts.requirementsCreated + ' 个、更新 ' +
      counts.requirementsUpdated + ' 个、执行中 ' + counts.runningRequirements + ' 个',
  ]
  if (input.skippedProjects.length > 0) {
    lines.push('- 跳过项目（路径不存在）：' + input.skippedProjects.length + ' 个')
  }
  const active = input.details.filter(function (detail) { return detail.active })
  if (active.length === 0) {
    lines.push('', messages.weeklyReportEmpty)
    return lines.join('\n') + '\n'
  }
  lines.push('', '## 项目详情')
  for (const detail of active) {
    lines.push('')
    lines.push(...renderProjectSection(detail))
  }
  return lines.join('\n') + '\n'
}

/** Build a deterministic Chinese Markdown weekly report from local repository data. */
export async function buildWeeklyReport(ctx, config, options = {}) {
  const days = reportDays(options.days)
  const generatedAt = new Date()
  const start = new Date(generatedAt.getTime() - days * DAY_MS)
  const startIso = start.toISOString()
  const endIso = generatedAt.toISOString()
  const registry = ctx.workspaceRegistry
  const workspaces = registry && typeof registry.list === 'function' ? registry.list() : []
  const tasks = await readTasksSafely(ctx)
  const rootDir = typeof config.rootDir === 'string' ? config.rootDir : ''
  const mapping = rootDir.length > 0 ? await readMapping(rootDir) : null
  const details = []
  const projects = []
  const skippedProjects = []
  const counts = {
    projects: 0,
    commits: 0,
    reviews: 0,
    tasks: 0,
    requirementsCreated: 0,
    requirementsUpdated: 0,
    runningRequirements: 0,
  }
  for (const workspace of workspaces) {
    const project = await workspaceProjectDto(workspace)
    if (project.missingPath) {
      skippedProjects.push({
        workspaceId: project.workspaceId,
        title: project.title,
        path: project.path,
        reason: 'missing-path',
      })
      continue
    }
    const commits = await projectCommits(project.canonicalPath, startIso)
    const reviews = await projectReviews(project.canonicalPath, startIso, ctx)
    const taskTally = tallyProjectTasks(tasks, workspace.id, startIso)
    const requirementActivity = await projectRequirementActivity(
      config, mapping, workspace.id, startIso, ctx,
    )
    counts.projects += 1
    counts.commits += commits.length
    counts.reviews += reviews.length
    counts.tasks += taskTally.total
    counts.requirementsCreated += requirementActivity.created.length
    counts.requirementsUpdated += requirementActivity.updated.length
    counts.runningRequirements += requirementActivity.running.length
    projects.push({
      workspaceId: project.workspaceId,
      title: project.title,
      commits,
      reviews,
      tasks: taskTally,
      requirements: {
        created: requirementActivity.created.length,
        updated: requirementActivity.updated.length,
        running: requirementActivity.running.map(function (item) {
          return { id: item.id, title: item.title, status: item.status }
        }),
      },
    })
    details.push({
      title: project.title,
      active: commits.length > 0 || reviews.length > 0 || taskTally.total > 0 ||
        requirementActivity.created.length > 0 || requirementActivity.updated.length > 0 ||
        requirementActivity.running.length > 0,
      commits,
      reviews,
      tasks: taskTally,
      requirementCreated: requirementActivity.created,
      requirementUpdated: requirementActivity.updated,
      requirementRunning: requirementActivity.running,
    })
  }
  const markdown = renderWeeklyMarkdown({
    generatedAt,
    days,
    start,
    end: generatedAt,
    counts,
    details,
    skippedProjects,
  })
  return {
    generatedAt: endIso,
    days,
    week: { start: startIso, end: endIso },
    markdown,
    counts,
    projects,
    skippedProjects,
  }
}
