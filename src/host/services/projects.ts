import type { HostContext, Workspace } from '../context.js'
import type { ProjectDto } from '../../shared/api-types.js'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'

function registryList(ctx: HostContext): Workspace[] {
  return ctx.workspaceRegistry && typeof ctx.workspaceRegistry.list === 'function'
    ? ctx.workspaceRegistry.list()
    : []
}

function registryGet(ctx: HostContext, workspaceId: string): Workspace | null | undefined {
  if (ctx.workspaceRegistry && typeof ctx.workspaceRegistry.get === 'function') {
    return ctx.workspaceRegistry.get(workspaceId)
  }
  return registryList(ctx).find(function (item) { return item.id === workspaceId }) || null
}

async function canonicalExisting(value: unknown): Promise<string> {
  if (typeof value !== 'string' || value.length === 0) return ''
  try {
    const real = await fsp.realpath(value)
    const stat = await fsp.stat(real)
    return stat.isDirectory() ? real : ''
  } catch {
    return ''
  }
}

export async function workspaceProjectDto(workspace: Workspace): Promise<ProjectDto> {
  const canonical = await canonicalExisting(workspace.path)
  return {
    workspaceId: workspace.id,
    title: workspace.title || path.basename(String(workspace.path || '')),
    path: workspace.path || '',
    canonicalPath: canonical,
    missingPath: canonical.length === 0,
  }
}

export async function findWorkspaceByCanonicalPath(ctx: HostContext, canonicalPath: string): Promise<Workspace | null> {
  for (const workspace of registryList(ctx)) {
    const current = await canonicalExisting(workspace.path)
    if (current === canonicalPath) return workspace
  }
  return null
}

export async function addProject(ctx: HostContext, requestedPath: string, requestedTitle?: string): Promise<{ created: boolean; project: ProjectDto }> {
  if (typeof requestedPath !== 'string' || path.isAbsolute(requestedPath) === false) {
    throw apiError(400, 'bad-project-path', messages.badRoot)
  }
  let canonicalPath
  try {
    canonicalPath = await fsp.realpath(requestedPath)
    const stat = await fsp.stat(canonicalPath)
    if (stat.isDirectory() === false) throw new Error('not a directory')
  } catch {
    throw apiError(400, 'bad-project-path', messages.projectPathInvalid)
  }
  const existing = await findWorkspaceByCanonicalPath(ctx, canonicalPath)
  if (existing !== null) {
    return { created: false, project: await workspaceProjectDto(existing) }
  }
  if (typeof ctx.workspaceRegistry.create !== 'function') {
    throw apiError(500, 'workspace-registry-unavailable', messages.projectRegistryUnavailable)
  }
  const title = typeof requestedTitle === 'string' && requestedTitle.trim().length > 0
    ? requestedTitle.trim()
    : undefined
  let result: Workspace | string
  try {
    result = await ctx.workspaceRegistry.create(canonicalPath, title)
  } catch (error) {
    throw apiError(500, 'project-create-failed', messages.projectCreateFailed)
  }
  let workspace: Workspace | null | undefined = null
  if (result && typeof result === 'object' && typeof result.id === 'string') {
    workspace = registryGet(ctx, result.id) || result
  }
  if (workspace === null && typeof result === 'string') workspace = registryGet(ctx, result)
  if (workspace === null) workspace = await findWorkspaceByCanonicalPath(ctx, canonicalPath)
  if (workspace === null) {
    throw apiError(500, 'project-create-failed', messages.projectCreateFailed)
  }
  return { created: true, project: await workspaceProjectDto(workspace) }
}

export function getRegisteredWorkspace(ctx: HostContext, workspaceId: string): Workspace {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw apiError(404, 'workspace-not-found', messages.workspaceNotFound)
  }
  const workspace = registryGet(ctx, workspaceId)
  if (workspace === null || workspace === undefined) {
    throw apiError(404, 'workspace-not-found', messages.workspaceNotFound)
  }
  return workspace
}

export async function requireProject(ctx: HostContext, workspaceId: string): Promise<{ workspace: Workspace; canonicalPath: string; project: ProjectDto }> {
  const workspace = getRegisteredWorkspace(ctx, workspaceId)
  let canonicalPath
  try {
    canonicalPath = await fsp.realpath(workspace.path)
    const stat = await fsp.stat(canonicalPath)
    if (stat.isDirectory() === false) throw new Error('not a directory')
  } catch {
    throw apiError(400, 'project-path-missing', messages.projectPathMissing)
  }
  return {
    workspace,
    canonicalPath,
    project: await workspaceProjectDto(workspace),
  }
}
