/** Conversation header actions: resolve the session's requirement, open the panel, or organize the session into a requirement. */
import { h, getFragment, useState, useEffect, isAbortError, t as translate } from '../../runtime.js'
import type { ReactElement } from 'react'
import type { Translate } from '../../runtime.js'
import type { RequirementLink, StateDto } from '../../../shared/api-types.js'
import { getSessionLink, getState, organizeRequirement } from '../../core/api.js'
import { uiStore } from '../../core/ui-store.js'
import { getRuntimeContext } from '../../runtime.js'
import { PANEL_ID } from '../../runtime.js'
import { Styles, Modal, Banner } from '../../ui/common.js'
import { IconLink, IconReq } from '../../ui/icons.js'

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

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message
  }
  return String(err || '')
}

export function SessionRequirementAction(props: { t?: Translate; linkedSessionId?: string; sessionId?: string }): ReactElement {
  const t = props.t || translate
  const sessionId = props.linkedSessionId || props.sessionId
  const [state, setState] = useState<{ status: string; link: RequirementLink | null; error: string }>({ status: 'loading', link: null, error: '' })
  const [reloadKey, setReloadKey] = useState(0)
  const [organize, setOrganize] = useState<OrganizeState>(CLOSED_ORGANIZE)
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
  function open() {
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
  function openOrganize() {
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
  let label = t('session.action.link')
  if (state.status === 'loading') label = t('panel.loading')
  else if (state.status === 'error') label = t('panel.retry')
  else if (state.link) label = t('session.action.open') + ': ' + state.link.title
  const hint = state.status === 'error'
    ? t('session.action.error', { message: state.error })
    : label
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
    h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
      h('button', {
        className: 'devbench-btn',
        title: hint,
        'aria-label': hint,
        'aria-busy': state.status === 'loading' ? 'true' : undefined,
        disabled: state.status === 'loading',
        onClick: open,
        style: { maxWidth: '240px', overflow: 'hidden' },
      },
      state.link ? h(IconReq, { size: 14 }) : h(IconLink, { size: 14 }),
      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label)),
      h('button', {
        className: 'devbench-btn',
        title: t('session.organize.body'),
        'aria-label': t('session.organize'),
        disabled: !sessionId || organize.open,
        onClick: openOrganize,
      }, h(IconReq, { size: 14 }), h('span', null, t('session.organize')))),
    modalElement)
}
