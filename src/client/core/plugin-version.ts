/** Plugin self-update store: version snapshot, update check and one-click upgrade (REQ-20261101-001). */
import type { PluginUpgradeResult, PluginVersionInfo } from '../../shared/api-types.js'
import { errorText, useSyncExternalStore } from '../runtime.js'
import { checkPluginVersion, getPluginVersion, upgradePlugin } from './api.js'

export interface PluginVersionState {
  info: PluginVersionInfo | null
  /** A request is in flight (initial load, manual check or a deferred host check). */
  loading: boolean
  /** Request-level error (network, HTTP or timeout); host check errors live in `info.error`. */
  error: string
  upgrading: boolean
  upgradeResult: PluginUpgradeResult | null
}

/** The host runs the registry check in the background; poll until it settles. */
const CHECKING_RETRY_MS = 1500
const CHECKING_MAX_RETRIES = 20
const EMPTY_STATE: PluginVersionState = Object.freeze({
  info: null, loading: false, error: '', upgrading: false, upgradeResult: null,
})

let state: PluginVersionState = EMPTY_STATE
const listeners = new Set<() => void>()
let loadSequence = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let prefetchPromise: Promise<void> | null = null
let upgradePromise: Promise<PluginUpgradeResult> | null = null

function emit(): void {
  listeners.forEach(function (listener) { listener() })
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return function () { listeners.delete(listener) }
}
function snapshot(): PluginVersionState { return state }
function setState(patch: Partial<PluginVersionState>): void {
  state = Object.assign({}, state, patch)
  emit()
}

/** React binding: current version state; re-renders on every store change. */
export function usePluginVersion(): PluginVersionState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

function clearRetry(): void {
  if (retryTimer === null) return
  clearTimeout(retryTimer)
  retryTimer = null
}

function scheduleRetry(retriesLeft: number): void {
  if (retryTimer !== null) return
  retryTimer = setTimeout(function () {
    retryTimer = null
    load(false, true, retriesLeft)
  }, CHECKING_RETRY_MS)
}

/** The host check is still running: `checking`, or `idle` before the first result. */
function isPendingInfo(info: PluginVersionInfo | null): boolean {
  if (info === null) return false
  if (info.status === 'checking') return true
  return info.status === 'idle' && info.latestVersion === ''
}

/** Apply one GET /version response and follow a host check that is still running. */
function settle(seq: number, info: PluginVersionInfo | null, retry: boolean, retriesLeft: number): PluginVersionInfo | null {
  if (seq !== loadSequence) return null
  const pending = isPendingInfo(info)
  const willRetry = pending === true && retry === true && retriesLeft > 0
  setState({
    loading: willRetry,
    info: info,
    error: info !== null && info.status === 'error' ? info.error : '',
  })
  if (willRetry === true) scheduleRetry(retriesLeft - 1)
  return info
}

/** Shared loader; never rejects so fire-and-forget callers cannot leak unhandled rejections. */
function load(force: boolean, retry: boolean, retriesLeft: number): Promise<PluginVersionInfo | null> {
  const seq = ++loadSequence
  setState({ loading: true, error: '' })
  const pending = force === true ? checkPluginVersion() : getPluginVersion()
  return pending.then(function (info) {
    return settle(seq, info, retry, retriesLeft)
  }, function (err) {
    if (seq !== loadSequence) return null
    setState({ loading: false, error: errorText(err) })
    return null
  })
}

/**
 * Startup check: load the cached snapshot once and follow the host's background
 * registry check. Called fire-and-forget from the plugin `apply`, so it must
 * never reject.
 */
export function prefetchPluginVersion(): Promise<void> {
  if (prefetchPromise !== null) return prefetchPromise
  // A ready/error snapshot is reused; only a missing (or failed) snapshot loads again.
  if (state.info !== null || state.loading) return Promise.resolve()
  prefetchPromise = load(false, true, CHECKING_MAX_RETRIES).then(function () {
    prefetchPromise = null
  })
  return prefetchPromise
}

/**
 * Re-read the snapshot; `force` runs the registry check again and waits for it.
 * Resolves with the info (or null on error) so UI callers never need a catch.
 */
export function refreshPluginVersion(force?: boolean): Promise<PluginVersionInfo | null> {
  clearRetry()
  return load(force === true, true, CHECKING_MAX_RETRIES)
}

/** Install the latest published version; rejects with the host/API error. */
export function upgradePluginVersion(): Promise<PluginUpgradeResult> {
  if (upgradePromise !== null) return upgradePromise
  setState({ upgrading: true, error: '' })
  upgradePromise = upgradePlugin().then(function (response) {
    setState({
      upgrading: false,
      info: response.info,
      upgradeResult: response.upgrade,
      error: '',
    })
    return response.upgrade
  }, function (err) {
    setState({ upgrading: false })
    throw err
  })
  function clear(): void { upgradePromise = null }
  upgradePromise.then(clear, clear)
  return upgradePromise
}

/** Reset the store between renders in tests. */
export function resetPluginVersionState(): void {
  clearRetry()
  loadSequence += 1
  prefetchPromise = null
  upgradePromise = null
  state = EMPTY_STATE
  emit()
}
