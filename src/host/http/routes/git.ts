/** Git API routes. The Git service enforces repository-root identity. */
import { MAX_GIT_MESSAGE_LENGTH } from '../../constants.js'
import { DEFAULT_COMMIT_MESSAGE } from '../../prompts/defaults.js'
import { findRequirementInWorkspace } from '../../domain/requirements.js'
import {
  gitCommit,
  gitInfo,
  gitInit,
  gitLog,
  gitStatus,
} from '../../integrations/git.js'
import { requireRoot } from '../../storage/config.js'
import { ensureGitignore } from '../../storage/workspaces.js'
import { readStringField } from '../body.js'

export const gitRoutes = []

gitRoutes.push({
  method: 'GET',
  path: '/git/status',
  async handle(context) {
    const root = requireRoot(context.config)
    const info = await gitInfo(root)
    if (info.initialized === false) {
      return { initialized: false, branch: '', changes: [] }
    }
    return gitStatus(root)
  },
})

gitRoutes.push({
  method: 'POST',
  path: '/git/init',
  async handle(context) {
    const root = requireRoot(context.config)
    const result = await gitInit(root)
    await ensureGitignore(root)
    return result
  },
})

gitRoutes.push({
  method: 'POST',
  path: '/git/commit',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const requested = readStringField(body, 'message', {
      allowEmpty: true,
      trim: true,
      maxLength: MAX_GIT_MESSAGE_LENGTH,
    })
    const message = requested.length > 0 ? requested : DEFAULT_COMMIT_MESSAGE
    return gitCommit(root, message)
  },
})

gitRoutes.push({
  method: 'GET',
  path: '/git/log',
  async handle(context) {
    const root = requireRoot(context.config)
    const workspaceId = context.url.searchParams.get('workspaceId') || ''
    const id = context.url.searchParams.get('id') || ''
    const git = await gitInfo(root)
    if (git.initialized === false) return { entries: [], git }
    let folder = null
    if (id.length > 0) {
      const found = await findRequirementInWorkspace(root, workspaceId, id)
      if (found !== null) folder = found.folderPath
    }
    const limit = Number(context.url.searchParams.get('limit') || '') || 30
    const entries = await gitLog(root, folder, limit)
    return { entries, git }
  },
})
