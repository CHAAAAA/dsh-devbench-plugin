/** Agent tools. Errors become structured {ok:false,message} results. */
import { AGENT_WRITABLE_STATUS } from '../constants.js'
import { ApiError, apiError, errorMessage } from '../errors.js'
import { messages } from '../messages/index.js'
import { buildState } from '../services/state.js'
import { readConfig, requireRoot } from '../storage/config.js'
import {
  findLinkedRequirement,
  findRequirementAnywhere,
  updateRequirement,
} from '../domain/requirements.js'
import { readTextFile } from '../domain/files.js'

const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
    content: { type: 'string' },
  },
  additionalProperties: false,
}

function toolResult(value) {
  return value
}

function renderToolValue(args, value) {
  const text = value && typeof value.content === 'string' && value.content.length > 0
    ? value.content
    : (value && typeof value.message === 'string' ? value.message : JSON.stringify(value))
  return [{ type: 'text', text }]
}

export function formatRequirement(requirement) {
  const meta = requirement.meta
  return [
    messages.formatIdLabel + meta.id,
    messages.formatTitleLabel + meta.title,
    messages.formatStatusLabel + meta.status,
    messages.formatDocumentLabel + requirement.file,
    messages.formatFolderLabel + requirement.folderPath,
    '',
    requirement.body,
  ].join('\n')
}

async function findTarget(config, args, exec) {
  const root = requireRoot(config)
  if (args.requirement_id !== undefined) {
    if (typeof args.requirement_id !== 'string') {
      throw apiError(400, 'bad-field', messages.invalidField + ': requirement_id')
    }
    const workspaceId = args.workspace_id === undefined ? '' : args.workspace_id
    if (typeof workspaceId !== 'string') {
      throw apiError(400, 'bad-field', messages.invalidField + ': workspace_id')
    }
    return findRequirementAnywhere(root, args.requirement_id, workspaceId)
  }
  const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
  return findLinkedRequirement(root, sessionId)
}

function executeTool(ctx, name, task) {
  return async function (args, exec) {
    try {
      return await task(args || {}, exec)
    } catch (error) {
      const message = error instanceof ApiError
        ? error.message
        : (messages.toolErrorPrefix || 'tool failed: ') + errorMessage(error)
      ctx.logger?.warn?.('devbench-manager tool ' + name + ': ' + errorMessage(error))
      return toolResult({ ok: false, message })
    }
  }
}

export function registerRequirementTools(ctx) {
  const disposers = []

  disposers.push(ctx.tools.register({
    name: 'requirement_read',
    description: messages.toolReadDescription,
    parameters: {
      type: 'object',
      properties: {
        requirement_id: { type: 'string', description: messages.toolRequirementIdDescription },
        workspace_id: { type: 'string', description: messages.toolWorkspaceIdDescription },
        file: { type: 'string', description: messages.toolFileDescription },
      },
      additionalProperties: false,
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolValue },
    execute: executeTool(ctx, 'requirement_read', async function (args, exec) {
      const config = await readConfig()
      if (typeof config.rootDir !== 'string' || config.rootDir.length === 0) {
        return toolResult({ ok: false, message: messages.toolRootMissing })
      }
      if (args.file !== undefined && typeof args.file !== 'string') {
        throw apiError(400, 'bad-field', messages.invalidField + ': file')
      }
      const found = await findTarget(config, args, exec)
      if (found === null) return toolResult({ ok: false, message: messages.toolNoTarget })
      if (typeof args.file === 'string' && args.file.length > 0) {
        const content = await readTextFile(found.folderPath, args.file)
        return toolResult({
          ok: true,
          content,
          message: (messages.toolReadFileSuccess || 'read file: ') + args.file,
        })
      }
      return toolResult({ ok: true, content: formatRequirement(found), message: 'ok' })
    }),
  }))

  disposers.push(ctx.tools.register({
    name: 'requirement_update',
    description: messages.toolUpdateDescription,
    parameters: {
      type: 'object',
      properties: {
        requirement_id: { type: 'string', description: messages.toolUpdateIdDescription },
        workspace_id: { type: 'string', description: messages.toolWorkspaceIdDescription },
        content: { type: 'string', description: messages.toolContentDescription },
        mode: { type: 'string', enum: ['replace', 'append'], description: messages.toolModeDescription },
        status: { type: 'string', enum: ['new', 'running'], description: messages.toolStatusDescription },
      },
      required: ['content'],
      additionalProperties: false,
    },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolValue },
    execute: executeTool(ctx, 'requirement_update', async function (args, exec) {
      const config = await readConfig()
      if (typeof config.rootDir !== 'string' || config.rootDir.length === 0) {
        return toolResult({ ok: false, message: messages.toolRootMissing })
      }
      if (typeof args.content !== 'string') {
        throw apiError(400, 'bad-field', messages.invalidField + ': content')
      }
      if (args.status !== undefined && AGENT_WRITABLE_STATUS.includes(args.status) === false) {
        return toolResult({
          ok: false,
          message: messages.toolInvalidStatus || 'status must be new or running',
        })
      }
      const found = await findTarget(config, args, exec)
      if (found === null) return toolResult({ ok: false, message: messages.toolNoTarget })
      const mode = args.mode === 'append' ? 'append' : 'replace'
      const metaPatch = {}
      if (args.status !== undefined) metaPatch.status = args.status
      const saved = await updateRequirement(found, function (latest) {
        const body = mode === 'append'
          ? latest.body.replace(/\s*$/, '') + '\n\n' + args.content + '\n'
          : args.content
        return { meta: metaPatch, body }
      })
      const label = mode === 'append'
        ? (messages.toolAppendLabel || 'append')
        : (messages.toolReplaceLabel || 'replace')
      const text = (messages.toolUpdatedPrefix || 'updated ') + saved.meta.id +
        (messages.toolUpdatedMiddle || ' (') + label +
        (messages.toolUpdatedSuffix || ' body)')
      return toolResult({
        ok: true,
        message: text,
        content: formatRequirement(Object.assign({}, found, saved)),
      })
    }),
  }))

  disposers.push(ctx.tools.register({
    name: 'requirement_list',
    description: messages.toolListDescription,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: TOOL_OUTPUT_SCHEMA, render: renderToolValue },
    execute: executeTool(ctx, 'requirement_list', async function () {
      const config = await readConfig()
      if (typeof config.rootDir !== 'string' || config.rootDir.length === 0) {
        return toolResult({ ok: false, message: messages.toolRootMissing })
      }
      const state = await buildState(ctx, config)
      const lines = []
      for (const workspace of state.workspaces) {
        if (workspace.requirements.length === 0) continue
        lines.push((messages.listWorkspacePrefix || 'workspace: ') +
          workspace.title + ' (' + workspace.workspaceId + ')')
        for (const requirement of workspace.requirements) {
          lines.push('- ' + requirement.id + ' [' + requirement.status + '] ' + requirement.title)
        }
      }
      return toolResult({
        ok: true,
        content: lines.length > 0 ? lines.join('\n') : messages.noRequirements,
        message: 'ok',
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
