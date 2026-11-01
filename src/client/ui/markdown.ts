/** Safe mini Markdown renderer. Never inject HTML; hrefs are allow-listed. */
import { h } from '../runtime.js'
import type { AnchorHTMLAttributes, Attributes } from 'react'
function badChars(text) {
  return /[\u0000-\u001f\u007f]/.test(text)
}
export function sanitizeHref(raw) {
  const text = String(raw || '').trim()
  if (!text || badChars(text)) return null
  if (text.charAt(0) === '#') return { href: text, external: false }
  if (text.indexOf('//') === 0) return null
  if (text.indexOf('\\') >= 0) return null
  const lower = text.toLowerCase()
  if (lower.indexOf('mailto:') === 0) {
    try { new URL(text); return { href: text, external: false } } catch (err) { return null }
  }
  if (lower.indexOf('https://') === 0 || lower.indexOf('http://') === 0) {
    try {
      const parsed = new URL(text)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return { href: text, external: true }
      }
    } catch (err) {}
    return null
  }
  if (text.charAt(0) === '/') return { href: text, external: false }
  return null
}
export function inlineMarkdown(text, keyPrefix) {
  const nodes = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let index = 0
  let match
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    const key = keyPrefix + '-i' + (index++)
    if (token.indexOf('**') === 0) {
      nodes.push(h('strong', { key: key }, token.slice(2, -2)))
    } else if (token.charAt(0) === '`') {
      nodes.push(h('code', { key: key }, token.slice(1, -1)))
    } else if (token.charAt(0) === '[') {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      const safe = linkMatch ? sanitizeHref(linkMatch[2]) : null
      if (linkMatch && safe) {
        const props: AnchorHTMLAttributes<HTMLAnchorElement> & Attributes = { key: key, href: safe.href }
        if (safe.external) {
          props.target = '_blank'
          props.rel = 'noreferrer noopener'
        }
        nodes.push(h('a', props, linkMatch[1]))
      } else {
        nodes.push(linkMatch ? linkMatch[1] : token)
      }
    } else {
      nodes.push(h('em', { key: key }, token.slice(1, -1)))
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}
export function renderMarkdown(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let paragraph = []
  let listItems = null
  let listOrdered = false
  let key = 0
  function flushParagraph() {
    if (paragraph.length === 0) return
    blocks.push(h('p', { key: 'p' + (key++) }, inlineMarkdown(paragraph.join(' '), 'p' + key)))
    paragraph = []
  }
  function flushList() {
    if (!listItems) return
    const tag = listOrdered ? 'ol' : 'ul'
    blocks.push(h(tag, { key: 'l' + (key++) }, listItems))
    listItems = null
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const fence = /^```(.*)$/.exec(line)
    if (fence) {
      flushParagraph(); flushList()
      const codeLines = []
      index++
      while (index < lines.length && /^```/.test(lines[index]) === false) {
        codeLines.push(lines[index])
        index++
      }
      blocks.push(h('pre', { key: 'c' + (key++) }, h('code', null, codeLines.join('\n'))))
      continue
    }
    if (/^\s*$/.test(line)) { flushParagraph(); flushList(); continue }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph(); flushList()
      blocks.push(h('h' + heading[1].length, { key: 'h' + (key++) }, inlineMarkdown(heading[2], 'h' + key)))
      continue
    }
    if (/^\s*([-*_])\s*\1\s*\1\s*$/.test(line) || /^---+$/.test(line)) {
      flushParagraph(); flushList()
      blocks.push(h('hr', { key: 'r' + (key++) }))
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      flushParagraph(); flushList()
      blocks.push(h('blockquote', { key: 'q' + (key++) }, inlineMarkdown(quote[1], 'q' + key)))
      continue
    }
    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (unordered) {
      flushParagraph()
      if (!listItems || listOrdered) { flushList(); listItems = []; listOrdered = false }
      listItems.push(h('li', { key: 'li' + (key++) }, inlineMarkdown(unordered[1], 'li' + key)))
      continue
    }
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ordered) {
      flushParagraph()
      if (!listItems || !listOrdered) { flushList(); listItems = []; listOrdered = true }
      listItems.push(h('li', { key: 'li' + (key++) }, inlineMarkdown(ordered[1], 'li' + key)))
      continue
    }
    flushList()
    paragraph.push(line.trim())
  }
  flushParagraph(); flushList()
  return blocks
}
