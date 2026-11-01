/** Linked session row plus the no-op session store used outside DSH. */
import { h, useCallback, useSyncExternalStore } from '../runtime.js'
const EMPTY = { byId: {} }
function emptySubscribe() { return function () {} }
function emptySnapshot() { return EMPTY }
export function useEmptySessions(selector) {
  const snapshot = useSyncExternalStore(emptySubscribe, emptySnapshot, emptySnapshot)
  return selector(snapshot)
}
export function useSessionSummary(useSessions, sessionId) {
  const selector = useCallback(function (snapshot) {
    return snapshot.byId[sessionId] || null
  }, [sessionId])
  return useSessions(selector)
}
export function SessionRow(props) {
  const t = props.t
  const sessionsHook = props.useSessions || useEmptySessions
  const summary = useSessionSummary(sessionsHook, props.sessionId)
  const title = summary ? (summary.title || summary.displayTitle) : props.sessionId
  return h('div', { className: 'devbench-session-row' },
    h('span', { className: 'devbench-dot ' + (summary && summary.running ? 'running' : 'done') }),
    h('span', { className: 'devbench-session-title', title: props.sessionId }, title),
    summary && summary.running ? h('span', { className: 'devbench-badge running' }, t('detail.session.running')) : null,
    h('button', { className: 'devbench-btn', disabled: props.disabled === true, onClick: props.onOpen }, t('detail.session.open')),
    h('button', {
      className: 'devbench-btn ghost danger',
      disabled: props.disabled === true,
      onClick: props.onUnlink,
    }, t('detail.session.unlink')))
}
