/**
 * Session -> DevBench project mapping helpers.
 *
 * DSH exposes workspace membership through `useWorkspaces()` (`WorkspaceView.sessionIds`);
 * a session row itself has no workspace id. These helpers keep the mapping rules in one
 * place so the right-sidebar tab body and the conversation header action agree.
 */
import type { SessionsSnapshot, WorkspaceRef, WorkspacesSnapshot } from '../runtime.js'

/** True when the workspace list snapshot is available and populated enough to filter on. */
export function workspacesReady(workspaces: WorkspacesSnapshot | null | undefined): boolean {
  return workspaces !== null && workspaces !== undefined && Array.isArray(workspaces.items)
}

function workspaceItems(workspaces: WorkspacesSnapshot | null | undefined): WorkspaceRef[] {
  if (!Array.isArray(workspaces && workspaces.items)) return []
  return (workspaces as WorkspacesSnapshot).items.filter(function (item) {
    return item !== null && typeof item === 'object' && typeof item.workspaceId === 'string'
  })
}

/** Workspace whose `sessionIds` contains the session (top-level sessions only). */
export function findSessionWorkspace(
  workspaces: WorkspacesSnapshot | null | undefined,
  sessionId: string,
): WorkspaceRef | null {
  if (typeof sessionId !== 'string' || sessionId === '') return null
  const items = workspaceItems(workspaces)
  for (const item of items) {
    if (Array.isArray(item.sessionIds) && item.sessionIds.indexOf(sessionId) >= 0) return item
  }
  return null
}

/** Workspace by DSH workspace id (same value DevBench uses for `workspaceId`). */
export function findWorkspaceById(
  workspaces: WorkspacesSnapshot | null | undefined,
  workspaceId: string,
): WorkspaceRef | null {
  if (typeof workspaceId !== 'string' || workspaceId === '') return null
  const items = workspaceItems(workspaces)
  for (const item of items) {
    if (item.workspaceId === workspaceId) return item
  }
  return null
}

function normalizedPath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Fallback mapping: the workspace whose path contains the session's cwd. Stable
 * ordering picks the deepest match so nested workspaces win over their parent.
 */
export function findWorkspaceByPath(
  workspaces: WorkspacesSnapshot | null | undefined,
  cwd: string,
): WorkspaceRef | null {
  const target = normalizedPath(cwd)
  if (target === '' || target.charAt(0) !== '/') return null
  const items = workspaceItems(workspaces)
  let best: WorkspaceRef | null = null
  let bestLength = 0
  for (const item of items) {
    const root = normalizedPath(item.path)
    if (root === '' || root.charAt(0) !== '/') continue
    const matches = target === root || target.indexOf(root + '/') === 0
    if (matches && root.length > bestLength) {
      best = item
      bestLength = root.length
    }
  }
  return best
}

/** Session catalog row; `parentId`/`origin: 'subagent'` mark subagent sessions. */
export function findSessionRow(
  sessions: SessionsSnapshot | null | undefined,
  sessionId: string,
): { id: string; cwd: string; parentId: string; origin: string; title: string } | null {
  if (!sessions || !sessions.byId || typeof sessionId !== 'string' || sessionId === '') return null
  const row = sessions.byId[sessionId]
  if (!row || typeof row !== 'object') return null
  return {
    id: typeof row.id === 'string' ? row.id : sessionId,
    cwd: typeof row.cwd === 'string' ? row.cwd : '',
    parentId: typeof row.parentId === 'string' ? row.parentId : '',
    origin: typeof row.origin === 'string' ? row.origin : '',
    title: typeof row.displayTitle === 'string' && row.displayTitle !== ''
      ? row.displayTitle
      : (typeof row.title === 'string' ? row.title : ''),
  }
}

/** Requirement says subagent sessions are not project sessions: show a clear empty state. */
export function isSubagentSession(
  sessions: SessionsSnapshot | null | undefined,
  sessionId: string,
): boolean {
  const row = findSessionRow(sessions, sessionId)
  if (row === null) return false
  return row.parentId !== '' || row.origin === 'subagent'
}
