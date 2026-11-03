/**
 * Session right-sidebar integration: the tab body that renders the current session's project
 * workbench, the conversation-header button that opens it, and the registration glue.
 *
 * Every DSH right-sidebar call sits behind the optional `ctx.inject(['sidebarRight',
 * 'sidebarRightTabs'], ...)` scope, so a host without the 0.2.1-rc.5 seat keeps the global
 * panel untouched (engines lower bound stays 0.2.1-rc.3).
 */
import {
  h, getFragment, getReact, useState, useEffect, useRef, useSyncExternalStore,
  t as translate, NS, SIDEBAR_TAB_ID, SIDEBAR_TAB_KIND, SIDEBAR_GUIDE_ENTRY_ID,
} from '../../runtime.js'
import type { ReactElement } from 'react'
import type {
  ClientContext, Dispose, SessionSlotProps, SidebarRightService, SidebarRightTabsService, Translate,
} from '../../runtime.js'
import type { SessionsHook } from '../../ui/session-row.js'
import { getSessionLink } from '../../core/api.js'
import {
  findSessionRow, findSessionWorkspace, findWorkspaceById, findWorkspaceByPath, isSubagentSession,
} from '../../core/session-project.js'
import {
  getAutoOpenSidebar, refreshPreferences, subscribePreferences,
} from '../../core/preferences.js'
import {
  openDevbenchSidebar, openFullWorkbench, useSessionsState, useWorkspacesState,
} from '../../core/sidebar.js'
import { Styles } from '../../ui/common.js'
import { DevbenchIcon, IconExternal, IconRefresh } from '../../ui/icons.js'
import { ProjectDevbenchPage } from './devbench.js'

interface Mapping {
  status: 'resolving' | 'ready' | 'none' | 'subagent'
  projectId: string
  title: string
  path: string
}

const RESOLVING: Mapping = { status: 'resolving', projectId: '', title: '', path: '' }
// Auto-open at most once per session per page load: remounting the header action after a
// session switch must not re-open a sidebar the user closed.
const autoOpenedSessions = new Set<string>()

function workspacesPending(snapshot: unknown): boolean {
  if (snapshot === null || snapshot === undefined) return true
  const value = snapshot as { items?: unknown; phase?: string }
  if (!Array.isArray(value.items)) return true
  return value.phase === 'pending' || value.phase === 'loading'
}

function SidebarEmptyState(props: {
  t: Translate
  title: string
  body: string
  onRetry?: () => void
}): ReactElement {
  const t = props.t
  return h('div', { className: 'devbench-sidebar-view' },
    h(Styles, null),
    h('div', { className: 'devbench-sidebar-empty devbench-empty-panel' },
      h('div', { className: 'devbench-sidebar-empty-title' }, props.title),
      h('div', { className: 'devbench-hint' }, props.body),
      h('div', { className: 'devbench-sidebar-empty-actions' },
        typeof props.onRetry === 'function'
          ? h('button', { className: 'devbench-btn', onClick: props.onRetry }, h(IconRefresh, { size: 14 }), t('panel.retry'))
          : null,
        h('button', {
          className: 'devbench-btn',
          onClick: function () { openFullWorkbench(null) },
        }, h(IconExternal, { size: 14 }), t('sidebar.openFull')))))
}

function SidebarLoadingState(props: { t: Translate }): ReactElement {
  return h('div', { className: 'devbench-sidebar-view' },
    h(Styles, null),
    h('div', { className: 'devbench-sidebar-loading' }, props.t('sidebar.loading')))
}

/**
 * Resolve the session's project: requirement link first (it can name a project the
 * workspace catalog does not own), then `WorkspaceView.sessionIds` membership, then the
 * session cwd against workspace paths. Subagent sessions and ungrouped sessions fall back
 * to an explicit empty state.
 */
