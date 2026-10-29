/** Requirement CRUD, session linking, and execution routes. */
import {
  MAX_SESSION_ID_LENGTH,
  MAX_TITLE_LENGTH,
  VALID_STATUS,
} from '../../constants.js'
import { apiError } from '../../errors.js'
import { messages } from '../../messages/index.js'
import { renderPrompt } from '../../prompts/render.js'
import { requireRoot } from '../../storage/config.js'
import {
  ensureWorkspaceFolder,
  readMapping,
} from '../../storage/workspaces.js'
import {
  addRequirementCommit,
  commitMatches,
  createRequirement,
  deleteRequirement,
  findLinkedRequirement,
  removeRequirementCommit,
  toSummary,
  updateRequirement,
} from '../../domain/requirements.js'
import { listTree } from '../../domain/files.js'
import {
  describeRequirementWorktree,
  ensureRequirementWorktree,
  removeRequirementWorktree,
  revealRequirementWorktree,
} from '../../domain/worktrees.js'
import { resolveProjectCommit } from '../../integrations/git.js'
import {
  normalizeSearchOptions,
  searchWorkspaceRequirements,
} from '../../services/requirement-search.js'
import { recordRequirementTask } from '../../services/requirement-tasks.js'
import { ACTIVE_TASK_STATUSES, readTasks } from '../../storage/tasks.js'
import { assertWorktreeNotInUse } from '../../domain/worktree-usage.js'
import { readStringField } from '../body.js'
import { findWorkspace, requireRequirement } from './common.js'

export const requirementRoutes = []

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function readBooleanField(body, key, required) {
  if (hasOwn(body, key) === false) {
    if (required === true) throw apiError(400, 'bad-field', messages.invalidField + ': ' + key)
    return undefined
  }
  if (typeof body[key] !== 'boolean') {
    throw apiError(400, 'bad-field', messages.invalidField + ': ' + key)
  }
  return body[key]
}

function readIdentity(body) {
  return {
    workspaceId: readStringField(body, 'workspaceId', { required: true }),
    id: readStringField(body, 'id', { required: true }),
  }
}

