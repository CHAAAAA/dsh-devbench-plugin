import { promises as fsp } from 'node:fs'
import { apiError, errorMessage } from '../errors.js'
import { messages } from '../messages/index.js'
import { validateCommitMessage } from '../services/project-service.js'
import { writeReview } from '../domain/reviews.js'
import { findPluginWorktree } from '../domain/worktrees.js'
import { showProjectCommitDiff, showWorktreeDiff } from '../integrations/git.js'
import { getRegisteredWorkspace } from '../services/projects.js'
import { readConfig } from '../storage/config.js'
import {
  findTaskRecord,
  updateTaskIf,
  withProjectTaskLock,
} from '../storage/tasks.js'

const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
    content: { type: 'string' },
  },
  additionalProperties: false,
}

function renderToolValue(args, value) {
  const text = value && typeof value.content === 'string' && value.content.length > 0
    ? value.content
    : (value && typeof value.message === 'string' ? value.message : JSON.stringify(value))
  return [{ type: 'text', text }]
}

function executeTool(ctx, name, task) {
  return async function (args, exec) {
    try {
      return await task(args || {}, exec || {})
    } catch (error) {
      const message = error && typeof error.message === 'string'
        ? error.message
        : (messages.toolErrorPrefix || 'tool failed: ') + errorMessage(error)
      ctx.logger?.warn?.('devbench-manager tool ' + name + ': ' + errorMessage(error))
      return { ok: false, message }
    }
  }
}

function taskSession(exec) {
  return exec && exec.agent && exec.agent.session ? exec.agent.session.id || '' : ''
}

async function validateTaskProject(ctx, task) {
  const workspace = getRegisteredWorkspace(ctx, task.workspaceId)
  const real = await fsp.realpath(workspace.path)
  if (real === task.projectPath) return
  const config = await readConfig()
  const found = await findPluginWorktree(config, workspace, task.projectPath)
  if (found === null) {
    throw apiError(409, 'task-project-mismatch', messages.projectPathMismatch)
  }
}

async function requireRunningTask(ctx, taskId, kind, exec) {
  if (typeof taskId !== 'string' || taskId.length === 0) {
    throw apiError(400, 'bad-field', messages.invalidField + ': task_id')
  }
  const task = await findTaskRecord(taskId)
  if (task === null) throw apiError(404, 'task-not-found', messages.projectTaskNotFound)
  if (task.kind !== kind) throw apiError(409, 'task-kind-mismatch', messages.projectTaskKindMismatch)
  if (task.status !== 'running') {
    throw apiError(409, 'invalid-task-state', messages.projectTaskInvalidState)
  }
  if (taskSession(exec) !== task.sessionId) {
    throw apiError(403, 'task-session-mismatch', messages.projectTaskSessionMismatch)
  }
  await validateTaskProject(ctx, task)
  return task
}

export function registerProjectTools(ctx) {
  const disposers = []

  disposers.push(ctx.tools.register({
    name: 'project_commit_propose',
    description: messages.projectCommitToolDescription,
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: messages.projectTaskIdDescription },
        message: { type: 'string', description: messages.projectCommitMessageDescription },
      },
      required: ['task_id', 'message'],
      additionalProperties: false,
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolValue },
    execute: executeTool(ctx, 'project_commit_propose', async function (args, exec) {
      const taskId = typeof args.task_id === 'string' ? args.task_id : ''
      return withProjectTaskLock(taskId, async function () {
        const message = validateCommitMessage(args.message)
        await requireRunningTask(ctx, taskId, 'commit', exec)
        const updated = await updateTaskIf(taskId, ['running'], function () {
          return { status: 'awaiting_confirmation', proposedMessage: message, error: '' }
        })
        if (updated === null) {
          throw apiError(409, 'invalid-task-state', messages.projectTaskInvalidState)
        }
        return { ok: true, message: messages.commitProposalSaved }
      })
    }),
  }))

  disposers.push(ctx.tools.register({
    name: 'project_review_write',
    description: messages.projectReviewToolDescription,
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: messages.projectTaskIdDescription },
        summary: { type: 'string', description: messages.projectReviewSummaryDescription },
        content: { type: 'string', description: messages.projectReviewContentDescription },
      },
      required: ['task_id', 'summary', 'content'],
      additionalProperties: false,
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolValue },
    execute: executeTool(ctx, 'project_review_write', async function (args, exec) {
      const taskId = typeof args.task_id === 'string' ? args.task_id : ''
      return withProjectTaskLock(taskId, async function () {
        if (typeof args.summary !== 'string' || args.summary.trim().length === 0) {
          throw apiError(400, 'bad-review-summary', messages.reviewSummaryInvalid)
        }
        if (typeof args.content !== 'string') {
          throw apiError(400, 'bad-review-content', messages.reviewContentInvalid)
        }
        const task = await requireRunningTask(ctx, taskId, 'review', exec)
        const review = await writeReview(task.projectPath, task, args.summary, args.content)
        const updated = await updateTaskIf(taskId, ['running'], function () {
          return { status: 'succeeded', reviewFile: review.name, error: '' }
        })
        if (updated === null) {
          throw apiError(409, 'invalid-task-state', messages.projectTaskInvalidState)
        }
        return {
          ok: true,
          message: (messages.reviewWrittenPrefix || 'review written: ') + review.name,
          content: review.name,
        }
      })
    }),
  }))

  disposers.push(ctx.tools.register({
    name: 'project_git_show',
    description: messages.projectGitShowToolDescription,
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: messages.projectTaskIdDescription },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolValue },
    execute: executeTool(ctx, 'project_git_show', async function (args, exec) {
      const taskId = typeof args.task_id === 'string' ? args.task_id : ''
      return withProjectTaskLock(taskId, async function () {
        const task = await requireRunningTask(ctx, taskId, 'review', exec)
        if (task.reviewTarget === 'uncommitted') {
          // 未提交评审没有 commitHash：返回暂存/未暂存/未跟踪文件的组合 diff。
          const worktree = await showWorktreeDiff(task.projectPath)
          return {
            ok: true,
            message: 'uncommitted changes',
            content: worktree.text,
          }
        }
        const detail = await showProjectCommitDiff(task.projectPath, task.commitHash)
        if (detail === null) {
          throw apiError(404, 'commit-not-found', messages.projectCommitNotFound)
        }
        return {
          ok: true,
          message: 'commit ' + task.commitShort,
          content: detail.diff,
        }
      })
    }),
  }))

  return function () {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // Ignore disposer failures.
      }
    }
  }
}
