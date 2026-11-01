/**
 * Requirement execution tasks.
 *
 * A requirement session is created by the client, so the host cannot drive it
 * like a background commit/review task. Instead the client reports the session
 * once its first prompt is accepted; the host stores a `requirement` task and
 * watches the live agent until the conversation quiesces.
 *
 * Requirements executed before this feature only carry session ids in their
 * frontmatter. Those sessions are exposed as read-time derived task records so
 * the task list is complete without rewriting any historical data.
 */
import { withKeyLock } from '../shared/atomic.js'
import { errorMessage } from '../errors.js'
import { messages } from '../messages/index.js'
import { describeRequirementWorktree } from '../domain/worktrees.js'
import { scanRequirements } from '../domain/requirements.js'
import {
  createTask,
  readTasks,
  toTaskDto,
  updateTaskIf,
} from '../storage/tasks.js'
import {
  getWorkspaceEntry,
  readMapping,
  resolveWorkspaceFolder,
} from '../storage/workspaces.js'

/** Synthetic ids keep derived rows unique without colliding with `TASK-` records. */
export const DERIVED_TASK_ID_PREFIX = 'REQ-SESSION:'
const AGENT_WAIT_ATTEMPTS = 40
const AGENT_WAIT_INTERVAL_MS = 250
const watchers = new Map()

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

function optionalService(ctx, name) {
  if (typeof ctx.get !== 'function') return null
  return ctx.get(name) || null
}

function liveAgent(ctx, sessionId) {
  const agents = optionalService(ctx, 'agents')
  if (agents === null || typeof agents.get !== 'function') return null
  return agents.get(sessionId) || null
}

function agentIsRunning(ctx, sessionId) {
  const agent = liveAgent(ctx, sessionId)
  return Boolean(agent && agent.status === 'running')
}

function recordedSessionTask(tasks, sessionId) {
  return tasks.find(function (task) {
    return task.kind === 'requirement' && task.sessionId === sessionId
  }) || null
}

/** Scan the requirement folder mapped to one workspace. */
export async function listWorkspaceRequirementSummaries(config, workspaceId) {
  const root = config && typeof config.rootDir === 'string' ? config.rootDir : ''
  if (root.length === 0) return []
  const mapping = await readMapping(root)
  const entry = getWorkspaceEntry(mapping, workspaceId)
  if (entry === null) return []
  const folder = await resolveWorkspaceFolder(root, entry.folder, { mustExist: false })
  return scanRequirements(folder, workspaceId)
}

/** Project path recorded on a requirement task: its worktree when one exists. */
async function requirementTaskProjectPath(config, workspace, requirement) {
  const workspacePath = typeof workspace.path === 'string' ? workspace.path : ''
  const worktree = await describeRequirementWorktree(config, workspace, requirement)
    .catch(function () { return null })
  if (worktree !== null && worktree.exists === true &&
      typeof worktree.path === 'string' && worktree.path.length > 0) {
    return worktree.path
  }
  return workspacePath
}

/**
 * Record one requirement execution session as a running `requirement` task.
 * Idempotent per session id: the same session never yields two task records.
 *
 * @param ctx - plugin context owning the live agent registry.
 * @param config - plugin config carrying the requirement root.
 * @param workspace - registered DSH workspace owning the requirement.
 * @param requirement - `findRequirementInWorkspace()` result to record.
 * @param sessionId - DSH session created by the requirement execute flow.
 * @returns the task DTO.
 */
export function recordRequirementTask(ctx, config, workspace, requirement, sessionId) {
  // Serialize the check-then-create per session: two concurrent reports of the
  // same session must produce exactly one task record.
  return withKeyLock('requirement-task:' + sessionId, async function () {
    const tasks = await readTasks()
    const recorded = recordedSessionTask(tasks, sessionId)
    if (recorded !== null) return toTaskDto(recorded)
    const projectPath = await requirementTaskProjectPath(config, workspace, requirement)
    const task = await createTask({
      kind: 'requirement',
      status: 'running',
      workspaceId: workspace.id,
      projectPath: projectPath,
      projectTitle: workspace.title || '',
      title: requirement.meta.title || '',
      requirementId: requirement.meta.id || '',
      sessionId: sessionId,
    })
    startRequirementTaskWatch(ctx, task.id, sessionId)
    return toTaskDto(task)
  })
}

