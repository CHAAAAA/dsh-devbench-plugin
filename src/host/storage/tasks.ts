import type { TaskDto } from '../../shared/api-types.js'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { atomicWriteJson, withFileLock, withKeyLock } from '../shared/atomic.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import { isPlainObject, lstatMaybe } from '../shared/path-safety.js'
import { configDirectory } from './config.js'

export const TASK_KINDS = Object.freeze(['commit', 'review', 'requirement'])
export const TASK_STATUSES = Object.freeze([
  'queued',
  'running',
  'awaiting_confirmation',
  'succeeded',
  'failed',
  'cancelled',
])
export const ACTIVE_TASK_STATUSES = Object.freeze([
  'queued',
  'running',
  'awaiting_confirmation',
])
export const TERMINAL_TASK_STATUSES = Object.freeze(['succeeded', 'failed', 'cancelled'])
export type TaskRecord = Partial<TaskDto> & Pick<TaskDto, 'id' | 'kind' | 'status'> & { prompt?: string; diffText?: string }
const MAX_TASKS = 200
const TASK_STRING_FIELDS = [
  'workspaceId', 'projectPath', 'projectTitle', 'title', 'sessionId', 'prompt', 'diffText',
  'baseHead', 'fingerprint', 'proposedMessage', 'commitHash', 'commitShort', 'commitSubject',
  'reviewFile', 'worktreePath', 'worktreeBranch', 'requirementId', 'error', 'createdAt', 'updatedAt',
]

export function tasksFilePath(): string {
  return path.join(configDirectory(), 'tasks.json')
}

async function readTaskFile(): Promise<TaskRecord[]> {
  const file = tasksFilePath()
  const stat = await lstatMaybe(file)
  if (stat === null) return []
  if (stat.isSymbolicLink() || stat.isFile() === false) {
    throw apiError(500, 'tasks-corrupt', messages.tasksCorrupt)
  }
  let data
  try {
    data = JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    throw apiError(500, 'tasks-corrupt', messages.tasksCorrupt)
  }
  const tasks = Array.isArray(data) ? data : data && data.tasks
  if (Array.isArray(tasks) === false) {
    throw apiError(500, 'tasks-corrupt', messages.tasksCorrupt)
  }
  for (const task of tasks) {
    if (isPlainObject(task) === false || typeof task.id !== 'string') {
      throw apiError(500, 'tasks-corrupt', messages.tasksCorrupt)
    }
    if (TASK_KINDS.includes(task.kind) === false || TASK_STATUSES.includes(task.status) === false) {
      throw apiError(500, 'tasks-corrupt', messages.tasksCorrupt)
    }
    // Older task records may omit these fields or store null; DTO defaults handle both.
    const invalidString = TASK_STRING_FIELDS.some(function (field) {
      return task[field] !== undefined && task[field] !== null && typeof task[field] !== 'string'
    })
    const invalidFiles = task.changedFiles !== undefined && task.changedFiles !== null &&
      (!Array.isArray(task.changedFiles) || task.changedFiles.some(function (file) { return typeof file !== 'string' }))
    const invalidPushed = task.pushed !== undefined && task.pushed !== null && typeof task.pushed !== 'boolean'
    const invalidTarget = task.reviewTarget !== undefined && task.reviewTarget !== null &&
      task.reviewTarget !== 'commit' && task.reviewTarget !== 'uncommitted'
    if (invalidString || invalidFiles || invalidPushed || invalidTarget) {
      throw apiError(500, 'tasks-corrupt', messages.tasksCorrupt)
    }
  }
  return recentTasks(tasks)
}

function recentTasks(tasks: TaskRecord[]): TaskRecord[] {
  return tasks.slice().sort(function (left, right) {
    return String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
  }).slice(-MAX_TASKS)
}

async function writeTaskFile(tasks) {
  const trimmed = recentTasks(tasks)
  await atomicWriteJson(tasksFilePath(), { version: 1, tasks: trimmed })
  tasks.splice(0, tasks.length, ...trimmed)
  return trimmed
}

function withTaskLock(updater) {
  return withFileLock(tasksFilePath(), async function () {
    const tasks = await readTaskFile()
    const result = await updater(tasks)
    await writeTaskFile(tasks)
    return result
  })
}

export function readTasks(): Promise<TaskRecord[]> {
  return readTaskFile()
}

/**
 * Read tasks for user-facing project endpoints. Corrupt task storage is surfaced as
 * 503 tasks-unavailable so the project page can degrade instead of failing with a
 * generic 500; other callers keep the raw tasks-corrupt ApiError.
 */
export async function readTasksForApi(): Promise<TaskRecord[]> {
  try {
    return await readTaskFile()
  } catch (error) {
    if (error && error.code === 'tasks-corrupt') {
      throw apiError(503, 'tasks-unavailable', messages.tasksUnavailable)
    }
    throw error
  }
}

