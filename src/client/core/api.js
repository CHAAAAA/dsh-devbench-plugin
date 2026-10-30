/** JSON API client. Adds the plugin header, normalizes errors, and enforces a timeout. */
import { t } from '../runtime.js'
import { API_BASE, REQUEST_HEADER } from '../../shared/protocol.js'
/** Re-exported for tests and components that only need the endpoint. */
export const API = API_BASE
export const REQ_HEADER = REQUEST_HEADER
export class ApiError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'ApiError'
    this.code = code || 'unknown'
    this.status = status || 0
  }
}
function abortError() {
  const err = new Error('aborted')
  err.name = 'AbortError'
  return err
}
export async function request(path, body, options) {
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
  const headers = {}
  headers[REQ_HEADER] = '1'
  const init = { method: body === undefined ? 'GET' : 'POST', headers: headers, signal: controller.signal }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  try {
    const response = await fetch(API + path, init)
    let data = null
    try { data = await response.json() } catch {}
    if (!data || data.ok !== true) {
      const info = data && data.error ? data.error : null
      throw new ApiError(
        info && info.message ? info.message : t('panel.error') + ' HTTP ' + response.status,
        info && info.code ? info.code : 'http',
        response.status,
      )
    }
    return data.value
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
function qs(values) {
  return Object.keys(values).map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(values[key])
  }).join('&')
}
export function getState(opts) { return request('/state', undefined, opts) }
export function getRequirement(sel, opts) {
  return request('/requirement/get', sel, opts)
}
/** Workspace-wide title/full-text requirement search (REQ-20261028-001). */
export function searchRequirements(workspaceId, query, scope, opts) {
  const values = { workspaceId: workspaceId, q: query }
  if (typeof scope === 'string' && scope !== '') values.scope = scope
  return request('/requirement/search?' + qs(values), undefined, opts)
}
export function createRequirement(payload, opts) {
  return request('/requirement/create', payload, opts)
}
export function saveRequirement(payload, opts) {
  return request('/requirement/save', payload, opts)
}
export function executeRequirement(payload, opts) {
  return request('/requirement/execute', payload, opts)
}
export function deleteRequirement(payload, opts) {
  return request('/requirement/delete', payload, opts)
}
export function linkSession(payload, opts) {
  return request('/requirement/link-session', payload, opts)
}
export function unlinkSession(payload, opts) {
  return request('/requirement/unlink-session', payload, opts)
}
export function recordRequirementTask(payload, opts) {
  return request('/requirement/execute/task', payload, opts)
}
export function getSessionLink(sessionId, opts) {
  return request('/session-link?' + qs({ sessionId: sessionId }), undefined, opts)
}
export function linkRequirementCommit(payload, opts) {
  return request('/requirement/link-commit', payload, opts)
}
export function unlinkRequirementCommit(payload, opts) {
  return request('/requirement/unlink-commit', payload, opts)
}
export function listFiles(sel, path, opts) {
  const query = { workspaceId: sel.workspaceId, id: sel.id }
  if (path !== undefined && path !== null) query.path = path
  return request('/files?' + qs(query), undefined, opts)
}
export function writeFile(payload, opts) {
  return request('/files/write', payload, opts)
}
export function createFile(payload, opts) {
  return request('/files/create', payload, opts)
}
export function deleteFile(payload, opts) {
  return request('/files/delete', payload, opts)
}
export function openFile(payload, opts) {
  return request('/files/open', payload, opts)
}
export function gitStatus(opts) { return request('/git/status', undefined, opts) }
export function gitLog(sel, opts) {
  return request('/git/log?' + qs({ workspaceId: sel.workspaceId, id: sel.id }), undefined, opts)
}
export function gitInit(opts) { return request('/git/init', {}, opts) }
export function gitCommit(message, opts) {
  return request('/git/commit', { message: message }, opts)
}
export function openRoot(opts) { return request('/root/open', {}, opts) }
export function saveConfig(payload, opts) {
  return request('/config', payload, opts)
}
export function getProjectOverview(workspaceId, opts) {
  return request('/project/overview?' + qs({ workspaceId: workspaceId }), undefined, opts)
}
export function addProject(payload, opts) {
  return request('/project/add', payload, opts)
}
export function initProjectGit(workspaceId, opts) {
  return request('/project/git/init', { workspaceId: workspaceId }, opts)
}
export function previewProjectCommit(workspaceId, opts) {
  return request('/project/commit/preview', { workspaceId: workspaceId }, opts)
}
export function confirmProjectCommit(payload, opts) {
  return request('/project/commit/confirm', payload, opts)
}
export function getProjectChanges(workspaceId, opts) {
  return request('/project/changes?' + qs({ workspaceId: workspaceId }), undefined, opts)
}
export function manualProjectCommit(payload, opts) {
  return request('/project/commit/manual', payload, opts)
}
export function pullProject(workspaceId, opts) {
  return request('/project/pull', { workspaceId: workspaceId }, opts)
}
export function pushProject(workspaceId, opts) {
  return request('/project/push', { workspaceId: workspaceId }, opts)
}
export function startProjectReview(payload, opts) {
  return request('/project/review/start', payload, opts)
}
export function startUncommittedReview(workspaceId, opts) {
  return request('/project/review/uncommitted', { workspaceId: workspaceId }, opts)
}
export function getProjectTasks(workspaceId, opts) {
  return request('/project/tasks?' + qs({ workspaceId: workspaceId }), undefined, opts)
}
export function getProjectCommits(workspaceId, offset, limit, opts) {
  const query = { workspaceId: workspaceId }
  if (offset !== undefined) query.offset = offset
  if (limit !== undefined) query.limit = limit
  return request('/project/commits?' + qs(query), undefined, opts)
}
export function getProjectCommitDetail(workspaceId, commit, opts) {
  return request('/project/commit/detail?' + qs({ workspaceId: workspaceId, commit: commit }), undefined, opts)
}
export function getProjectOpenTargets(opts) {
  return request('/project/open-targets', undefined, opts)
}
export function openProjectDirectory(payload, opts) {
  return request('/project/open', payload, opts)
}
export function getProjectWorktrees(workspaceId, opts) {
  return request('/project/worktrees?' + qs({ workspaceId: workspaceId }), undefined, opts)
}
export function getProjectWorktreeChanges(workspaceId, id, opts) {
  return request('/project/worktree/changes?' + qs({ workspaceId: workspaceId, id: id }), undefined, opts)
}
export function createProjectWorktree(workspaceId, id, opts) {
  return request('/project/worktree/create', { workspaceId: workspaceId, id: id }, opts)
}
export function previewWorktreeCommit(workspaceId, id, opts) {
  return request('/project/worktree/commit/preview', { workspaceId: workspaceId, id: id }, opts)
}
export function confirmWorktreeCommit(payload, opts) {
  return request('/project/worktree/commit/confirm', payload, opts)
}
export function pushWorktree(workspaceId, id, opts) {
  return request('/project/worktree/push', { workspaceId: workspaceId, id: id }, opts)
}
export function revealProjectWorktree(workspaceId, id, target, opts) {
  const payload = { workspaceId: workspaceId, id: id }
  if (typeof target === 'string' && target.length > 0) payload.target = target
  return request('/project/worktree/reveal', payload, opts)
}
export function pruneProjectWorktree(workspaceId, id, opts) {
  const payload = { workspaceId: workspaceId }
  if (typeof id === 'string' && id.length > 0) payload.id = id
  return request('/project/worktree/prune', payload, opts)
}
export function removeProjectWorktree(workspaceId, id, opts) {
  return request('/project/worktree/remove', { workspaceId: workspaceId, id: id }, opts)
}
export function getDashboard(opts) {
  return request('/dashboard', undefined, opts)
}
export function generateWeeklyReport(payload, opts) {
  return request('/weekly-report', payload || {}, opts)
}
export function setRequirementWorktree(payload, opts) {
  return request('/requirement/worktree', payload, opts)
}
export function removeRequirementWorktree(payload, opts) {
  return request('/requirement/worktree/remove', payload, opts)
}
export function revealRequirementWorktree(payload, opts) {
  return request('/requirement/worktree/reveal', payload, opts)
}
export function cancelProjectTask(payload, opts) {
  return request('/project/task/cancel', payload, opts)
}
export function retryProjectTask(payload, opts) {
  return request('/project/task/retry', payload, opts)
}
export function getReviewContent(workspaceId, name, opts) {
  return request('/project/review/content?' + qs({ workspaceId: workspaceId, name: name }), undefined, opts)
}
/** List the MCP client servers of the active DSH profile (REQ-20261029-002). */
export function getMcpServers(opts) {
  return request('/mcp', undefined, opts)
}
/**
 * Create or update one MCP server row. Saving may wait for the DSH hot reload,
 * so callers should pass a generous timeout (default request timeout applies).
 */
export function saveMcpServer(payload, opts) {
  return request('/mcp/save', payload, opts)
}
/** Delete a profile patch row or disable a bundle-provided MCP server. */
export function deleteMcpServer(payload, opts) {
  return request('/mcp/delete', payload, opts)
}
/** Enable or disable one MCP server row. */
export function toggleMcpServer(payload, opts) {
  return request('/mcp/toggle', payload, opts)
}