async function waitForAgent(ctx, sessionId) {
  for (let attempt = 0; attempt < AGENT_WAIT_ATTEMPTS; attempt += 1) {
    const agent = liveAgent(ctx, sessionId)
    if (agent !== null) return agent
    if (attempt < AGENT_WAIT_ATTEMPTS - 1) await delay(AGENT_WAIT_INTERVAL_MS)
  }
  return null
}

async function runRequirementTaskWatch(ctx, taskId, sessionId) {
  try {
    const agent = await waitForAgent(ctx, sessionId)
    if (agent === null) {
      await updateTaskIf(taskId, ['running'], function () {
        return { status: 'failed', error: messages.requirementTaskAgentMissing }
      })
      return
    }
    if (typeof agent.whenIdle !== 'function') {
      throw new Error(messages.agentServiceUnavailable)
    }
    await agent.whenIdle()
    await updateTaskIf(taskId, ['running'], function () {
      return { status: 'succeeded', error: '' }
    })
  } catch (error) {
    await updateTaskIf(taskId, ['running'], function () {
      return { status: 'failed', error: messages.requirementTaskFailed + errorMessage(error) }
    }).catch(function () {})
  }
}

function scheduleWatcher(taskId, promise) {
  let tracked
  tracked = promise.finally(function () {
    if (watchers.get(taskId) === tracked) watchers.delete(taskId)
  })
  watchers.set(taskId, tracked)
  return tracked
}

/** Start (or join) the completion watcher for one requirement task. */
export function startRequirementTaskWatch(ctx, taskId, sessionId) {
  const existing = watchers.get(taskId)
  if (existing !== undefined) {
    return scheduleWatcher(taskId, existing.catch(function () {}).then(function () {
      return runRequirementTaskWatch(ctx, taskId, sessionId)
    }))
  }
  return scheduleWatcher(taskId, runRequirementTaskWatch(ctx, taskId, sessionId))
}

/** Test hook: wait until the watcher for one task settles. */
export function waitForRequirementTask(taskId) {
  return watchers.get(taskId) || Promise.resolve()
}

/**
 * Read-time task records for requirement-linked sessions that have no recorded
 * requirement task yet (requirements executed before this feature shipped).
 * Status reflects whether the session's live agent is currently running.
 *
 * @param ctx - plugin context owning the live agent registry.
 * @param workspace - `{ workspaceId, title, path }` of the owning project.
 * @param requirements - requirement summaries carrying `sessions`.
 * @param recordedTasks - persisted task records used for de-duplication.
 * @returns task records shaped like `tasks.json` entries.
 */
export function deriveRequirementTaskRecords(ctx, workspace, requirements, recordedTasks) {
  const records = []
  const seen = new Set()
  const items = Array.isArray(requirements) ? requirements : []
  for (const requirement of items) {
    const sessionIds = Array.isArray(requirement.sessions) ? requirement.sessions : []
    for (const sessionId of sessionIds) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) continue
      if (seen.has(sessionId)) continue
      if (recordedSessionTask(recordedTasks, sessionId) !== null) continue
      seen.add(sessionId)
      const updatedAt = requirement.updatedAt || requirement.createdAt || ''
      records.push({
        id: DERIVED_TASK_ID_PREFIX + sessionId,
        kind: 'requirement',
        status: agentIsRunning(ctx, sessionId) ? 'running' : 'succeeded',
        workspaceId: workspace.workspaceId,
        projectPath: typeof workspace.path === 'string' ? workspace.path : '',
        projectTitle: workspace.title || '',
        title: requirement.title || '',
        requirementId: requirement.id || '',
        sessionId: sessionId,
        derived: true,
        createdAt: updatedAt,
        updatedAt: updatedAt,
      })
    }
  }
  return records
}

/** Merge derived requirement-session rows for the dashboard's workspace list. */
export function mergeDerivedRequirementTasks(ctx, workspaces, recordedTasks) {
  const merged = recordedTasks.slice()
  const seenSessions = new Set(merged.map(function (task) { return task.sessionId }).filter(Boolean))
  const items = Array.isArray(workspaces) ? workspaces : []
  for (const workspace of items) {
    const requirements = Array.isArray(workspace.requirements) ? workspace.requirements : []
    if (requirements.length === 0) continue
    const derived = deriveRequirementTaskRecords(ctx, workspace, requirements, recordedTasks)
    for (const record of derived) {
      if (seenSessions.has(record.sessionId)) continue
      seenSessions.add(record.sessionId)
      merged.push(record)
    }
  }
  return merged
}
