/** Safe mini Markdown renderer. Never inject HTML; hrefs are allow-listed. */
import { h } from '../runtime.js'
import type { AnchorHTMLAttributes, Attributes, CSSProperties } from 'react'
type CellAlign = 'left' | 'center' | 'right'
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
function isEscapedAt(text, index) {
  let count = 0
  for (let cursor = index - 1; cursor >= 0 && text.charAt(cursor) === '\\'; cursor--) count++
  return count % 2 === 1
}
function hasUnescapedPipe(line) {
  for (let index = 0; index < line.length; index++) {
    if (line.charAt(index) === '|' && !isEscapedAt(line, index)) return true
  }
  return false
}
/** Split one GFM table row into trimmed cells; `\|` is a literal pipe. */
function splitTableRow(line) {
  let text = String(line || '').trim()
  if (text.charAt(0) === '|') text = text.slice(1)
  if (text.charAt(text.length - 1) === '|' && !isEscapedAt(text, text.length - 1)) {
    text = text.slice(0, -1)
  }
  const cells = []
  let cell = ''
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index)
    if (char === '\\' && text.charAt(index + 1) === '|') {
      cell += '|'
      index++
      continue
    }
    if (char === '|') {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += char
  }
  cells.push(cell.trim())
  return cells
}
/** Parse a GFM delimiter row into one alignment per column; null means default. */
function parseTableDelimiter(line) {
  const cells = splitTableRow(line)
  const alignments = []
  for (let index = 0; index < cells.length; index++) {
    const match = /^(:?)(-+)(:?)$/.exec(cells[index])
    if (!match) return null
    if (match[1] === ':' && match[3] === ':') alignments.push('center')
    else if (match[3] === ':') alignments.push('right')
    else if (match[1] === ':') alignments.push('left')
    else alignments.push(null)
  }
  return alignments
}
/** Block-level constructs that end a GFM table body instead of becoming a row. */
function startsBlock(line) {
  if (/^```/.test(line)) return true
  if (/^#{1,6}\s+/.test(line)) return true
  if (/^\s*([-*_])\s*\1\s*\1\s*$/.test(line) || /^---+$/.test(line)) return true
  if (/^>\s?/.test(line)) return true
  if (/^\s*[-*+]\s+/.test(line)) return true
  return /^\s*\d+\.\s+/.test(line)
}
/** Detect and parse a GFM table starting at `start`; `end` is the last consumed line. */
function parseTable(lines, start) {
  const headerLine = lines[start]
  const delimiterLine = lines[start + 1]
  if (headerLine === undefined || delimiterLine === undefined) return null
  if (!hasUnescapedPipe(headerLine) || !hasUnescapedPipe(delimiterLine)) return null
  const alignments = parseTableDelimiter(delimiterLine)
  if (!alignments) return null
  const header = splitTableRow(headerLine)
  if (header.length !== alignments.length) return null
  const rows = []
  let end = start + 1
  for (let index = start + 2; index < lines.length; index++) {
    const line = lines[index]
    if (line.trim() === '' || startsBlock(line) || !hasUnescapedPipe(line)) break
    rows.push(splitTableRow(line))
    end = index
  }
  return { alignments: alignments, header: header, rows: rows, end: end }
}
function cellStyle(align: CellAlign | null) {
  if (!align) return undefined
  const style: CSSProperties = { textAlign: align }
  return style
}
function renderTableBlock(table, key: number) {
  const tableKey = 't' + key
  const headerCells = table.header.map(function (cell, index) {
    const cellKey = tableKey + '-h' + index
    const props: { key: string; scope: 'col'; style?: CSSProperties } = { key: cellKey, scope: 'col' }
    const style = cellStyle(table.alignments[index])
    if (style) props.style = style
    return h('th', props, inlineMarkdown(cell, cellKey + '-i'))
  })
  const bodyRows = table.rows.map(function (row, rowIndex) {
    const rowKey = tableKey + '-r' + rowIndex
    const cells = []
    for (let index = 0; index < table.header.length; index++) {
      const cellKey = rowKey + '-c' + index
      const props: { key: string; style?: CSSProperties } = { key: cellKey }
      const style = cellStyle(table.alignments[index])
      if (style) props.style = style
      cells.push(h('td', props, inlineMarkdown(row[index] || '', cellKey + '-i')))
    }
    return h('tr', { key: rowKey }, cells)
  })
  return h('div', { className: 'devbench-md-table-wrap', key: tableKey },
    h('table', null,
      h('thead', null, h('tr', { key: tableKey + '-hr' }, headerCells)),
      h('tbody', null, bodyRows)))
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
    const table = parseTable(lines, index)
    if (table) {
      flushParagraph(); flushList()
      blocks.push(renderTableBlock(table, key++))
      index = table.end
      continue
    }
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
