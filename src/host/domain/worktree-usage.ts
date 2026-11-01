/**
 * Worktree usage guard: refuses to remove a worktree while an active task or a
 * running requirement session still depends on it. Shared by the per-requirement
 * worktree route and the project worktree route.
 */
import path from 'node:path'
import { ACTIVE_TASK_STATUSES } from '../storage/tasks.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'

function normalized(value) {
  return path.resolve(String(value || ''))
}

function activeAgentRunning(ctx, sessionId) {
  if (!ctx || typeof ctx.get !== 'function') return false
  const agents = ctx.get('agents')
  if (!agents || typeof agents.get !== 'function') return false
  const agent = agents.get(sessionId)
  return Boolean(agent && agent.status === 'running')
}

/** First active task that depends on the given requirement / worktree. */
export function findBlockingWorktreeTask(tasks, options) {
  const workspaceId = String(options.workspaceId || '')
  const requirementId = String(options.requirementId || '')
  const worktreePath = typeof options.worktreePath === 'string' && options.worktreePath.length > 0
    ? normalized(options.worktreePath)
    : ''
  const items = Array.isArray(tasks) ? tasks : []
  return items.find(function (task) {
    if (task === null || typeof task !== 'object') return false
    if (task.workspaceId !== workspaceId) return false
    if (ACTIVE_TASK_STATUSES.includes(task.status) === false) return false
    if (task.kind === 'requirement') {
      return requirementId.length > 0 && task.requirementId === requirementId
    }
    if (task.kind === 'commit') {
      if (requirementId.length > 0 && task.requirementId === requirementId) return true
      if (worktreePath.length > 0 && typeof task.worktreePath === 'string' &&
          task.worktreePath.length > 0 && normalized(task.worktreePath) === worktreePath) {
        return true
      }
    }
    return false
  }) || null
}

/** True when one of the sessions is backed by a live agent that is still running. */
export function hasRunningRequirementSession(ctx, sessionIds) {
  const items = Array.isArray(sessionIds) ? sessionIds : []
  for (const sessionId of items) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) continue
    if (activeAgentRunning(ctx, sessionId)) return true
  }
  return false
}

/**
 * Throw 409 worktree-in-use when an active task or running requirement session
 * still uses the worktree.
 */
export function assertWorktreeNotInUse(options) {
  const blocking = findBlockingWorktreeTask(options.tasks, options)
  if (blocking !== null) {
    throw apiError(409, 'worktree-in-use', messages.worktreeInUse)
  }
  if (hasRunningRequirementSession(options.ctx, options.sessionIds)) {
    throw apiError(409, 'worktree-in-use', messages.worktreeInUse)
  }
}
