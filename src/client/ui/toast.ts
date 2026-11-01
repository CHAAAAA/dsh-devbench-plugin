/** Tiny global toast queue. Rendered once by the workbench. */
import { h, useSyncExternalStore, t } from '../runtime.js'

const AUTO_DISMISS_MS = 5000
const ERROR_DISMISS_MS = 12000
const MAX_ITEMS = 4
let items = []
let sequence = 0
const timers = new Map()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(function (listener) { listener() })
}
function subscribe(listener) {
  listeners.add(listener)
  return function () { listeners.delete(listener) }
}
function snapshot() { return items }
function schedule(item) {
  const timeout = item.sticky === true
    ? ERROR_DISMISS_MS * 2
    : (item.kind === 'error' ? ERROR_DISMISS_MS : AUTO_DISMISS_MS)
  const timer = setTimeout(function () { dismissToast(item.id) }, timeout)
  timers.set(item.id, timer)
}
export function dismissToast(id) {
  const timer = timers.get(id)
  if (timer !== undefined) clearTimeout(timer)
  timers.delete(id)
  const next = items.filter(function (item) { return item.id !== id })
  if (next.length === items.length) return
  items = next
  emit()
}
export function showToast(kind, text, options) {
  if (typeof text !== 'string' || text === '') return
  const opts = options || {}
  const item = {
    id: ++sequence,
    kind: kind === 'error' ? 'error' : 'info',
    text: text,
    actionLabel: typeof opts.actionLabel === 'string' ? opts.actionLabel : '',
    action: typeof opts.onAction === 'function' ? opts.onAction : null,
    sticky: opts.sticky === true,
  }
  items = items.concat([item]).slice(-MAX_ITEMS)
  emit()
  schedule(item)
  return item.id
}
export function useToasts() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
export function ToastHost() {
  const list = useToasts()
  if (list.length === 0) return null
  return h('div', { className: 'devbench-toast-stack', role: 'status', 'aria-live': 'polite' },
    list.map(function (item) {
      return h('div', { key: item.id, className: 'devbench-toast ' + item.kind },
        h('span', { className: 'devbench-toast-text' }, item.text),
        item.actionLabel !== '' && item.action !== null
          ? h('button', {
            className: 'devbench-toast-action',
            type: 'button',
            onClick() {
              const action = item.action
              dismissToast(item.id)
              action()
            },
          }, item.actionLabel)
          : null,
        h('button', {
          className: 'devbench-toast-close',
          type: 'button',
          title: t('common.close'),
          'aria-label': t('common.close'),
          onClick() { dismissToast(item.id) },
        }, '×'))
    }))
}
