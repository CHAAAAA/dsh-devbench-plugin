/** Central React binding. Only the DSH loader calls require("react"). */
let ReactLib = null
let hBound = null
let runtimeCtx = null
let boundT = null
export const NS = 'devbench'
export const PANEL_ID = 'devbench'
export function initRuntime(require) {
  ReactLib = require('react')
  if (!ReactLib || !ReactLib.createElement) throw new Error('react unavailable')
  hBound = ReactLib.createElement
}
export function h() {
  if (!hBound) throw new Error('runtime not initialized')
  return hBound.apply(null, arguments)
}
export function setRuntimeContext(ctx) {
  runtimeCtx = ctx
  boundT = ctx && ctx.locale ? ctx.locale.bind(NS) : null
}
export function getRuntimeContext() { return runtimeCtx }
export function t(key, params) {
  if (!boundT) return key
  return params === undefined ? boundT(key) : boundT(key, params)
}
export function useState(v) { return ReactLib.useState(v) }
export function useEffect(fn, deps) { return ReactLib.useEffect(fn, deps) }
export function useRef(v) { return ReactLib.useRef(v) }
export function useCallback(fn, deps) { return ReactLib.useCallback(fn, deps) }
export function useSyncExternalStore(sub, snap, server) {
  return ReactLib.useSyncExternalStore(sub, snap, server)
}
export function isAbortError(err) {
  return Boolean(err && (err.name === 'AbortError' || err.code === 'aborted'))
}
export function errorText(err) {
  if (!err) return ''
  if (isAbortError(err)) return ''
  if (err.name === 'TimeoutError') return t('common.offline')
  if (err instanceof TypeError) return t('common.offline')
  return err.message || String(err)
}
export function getReact() { return ReactLib }
export function getFragment() { return ReactLib.Fragment }