function userStatus(body) {
  const status = readStringField(body, 'status', { required: true })
  if (VALID_STATUS.includes(status) === false) {
    throw apiError(400, 'bad-status', messages.badStatus)
  }
  return status
}

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/create',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const workspaceId = readStringField(body, 'workspaceId', { required: true })
    const workspace = findWorkspace(context.ctx, workspaceId)
    const title = readStringField(body, 'title', {
      required: true,
      trim: true,
      maxLength: MAX_TITLE_LENGTH,
      missingCode: 'missing-title',
      missingMessage: messages.missingTitle,
    })
    const text = hasOwn(body, 'body')
      ? readStringField(body, 'body', { allowEmpty: true })
      : ''
    const worktree = readBooleanField(body, 'worktree', false)
    const folderInfo = await ensureWorkspaceFolder(root, workspace)
    const result = await createRequirement(root, workspace, folderInfo, title, text, {
      worktree: worktree === true,
    })
    return {
      requirement: toSummary(result.requirement.meta, result.requirement.folderPath, workspaceId),
      body: result.body,
    }
  },
})

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/get',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readIdentity(body)
    const workspace = findWorkspace(context.ctx, identity.workspaceId)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    const summary = toSummary(found.meta, found.folderPath, identity.workspaceId)
    const files = await listTree(found.folderPath)
    const worktree = await describeRequirementWorktree(context.config, workspace, found)
    return { requirement: summary, body: found.body, files, worktree }
  },
})

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/save',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readIdentity(body)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    const metaPatch = {}
    if (hasOwn(body, 'title')) {
      metaPatch.title = readStringField(body, 'title', {
        required: true,
        trim: true,
        maxLength: MAX_TITLE_LENGTH,
      })
    }
    if (hasOwn(body, 'status')) metaPatch.status = userStatus(body)
    const hasBody = hasOwn(body, 'body')
    const nextBody = hasBody ? readStringField(body, 'body', { allowEmpty: true }) : undefined
    const hasExpectedUpdatedAt = hasOwn(body, 'expectedUpdatedAt') && body.expectedUpdatedAt !== null
    const expectedUpdatedAt = hasExpectedUpdatedAt
      ? readStringField(body, 'expectedUpdatedAt', { allowEmpty: true })
      : ''
    const force = readBooleanField(body, 'force', false) === true
    const saved = await updateRequirement(found, function () {
      return { meta: metaPatch, body: nextBody }
    }, { expectedUpdatedAt, force })
    return {
      requirement: toSummary(saved.meta, found.folderPath, identity.workspaceId),
    }
  },
})

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/execute',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readIdentity(body)
    const workspace = findWorkspace(context.ctx, identity.workspaceId)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    if (hasOwn(body, 'markRunning') && typeof body.markRunning !== 'boolean') {
      throw apiError(400, 'bad-field', messages.invalidField + ': markRunning')
    }
    const markRunning = body.markRunning === undefined ? true : body.markRunning
    const worktreeEnabled = Boolean(found.meta.extra && found.meta.extra.worktree === true)
    if (worktreeEnabled === true) {
      // Starting a session inside the worktree while a commit preview is pending
      // would race the Agent with the commit; ask the user to resolve it first.
      const tasks = await readTasks()
      const activeCommit = tasks.find(function (task) {
        if (task.workspaceId !== identity.workspaceId || task.kind !== 'commit') return false
        if (task.requirementId !== found.meta.id) return false
        return ACTIVE_TASK_STATUSES.includes(task.status)
      })
      if (activeCommit !== undefined) {
        throw apiError(409, 'worktree-commit-active', messages.worktreeCommitActive)
      }
    }
    const worktree = worktreeEnabled === true
      ? await ensureRequirementWorktree(context.config, workspace, found)
      : null
    const saved = markRunning === true && found.meta.status !== 'running'
      ? await updateRequirement(found, function () { return { meta: { status: 'running' } } })
      : found
    const prompt = renderPrompt(context.config.promptTemplate, {
      workspaceTitle: workspace.title || workspace.path,
      title: saved.meta.title,
      id: saved.meta.id,
      requirementPath: saved.file,
      folderPath: saved.folderPath,
      body: saved.body,
    })
    const payload = {
      prompt,
      requirement: toSummary(saved.meta, found.folderPath, identity.workspaceId),
      worktree,
    }
    if (worktree !== null) payload.cwd = worktree.path
    return payload
  },
})

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/delete',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readIdentity(body)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    const tasks = await readTasks()
    const activeTask = tasks.find(function (task) {
      return task.workspaceId === identity.workspaceId &&
        task.requirementId === found.meta.id &&
        ACTIVE_TASK_STATUSES.includes(task.status)
    })
    if (activeTask !== undefined) {
      throw apiError(409, 'requirement-task-active', messages.requirementTaskActive)
    }
    const mapping = await readMapping(root)
    return deleteRequirement(root, found, mapping)
  },
})

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/link-session',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readIdentity(body)
    const sessionId = readStringField(body, 'sessionId', {
      required: true,
      maxLength: MAX_SESSION_ID_LENGTH,
      missingCode: 'missing-session',
      missingMessage: messages.missingSession,
    })
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    const saved = await updateRequirement(found, function (latest) {
      const sessions = latest.meta.sessions.includes(sessionId)
        ? latest.meta.sessions
        : latest.meta.sessions.concat([sessionId])
      return { meta: { sessions } }
    })
    return {
      requirement: toSummary(saved.meta, found.folderPath, identity.workspaceId),
    }
  },
})

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/execute/task',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readIdentity(body)
    const sessionId = readStringField(body, 'sessionId', {
      required: true,
      maxLength: MAX_SESSION_ID_LENGTH,
      missingCode: 'missing-session',
      missingMessage: messages.missingSession,
    })
    const workspace = findWorkspace(context.ctx, identity.workspaceId)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    if (found.meta.sessions.includes(sessionId) === false) {
      throw apiError(409, 'session-not-linked', messages.requirementSessionNotLinked)
    }
    return {
      task: await recordRequirementTask(context.ctx, context.config, workspace, found, sessionId),
    }
  },
})

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/unlink-session',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readIdentity(body)
    const sessionId = readStringField(body, 'sessionId', {
      required: true,
      maxLength: MAX_SESSION_ID_LENGTH,
      missingCode: 'missing-session',
      missingMessage: messages.missingSession,
    })
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    const saved = await updateRequirement(found, function (latest) {
      const sessions = latest.meta.sessions.filter(function (item) { return item !== sessionId })
      return { meta: { sessions } }
    })
    return {
      requirement: toSummary(saved.meta, found.folderPath, identity.workspaceId),
    }
  },
})

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/link-commit',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readIdentity(body)
    const commitValue = readStringField(body, 'commit', {
      required: true,
      missingCode: 'bad-commit',
      missingMessage: messages.projectCommitNotFound,
    })
    const workspace = findWorkspace(context.ctx, identity.workspaceId)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    const info = await resolveProjectCommit(workspace.path, commitValue)
    if (info === null) throw apiError(404, 'commit-not-found', messages.projectCommitNotFound)
    let saved = await addRequirementCommit(found, info.hash)
    // A review may already exist for this commit: attach its session as well so
    // the requirement lists the review conversation immediately.
    const reviewSessions = (await readTasks()).filter(function (task) {
      return task.kind === 'review' && typeof task.sessionId === 'string' &&
        task.sessionId.length > 0 && commitMatches(task.commitHash, info.hash)
    }).map(function (task) { return task.sessionId })
    const missing = reviewSessions.filter(function (sessionId) {
      return saved.meta.sessions.includes(sessionId) === false
    })
    if (missing.length > 0) {
      saved = await updateRequirement(found, function (latest) {
        const sessions = latest.meta.sessions.slice()
        for (const sessionId of missing) {
          if (sessions.includes(sessionId) === false) sessions.push(sessionId)
        }
        return { meta: { sessions: sessions } }
      })
    }
    return {
      requirement: toSummary(saved.meta, found.folderPath, identity.workspaceId),
    }
  },
})

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/unlink-commit',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readIdentity(body)
    const commitValue = readStringField(body, 'commit', {
      required: true,
      missingCode: 'bad-commit',
      missingMessage: messages.projectCommitNotFound,
    })
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    const saved = await removeRequirementCommit(found, commitValue)
    return {
      requirement: toSummary(saved.meta, found.folderPath, identity.workspaceId),
    }
  },
})

