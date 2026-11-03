/** Central React binding. Only the DSH loader calls require("react"). */
import type * as React from 'react'

export type Translate = (key: string, params?: Record<string, string | number>) => string
type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export type Dispose = () => void

/** Host observable exposed to client plugins (`subscribe` + `getSnapshot`). */
export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** DSH workspace registry projection (`ctx.workspaces.list`, see dsh-api-workspace-controller). */
export interface WorkspaceRef {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
}
export interface WorkspacesSnapshot {
  items: WorkspaceRef[]
  phase?: string
}
/** DSH session catalog row; subagent rows carry `parentId`/`origin`. */
export interface SessionRow {
  id: string
  displayTitle?: string
  title?: string
  cwd?: string
  parentId?: string
  origin?: string
}
export interface SessionsSnapshot {
  ids: string[]
  byId: Record<string, SessionRow>
  phase?: string
}

/** Values the right-sidebar tab body reads through the seat-injected `useTabInfo()` hook. */
export interface SidebarTabInfo {
  sidebar: { expanded: boolean; fullscreen: boolean }
  panel: { id: string }
  tab: {
    id: string
    kind: string
    contentId?: string
    title: string
    visible?: boolean
    navigation?: { address?: string; params?: unknown; revision?: number }
    signal?: AbortSignal
  }
}
export type UseTabInfo = () => SidebarTabInfo

export interface SidebarGuideEntry {
  id: string
  order?: number
  title: () => string
  description?: () => string
  icon?: React.ComponentType<{ size?: number; className?: string }>
  commandId?: string
}
/** `ctx.sidebarRightTabs.register` argument (page type: no `patterns`). */
export interface SidebarTabDefinition {
  id: string
  kind: string
  priority?: 'extension' | 'builtin' | 'fallback'
  patterns?: string[]
  canOpen?: (address: string) => boolean
  title: (address?: string) => string
  guide?: SidebarGuideEntry[]
  keepMounted?: boolean
  multiple?: boolean
}
export interface SidebarRightTabsService {
  register(definition: SidebarTabDefinition): Dispose
}
export interface SidebarRightOpenOptions {
  paneId?: string
  preferNewPane?: boolean
  replaceTab?: string
  revealIfOpened?: boolean
  params?: unknown
}
export interface SidebarRightService {
  openTab(kind: string, options?: SidebarRightOpenOptions): void
  close(tabId: string): void
  isExpanded(): boolean
  mounted: SnapshotStore<string | undefined>
}
/** Cordis `ctx.inject(deps, callback)` return value. */
export type InjectFiber = { dispose?: Dispose } | Dispose | void

/**
 * Standard props a session-scoped slot entry receives (only the ones DevBench uses;
 * see @deepseek-ai/dsh-client-ui-renderer README for the full list).
 */
export interface SessionSlotProps {
  sessionId?: string
  t?: Translate
  // DSH binds these as uSES selectors, so the selector argument is required.
  useSessions?: <S>(selector: (state: SessionsSnapshot) => S) => S
  useWorkspaces?: <S>(selector: (state: WorkspacesSnapshot) => S) => S
  useTabInfo?: UseTabInfo
}

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
    // DSH's client Session controller resolves the created session id directly;
    // only the `ctx.remote.*` RPC namespace uses the { ok, value } envelope.
    create(options: { workspaceId: string } | { cwd: string }): Promise<string>
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
  // Optional Cordis surface: present in DSH >= 0.2.1-rc.5. Plugins feature-detect
  // with `ctx.get(name)` / `ctx.inject(deps, cb)` so older hosts keep loading.
  get?(name: string): unknown
  inject?(deps: string[], callback: (scope: ClientContext) => Dispose | void): InjectFiber
  sidebarRight?: SidebarRightService
  sidebarRightTabs?: SidebarRightTabsService
}

let ReactLib: typeof React | null = null
let runtimeCtx: ClientContext | null = null
let boundT: Translate | null = null
export const NS = 'devbench'
export const PANEL_ID = 'devbench'
/** Right-sidebar tab type identity: also the key its body/title register under. */
export const SIDEBAR_TAB_ID = 'dsh-devbench-plugin'
export const SIDEBAR_TAB_KIND = 'devbench-project'
export const SIDEBAR_GUIDE_ENTRY_ID = 'project'
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
