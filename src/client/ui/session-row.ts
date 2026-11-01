/** Linked session row plus the no-op session store used outside DSH. */
import { h, useCallback, useSyncExternalStore } from '../runtime.js'
import type { ReactElement } from 'react'
import type { Translate } from '../runtime.js'
export interface SessionSummary { title?: string; displayTitle?: string; running?: boolean }
export interface SessionsSnapshot { phase?: string; byId: Record<string, SessionSummary> }
export type SessionsHook = <T>(selector: (snapshot: SessionsSnapshot) => T) => T
const EMPTY: SessionsSnapshot = { byId: {} }
function emptySubscribe() { return function () {} }
function emptySnapshot() { return EMPTY }
export function useEmptySessions<T>(selector: (snapshot: SessionsSnapshot) => T): T {
  const snapshot = useSyncExternalStore(emptySubscribe, emptySnapshot, emptySnapshot)
  return selector(snapshot)
}
export function useSessionSummary(useSessions: SessionsHook, sessionId: string): SessionSummary | null {
  const selector = useCallback(function (snapshot: SessionsSnapshot) {
    return snapshot.byId[sessionId] || null
  }, [sessionId])
  return useSessions(selector)
}
export function SessionRow(props: {
  t: Translate; sessionId: string; useSessions?: SessionsHook; disabled?: boolean
  onOpen?: () => void; onUnlink?: () => void
}): ReactElement {
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
