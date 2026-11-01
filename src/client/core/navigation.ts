/** Navigation helpers: dirty-draft guard + view history aware switching. */
import { uiStore } from './ui-store.js'

let leaveGuard = null

/** Register the active "unsaved changes" guard (only one view is editable at a time). */
export function setLeaveGuard(fn) {
  leaveGuard = typeof fn === 'function' ? fn : null
}

export function clearLeaveGuard(fn?) {
  if (fn === undefined || leaveGuard === fn) leaveGuard = null
}

export function hasLeaveGuard() {
  return typeof leaveGuard === 'function'
}

/** Run the registered guard; views without a guard always allow navigation. */
export async function runLeaveGuard() {
  if (typeof leaveGuard !== 'function') return true
  try {
    const allowed = await leaveGuard()
    return allowed !== false
  } catch {
    return false
  }
}

/**
 * Switch views synchronously when no guard is registered (keeps click handlers
 * predictable) and asynchronously when an editor has unsaved changes.
 */
export function navigateView(patch, options?) {
  if (!hasLeaveGuard()) {
    if (options && options.history) uiStore.enterView(patch)
    else uiStore.set(patch)
    return Promise.resolve(true)
  }
  return guardedSet(patch, options)
}

export function navigateBack(fallbackPatch) {
  if (!hasLeaveGuard()) {
    uiStore.back(fallbackPatch)
    return Promise.resolve(true)
  }
  return guardedBack(fallbackPatch)
}

/** Switch views after the guard allows it. `history` pushes the current view. */
export async function guardedSet(patch, options?) {
  const allowed = await runLeaveGuard()
  if (!allowed) return false
  if (options && options.history) uiStore.enterView(patch)
  else uiStore.set(patch)
  return true
}

/** Go back to the previous view after the guard allows it. */
export async function guardedBack(fallbackPatch) {
  const allowed = await runLeaveGuard()
  if (!allowed) return false
  uiStore.back(fallbackPatch)
  return true
}