function useSessionProject(
  props: SessionSlotProps,
  reloadKey: number,
): Mapping {
  const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
  const workspaces = useWorkspacesState(props.useWorkspaces)
  const sessions = useSessionsState(props.useSessions)
  const [mapping, setMapping] = useState<Mapping>(RESOLVING)
  useEffect(function () {
    let cancelled = false
    function apply(next: Mapping): void {
      if (!cancelled) setMapping(next)
    }
    function ready(workspaceId: string, title: string, path: string): void {
      apply({ status: 'ready', projectId: workspaceId, title: title, path: path })
    }
    if (sessionId === '') {
      apply({ status: 'none', projectId: '', title: '', path: '' })
      return function () { cancelled = true }
    }
    if (isSubagentSession(sessions, sessionId)) {
      apply({ status: 'subagent', projectId: '', title: '', path: '' })
      return function () { cancelled = true }
    }
    const membership = findSessionWorkspace(workspaces, sessionId)
    const row = findSessionRow(sessions, sessionId)
    const cwdMatch = row !== null && row.cwd !== ''
      ? findWorkspaceByPath(workspaces, row.cwd)
      : null
    const immediate = membership !== null ? membership : cwdMatch
    if (immediate !== null) {
      ready(immediate.workspaceId, immediate.title, immediate.path)
    } else {
      apply(RESOLVING)
      // Only wait for the session catalog while workspace membership is still unknown.
      if (workspacesPending(workspaces) || sessionsPending(sessions)) {
        return function () { cancelled = true }
      }
    }
    getSessionLink(sessionId).then(function (value) {
      if (cancelled) return
      const link = value && value.link ? value.link : null
      const linkedId = link !== null && typeof link.workspaceId === 'string' ? link.workspaceId : ''
      if (linkedId === '') {
        if (immediate === null) apply({ status: 'none', projectId: '', title: '', path: '' })
        return
      }
      if (immediate !== null && immediate.workspaceId === linkedId) return
      const linked = findWorkspaceById(workspaces, linkedId)
      if (linked !== null) {
        ready(linked.workspaceId, linked.title, linked.path)
        return
      }
      if (immediate === null && workspacesPending(workspaces)) {
        // Catalog still loading: trust the durable requirement link for now.
        ready(linkedId, link !== null && typeof link.title === 'string' ? link.title : '', '')
        return
      }
      if (immediate === null) apply({ status: 'none', projectId: '', title: '', path: '' })
    }, function () {
      if (cancelled) return
      if (immediate === null) apply({ status: 'none', projectId: '', title: '', path: '' })
    })
    return function () { cancelled = true }
  }, [sessionId, workspaces, sessions, reloadKey])
  return mapping
}

function sessionsPending(snapshot: unknown): boolean {
  if (snapshot === null || snapshot === undefined) return true
  const value = snapshot as { byId?: unknown; phase?: string }
  if (value.byId === null || value.byId === undefined || typeof value.byId !== 'object') return true
  return value.phase === 'pending' || value.phase === 'loading'
}

let sidebarBoundary: unknown = null

/**
 * Visible fallback for renderer crashes inside the embedded project pane: DSH's own slot
 * boundary would otherwise leave an empty entry (a blank sidebar) with only a console error.
 */
function getSidebarBoundary(): unknown {
  if (sidebarBoundary !== null) return sidebarBoundary
  const react: any = getReact()
  sidebarBoundary = class DevbenchSidebarBoundary extends react.Component {
    constructor(props: unknown) {
      super(props as any)
      this.state = { error: null }
    }
    static getDerivedStateFromError(error: unknown): { error: unknown } {
      return { error: error }
    }
    componentDidCatch(error: unknown): void {
      console.error('devbench: right sidebar pane crashed', error)
    }
    render(): ReactElement {
      const error: any = (this.state as any).error
      if (error) {
        const t: Translate = (this.props as any).t || translate
        const detail = error && typeof error.message === 'string' && error.message !== '' ? String(error.message) : String(error)
        return h('div', { className: 'devbench-sidebar-view' },
          h(Styles, null),
          h('div', { className: 'devbench-sidebar-empty devbench-empty-panel' },
            h('div', { className: 'devbench-sidebar-empty-title' }, t('sidebar.renderFailed.title')),
            h('div', { className: 'devbench-hint' }, t('sidebar.renderFailed.body')),
            detail !== '' ? h('div', { className: 'devbench-hint devbench-mono' }, detail) : null))
      }
      return (this.props as any).children
    }
  }
  return sidebarBoundary
}

/** Body registered under `sidebar.right.pane.tab` with `key = SIDEBAR_TAB_ID`. */
export function DevbenchSidebarView(props: SessionSlotProps): ReactElement {
  const t = props.t || translate
  const [reloadKey, setReloadKey] = useState(0)
  const mapping = useSessionProject(props, reloadKey)
  function retry(): void { setReloadKey(function (value) { return value + 1 }) }
  if (mapping.status === 'resolving') return h(SidebarLoadingState, { t: t })
  if (mapping.status === 'subagent') {
    return h(SidebarEmptyState, {
      t: t,
      title: t('sidebar.empty.subagent.title'),
      body: t('sidebar.empty.subagent.body'),
    })
  }
  if (mapping.status === 'none') {
    return h(SidebarEmptyState, {
      t: t,
      title: t('sidebar.empty.none.title'),
      body: t('sidebar.empty.none.body'),
      onRetry: retry,
    })
  }
  const Boundary: any = getSidebarBoundary()
  return h('div', { className: 'devbench-sidebar-view' },
    h(Boundary, { t: t },
      h(ProjectDevbenchPage, {
        t: t,
        useSessions: props.useSessions as unknown as SessionsHook | undefined,
        embedded: true,
        projectId: mapping.projectId,
        projectTitle: mapping.title,
        projectPath: mapping.path,
      })))
}

/** Tab chip title registration (keeps the fixed open-time title localized). */
export function DevbenchSidebarTitle(props: { t?: Translate }): ReactElement {
  const t = props.t || translate
  return h('span', null, t('sidebar.tab.title'))
}

/**
 * Conversation-header button. It also drives the optional auto-open preference: once the
 * session's project is known and the preference is on, it opens the tab for this session
 * exactly once (retrying briefly while DSH mints the session surface).
 */
