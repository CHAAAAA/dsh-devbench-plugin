/** Shared UI primitives: styles, banner, badge, breadcrumb and focus-trapped modal. */
import { h, useEffect, useRef } from '../runtime.js'
import type { ReactElement, ReactNode } from 'react'
import type { Translate } from '../runtime.js'
import { CSS } from './styles.js'

const MODAL_STACK = []
let modalSequence = 0

export function Styles(): ReactElement {
  return h('style', { dangerouslySetInnerHTML: { __html: CSS } })
}

export function StatusBadge(props: { status: string; t: Translate }): ReactElement {
  return h('span', { className: 'devbench-badge ' + props.status }, props.t('status.' + props.status))
}

export function Banner(props: { kind?: string; children?: ReactNode }): ReactElement {
  return h('div', {
    className: 'devbench-banner ' + (props.kind || 'info'),
    role: props.kind === 'error' ? 'alert' : undefined,
  }, props.children)
}

/** Breadcrumb: items = [{ label, onClick?, current? }]. */
export function Breadcrumb(props: {
  items: { label: string; onClick?: () => void; current?: boolean }[]
  label?: string
}): ReactElement {
  const items = Array.isArray(props.items) ? props.items : []
  return h('nav', { className: 'devbench-breadcrumb', 'aria-label': props.label || 'breadcrumb' },
    items.map(function (item, index) {
      const current = item.current === true || index === items.length - 1
      return h('span', { className: 'devbench-crumb-item', key: item.label + ':' + index },
        index > 0 ? h('span', { className: 'devbench-crumb-sep', 'aria-hidden': 'true' }, '/') : null,
        current || typeof item.onClick !== 'function'
          ? h('span', { className: 'devbench-crumb' + (current ? ' current' : '') }, item.label)
          : h('button', {
            className: 'devbench-crumb',
            type: 'button',
            onClick: item.onClick,
          }, item.label))
    }))
}

export function formatTime(value) {
  if (!value) return ''
  try { return new Date(value).toLocaleString() } catch (err) { return String(value) }
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** Compact timestamp for dense lists: HH:MM today, MM-DD HH:MM this year, YYYY-MM-DD otherwise. */
export function formatShortTime(value, now?) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : ''
  const current = now instanceof Date ? now : new Date()
  const timeText = pad2(date.getHours()) + ':' + pad2(date.getMinutes())
  const sameDay = date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() && date.getDate() === current.getDate()
  if (sameDay) return timeText
  const monthDay = pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
  if (date.getFullYear() === current.getFullYear()) return monthDay + ' ' + timeText
  return String(date.getFullYear()) + '-' + monthDay
}

export interface ModalProps {
  t: Translate
  title: string
  children?: ReactNode
  headerActions?: ReactNode
  onClose?: () => void
  onCancel?: () => void
  onConfirm?: () => void
  showClose?: boolean
  closeOnOverlay?: boolean
  autoFocus?: boolean
  size?: string
  actions?: boolean
  cancelText?: string
  confirmText?: string
  danger?: boolean
  confirmDisabled?: boolean
}
export function Modal(props: ModalProps): ReactElement {
  const t = props.t
  const idRef = useRef(0)
  if (idRef.current === 0) idRef.current = ++modalSequence
  const closeRef = useRef(props.onClose || props.onCancel)
  closeRef.current = props.onClose || props.onCancel || function () {}
  const cancelRef = useRef(props.onCancel || props.onClose)
  cancelRef.current = props.onCancel || props.onClose || function () {}
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(function () {
    const modalId = idRef.current
    MODAL_STACK.push(modalId)
    const previous = typeof document === 'undefined' ? null : document.activeElement
    const node = dialogRef.current
    if (node) {
      const root = node.querySelector('.devbench-modal-body') || node
      const first = root.querySelector<HTMLElement>('input,textarea,select,button')
      if (first && props.autoFocus !== false) first.focus()
      else node.focus()
    }
    function onKey(event: KeyboardEvent): void {
      // Only the top-most dialog reacts to Escape / Tab (prevents closing the
      // dialog underneath when a confirmation is stacked on top of it).
      if (MODAL_STACK[MODAL_STACK.length - 1] !== modalId) return
      if (event.key === 'Escape') {
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !node) return
      const items = node.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href]')
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return function () {
      window.removeEventListener('keydown', onKey)
      const index = MODAL_STACK.indexOf(modalId)
      if (index >= 0) MODAL_STACK.splice(index, 1)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])
  const showClose = props.showClose === undefined
    ? typeof props.onClose === 'function'
    : props.showClose === true
  return h('div', {
    className: 'devbench-overlay',
    onMouseDown(event) {
      if (event.target === event.currentTarget && props.closeOnOverlay !== false) closeRef.current()
    },
  }, h('div', {
    className: 'devbench-modal' + (props.size ? ' devbench-modal-' + props.size : ''),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': props.title,
    tabIndex: -1,
    ref: dialogRef,
  },
  h('div', { className: 'devbench-modal-head' },
    h('div', { className: 'devbench-modal-title' }, props.title),
    props.headerActions
      ? h('div', { className: 'devbench-modal-head-actions' }, props.headerActions)
      : null,
    showClose
      ? h('button', {
        className: 'devbench-modal-close',
        type: 'button',
        title: t('common.close'),
        'aria-label': t('common.close'),
        onClick() { closeRef.current() },
      }, '×')
      : null),
  h('div', { className: 'devbench-modal-body' }, props.children),
  props.actions === false ? null : h('div', { className: 'devbench-modal-actions' },
    h('button', { className: 'devbench-btn ghost', onClick() { cancelRef.current() } },
      props.cancelText || t('action.cancel')),
    h('button', {
      className: 'devbench-btn primary' + (props.danger === true ? ' danger' : ''),
      disabled: props.confirmDisabled === true,
      onClick: props.onConfirm,
    }, props.confirmText || t('action.confirm')))))
}
