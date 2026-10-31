/** Reusable Markdown editing surface: toolbar, shortcuts and live split preview. */
import { h, useRef, useState } from '../runtime.js'
import { renderMarkdown } from './markdown.js'

const MODES = ['edit', 'split', 'preview']
const TOOLBAR_GROUPS = [
  [
    { id: 'heading1', label: 'H1', title: 'markdown.toolbar.heading1' },
    { id: 'heading2', label: 'H2', title: 'markdown.toolbar.heading2' },
    { id: 'heading3', label: 'H3', title: 'markdown.toolbar.heading3' },
  ],
  [
    { id: 'bold', label: 'B', title: 'markdown.toolbar.bold' },
    { id: 'italic', label: 'I', title: 'markdown.toolbar.italic' },
  ],
  [
    { id: 'bullet', label: '\u2022', title: 'markdown.toolbar.bullet' },
    { id: 'ordered', label: '1.', title: 'markdown.toolbar.ordered' },
    { id: 'quote', label: '>', title: 'markdown.toolbar.quote' },
  ],
  [
    { id: 'code', label: '`', title: 'markdown.toolbar.code' },
    { id: 'codeBlock', label: '```', title: 'markdown.toolbar.codeBlock' },
  ],
  [
    { id: 'link', label: '[]()', title: 'markdown.toolbar.link' },
    { id: 'divider', label: '---', title: 'markdown.toolbar.divider' },
  ],
]
const HELP_ROWS = [
  ['# Heading', 'markdown.help.heading'],
  ['**bold**', 'markdown.help.bold'],
  ['*italic*', 'markdown.help.italic'],
  ['`code`', 'markdown.help.code'],
  ['``` code ```', 'markdown.help.codeBlock'],
  ['- item', 'markdown.help.bullet'],
  ['1. item', 'markdown.help.ordered'],
  ['> quote', 'markdown.help.quote'],
  ['[text](https://)', 'markdown.help.link'],
  ['---', 'markdown.help.divider'],
]

function selectionOf(text, start, end) {
  const length = text.length
  let from = Number.isInteger(start) ? start : length
  let to = Number.isInteger(end) ? end : length
  from = Math.max(0, Math.min(length, from))
  to = Math.max(0, Math.min(length, to))
  if (from > to) {
    const swap = from
    from = to
    to = swap
  }
  return { start: from, end: to }
}

function replacement(text, start, end, inserted, selectStart, selectEnd) {
  return {
    value: text.slice(0, start) + inserted + text.slice(end),
    selectionStart: selectStart,
    selectionEnd: selectEnd,
  }
}

function wrapInline(text, start, end, marker, placeholder) {
  const selected = text.slice(start, end)
  const content = selected || placeholder || ''
  const inserted = marker + content + marker
  const next = replacement(text, start, end, inserted, 0, 0)
  if (selected !== '') {
    next.selectionStart = start + marker.length
    next.selectionEnd = start + marker.length + selected.length
  } else if (placeholder) {
    next.selectionStart = start + marker.length
    next.selectionEnd = start + marker.length + placeholder.length
  } else {
    next.selectionStart = start + marker.length
    next.selectionEnd = start + marker.length
  }
  return next
}

function changeLines(text, start, end, pattern, prefix, matchesDesired) {
  const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1
  let lineEnd = text.indexOf('\n', end)
  if (lineEnd < 0) lineEnd = text.length
  const block = text.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const nonEmpty = lines.filter(function (line) { return line.trim() !== '' })
  if (nonEmpty.length === 0) {
    const inserted = prefix(0)
    return replacement(text, lineStart, lineEnd, inserted,
      lineStart + inserted.length, lineStart + inserted.length)
  }
  const allPrefixed = nonEmpty.every(function (line) { return pattern.test(line) })
  const allDesired = typeof matchesDesired === 'function'
    ? nonEmpty.every(matchesDesired)
    : allPrefixed
  const nextLines = lines.map(function (line, index) {
    if (line.trim() === '') return ''
    if (allDesired) return line.replace(pattern, '')
    if (allPrefixed) return prefix(index) + line.replace(pattern, '')
    return prefix(index) + line
  })
  const inserted = nextLines.join('\n')
  return replacement(text, lineStart, lineEnd, inserted,
    lineStart, lineStart + inserted.length)
}

