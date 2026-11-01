/** Shared route helpers for workspace and requirement lookup. */
import { apiError } from '../../errors.js'
import { messages } from '../../messages/index.js'
import { findRequirementInWorkspace } from '../../domain/requirements.js'

export function findWorkspace(ctx, workspaceId) {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw apiError(404, 'workspace-not-found', messages.workspaceNotFound)
  }
  const value = typeof ctx.workspaceRegistry.get === 'function'
    ? ctx.workspaceRegistry.get(workspaceId)
    : undefined
  if (value === undefined || value === null) {
    throw apiError(404, 'workspace-not-found', messages.workspaceNotFound)
  }
  return value
}

export async function requireRequirement(root, workspaceId, requirementId) {
  const found = await findRequirementInWorkspace(root, workspaceId, requirementId)
  if (found === null) {
    throw apiError(404, 'requirement-not-found', messages.requirementNotFound)
  }
  return found
}
