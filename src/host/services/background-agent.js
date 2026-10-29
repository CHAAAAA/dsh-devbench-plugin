import { randomUUID } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { findPluginWorktree } from '../domain/worktrees.js'
import { ApiError, apiError, errorMessage } from '../errors.js'
import { messages } from '../messages/index.js'
import { getRegisteredWorkspace } from './projects.js'
import { readConfig } from '../storage/config.js'
import { findTaskRecord, updateTaskIf } from '../storage/tasks.js'
import { linkSessionToCommitRequirements } from '../domain/requirements.js'

const handles = new Map()
const runs = new Map()
const MUTATION_TOOLS = new Set([
  'bash',
  'pwsh',
  'shell',
  'exec',
  'write',
  'edit',
  'str_replace_editor',
  'apply_patch',
  'file_write',
  'multi_edit',
  'multiedit',
  'notebook_edit',
])

function missingService(name) {
  const prefix = messages.agentServiceUnavailable || 'agent service unavailable'
  return apiError(500, 'agent-service-unavailable', prefix + ': ' + name)
}

function requireService(ctx, name) {
  if (typeof ctx.get !== 'function') throw missingService(name)
  const service = ctx.get(name)
  if (service === undefined || service === null) throw missingService(name)
  return service
}

function optionalService(ctx, name) {
  if (typeof ctx.get !== 'function') return null
  return ctx.get(name) || null
}

function identifier(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return value.id || value.name || ''
  return ''
}

async function resolveAgentOptions(ctx) {
  const defaultModel = requireService(ctx, 'agentDefaultModel')
  if (typeof defaultModel.currentSelection !== 'function') throw missingService('agentDefaultModel')
  const raw = await defaultModel.currentSelection()
  const selection = raw && raw.selection ? raw.selection : raw
  if (selection === null || selection === undefined) throw missingService('agentDefaultModel')
  const provider = identifier(selection.provider) || identifier(selection.providerId)
  const model = identifier(selection.model) || identifier(selection.modelId)
  if (provider.length === 0 || model.length === 0) throw missingService('agentDefaultModel')
  const options = { provider, model }
  if (selection.reasoningEffort !== undefined && selection.reasoningEffort !== null) {
    options.reasoningEffort = selection.reasoningEffort
  }
  return options
}

async function resolvePresetId(presets) {
  if (presets === null || typeof presets.resolve !== 'function') return ''
  const resolved = await presets.resolve(undefined)
  return identifier(resolved)
}

function toolNames(schemas) {
  let values = []
  if (Array.isArray(schemas)) values = schemas
  else if (schemas && Array.isArray(schemas.tools)) values = schemas.tools
  else if (schemas && Array.isArray(schemas.schemas)) values = schemas.schemas
  else if (schemas && schemas.tools && typeof schemas.tools === 'object') values = Object.keys(schemas.tools)
  else if (schemas && typeof schemas === 'object') values = Object.keys(schemas)
  return values.map(function (value) {
    return typeof value === 'string' ? value : (value && value.name) || ''
  }).filter(Boolean)
}

async function restrictMutationTools(agentCtx, agent) {
  if (agentCtx === null || agentCtx === undefined) return
  if (agentCtx.tools === null || agentCtx.tools === undefined) return
  if (typeof agentCtx.tools.schemas !== 'function') return
  const schemas = await agentCtx.tools.schemas(agent)
  const names = toolNames(schemas)
  const denied = names.filter(function (name) { return MUTATION_TOOLS.has(name) })
  if (denied.length > 0 && typeof agentCtx.tools.restrict === 'function') {
    await agentCtx.tools.restrict({ deny: denied })
  }
}

/**
 * Build the complete user-role message DSH expects from `Agent.followup()`.
 * Passing only `{ content, source }` persists a `user/message` event without an
 * identity; the stored-log validator then rejects the whole session on the next
 * load ("session event at seq N lacks an identified message"). Keep the full
 * UserMessage here: id, role, source, and content.
 */
function followupMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: text }],
    source: { kind: 'user' },
  }
}

export {
  buildCommitPrompt,
  buildReviewPrompt,
  buildUncommittedReviewPrompt,
} from '../prompts/project.js'

/**
 * Resolve the project path a task runs in and whether its session may be
 * attached to the registered workspace.
 *
 * DSH `workspace.attachSession()` validates that the session header cwd equals
 * the workspace path exactly. A worktree commit task runs in a directory
 * outside the project (its cwd is the plugin worktree), so attaching would be
 * rejected and fail the whole task. Such sessions stay unattached and DSH lists
 * them under its "Ungrouped" group; the task panel/home still opens them by id.
 * Tasks on the project root itself keep the attachment so their conversation
 * shows under the workspace.
 */
async function resolveTaskProject(ctx, task) {
  const workspace = getRegisteredWorkspace(ctx, task.workspaceId)
  const real = await fsp.realpath(workspace.path)
  if (real === task.projectPath) return { projectPath: real, attach: true }
  const config = await readConfig()
  const found = await findPluginWorktree(config, workspace, task.projectPath)
  if (found === null) {
    throw apiError(409, 'task-project-mismatch', messages.projectPathMismatch)
  }
  return { projectPath: found.path, attach: false }
}