/** Apply one toolbar action to a textarea value and return the next selection. */
export function applyMarkdownAction(value, selectionStart, selectionEnd, action, options) {
  const text = typeof value === 'string' ? value : ''
  const range = selectionOf(text, selectionStart, selectionEnd)
  const opts = options || {}
  const selected = text.slice(range.start, range.end)
  switch (action) {
    case 'bold':
      return wrapInline(text, range.start, range.end, '**', '')
    case 'italic':
      return wrapInline(text, range.start, range.end, '*', '')
    case 'code':
      return wrapInline(text, range.start, range.end, '`', '')
    case 'heading1':
      return changeLines(text, range.start, range.end, /^#{1,6}\s+/, function () { return '# ' },
        function (line) { return line.indexOf('# ') === 0 })
    case 'heading2':
      return changeLines(text, range.start, range.end, /^#{1,6}\s+/, function () { return '## ' },
        function (line) { return line.indexOf('## ') === 0 })
    case 'heading3':
      return changeLines(text, range.start, range.end, /^#{1,6}\s+/, function () { return '### ' },
        function (line) { return line.indexOf('### ') === 0 })
    case 'bullet':
      return changeLines(text, range.start, range.end, /^\s*(?:[-*+]|\d+\.)\s+/, function () { return '- ' },
        function (line) { return /^\s*[-*+]\s+/.test(line) })
    case 'ordered':
      return changeLines(text, range.start, range.end, /^\s*(?:[-*+]|\d+\.)\s+/, function (index) { return String(index + 1) + '. ' },
        function (line) { return /^\s*\d+\.\s+/.test(line) })
    case 'quote':
      return changeLines(text, range.start, range.end, /^\s*>\s?/, function () { return '> ' })
    case 'divider': {
      const lead = range.start > 0 && text.charAt(range.start - 1) !== '\n' ? '\n' : ''
      const inserted = lead + '---\n'
      return replacement(text, range.start, range.end, inserted,
        range.start + inserted.length, range.start + inserted.length)
    }
    case 'codeBlock': {
      if (selected !== '') {
        const inserted = '```\n' + selected + '\n```'
        return replacement(text, range.start, range.end, inserted,
          range.start + 4, range.start + 4 + selected.length)
      }
      const inserted = '```\n\n```'
      return replacement(text, range.start, range.end, inserted,
        range.start + 4, range.start + 4)
    }
    case 'link': {
      const placeholder = typeof opts.linkText === 'string' && opts.linkText !== ''
        ? opts.linkText
        : 'link'
      const url = 'https://'
      if (selected !== '') {
        const inserted = '[' + selected + '](' + url + ')'
        const urlStart = range.start + selected.length + 3
        return replacement(text, range.start, range.end, inserted,
          urlStart, urlStart + url.length)
      }
      const inserted = '[' + placeholder + '](' + url + ')'
      return replacement(text, range.start, range.end, inserted,
        range.start + 1, range.start + 1 + placeholder.length)
    }
    default:
      return { value: text, selectionStart: range.start, selectionEnd: range.end }
  }
}

function restoreSelection(ref, start, end) {
  const node = ref.current
  if (node === null || node === undefined || typeof node.focus !== 'function') return
  node.focus()
  if (typeof node.setSelectionRange === 'function') {
    try { node.setSelectionRange(start, end) } catch (err) { /* ignore */ }
  }
}

