/** Central React binding. Only the DSH loader calls require("react"). */
import type * as React from 'react'

export type Translate = (key: string, params?: Record<string, string | number>) => string
type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
type Dispose = () => void
export interface ClientContext {
  effect(callback: () => Dispose, name: string): void
  locale: {
    bind(namespace: string): Translate
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): Dispose
  }
  slots: {
    inject(name: string, callback: () => Dispose): void
    register<P>(options: {
      name: string
      key?: string
      id?: string
      order?: number
      locale?: string
      label?: () => string
      inject?: (sessionId: string) => P
    }, component: React.ComponentType<P>): Dispose
  }
  layout: { selectPanel(panelId: string): void }
  uiWorkspace: {
    pickDirectory(): Promise<string | null>
    openSession(sessionId: string): void
  }
  sessions: {
    create(options: { workspaceId: string } | { cwd: string }): Promise<RemoteResult<{ sessionId: string }>>
  }
  remote: {
    session: {
      prompt(options: {
        requestId: string
        sessionId: string
        mode: 'queue'
        content: { type: 'text'; text: string }[]
        clientTimeZone: string
      }): Promise<RemoteResult<unknown>>
      rename(options: { sessionId: string; title: string }): Promise<RemoteResult<unknown>>
    }
  }
}

let ReactLib: typeof React | null = null
let runtimeCtx: ClientContext | null = null
let boundT: Translate | null = null
export const NS = 'devbench'
export const PANEL_ID = 'devbench'
function uninitialized(): never { throw new Error('runtime not initialized') }
export let h: typeof React.createElement = uninitialized
export let useState: typeof React.useState = uninitialized
export let useEffect: typeof React.useEffect = uninitialized
export let useRef: typeof React.useRef = uninitialized
export let useCallback: typeof React.useCallback = uninitialized
export let useSyncExternalStore: typeof React.useSyncExternalStore = uninitialized

export function initRuntime(require: (id: string) => unknown): void {
  // DSH supplies the React module; keep its official signatures at this boundary.
  const react = require('react') as typeof React | null
  if (!react || typeof react.createElement !== 'function') throw new Error('react unavailable')
  ReactLib = react
  h = react.createElement
  useState = react.useState
  useEffect = react.useEffect
  useRef = react.useRef
  useCallback = react.useCallback
  useSyncExternalStore = react.useSyncExternalStore
}
export function setRuntimeContext(ctx: ClientContext | null): void {
  runtimeCtx = ctx
  boundT = ctx && ctx.locale ? ctx.locale.bind(NS) : null
}
export function getRuntimeContext(): ClientContext | null { return runtimeCtx }
export function t(key: string, params?: Record<string, string | number>): string {
  if (!boundT) return key
  return params === undefined ? boundT(key) : boundT(key, params)
}
export function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' &&
    (('name' in err && err.name === 'AbortError') || ('code' in err && err.code === 'aborted')))
}
export function errorText(err: unknown): string {
  if (!err) return ''
  if (isAbortError(err)) return ''
  if (typeof err === 'object' && 'name' in err && err.name === 'TimeoutError') return t('common.offline')
  if (err instanceof TypeError) return t('common.offline')
  return typeof err === 'object' && 'message' in err && typeof err.message === 'string'
    ? err.message : String(err)
}
export function getReact(): typeof React {
  if (!ReactLib) return uninitialized()
  return ReactLib
}
export function getFragment(): typeof React.Fragment { return getReact().Fragment }
