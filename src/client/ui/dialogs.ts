/** Small imperative confirmation dialogs. Rendered once by the workbench. */
import { h, useSyncExternalStore, t } from '../runtime.js'
import { Modal } from './common.js'

let current = null
let resolver = null
const listeners = new Set<any>()

function emit() {
  listeners.forEach(function (listener) { listener() })
}
function subscribe(listener) {
  listeners.add(listener)
  return function () { listeners.delete(listener) }
}
function snapshot() { return current }

/**
 * Open a choice dialog and resolve with the clicked action value.
 * @param {{title:string, body?:string, detail?:*, tone?:'default'|'danger',
 *   dismissible?:boolean, cancelValue?:*, size?:string,
 *   actions:Array<{label:string, value:*, kind?:string, disabled?:boolean}>}} options
 */
export function choiceDialog(options) {
  if (resolver !== null) {
    const previous = resolver
    const previousOptions = current
    resolver = null
    current = null
    previous(previousOptions && previousOptions.cancelValue !== undefined ? previousOptions.cancelValue : null)
  }
  current = options
  emit()
  return new Promise(function (resolve) { resolver = resolve })
}

export function closeDialog(value) {
  if (current === null) return
  const resolve = resolver
  const options = current
  current = null
  resolver = null
  emit()
  if (resolve) resolve(value === undefined ? (options.cancelValue === undefined ? null : options.cancelValue) : value)
}

/** Promise<boolean> confirmation dialog. */
export function confirmDialog(options) {
  const tone = options.tone || (options.danger === true ? 'danger' : 'default')
  const actions = [
    { label: options.cancelText || t('action.cancel'), value: false, kind: 'ghost' },
    {
      label: options.confirmText || t('action.confirm'),
      value: true,
      kind: tone === 'danger' ? 'primary danger' : 'primary',
    },
  ]
  return choiceDialog(Object.assign({}, options, {
    tone: tone,
    actions: actions,
    cancelValue: false,
  })).then(function (value) { return value === true })
}

/** Dialog host mounted once near the plugin root. */
export function DialogHost(props) {
  const options = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (options === null || options === undefined) return null
  const closeValue = options.cancelValue === undefined ? null : options.cancelValue
  const dismissible = options.dismissible !== false
  const actions = Array.isArray(options.actions) ? options.actions : []
  return h(Modal, {
    t: props && props.t ? props.t : t,
    title: options.title,
    actions: false,
    size: options.size,
    showClose: dismissible,
    onClose() { closeDialog(closeValue) },
  },
  h('div', { className: 'devbench-dialog-body' },
    options.body ? h('div', { className: 'devbench-hint' }, options.body) : null,
    options.detail ? h('div', { className: 'devbench-dialog-detail' }, options.detail) : null),
  h('div', { className: 'devbench-modal-actions' }, actions.map(function (action, index) {
    return h('button', {
      key: action.value === undefined ? 'action-' + index : 'action-' + String(action.value) + '-' + index,
      className: 'devbench-btn ' + (action.kind || 'ghost'),
      disabled: action.disabled === true,
      onClick() { closeDialog(action.value) },
    }, action.label)
  })))
}
