/** JSON API client. Adds the plugin header, normalizes errors, and enforces a timeout. */
import type * as Api from '../../shared/api-types.js'
import { t } from '../runtime.js'
import { API_BASE, REQUEST_HEADER } from '../../shared/protocol.js'
/** Re-exported for tests and components that only need the endpoint. */
export const API = API_BASE
export const REQ_HEADER = REQUEST_HEADER
export class ApiError extends Error {
  code: string
  status: number
  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code || 'unknown'
    this.status = status || 0
  }
}
function abortError(): Error {
  const err = new Error('aborted')
  err.name = 'AbortError'
  return err
}
export interface RequestOptions { timeoutMs?: number; signal?: AbortSignal }
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export async function request<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  const opts = options || {}
  const controller = new AbortController()
  const timeoutMs = opts.timeoutMs === undefined ? 30000 : opts.timeoutMs
  let timedOut = false
  const timer = timeoutMs > 0 ? setTimeout(function () {
    timedOut = true
    controller.abort()
  }, timeoutMs) : null
  const external = opts.signal
  const onAbort = function () { controller.abort() }
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onAbort)
  }
  const headers: Record<string, string> = { [REQ_HEADER]: '1' }
  const init: RequestInit = { method: body === undefined ? 'GET' : 'POST', headers: headers, signal: controller.signal }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  try {
    const response = await fetch(API + path, init)
    let data: unknown = null
    try { data = await response.json() } catch {}
    if (!isRecord(data) || data.ok !== true) {
      const info = isRecord(data) && isRecord(data.error) ? data.error : null
      throw new ApiError(
        info && typeof info.message === 'string' && info.message ? info.message : t('panel.error') + ' HTTP ' + response.status,
        info && typeof info.code === 'string' && info.code ? info.code : 'http',
        response.status,
      )
    }
    // The envelope is checked here; each endpoint supplies its shared DTO contract.
    return data.value as T
  } catch (err) {
    if (timedOut) {
      const timeoutErr = new Error('timeout')
      timeoutErr.name = 'TimeoutError'
      throw timeoutErr
    }
    if (external && external.aborted) throw abortError()
    throw err
  } finally {
    if (timer) clearTimeout(timer)
    if (external) external.removeEventListener('abort', onAbort)
  }
}
function qs(values: Record<string, string | number | boolean>): string {
  return Object.keys(values).map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(values[key])
  }).join('&')
}
export function getState(opts?: RequestOptions): Promise<Api.StateDto> { return request('/state', undefined, opts) }
export function getRequirement(sel: Api.RequirementSelection, opts?: RequestOptions): Promise<Api.RequirementDetail> {
  return request('/requirement/get', sel, opts)
}
/** Workspace-wide title/full-text requirement search (REQ-20261028-001). */
export function searchRequirements(workspaceId: string, query: string, scope?: Api.SearchScope, opts?: RequestOptions): Promise<Api.SearchResult<Api.RequirementSearchItem>> {
  const values: Record<string, string | number> = { workspaceId: workspaceId, q: query }
  if (typeof scope === 'string') values.scope = scope
  return request('/requirement/search?' + qs(values), undefined, opts)
}
export function createRequirement(payload: Api.CreateRequirementRequest, opts?: RequestOptions): Promise<{ requirement: Api.RequirementSummary; body: string }> {
  return request('/requirement/create', payload, opts)
}
export function saveRequirement(payload: Api.SaveRequirementRequest, opts?: RequestOptions): Promise<{ requirement: Api.RequirementSummary }> {
  return request('/requirement/save', payload, opts)
}
export function executeRequirement(payload: Api.RequirementSelection & { markRunning?: boolean }, opts?: RequestOptions): Promise<{ prompt: string; requirement: Api.RequirementSummary; worktree: Api.RequirementWorktree | null; cwd?: string }> {
  return request('/requirement/execute', payload, opts)
}
export function deleteRequirement(payload: Api.RequirementSelection, opts?: RequestOptions): Promise<{ deleted: boolean; filesPreserved: boolean; id: string; folder: string }> {
  return request('/requirement/delete', payload, opts)
}
export function linkSession(payload: Api.RequirementSelection & { sessionId: string }, opts?: RequestOptions): Promise<{ requirement: Api.RequirementSummary }> {
  return request('/requirement/link-session', payload, opts)
}
export function unlinkSession(payload: Api.RequirementSelection & { sessionId: string }, opts?: RequestOptions): Promise<{ requirement: Api.RequirementSummary }> {
  return request('/requirement/unlink-session', payload, opts)
}
export function recordRequirementTask(payload: Api.RequirementSelection & { sessionId: string }, opts?: RequestOptions): Promise<{ task: Api.TaskDto }> {
  return request('/requirement/execute/task', payload, opts)
}
export function getSessionLink(sessionId: string, opts?: RequestOptions): Promise<{ link: Api.RequirementLink | null }> {
  return request('/session-link?' + qs({ sessionId: sessionId }), undefined, opts)
}
export function linkRequirementCommit(payload: Api.RequirementSelection & { commit: string }, opts?: RequestOptions): Promise<{ requirement: Api.RequirementSummary }> {
  return request('/requirement/link-commit', payload, opts)
}
export function unlinkRequirementCommit(payload: Api.RequirementSelection & { commit: string }, opts?: RequestOptions): Promise<{ requirement: Api.RequirementSummary }> {
  return request('/requirement/unlink-commit', payload, opts)
}
/** Toggle the requirement bookmark; the host keeps updatedAt unchanged. */
export function setRequirementFavorite(payload: Api.RequirementSelection & { favorite: boolean }, opts?: RequestOptions): Promise<{ requirement: Api.RequirementSummary }> {
  return request('/requirement/favorite', payload, opts)
}
/** Project documents live under `<root>/<workspace>/.documents/` on the host. */
export function listDocuments(workspaceId: string, opts?: RequestOptions): Promise<{ documents: Api.DocumentSummary[] }> {
  return request('/documents?' + qs({ workspaceId: workspaceId }), undefined, opts)
}
export function getDocument(sel: Api.RequirementSelection, opts?: RequestOptions): Promise<Api.DocumentDetail> {
  return request('/document/get', sel, opts)
}
export function createDocument(payload: Api.CreateDocumentRequest, opts?: RequestOptions): Promise<{ document: Api.DocumentSummary }> {
  return request('/document/create', payload, opts)
}
export function saveDocument(payload: Api.SaveDocumentRequest, opts?: RequestOptions): Promise<{ document: Api.DocumentSummary }> {
  return request('/document/save', payload, opts)
}
export function deleteDocument(payload: Api.RequirementSelection, opts?: RequestOptions): Promise<{ deleted: boolean; id: string }> {
  return request('/document/delete', payload, opts)
}
/** Workspace-wide title/full-text document search. */
export function searchDocuments(workspaceId: string, query: string, scope: Api.SearchScope, limit?: number, opts?: RequestOptions): Promise<Api.SearchResult<Api.DocumentSearchItem>> {
  const values: Record<string, string | number> = { workspaceId: workspaceId, q: query }
  if (typeof scope === 'string') values.scope = scope
  if (limit !== undefined && limit !== null) values.limit = limit
  return request('/document/search?' + qs(values), undefined, opts)
}
export function listFiles(sel: Api.RequirementSelection, path?: string, opts?: RequestOptions): Promise<Api.FileResult> {
  const query: Record<string, string | number> = { workspaceId: sel.workspaceId, id: sel.id }
  if (path !== undefined && path !== null) query.path = path
  return request('/files?' + qs(query), undefined, opts)
}
export function writeFile(payload: Api.RequirementSelection & { path: string; content: string }, opts?: RequestOptions): Promise<{ saved: boolean }> {
  return request('/files/write', payload, opts)
}
export function createFile(payload: Api.RequirementSelection & { path: string; type?: 'file' | 'dir'; content?: string }, opts?: RequestOptions): Promise<{ created: boolean }> {
  return request('/files/create', payload, opts)
}
export function deleteFile(payload: Api.RequirementSelection & { path: string }, opts?: RequestOptions): Promise<{ deleted: boolean }> {
  return request('/files/delete', payload, opts)
}
export function openFile(payload: Api.RequirementSelection & { path?: string; reveal?: boolean }, opts?: RequestOptions): Promise<{ opened: boolean }> {
  return request('/files/open', payload, opts)
}
export function gitStatus(opts?: RequestOptions): Promise<Api.GitStatus> { return request('/git/status', undefined, opts) }
export function gitLog(sel: Partial<Api.RequirementSelection>, opts?: RequestOptions): Promise<{ entries: Api.GitLogEntry[]; git: Api.GitInfo }> {
  return request('/git/log?' + qs({ workspaceId: sel.workspaceId, id: sel.id }), undefined, opts)
}
export function gitInit(opts?: RequestOptions): Promise<{ initialized: boolean }> { return request('/git/init', {}, opts) }
export function gitCommit(message: string, opts?: RequestOptions): Promise<{ committed: boolean; message: string }> {
  return request('/git/commit', { message: message }, opts)
}
export function openRoot(opts?: RequestOptions): Promise<{ opened: boolean }> { return request('/root/open', {}, opts) }
export function saveConfig(payload: Partial<Api.ConfigDto>, opts?: RequestOptions): Promise<Api.StateDto> {
  return request('/config', payload, opts)
}
export function getProjectOverview(workspaceId: string, opts?: RequestOptions): Promise<Api.ProjectOverview> {
  return request('/project/overview?' + qs({ workspaceId: workspaceId }), undefined, opts)
}
export function addProject(payload: { path: string; title?: string }, opts?: RequestOptions): Promise<{ created: boolean; project: Api.ProjectDto }> {
  return request('/project/add', payload, opts)
}
export function initProjectGit(workspaceId: string, opts?: RequestOptions): Promise<{ initialized: boolean; project: Api.ProjectDto; git: Api.ProjectGit }> {
  return request('/project/git/init', { workspaceId: workspaceId }, opts)
}
export function previewProjectCommit(workspaceId: string, opts?: RequestOptions): Promise<{ task: Api.TaskDto }> {
  return request('/project/commit/preview', { workspaceId: workspaceId }, opts)
}
export function confirmProjectCommit(payload: Api.ConfirmCommitRequest, opts?: RequestOptions): Promise<Api.CommitConfirmation> {
  return request('/project/commit/confirm', payload, opts)
}
export function getProjectChanges(workspaceId: string, opts?: RequestOptions): Promise<Api.WorkspaceChanges> {
  return request('/project/changes?' + qs({ workspaceId: workspaceId }), undefined, opts)
}
export function manualProjectCommit(payload: { workspaceId: string; message: string }, opts?: RequestOptions): Promise<{ commit: Api.CommitResult }> {
  return request('/project/commit/manual', payload, opts)
}
export function pullProject(workspaceId: string, opts?: RequestOptions): Promise<Api.PullResult> {
  return request('/project/pull', { workspaceId: workspaceId }, opts)
}
export function pushProject(workspaceId: string, opts?: RequestOptions): Promise<Api.PushResult> {
  return request('/project/push', { workspaceId: workspaceId }, opts)
}
export function startProjectReview(payload: { workspaceId: string; commit: string }, opts?: RequestOptions): Promise<{ task: Api.TaskDto; alreadyReviewed?: boolean }> {
  return request('/project/review/start', payload, opts)
}
export function startUncommittedReview(workspaceId: string, opts?: RequestOptions): Promise<{ task: Api.TaskDto }> {
  return request('/project/review/uncommitted', { workspaceId: workspaceId }, opts)
}
export function getProjectTasks(workspaceId: string, opts?: RequestOptions): Promise<{ tasks: Api.TaskDto[] }> {
  return request('/project/tasks?' + qs({ workspaceId: workspaceId }), undefined, opts)
}
export function getProjectCommits(workspaceId: string, offset?: number, limit?: number, opts?: RequestOptions): Promise<Api.ProjectCommits> {
  const query: Record<string, string | number> = { workspaceId: workspaceId }
  if (offset !== undefined) query.offset = offset
  if (limit !== undefined) query.limit = limit
  return request('/project/commits?' + qs(query), undefined, opts)
}
export function getProjectCommitDetail(workspaceId: string, commit: string, opts?: RequestOptions): Promise<Api.ProjectCommitDetail> {
  return request('/project/commit/detail?' + qs({ workspaceId: workspaceId, commit: commit }), undefined, opts)
}
export function getProjectOpenTargets(opts?: RequestOptions): Promise<{ targets: Api.OpenTarget[] }> {
  return request('/project/open-targets', undefined, opts)
}
export function openProjectDirectory(payload: { workspaceId: string; target: Api.OpenTarget }, opts?: RequestOptions): Promise<{ opened: boolean; target: Api.OpenTarget }> {
  return request('/project/open', payload, opts)
}
export function getProjectWorktrees(workspaceId: string, opts?: RequestOptions): Promise<Api.ProjectWorktrees> {
  return request('/project/worktrees?' + qs({ workspaceId: workspaceId }), undefined, opts)
}
export function getProjectWorktreeChanges(workspaceId: string, id: string, opts?: RequestOptions): Promise<Api.WorktreeChanges> {
  return request('/project/worktree/changes?' + qs({ workspaceId: workspaceId, id: id }), undefined, opts)
}
export function createProjectWorktree(workspaceId: string, id: string, opts?: RequestOptions): Promise<{ worktree: Api.RequirementWorktree; requirement: Api.RequirementSummary }> {
  return request('/project/worktree/create', { workspaceId: workspaceId, id: id }, opts)
}
export function previewWorktreeCommit(workspaceId: string, id: string, opts?: RequestOptions): Promise<{ task: Api.TaskDto }> {
  return request('/project/worktree/commit/preview', { workspaceId: workspaceId, id: id }, opts)
}
export function confirmWorktreeCommit(payload: Api.ConfirmCommitRequest, opts?: RequestOptions): Promise<Api.CommitConfirmation & { pushed: boolean; warning: string }> {
  return request('/project/worktree/commit/confirm', payload, opts)
}
export function pushWorktree(workspaceId: string, id: string, opts?: RequestOptions): Promise<Api.PushResult> {
  return request('/project/worktree/push', { workspaceId: workspaceId, id: id }, opts)
}
export function revealProjectWorktree(workspaceId: string, id: string, target?: Api.OpenTarget, opts?: RequestOptions): Promise<{ opened: boolean; path: string; target: Api.OpenTarget }> {
  const payload: Record<string, string | number> = { workspaceId: workspaceId, id: id }
  if (typeof target === 'string' && target.length > 0) payload.target = target
  return request('/project/worktree/reveal', payload, opts)
}
export function pruneProjectWorktree(workspaceId: string, id?: string, opts?: RequestOptions): Promise<{ pruned: { requirementId: string; path: string; branch: string }[] }> {
  const payload: Record<string, string | number> = { workspaceId: workspaceId }
  if (typeof id === 'string' && id.length > 0) payload.id = id
  return request('/project/worktree/prune', payload, opts)
}
export function removeProjectWorktree(workspaceId: string, id: string, opts?: RequestOptions): Promise<{ removed: boolean; pruned: boolean; branch: string; path: string; requirementId: string }> {
  return request('/project/worktree/remove', { workspaceId: workspaceId, id: id }, opts)
}
export function getDashboard(opts?: RequestOptions): Promise<Api.Dashboard> {
  return request('/dashboard', undefined, opts)
}
export function generateWeeklyReport(payload?: { days?: number }, opts?: RequestOptions): Promise<Api.WeeklyReport> {
  return request('/weekly-report', payload || {}, opts)
}
export function setRequirementWorktree(payload: Api.RequirementSelection & { enabled: boolean }, opts?: RequestOptions): Promise<{ requirement: Api.RequirementSummary; worktree: Api.RequirementWorktree }> {
  return request('/requirement/worktree', payload, opts)
}
export function removeRequirementWorktree(payload: Api.RequirementSelection, opts?: RequestOptions): Promise<{ removed: boolean; pruned: boolean; branch: string; requirement: Api.RequirementSummary; worktree: Api.RequirementWorktree }> {
  return request('/requirement/worktree/remove', payload, opts)
}
export function revealRequirementWorktree(payload: Api.RequirementSelection, opts?: RequestOptions): Promise<{ opened: boolean; path: string }> {
  return request('/requirement/worktree/reveal', payload, opts)
}
export function cancelProjectTask(payload: Api.TaskSelection, opts?: RequestOptions): Promise<{ task: Api.TaskDto }> {
  return request('/project/task/cancel', payload, opts)
}
export function retryProjectTask(payload: Api.TaskSelection, opts?: RequestOptions): Promise<{ task: Api.TaskDto }> {
  return request('/project/task/retry', payload, opts)
}
export function getReviewContent(workspaceId: string, name: string, opts?: RequestOptions): Promise<Api.ReviewDto & { content: string }> {
  return request('/project/review/content?' + qs({ workspaceId: workspaceId, name: name }), undefined, opts)
}
/** List the MCP client servers of the active DSH profile (REQ-20261029-002). */
export function getMcpServers(opts?: RequestOptions): Promise<Api.McpServers> {
  return request('/mcp', undefined, opts)
}
/**
 * Create or update one MCP server row. Saving may wait for the DSH hot reload,
 * so callers should pass a generous timeout (default request timeout applies).
 */
export function saveMcpServer(payload: Api.SaveMcpServerRequest, opts?: RequestOptions): Promise<Api.McpMutationResult> {
  return request('/mcp/save', payload, opts)
}
/** Delete a profile patch row or disable a bundle-provided MCP server. */
export function deleteMcpServer(payload: { id: string }, opts?: RequestOptions): Promise<Api.McpMutationResult> {
  return request('/mcp/delete', payload, opts)
}
/** Enable or disable one MCP server row. */
export function toggleMcpServer(payload: { id: string; enabled: boolean }, opts?: RequestOptions): Promise<Api.McpMutationResult> {
  return request('/mcp/toggle', payload, opts)
}