export function DevbenchSidebarAction(props: SessionSlotProps): ReactElement {
  const t = props.t || translate
  const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
  const workspaces = useWorkspacesState(props.useWorkspaces)
  const autoOpen = useSyncExternalStore(subscribePreferences, getAutoOpenSidebar, getAutoOpenSidebar)
  const membership = findSessionWorkspace(workspaces, sessionId)
  const projectId = membership !== null ? membership.workspaceId : ''
  const autoAttemptRef = useRef('')
  useEffect(function () {
    if (autoOpen !== true || sessionId === '' || projectId === '') return function () {}
    if (autoAttemptRef.current === sessionId || autoOpenedSessions.has(sessionId)) return function () {}
    autoAttemptRef.current = sessionId
    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    function attempt(): void {
      if (cancelled) return
      if (openDevbenchSidebar(sessionId)) {
        autoOpenedSessions.add(sessionId)
        return
      }
      attempts += 1
      if (attempts > 6) return
      timer = setTimeout(attempt, 150)
    }
    attempt()
    return function () {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [autoOpen, sessionId, projectId])
  const label = t('sidebar.open')
  return h(getFragment(), null,
    h(Styles, null),
    h('button', {
      className: 'devbench-btn devbench-sidebar-trigger',
      title: label,
      'aria-label': label,
      disabled: sessionId === '',
      onClick: function () { openDevbenchSidebar(sessionId) },
    },
    h(DevbenchIcon, { size: 14 }),
    h('span', { className: 'devbench-sidebar-trigger-label' }, t('sidebar.open.short'))))
}

function disposeFiber(fiber: unknown): void {
  try {
    if (typeof fiber === 'function') (fiber as Dispose)()
    else if (fiber !== null && typeof fiber === 'object' &&
      typeof (fiber as { dispose?: Dispose }).dispose === 'function') {
      (fiber as { dispose: Dispose }).dispose()
    }
  } catch (err) {
    // Plugin teardown must never throw into the host loader.
  }
}

function registerInScope(scope: ClientContext): Dispose {
  const tabs: SidebarRightTabsService | undefined = scope.sidebarRightTabs
  const right: SidebarRightService | undefined = scope.sidebarRight
  if (!tabs || typeof tabs.register !== 'function' || !right || typeof right.openTab !== 'function') {
    return function () {}
  }
  const disposers: Dispose[] = []
  function trackInject(name: string, callback: () => Dispose): void {
    // `slots.inject` returns a disposer in DSH 0.2.1-rc.5; tolerate hosts that return void.
    const result = scope.slots.inject(name, callback) as unknown
    disposers.push(typeof result === 'function' ? result as Dispose : function () {})
  }
  function release(): void {
    const pending = disposers.splice(0, disposers.length).reverse()
    for (const dispose of pending) {
      try { dispose() } catch (err) { /* keep releasing */ }
    }
  }
  try {
    disposers.push(tabs.register({
      id: SIDEBAR_TAB_ID,
      kind: SIDEBAR_TAB_KIND,
      title: function () { return translate('sidebar.tab.title') },
      guide: [{
        id: SIDEBAR_GUIDE_ENTRY_ID,
        order: 40,
        title: function () { return translate('sidebar.guide.title') },
        description: function () { return translate('sidebar.guide.description') },
        icon: DevbenchIcon,
      }],
    }))
    trackInject('sidebar.right.pane.tab', function () {
      return scope.slots.register({
        name: 'sidebar.right.pane.tab',
        key: SIDEBAR_TAB_ID,
        locale: NS,
        inject: function (sessionId: string) { return { sessionId: sessionId } },
      }, DevbenchSidebarView)
    })
    trackInject('sidebar.right.pane.tab.title', function () {
      return scope.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: SIDEBAR_TAB_ID,
        locale: NS,
      }, DevbenchSidebarTitle)
    })
    trackInject('conversation.session.header.actions', function () {
      return scope.slots.register({
        name: 'conversation.session.header.actions',
        id: 'devbench-sidebar',
        order: 30,
        locale: NS,
        inject: function (sessionId: string) { return { sessionId: sessionId } },
      }, DevbenchSidebarAction)
    })
  } catch (err) {
    console.error('devbench: right sidebar registration failed', err)
    release()
    return function () {}
  }
  return release
}

/**
 * Optional right-sidebar wiring. Missing services (older DSH) leave the callback unrun, so
 * the plugin keeps only its existing global panel and never fails to apply.
 */
export function registerSidebarRight(ctx: ClientContext): Dispose {
  if (typeof ctx.inject !== 'function') return function () {}
  let fiber: unknown = null
  try {
    fiber = ctx.inject(['sidebarRight', 'sidebarRightTabs'], function (scope) {
      refreshPreferences().catch(function () {})
      return registerInScope(scope)
    })
  } catch (err) {
    console.error('devbench: right sidebar unavailable', err)
    return function () {}
  }
  return function () { disposeFiber(fiber) }
}
