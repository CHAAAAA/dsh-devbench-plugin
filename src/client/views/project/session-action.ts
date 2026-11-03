/**
 * Conversation header actions: one split button. The main button opens the session's
 * requirement (or the link picker); the caret opens a menu with "organize as requirement"
 * (REQ-20261103-002 merged three header buttons into this dropdown).
 */
import {
  h, getFragment, useState, useEffect, useRef, useSyncExternalStore,
  isAbortError, t as translate,
} from '../../runtime.js'
import type { ReactElement } from 'react'
import type { SessionSlotProps } from '../../runtime.js'
import type { RequirementLink, StateDto } from '../../../shared/api-types.js'
import { getSessionLink, getState, organizeRequirement } from '../../core/api.js'
import { findSessionWorkspace } from '../../core/session-project.js'
import { getAutoOpenSidebar, subscribePreferences } from '../../core/preferences.js'
import {
  isSidebarRightAvailable, openDevbenchSidebar, openFullWorkbench, useWorkspacesState,
} from '../../core/sidebar.js'
import { uiStore } from '../../core/ui-store.js'
import { getRuntimeContext, PANEL_ID } from '../../runtime.js'
import { Styles, Modal, Banner } from '../../ui/common.js'
import { IconCaret, IconDevbench, IconLink, IconRefresh, IconReq } from '../../ui/icons.js'

type OrganizeState = {
  open: boolean
  loading: boolean
  loaded: boolean
  configured: boolean
  workspaces: StateDto['workspaces']
  workspaceId: string
  titleHint: string
  busy: boolean
  error: string
  sent: boolean
}

const CLOSED_ORGANIZE: OrganizeState = {
  open: false,
  loading: false,
  loaded: false,
  configured: true,
  workspaces: [],
  workspaceId: '',
  titleHint: '',
  busy: false,
  error: '',
  sent: false,
}

// Auto-open at most once per session per page load: remounting the header action after a
// session switch must not re-open a sidebar the user closed.
const autoOpenedSessions = new Set<string>()
// Stable id for `aria-controls`; the menu itself only exists while it is open.
let menuSequence = 0

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message
  }
  return String(err || '')
}

