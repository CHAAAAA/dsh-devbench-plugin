/** Project worktree listing, creation, change inspection, commit, push, reveal, prune, and remove routes. */
import {
  confirmProjectWorktreeCommit,
  createProjectWorktree,
  listProjectWorktrees,
  previewProjectWorktreeCommit,
  pruneProjectWorktrees,
  pushProjectWorktree,
  readProjectWorktreeChanges,
  removeProjectWorktree,
  revealProjectWorktree,
} from '../../services/project-worktrees.js'
import { readStringField } from '../body.js'

export const projectWorktreeRoutes = []

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function workspaceIdFromBody(body) {
  return readStringField(body, 'workspaceId', { required: true })
}

function requirementIdFromBody(body) {
  return readStringField(body, 'id', { required: true })
}

function optionalRequirementIdFromBody(body) {
  return hasOwn(body, 'id') ? readStringField(body, 'id', { required: true }) : ''
}

projectWorktreeRoutes.push({
  method: 'GET',
  path: '/project/worktrees',
  async handle(context) {
    const workspaceId = context.url.searchParams.get('workspaceId') || ''
    return listProjectWorktrees(context.ctx, workspaceId)
  },
})

projectWorktreeRoutes.push({
  method: 'GET',
  path: '/project/worktree/changes',
  async handle(context) {
    const workspaceId = context.url.searchParams.get('workspaceId') || ''
    const id = context.url.searchParams.get('id') || ''
    return readProjectWorktreeChanges(context.ctx, workspaceId, id)
  },
})

projectWorktreeRoutes.push({
  method: 'POST',
  path: '/project/worktree/create',
  async handle(context) {
    const body = await context.readBody()
    return createProjectWorktree(context.ctx,
      workspaceIdFromBody(body), requirementIdFromBody(body))
  },
})

projectWorktreeRoutes.push({
  method: 'POST',
  path: '/project/worktree/commit/preview',
  async handle(context) {
    const body = await context.readBody()
    return previewProjectWorktreeCommit(context.ctx,
      workspaceIdFromBody(body), requirementIdFromBody(body))
  },
})

projectWorktreeRoutes.push({
  method: 'POST',
  path: '/project/worktree/commit/confirm',
  async handle(context) {
    const body = await context.readBody()
    const workspaceId = workspaceIdFromBody(body)
    const taskId = readStringField(body, 'taskId', { required: true })
    const message = hasOwn(body, 'message')
      ? readStringField(body, 'message', { allowEmpty: false, trim: true, maxLength: 2000 })
      : undefined
    return confirmProjectWorktreeCommit(context.ctx, workspaceId, taskId, message)
  },
})

projectWorktreeRoutes.push({
  method: 'POST',
  path: '/project/worktree/push',
  async handle(context) {
    const body = await context.readBody()
    return pushProjectWorktree(context.ctx,
      workspaceIdFromBody(body), requirementIdFromBody(body))
  },
})

projectWorktreeRoutes.push({
  method: 'POST',
  path: '/project/worktree/reveal',
  async handle(context) {
    const body = await context.readBody()
    const target = hasOwn(body, 'target')
      ? readStringField(body, 'target', { required: true })
      : ''
    return revealProjectWorktree(context.ctx,
      workspaceIdFromBody(body), requirementIdFromBody(body), target)
  },
})

projectWorktreeRoutes.push({
  method: 'POST',
  path: '/project/worktree/prune',
  async handle(context) {
    const body = await context.readBody()
    return pruneProjectWorktrees(context.ctx,
      workspaceIdFromBody(body), optionalRequirementIdFromBody(body))
  },
})

projectWorktreeRoutes.push({
  method: 'POST',
  path: '/project/worktree/remove',
  async handle(context) {
    const body = await context.readBody()
    return removeProjectWorktree(context.ctx,
      workspaceIdFromBody(body), requirementIdFromBody(body))
  },
})
