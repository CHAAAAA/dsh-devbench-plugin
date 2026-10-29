/** State, config, root-open, and workspace-initialize routes. */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_COMMIT_PROMPT_TEMPLATE,
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_REVIEW_PROMPT_TEMPLATE,
} from '../../constants.js'
import { apiError } from '../../errors.js'
import { messages } from '../../messages/index.js'
import { buildState } from '../../services/state.js'
import {
  defaultWorktreeRoot,
  requireRoot,
  resolveWorktreeRoot,
  updateConfig,
} from '../../storage/config.js'
import {
  ensureMetaDirectory,
  ensureRootDirectory,
  ensureWorkspaceFolder,
} from '../../storage/workspaces.js'
import { openInSystem } from '../../platform/open.js'
import { listExistingPluginWorktrees } from '../../domain/worktrees.js'
import { readStringField } from '../body.js'
import { findWorkspace } from './common.js'

export const configRoutes = [
  {
    method: 'GET',
    path: '/state',
    async handle(context) {
      return buildState(context.ctx, context.config)
    },
  },
  {
    method: 'POST',
    path: '/config',
    async handle(context) {
      const body = await context.readBody()
      const next = await updateConfig(async function (current) {
        const value = { ...current }
        if (Object.prototype.hasOwnProperty.call(body, 'rootDir')) {
          let root = readStringField(body, 'rootDir', { allowEmpty: true, trim: true, maxLength: 4096 })
          if (root.length > 0) {
            if (path.isAbsolute(root) === false) throw apiError(400, 'bad-root', messages.badRoot)
            root = path.resolve(root)
            await ensureRootDirectory(root)
            await ensureMetaDirectory(root)
            value.rootDir = root
          } else {
            value.rootDir = ''
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'promptTemplate')) {
          const template = readStringField(body, 'promptTemplate', { allowEmpty: true })
          const trimmed = template.trim()
          value.promptTemplate = trimmed.length === 0 || template === DEFAULT_PROMPT_TEMPLATE ? '' : template
        }
        if (Object.prototype.hasOwnProperty.call(body, 'reviewPromptTemplate')) {
          const template = readStringField(body, 'reviewPromptTemplate', { allowEmpty: true })
          const trimmed = template.trim()
          const isDefault = trimmed.length === 0 || trimmed === DEFAULT_REVIEW_PROMPT_TEMPLATE
          if (isDefault === false && trimmed.includes('{taskId}') === false) {
            throw apiError(400, 'bad-review-template', messages.badReviewTemplate)
          }
          value.reviewPromptTemplate = isDefault ? '' : template
        }
        if (Object.prototype.hasOwnProperty.call(body, 'commitPromptTemplate')) {
          const template = readStringField(body, 'commitPromptTemplate', { allowEmpty: true })
          const trimmed = template.trim()
          const isDefault = trimmed.length === 0 || trimmed === DEFAULT_COMMIT_PROMPT_TEMPLATE
          const required = ['{taskId}', '{changedFiles}', '{diffText}']
          const missing = required.some(function (token) {
            return trimmed.includes(token) === false
          })
          if (isDefault === false && missing) {
            throw apiError(400, 'bad-commit-template', messages.badCommitPromptTemplate)
          }
          value.commitPromptTemplate = isDefault ? '' : template
        }
        if (Object.prototype.hasOwnProperty.call(body, 'worktreeRoot')) {
          const root = readStringField(body, 'worktreeRoot', {
            allowEmpty: true, trim: true, maxLength: 4096,
          })
          if (root.length === 0) {
            const currentRoot = path.resolve(resolveWorktreeRoot(current))
            const defaultRoot = path.resolve(defaultWorktreeRoot())
            if (currentRoot !== defaultRoot) {
              const existing = await listExistingPluginWorktrees(context.ctx, current)
              if (existing.length > 0) {
                throw apiError(409, 'worktree-root-in-use', messages.worktreeRootInUse)
              }
            }
            value.worktreeRoot = ''
          } else {
            if (path.isAbsolute(root) === false) {
              throw apiError(400, 'bad-worktree-root', messages.worktreeRootInvalid)
            }
            let real
            try {
              await fsp.mkdir(root, { recursive: true })
              real = await fsp.realpath(root)
              const stat = await fsp.stat(real)
              if (stat.isDirectory() === false) throw new Error('not a directory')
            } catch {
              throw apiError(400, 'bad-worktree-root', messages.worktreeRootInvalid)
            }
            const currentRoot = path.resolve(resolveWorktreeRoot(current))
            if (real !== currentRoot) {
              const existing = await listExistingPluginWorktrees(context.ctx, current)
              if (existing.length > 0) {
                throw apiError(409, 'worktree-root-in-use', messages.worktreeRootInUse)
              }
            }
            value.worktreeRoot = real
          }
        }
        return value
      })
      return buildState(context.ctx, next)
    },
  },
]

configRoutes.push({
  method: 'POST',
  path: '/root/open',
  async handle(context) {
    const root = requireRoot(context.config)
    return openInSystem(root, false)
  },
})

configRoutes.push({
  method: 'POST',
  path: '/root/reveal',
  async handle(context) {
    const root = requireRoot(context.config)
    return openInSystem(root, true)
  },
})

configRoutes.push({
  method: 'POST',
  path: '/workspace/init',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const workspaceId = readStringField(body, 'workspaceId', { required: true })
    const workspace = findWorkspace(context.ctx, workspaceId)
    const result = await ensureWorkspaceFolder(root, workspace)
    return { folder: result.folder, folderPath: result.folderPath }
  },
})