/** Toolbar and split editor shared by the inline editor and the popup editor. */
export function MarkdownEditor(props) {
  const t = props.t
  const textareaRef = useRef(null)
  const [mode, setMode] = useState('split')
  const value = typeof props.value === 'string' ? props.value : ''
  const height = props.height || '48vh'
  const disabled = props.disabled === true
  function applyAction(action) {
    if (disabled === true) return
    const node = textareaRef.current
    const start = node && Number.isInteger(node.selectionStart) ? node.selectionStart : value.length
    const end = node && Number.isInteger(node.selectionEnd) ? node.selectionEnd : value.length
    const next = applyMarkdownAction(value, start, end, action, {
      linkText: t('markdown.linkPlaceholder'),
    })
    if (typeof props.onChange === 'function') props.onChange(next.value)
    const focus = function () {
      restoreSelection(textareaRef, next.selectionStart, next.selectionEnd)
    }
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focus)
    } else {
      Promise.resolve().then(focus)
    }
  }
  function handleKeyDown(event) {
    if (disabled === true) return
    const mod = Boolean(event.metaKey || event.ctrlKey)
    const key = String(event.key || '').toLowerCase()
    if (mod && key === 's') {
      event.preventDefault()
      if (typeof props.onSave === 'function') props.onSave()
      return
    }
    if (mod && (key === 'b' || key === 'i' || key === 'k')) {
      event.preventDefault()
      applyAction(key === 'b' ? 'bold' : (key === 'i' ? 'italic' : 'link'))
      return
    }
    if (event.key === 'Escape' && typeof props.onEscape === 'function') {
      event.preventDefault()
      props.onEscape()
    }
  }
  const editorPane = h('div', { className: 'devbench-md-pane' },
    h('div', { className: 'devbench-md-pane-label' }, t('markdown.mode.edit')),
    h('textarea', {
      ref: textareaRef,
      className: 'devbench-textarea devbench-mono devbench-md-textarea',
      style: { height: height },
      value: value,
      disabled: disabled,
      placeholder: props.placeholder || '',
      'aria-label': props.ariaLabel || t('markdown.editor.aria'),
      onChange(event) {
        if (typeof props.onChange === 'function') props.onChange(event.target.value)
      },
      onKeyDown: handleKeyDown,
    }))
  const previewPane = h('div', { className: 'devbench-md-pane' },
    h('div', { className: 'devbench-md-pane-label' }, t('markdown.mode.preview')),
    h('div', { className: 'devbench-md-preview', style: { height: height } },
      value.trim() === ''
        ? h('div', { className: 'devbench-md-preview-empty' }, t('markdown.preview.empty'))
        : h('div', { className: 'devbench-md' }, renderMarkdown(value))))
  return h('div', { className: 'devbench-md-editor' + (props.className ? ' ' + props.className : '') },
    h('div', { className: 'devbench-md-toolbar' },
      h('div', { className: 'devbench-md-mode-group', role: 'tablist' },
        MODES.map(function (item) {
          return h('button', {
            key: item,
            type: 'button',
            className: 'devbench-md-mode' + (mode === item ? ' active' : ''),
            role: 'tab',
            'aria-selected': mode === item,
            onClick() { setMode(item) },
          }, t('markdown.mode.' + item))
        })),
      h('span', { className: 'devbench-md-toolbar-divider' }),
      TOOLBAR_GROUPS.map(function (group, groupIndex) {
        return h('div', { className: 'devbench-md-tool-group', key: 'group-' + groupIndex },
          group.map(function (item) {
            return h('button', {
              key: item.id,
              type: 'button',
              className: 'devbench-md-tool',
              title: t(item.title),
              'aria-label': t(item.title),
              disabled: disabled,
              onClick() { applyAction(item.id) },
            }, item.label)
          }))
      }),
      h('span', { className: 'devbench-md-toolbar-spacer' }),
      h('button', {
        type: 'button',
        className: 'devbench-md-tool',
        title: t('markdown.toolbar.help'),
        'aria-label': t('markdown.toolbar.help'),
        onClick() { if (typeof props.onOpenHelp === 'function') props.onOpenHelp() },
      }, '?')),
    h('div', { className: 'devbench-md-panes mode-' + mode },
      mode === 'preview' ? null : editorPane,
      mode === 'edit' ? null : previewPane),
    h('div', { className: 'devbench-md-hint' }, t('markdown.hint')))
}

/** Syntax cheat sheet opened from the editor toolbar. */
export function MarkdownHelp(props) {
  const t = props.t
  return h('div', { className: 'devbench-md-help' },
    h('div', { className: 'devbench-hint' }, t('markdown.help.intro')),
    h('div', { className: 'devbench-md-help-list' },
      HELP_ROWS.map(function (row) {
        return h('div', { className: 'devbench-md-help-row', key: row[1] },
          h('code', { className: 'devbench-md-help-code' }, row[0]),
          h('span', null, t(row[1])))
      })))
}