export function toTaskDto(task: TaskRecord): TaskDto {
  return {
    id: task.id,
    kind: task.kind,
    reviewTarget: task.reviewTarget === 'uncommitted' ? 'uncommitted' : 'commit',
    status: task.status,
    workspaceId: task.workspaceId || '',
    projectPath: task.projectPath || '',
    projectTitle: task.projectTitle || '',
    title: task.title || '',
    sessionId: task.sessionId || '',
    baseHead: task.baseHead || '',
    fingerprint: task.fingerprint || '',
    changedFiles: Array.isArray(task.changedFiles) ? task.changedFiles.slice() : [],
    proposedMessage: task.proposedMessage || '',
    commitHash: task.commitHash || '',
    commitShort: task.commitShort || '',
    commitSubject: task.commitSubject || '',
    reviewFile: task.reviewFile || '',
    worktreePath: task.worktreePath || '',
    worktreeBranch: task.worktreeBranch || '',
    requirementId: task.requirementId || '',
    pushed: task.pushed === true,
    error: task.error || '',
    createdAt: task.createdAt || '',
    updatedAt: task.updatedAt || '',
  }
}

export function listTaskDtos(tasks: TaskRecord[], workspaceId: string): TaskDto[] {
  return tasks.filter(function (task) {
    return task.workspaceId === workspaceId
  }).sort(function (left, right) {
    return String(right.createdAt).localeCompare(String(left.createdAt))
  }).map(toTaskDto)
}

function nextTaskId(tasks, datePart) {
  const pattern = new RegExp('^TASK-' + datePart + '-(\\d+)$')
  let sequence = 0
  for (const task of tasks) {
    const match = pattern.exec(task.id)
    if (match !== null) sequence = Math.max(sequence, Number(match[1]))
  }
  return 'TASK-' + datePart + '-' + String(sequence + 1).padStart(3, '0')
}

export function createTask(input: Partial<TaskRecord> & Pick<TaskDto, 'kind'>): Promise<TaskRecord> {
  if (TASK_KINDS.includes(input.kind) === false) {
    throw apiError(400, 'bad-task-kind', messages.projectTaskKindInvalid)
  }
  return withTaskLock(async function (tasks) {
    const now = new Date()
    const datePart = String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0')
    const task: TaskRecord = {
      id: nextTaskId(tasks, datePart),
      kind: input.kind,
      reviewTarget: input.reviewTarget === 'uncommitted' ? 'uncommitted' : 'commit',
      status: input.status || 'queued',
      workspaceId: input.workspaceId || '',
      projectPath: input.projectPath || '',
      projectTitle: input.projectTitle || '',
      title: input.title || '',
      sessionId: input.sessionId || '',
      prompt: input.prompt || '',
      diffText: input.diffText || '',
      baseHead: input.baseHead || '',
      fingerprint: input.fingerprint || '',
      changedFiles: Array.isArray(input.changedFiles) ? input.changedFiles.slice() : [],
      proposedMessage: input.proposedMessage || '',
      commitHash: input.commitHash || '',
      commitShort: input.commitShort || '',
      commitSubject: input.commitSubject || '',
      reviewFile: input.reviewFile || '',
      worktreePath: input.worktreePath || '',
      worktreeBranch: input.worktreeBranch || '',
      requirementId: input.requirementId || '',
      pushed: input.pushed === true,
      error: input.error || '',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
    tasks.push(task)
    return { ...task }
  })
}

export async function findTaskRecord(taskId: string, workspaceId?: string): Promise<TaskRecord | null> {
  const tasks = await readTaskFile()
  return tasks.find(function (task) {
    if (task.id !== taskId) return false
    if (typeof workspaceId === 'string' && workspaceId.length > 0) return task.workspaceId === workspaceId
    return true
  }) || null
}

export function updateTask(taskId, workspaceId, updater) {
  return withTaskLock(async function (tasks) {
    const index = tasks.findIndex(function (task) {
      if (task.id !== taskId) return false
      if (typeof workspaceId === 'string' && workspaceId.length > 0) return task.workspaceId === workspaceId
      return true
    })
    if (index < 0) throw apiError(404, 'task-not-found', messages.projectTaskNotFound)
    const patch = await updater(tasks[index], tasks)
    if (isPlainObject(patch)) tasks[index] = { ...tasks[index], ...patch }
    tasks[index].updatedAt = new Date().toISOString()
    return { ...tasks[index] }
  })
}

export function recoverInterruptedTasks(): Promise<number> {
  return withFileLock(tasksFilePath(), async function () {
    const tasks = await readTaskFile()
    let changed = 0
    const now = new Date().toISOString()
    for (const task of tasks) {
      if (task.status === 'queued' || task.status === 'running') {
        task.status = 'failed'
        task.error = messages.taskInterrupted
        task.updatedAt = now
        changed += 1
      }
    }
    if (changed > 0) await writeTaskFile(tasks)
    return changed
  })
}

export function updateTaskIf(taskId, allowedStatuses, updater) {
  return withFileLock(tasksFilePath(), async function () {
    const tasks = await readTaskFile()
    const index = tasks.findIndex(function (task) { return task.id === taskId })
    if (index < 0) return null
    if (allowedStatuses.includes(tasks[index].status) === false) return null
    const patch = await updater(tasks[index], tasks)
    if (isPlainObject(patch)) tasks[index] = { ...tasks[index], ...patch }
    tasks[index].updatedAt = new Date().toISOString()
    await writeTaskFile(tasks)
    return { ...tasks[index] }
  })
}

export function withProjectTaskLock(taskId, task) {
  return withKeyLock('project-task:' + taskId, task)
}
