/** Central React binding. Only the DSH loader calls require("react"). */
let ReactLib: any = null
let hBound: any = null
let runtimeCtx: any = null
let boundT: any = null
export const NS = 'devbench'
export const PANEL_ID = 'devbench'
export function initRuntime(require: (id: string) => any): void {
  ReactLib = require('react')
  if (!ReactLib || !ReactLib.createElement) throw new Error('react unavailable')
  hBound = ReactLib.createElement
}
export function h(...args: any[]): any {
  if (!hBound) throw new Error('runtime not initialized')
  return hBound.apply(null, args)
}
export function setRuntimeContext(ctx: any): void {
  runtimeCtx = ctx
  boundT = ctx && ctx.locale ? ctx.locale.bind(NS) : null
}
export function getRuntimeContext(): any { return runtimeCtx }
export function t(key: string, params?: any): any {
  if (!boundT) return key
  return params === undefined ? boundT(key) : boundT(key, params)
}
export function useState(...args: any[]): any { return ReactLib.useState(...args) }
export function useEffect(...args: any[]): any { return ReactLib.useEffect(...args) }
export function useRef(...args: any[]): any { return ReactLib.useRef(...args) }
export function useCallback(...args: any[]): any { return ReactLib.useCallback(...args) }
export function useSyncExternalStore(...args: any[]): any {
  return ReactLib.useSyncExternalStore(...args)
}
export function isAbortError(err: any): boolean {
  return Boolean(err && (err.name === 'AbortError' || err.code === 'aborted'))
}
export function errorText(err: any): string {
  if (!err) return ''
  if (isAbortError(err)) return ''
  if (err.name === 'TimeoutError') return t('common.offline')
  if (err instanceof TypeError) return t('common.offline')
  return err.message || String(err)
}
export function getReact(): any { return ReactLib }
export function getFragment(): any { return ReactLib.Fragment }
