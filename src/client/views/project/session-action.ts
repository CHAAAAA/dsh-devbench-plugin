/** Conversation header action. Resolves session to requirement and opens the panel. */
import { h, getFragment, useState, useEffect, isAbortError, t as translate } from '../../runtime.js'
import { getSessionLink } from '../../core/api.js'
import { uiStore } from '../../core/ui-store.js'
import { getRuntimeContext } from '../../runtime.js'
import { PANEL_ID } from '../../runtime.js'
import { Styles } from '../../ui/common.js'
import { IconLink, IconReq } from '../../ui/icons.js'
export function SessionRequirementAction(props) {
  const t = props.t || translate
  const sessionId = props.linkedSessionId || props.sessionId
  const [state, setState] = useState({ status: 'loading', link: null, error: '' })
  const [reloadKey, setReloadKey] = useState(0)
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
      const storeState: Record<string, any> = uiStore.state
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
  let label = t('session.action.link')
  if (state.status === 'loading') label = t('panel.loading')
  else if (state.status === 'error') label = t('panel.retry')
  else if (state.link) label = t('session.action.open') + ': ' + state.link.title
  const hint = state.status === 'error'
    ? t('session.action.error', { message: state.error })
    : label
  return h(getFragment(), null,
    h(Styles, null),
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
    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label)))
}