requirementRoutes.push({
  method: 'GET',
  path: '/requirement/search',
  async handle(context) {
    const params = context.url.searchParams
    const workspaceId = params.get('workspaceId') || ''
    // 路由层先校验查询参数（q 长度、scope 枚举、limit 范围），保证 HTTP 200/400
    // 判定在这里完成；服务层对直接调用方仍会做同一次归一化兜底。
    const options = normalizeSearchOptions({
      q: params.get('q'),
      scope: params.get('scope'),
      limit: params.get('limit'),
    })
    return searchWorkspaceRequirements(context.ctx, context.config, workspaceId, {
      q: options.query,
      scope: options.scope,
      limit: options.limit,
    })
  },
})

requirementRoutes.push({
  method: 'GET',
  path: '/session-link',
  async handle(context) {
    const sessionId = context.url.searchParams.get('sessionId') || ''
    if (sessionId.length === 0) {
      throw apiError(400, 'missing-session', messages.missingSessionShort)
    }
    const root = requireRoot(context.config)
    const found = await findLinkedRequirement(root, sessionId)
    if (found === null) return { link: null }
    return {
      link: {
        workspaceId: found.workspaceId,
        id: found.meta.id,
        title: found.meta.title,
        status: found.meta.status,
      },
    }
  },
})

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/worktree',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readIdentity(body)
    const enabled = readBooleanField(body, 'enabled', true)
    const workspace = findWorkspace(context.ctx, identity.workspaceId)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    if (enabled === false) {
      const description = await describeRequirementWorktree(context.config, workspace, found)
      if (description.exists === true) {
        throw apiError(409, 'worktree-exists-cannot-disable', messages.worktreeDisableBlocked)
      }
    }
    const saved = await updateRequirement(found, function (latest) {
      const extra = Object.assign({}, latest.meta.extra)
      if (enabled === true) extra.worktree = true
      else delete extra.worktree
      return { meta: { extra } }
    })
    return {
      requirement: toSummary(saved.meta, found.folderPath, identity.workspaceId),
      worktree: await describeRequirementWorktree(context.config, workspace, saved),
    }
  },
})

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/worktree/remove',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readIdentity(body)
    const workspace = findWorkspace(context.ctx, identity.workspaceId)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    const tasks = await readTasks()
    const sessions = Array.isArray(found.meta.sessions) ? found.meta.sessions : []
    assertWorktreeNotInUse({
      ctx: context.ctx,
      tasks,
      workspaceId: identity.workspaceId,
      requirementId: found.meta.id,
      worktreePath: '',
      sessionIds: sessions,
    })
    const removed = await removeRequirementWorktree(context.config, workspace, found)
    return {
      removed: removed.removed,
      pruned: removed.pruned === true,
      branch: removed.branch,
      requirement: toSummary(found.meta, found.folderPath, identity.workspaceId),
      worktree: await describeRequirementWorktree(context.config, workspace, found),
    }
  },
})

requirementRoutes.push({
  method: 'POST',
  path: '/requirement/worktree/reveal',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readIdentity(body)
    const workspace = findWorkspace(context.ctx, identity.workspaceId)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    return revealRequirementWorktree(context.config, workspace, found)
  },
})
