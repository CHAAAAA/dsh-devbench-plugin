/**
 * Cached host preferences the client needs before a panel is open (only the
 * right-sidebar auto-open switch today). Settings saves refresh it and the
 * window-focus listener keeps a stale first load from sticking around.
 */
import { getConfig } from './api.js'

let autoOpenSidebar = false
let loaded = false
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach(function (listener) { listener() })
}

export function getAutoOpenSidebar(): boolean {
  return autoOpenSidebar
}

export function isPreferencesLoaded(): boolean {
  return loaded
}

export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener)
  return function () { listeners.delete(listener) }
}

/** Called after a successful settings save so the header action sees the new value. */
export function setAutoOpenSidebar(value: boolean): void {
  const next = value === true
  loaded = true
  if (autoOpenSidebar === next) return
  autoOpenSidebar = next
  emit()
}

/** Read `GET /config` once; concurrent callers share the same request. */
export function refreshPreferences(): Promise<void> {
  if (inflight !== null) return inflight
  inflight = getConfig().then(function (config) {
    setAutoOpenSidebar(config !== null && typeof config === 'object' && config.autoOpenSidebar === true)
  }, function () {
    // Leave the previous value in place; auto-open is optional and a failed read is harmless.
  }).then(function () {
    inflight = null
  })
  return inflight
}
