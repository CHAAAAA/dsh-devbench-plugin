import { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { Window } from 'happy-dom'
import { initRuntime } from '../../src/client/runtime.js'

const browser = new Window({ url: 'http://127.0.0.1/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? browser : browser[key] })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const renderedProps = new WeakMap<Element, Record<string, any>>()
const originalFetch = globalThis.fetch
let root: ReturnType<typeof createRoot> | null = null
let container: HTMLElement | null = null

// Keep the old assertions readable while every state change runs through React and DOM events.
initRuntime(() => ({
  ...React,
  createElement(type, props, ...children) {
    if (typeof type !== 'string') return React.createElement(type, props, ...children)
    const ref = props?.ref
    return React.createElement(type, {
      ...props,
      ref(element: Element | null) {
        if (element) renderedProps.set(element, props || {})
        if (typeof ref === 'function') return ref(element)
        if (ref) ref.current = element
      },
    }, ...children)
  },
}))

export interface RenderedNode {
  type: string
  props: Record<string, any>
  children: Array<RenderedNode | string>
  element: Element
}

export async function flushAsyncWork(): Promise<void> {
  await React.act(async () => { await new Promise<void>(resolve => setImmediate(resolve)) })
}

function dispatch(element: Element, name: string, event: Record<string, any> = {}): PromiseLike<void> {
  React.act(() => {
    if (name === 'onClick') {
      ;(element as HTMLElement).click()
    } else if (name === 'onChange') {
      const target = event.target || {}
      if ('checked' in target) {
        ;(element as HTMLElement).click()
      } else {
        const prototype = element.tagName === 'TEXTAREA' ? browser.HTMLTextAreaElement.prototype : browser.HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
        if (element.tagName === 'SELECT') (element as HTMLSelectElement).value = target.value
        else if (setter) setter.call(element, target.value)
        element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
      }
    } else {
      const kind = name.slice(2).toLowerCase()
      element.dispatchEvent(new KeyboardEvent(kind, { bubbles: true, cancelable: true, ...event }))
    }
  })
  return { then(resolve, reject) { return flushAsyncWork().then(resolve, reject) } }
}

function snapshot(element: Element): RenderedNode {
  const props = { ...renderedProps.get(element) }
  delete props.ref
  for (const key of Object.keys(props)) {
    if (/^on[A-Z]/.test(key) && typeof props[key] === 'function') props[key] = event => dispatch(element, key, event)
  }
  if ('value' in element) props.value = element.value
  if ('disabled' in element) props.disabled = element.disabled
  if ('checked' in element) props.checked = element.checked
  return {
    type: element.tagName.toLowerCase(), props, element,
    children: Array.from(element.childNodes).map(child => child.nodeType === 1 ? snapshot(child as Element) : child.textContent || ''),
  }
}

export function nodes(): RenderedNode[] {
  return container ? Array.from(container.querySelectorAll('*')).map(snapshot) : []
}

export async function render(element: { type: React.ElementType, props?: Record<string, any>, children?: React.ReactNode[] }): Promise<RenderedNode[]> {
  if (!container) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  await React.act(async () => { root.render(React.createElement(element.type, element.props, ...(element.children || []))) })
  return nodes()
}

export function cleanup(): void {
  if (root) React.act(() => root.unmount())
  root = null
  container?.remove()
  container = null
}

export function textOf(value: RenderedNode | string | Array<RenderedNode | string>, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach(item => textOf(item, out))
  else if (typeof value === 'string') out.push(value)
  else if (value) textOf(value.children, out)
  return out
}

export function findButton(values: RenderedNode[], label: string): RenderedNode | undefined {
  return values.find(node => node.type === 'button' && textOf(node).join(' ').includes(label))
}

export function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, value }), { status, headers: { 'content-type': 'application/json' } })
}

export function mockApi(handler: (url: URL, init: RequestInit) => unknown | Promise<unknown>): void {
  globalThis.fetch = async (input, init = {}) => {
    const result = await handler(new URL(String(input), 'http://127.0.0.1'), init)
    return result instanceof Response ? result : reply(result)
  }
}

export async function waitFor(check: () => boolean, message: string): Promise<void> {
  const end = Date.now() + 1000
  while (!check() && Date.now() < end) await flushAsyncWork()
  assert.ok(check(), message)
}

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  browser.localStorage.clear()
})
