/**
 * Client helpers over the optional DSH right-sidebar services.
 *
 * `ctx.get('sidebarRight')` / `ctx.get('sidebarRightTabs')` let the plugin feature-detect
 * the 0.2.1-rc.5 right sidebar while older hosts (engines >= 0.2.1-rc.3) simply never expose
 * it: DevBench then keeps its existing global panel and skips these helpers.
 */
import {
  getRuntimeContext, PANEL_ID, SIDEBAR_TAB_KIND, useSyncExternalStore,
} from '../runtime.js'
import type {
  SessionSlotProps, SessionsSnapshot, SidebarRightService, SnapshotStore, WorkspacesSnapshot,
} from '../runtime.js'
import { uiStore } from './ui-store.js'

function readService(ctx: ReturnType<typeof getRuntimeContext>, name: string): unknown {
  if (!ctx || typeof ctx.get !== 'function') return null
  try {
    return ctx.get(name)
  } catch (err) {
    return null
  }
}

/** The right-sidebar navigation controller, or null when the host lacks the seat. */
export function getSidebarRightService(): SidebarRightService | null {
  const service = readService(getRuntimeContext(), 'sidebarRight')
  if (service === null || typeof service !== 'object') return null
  const candidate = service as Partial<SidebarRightService>
  if (typeof candidate.openTab !== 'function') return null
  if (!candidate.mounted || typeof candidate.mounted.getSnapshot !== 'function') return null
  return candidate as SidebarRightService
}

export function isSidebarRightAvailable(): boolean {
  return getSidebarRightService() !== null
}

/**
 * Open (and so expand) the DevBench tab for the on-screen session. Refuses stale callers:
 * the service always acts on the mounted session, so `mounted === sessionId` is required.
 */
export function openDevbenchSidebar(sessionId: string): boolean {
  const service = getSidebarRightService()
  if (service === null || typeof sessionId !== 'string' || sessionId === '') return false
  const mounted = service.mounted.getSnapshot()
  if (mounted !== sessionId) return false
  try {
    service.openTab(SIDEBAR_TAB_KIND)
    return true
  } catch (err) {
    return false
  }
}

/** Leave the conversation and open the global DevBench panel on a project/tab. */
export function openFullWorkbench(projectId?: string | null, activeTab?: string): void {
  const patch: Record<string, unknown> = { view: 'project', selectedRequirement: null }
  if (typeof projectId === 'string' && projectId !== '') patch.selectedProjectId = projectId
  if (typeof activeTab === 'string' && activeTab !== '') patch.activeTab = activeTab
  uiStore.set(patch)
  const ctx = getRuntimeContext()
  if (ctx && ctx.layout && typeof ctx.layout.selectPanel === 'function') {
    ctx.layout.selectPanel(PANEL_ID)
  }
}

/**
 * Workspace/session catalog access for the right-sidebar slots. The standard slot props
 * (`useWorkspaces`/`useSessions`) are preferred; the injected controller stores are the
 * fallback so the header action and tab body keep working if a seat omits the prop.
 */
export function getWorkspacesStore(): SnapshotStore<WorkspacesSnapshot> | null {
  const service = readService(getRuntimeContext(), 'workspaces') as
    { list?: SnapshotStore<WorkspacesSnapshot> } | null
  const list = service !== null && typeof service === 'object' ? service.list : null
  if (!list || typeof list.getSnapshot !== 'function' || typeof list.subscribe !== 'function') return null
  return list
}

export function getSessionsStore(): SnapshotStore<SessionsSnapshot> | null {
  const service = readService(getRuntimeContext(), 'sessions') as
    { list?: SnapshotStore<SessionsSnapshot> } | null
  const list = service !== null && typeof service === 'object' ? service.list : null
  if (!list || typeof list.getSnapshot !== 'function' || typeof list.subscribe !== 'function') return null
  return list
}

/**
 * DSH materializes standard hook props as uSES selectors, so they MUST receive a
 * selector: calling them without one throws `selector is not a function` and the
 * slot error boundary would render an empty entry (a blank sidebar body).
 */
function identityWorkspaces(state: WorkspacesSnapshot): WorkspacesSnapshot { return state }
function identitySessions(state: SessionsSnapshot): SessionsSnapshot { return state }

export function useWorkspacesState(
  propHook: SessionSlotProps['useWorkspaces'],
): WorkspacesSnapshot | null {
  if (typeof propHook === 'function') return propHook(identityWorkspaces)
  const store = getWorkspacesStore()
  if (store === null) return null
  // Wrap so method-based stores keep their receiver even when read detached.
  return useSyncExternalStore(
    function (listener) { return store.subscribe(listener) },
    function () { return store.getSnapshot() },
    function () { return store.getSnapshot() },
  )
}

export function useSessionsState(
  propHook: SessionSlotProps['useSessions'],
): SessionsSnapshot | null {
  if (typeof propHook === 'function') return propHook(identitySessions)
  const store = getSessionsStore()
  if (store === null) return null
  return useSyncExternalStore(
    function (listener) { return store.subscribe(listener) },
    function () { return store.getSnapshot() },
    function () { return store.getSnapshot() },
  )
}