async function attachTaskSession(ctx, workspaceId, sessionId) {
  const workspace = getRegisteredWorkspace(ctx, workspaceId)
  if (typeof workspace.attachSession === 'function') {
    await workspace.attachSession(sessionId)
    return
  }
  const sessionController = optionalService(ctx, 'sessionController')
  if (sessionController !== null && typeof sessionController.create === 'function') {
    await sessionController.create({ workspaceId, sessionId })
    return
  }
  throw apiError(500, 'workspace-session-unavailable', messages.workspaceSessionUnavailable)
}

async function failTask(taskId, error) {
  const prefix = messages.agentTaskFailed || 'operation failed: '
  const message = error instanceof ApiError ? error.message : prefix + errorMessage(error)
  await updateTaskIf(taskId, ['queued', 'running'], function () {
    return { status: 'failed', error: message }
  })
}

async function runTask(ctx, taskId) {
  let handle = null
  try {
    const initial = await findTaskRecord(taskId)
    if (initial === null || initial.status !== 'queued') return
    const target = await resolveTaskProject(ctx, initial)
    const agents = requireService(ctx, 'agents')
    if (typeof agents.create !== 'function') throw missingService('agents')
    const agentOptions = await resolveAgentOptions(ctx)
    const presets = optionalService(ctx, 'agentPresets')
    const presetId = await resolvePresetId(presets)
    const sessionId = 'session-' + randomUUID()
    const claimed = await updateTaskIf(taskId, ['queued'], function () {
      return { status: 'running', sessionId, error: '' }
    })
    if (claimed === null) return
    const meta = { cwd: target.projectPath }
    if (presetId.length > 0) meta.agentPreset = presetId
    const setup = async function (agentCtx, agent) {
      if (presets !== null && typeof presets.mount === 'function') {
        await presets.mount(agentCtx, presetId.length > 0 ? presetId : undefined)
      }
      await restrictMutationTools(agentCtx, agent)
    }
    handle = await agents.create({ sessionId, agentOptions, meta, setup })
    handles.set(taskId, handle)
    if (target.attach) {
      await attachTaskSession(ctx, initial.workspaceId, sessionId)
    } else {
      ctx.logger?.debug?.('devbench-manager: worktree task ' + taskId +
        ' runs outside the workspace; its session stays unattached')
    }
    if (claimed.kind === 'review' &&
        typeof claimed.commitHash === 'string' && claimed.commitHash.length > 0) {
      // Reviewing a commit that a requirement references also links the review
      // conversation to that requirement. Failures must not abort the review.
      try {
        const config = await readConfig()
        if (typeof config.rootDir === 'string' && config.rootDir.length > 0) {
          await linkSessionToCommitRequirements(
            config.rootDir, claimed.workspaceId, claimed.commitHash, sessionId)
        }
      } catch (error) {
        ctx.logger?.warn?.('devbench-manager: unable to link review session to requirements: ' +
          errorMessage(error))
      }
    }
    const afterCreate = await findTaskRecord(taskId)
    if (afterCreate === null || afterCreate.status !== 'running') {
      if (handle.agent && typeof handle.agent.cancel === 'function') {
        try {
          await handle.agent.cancel({ kind: 'user' })
        } catch {
          // Ignore cancellation failures while disposing.
        }
      }
      return
    }
    if (handle.agent === null || handle.agent === undefined) throw missingService('agents')
    if (typeof handle.agent.followup !== 'function' ||
        typeof handle.agent.whenIdle !== 'function') {
      throw missingService('agents')
    }
    await handle.agent.followup(followupMessage(claimed.prompt))
    await handle.agent.whenIdle()
    const idleError = claimed.kind === 'commit'
      ? messages.commitTaskIdle
      : messages.reviewTaskIdle
    await updateTaskIf(taskId, ['running'], function () {
      return { status: 'failed', error: idleError }
    })
  } catch (error) {
    await failTask(taskId, error).catch(function () {})
  } finally {
    handles.delete(taskId)
    if (handle !== null && typeof handle.dispose === 'function') {
      try {
        await handle.dispose()
      } catch {
        // Ignore dispose failures.
      }
    }
  }
}

export function startBackgroundTask(ctx, taskId) {
  function schedule(run) {
    let promise
    promise = run.finally(function () {
      if (runs.get(taskId) === promise) runs.delete(taskId)
    })
    runs.set(taskId, promise)
    return promise
  }
  const existing = runs.get(taskId)
  if (existing !== undefined) {
    const next = existing.catch(function () {}).then(function () {
      return runTask(ctx, taskId)
    })
    return schedule(next)
  }
  return schedule(runTask(ctx, taskId))
}

export function waitForBackgroundTask(taskId) {
  return runs.get(taskId) || Promise.resolve()
}

export async function cancelBackgroundTask(taskId) {
  const handle = handles.get(taskId)
  if (handle === null || handle === undefined) return
  if (handle.agent && typeof handle.agent.cancel === 'function') {
    try {
      await handle.agent.cancel({ kind: 'user' })
    } catch {
      // The route still marks the task cancelled.
    }
  }
}