export function SessionRequirementAction(props: SessionSlotProps & { linkedSessionId?: string }): ReactElement {
  const t = props.t || translate
  const sessionId = props.linkedSessionId || props.sessionId || ''
  const [state, setState] = useState<{ status: string; link: RequirementLink | null; error: string }>({ status: 'loading', link: null, error: '' })
  const [reloadKey, setReloadKey] = useState(0)
  const [organize, setOrganize] = useState<OrganizeState>(CLOSED_ORGANIZE)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const menuIdRef = useRef('')
  if (menuIdRef.current === '') menuIdRef.current = 'devbench-actions-menu-' + (++menuSequence)
  const autoAttemptRef = useRef('')
  const workspaces = useWorkspacesState(props.useWorkspaces)
  const autoOpen = useSyncExternalStore(subscribePreferences, getAutoOpenSidebar, getAutoOpenSidebar)
  const membership = findSessionWorkspace(workspaces, sessionId)
  const projectId = membership !== null ? membership.workspaceId : ''
  useEffect(function () {
    if (!sessionId) return
    const controller = new AbortController()
    setState({ status: 'loading', link: null, error: '' })
    getSessionLink(sessionId, { signal: controller.signal }).then(function (value) {
      setState({ status: 'ready', link: value && value.link ? value.link : null, error: '' })
    }, function (err) {
      if (isAbortError(err)) return
      setState({ status: 'error', link: null, error: err.message || String(err) })
    })
    return function () { controller.abort() }
  }, [sessionId, reloadKey])
  useEffect(function () {
    function onFocus() { setReloadKey(function (value) { return value + 1 }) }
    window.addEventListener('focus', onFocus)
    return function () { window.removeEventListener('focus', onFocus) }
  }, [sessionId])
  // Switching sessions reuses this component; a menu opened for the previous session must not
  // linger over the new one.
  useEffect(function () { setMenuOpen(false) }, [sessionId])
  // Optional auto-open preference: the menu item is the manual entry, this keeps the
  // "open the DevBench tab automatically once per session" switch working without it.
  useEffect(function () {
    if (autoOpen !== true || sessionId === '' || projectId === '') return function () {}
    if (!isSidebarRightAvailable()) return function () {}
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
  // Close the menu on outside click and Escape; the listener only lives while it is open.
  useEffect(function () {
    if (!menuOpen) return function () {}
    function onPointer(event: MouseEvent): void {
      const node = menuRef.current
      const target = event.target
      if (node !== null && target instanceof Node && node.contains(target)) return
      setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      // Return focus to the control that opened the menu so keyboard users keep their place.
      if (toggleRef.current !== null) toggleRef.current.focus()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return function () {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])
  function open(): void {
    setMenuOpen(false)
    if (state.status === 'loading') return
    if (state.status === 'error') {
      setReloadKey(function (value) { return value + 1 })
      return
    }
    if (state.link) {
      const storeState: { view: string; collapsedGroups?: Record<string, boolean>; expandedGroups?: Record<string, boolean> } = uiStore.state
      const nextCollapsed = Object.assign({}, storeState.collapsedGroups || {})
      delete nextCollapsed[state.link.workspaceId]
      const nextExpanded = Object.assign({}, storeState.expandedGroups || {})
      nextExpanded[state.link.workspaceId] = true
      uiStore.set({
        view: 'project',
        selectedProjectId: state.link.workspaceId,
        selectedRequirement: { workspaceId: state.link.workspaceId, id: state.link.id },
        activeTab: 'requirements',
        linkSessionId: null,
        collapsedGroups: nextCollapsed,
        expandedGroups: nextExpanded,
      })
    } else {
      uiStore.set({ view: 'link', selectedRequirement: null, linkSessionId: sessionId })
    }
    const ctx = getRuntimeContext()
    if (ctx && ctx.layout) ctx.layout.selectPanel(PANEL_ID)
  }
  /**
   * Right sidebar first, exactly like the old dedicated button. Only hosts without the seat
   * fall back to the full workbench: an open call that fails on a supported host (a transient
   * session-surface race) must not yank the user out of the conversation.
   */
  function openDevbench(): void {
    setMenuOpen(false)
    if (sessionId === '') return
    if (isSidebarRightAvailable()) {
      openDevbenchSidebar(sessionId)
      return
    }
    openFullWorkbench(projectId !== '' ? projectId : null)
  }
  /** Default target: the linked requirement's project, then the project open in the panel. */
  function defaultWorkspaceId(workspaces: StateDto['workspaces'], link: RequirementLink | null): string {
    if (link && workspaces.some(function (item) { return item.workspaceId === link.workspaceId })) {
      return link.workspaceId
    }
    const selected = uiStore.state.selectedProjectId
    if (typeof selected === 'string' && selected.length > 0 &&
        workspaces.some(function (item) { return item.workspaceId === selected })) {
      return selected
    }
    return workspaces.length > 0 ? workspaces[0].workspaceId : ''
  }
  function openOrganize(): void {
    setMenuOpen(false)
    if (!sessionId || organize.open) return
    setOrganize(Object.assign({}, CLOSED_ORGANIZE, { open: true, loading: true }))
    getState().then(function (value) {
      const workspaces = value && Array.isArray(value.workspaces) ? value.workspaces : []
      const configured = value ? value.configured === true : false
      const link = state.link
      setOrganize(function (prev) {
        if (!prev.open) return prev
        return Object.assign({}, prev, {
          loading: false,
          loaded: true,
          configured: configured,
          workspaces: workspaces,
          workspaceId: defaultWorkspaceId(workspaces, link),
          error: '',
        })
      })
    }, function (err) {
      setOrganize(function (prev) {
        if (!prev.open) return prev
        return Object.assign({}, prev, {
          loading: false,
          loaded: false,
          error: errorMessage(err) || t('session.organize.loadFailed'),
        })
      })
    })
  }
  function updateOrganize(patch: Partial<OrganizeState>) {
    setOrganize(function (prev) {
      return prev.open ? Object.assign({}, prev, patch) : prev
    })
  }
  function submitOrganize() {
    if (!organize.open || organize.busy || organize.sent || !sessionId) return
    const ctx = getRuntimeContext()
    if (!ctx || !ctx.remote || !ctx.remote.session || typeof ctx.remote.session.prompt !== 'function') {
      updateOrganize({ error: t('session.organize.sendFailed') })
      return
    }
    updateOrganize({ busy: true, error: '' })
    organizeRequirement({
      sessionId: sessionId,
      workspaceId: organize.workspaceId,
      titleHint: organize.titleHint.trim(),
    }).then(function (result) {
      const requestId = 'organize-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
      return ctx.remote.session.prompt({
        requestId: requestId,
        sessionId: sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: result.prompt }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }).then(function (value) {
        if (value && value.ok === false) throw new Error(value.error.message)
      })
    }).then(function () {
      updateOrganize({ busy: false, sent: true, error: '' })
    }, function (err) {
      updateOrganize({ busy: false, error: errorMessage(err) || t('session.organize.sendFailed') })
    })
  }
  function closeOrganize() {
    // Closing during a pending send is allowed; the in-flight request just keeps going
    // and its result is dropped because state updates only apply while the dialog is open.
    setOrganize(CLOSED_ORGANIZE)
  }
  const label = t('session.action.open')
  const hint = state.status === 'error'
    ? t('session.action.error', { message: state.error })
    : state.status === 'loading'
      ? t('panel.loading')
      : state.link
        ? t('session.action.open') + ': ' + state.link.title
        : t('session.action.link')
  const projectSelect = organize.workspaces.map(function (workspace) {
    return h('option', { key: workspace.workspaceId, value: workspace.workspaceId },
      workspace.title || workspace.path)
  })
  const canConfirm = organize.busy === false && organize.loading === false &&
    organize.sent === false && organize.configured === true &&
    organize.workspaces.length > 0 && organize.workspaceId !== ''
  let modalElement = null
  if (organize.open) {
    modalElement = h(Modal, {
      t: t,
      title: t('session.organize.title'),
      onClose: closeOrganize,
      onCancel: closeOrganize,
      confirmText: organize.busy ? t('session.organize.sending') : t('session.organize.confirm'),
      confirmDisabled: canConfirm === false,
      showClose: true,
      actions: organize.sent === false,
      onConfirm: submitOrganize,
    }, organize.sent
      ? h(Banner, { kind: 'info' }, t('session.organize.sent'))
      : h('div', { className: 'devbench-flexcol' },
        h('div', { className: 'devbench-hint' }, t('session.organize.body')),
        organize.loading ? h('div', { className: 'devbench-inline-loading' }, t('panel.loading')) : null,
        organize.error !== '' ? h(Banner, { kind: 'error' }, organize.error) : null,
        organize.loaded === true && organize.configured === false
          ? h(Banner, { kind: 'info' }, t('session.organize.unconfigured'))
          : null,
        organize.loaded === true && organize.configured === true && organize.workspaces.length === 0
          ? h(Banner, { kind: 'info' }, t('session.organize.noProjects'))
          : null,
        h('label', { className: 'devbench-hint' }, t('session.organize.project')),
        h('select', {
          className: 'devbench-input',
          value: organize.workspaceId,
          disabled: organize.busy || organize.loading || organize.workspaces.length === 0,
          onChange(event) { updateOrganize({ workspaceId: event.target.value }) },
        }, projectSelect),
        h('div', { className: 'devbench-hint' }, t('session.organize.projectHint')),
        h('label', { className: 'devbench-hint', style: { marginTop: '10px' } }, t('session.organize.titleHint')),
        h('input', {
          className: 'devbench-input',
          value: organize.titleHint,
          disabled: organize.busy || organize.loading,
          placeholder: t('session.organize.titleHintPlaceholder'),
          maxLength: 200,
          onChange(event) { updateOrganize({ titleHint: event.target.value }) },
        })))
  }
  return h(getFragment(), null,
    h(Styles, null),
    h('div', { className: 'devbench-actions', ref: menuRef },
      h('button', {
        className: 'devbench-btn devbench-actions-main',
        type: 'button',
        title: hint,
        // Keep the accessible name equal to the visible label; the state detail lives in title.
        'aria-label': label,
        'aria-busy': state.status === 'loading' ? 'true' : undefined,
        disabled: state.status === 'loading',
        onClick: open,
      },
      state.status === 'error'
        ? h(IconRefresh, { size: 14 })
        : state.link ? h(IconReq, { size: 14 }) : h(IconLink, { size: 14 }),
      h('span', { className: 'devbench-actions-label' }, label)),
      h('button', {
        className: 'devbench-btn devbench-actions-toggle',
        type: 'button',
        title: t('session.action.more'),
        'aria-label': t('session.action.more'),
        'aria-expanded': menuOpen ? 'true' : 'false',
        'aria-controls': menuOpen ? menuIdRef.current : undefined,
        disabled: sessionId === '',
        onClick: function () { setMenuOpen(function (value) { return !value }) },
        ref: toggleRef,
      },
      h(IconCaret, { open: menuOpen, size: 12 })),
      menuOpen
        ? h('div', { className: 'devbench-actions-menu', id: menuIdRef.current },
          h('button', {
            className: 'devbench-actions-item',
            type: 'button',
            title: t('session.organize.body'),
            disabled: sessionId === '',
            onClick: openOrganize,
          }, h(IconReq, { size: 14 }), h('span', null, t('session.organize'))),
          h('button', {
            className: 'devbench-actions-item',
            type: 'button',
            disabled: sessionId === '',
            onClick: openDevbench,
          }, h(IconDevbench, { size: 14 }), h('span', null, t('session.action.devbench'))))
        : null),
    modalElement)
}
