/** Attachment tree. Revision remounts it; request generations reject stale responses.
 *  The editor tracks an unsaved draft and asks before switching files. */
import { h, getFragment, useState, useEffect, useRef, errorText, isAbortError } from '../runtime.js'
import { listFiles, writeFile, openFile } from '../core/api.js'
import { confirmDialog } from './dialogs.js'
import { Banner } from './common.js'
import { IconArrow, IconFolder, IconFile, IconExternal, IconTrash } from './icons.js'
const EMPTY_FILE = { status: 'idle', data: null, error: '' }
function noop() {}
export function FileTree(props) {
  const t = props.t
  const [children, setChildren] = useState({})
  const [expanded, setExpanded] = useState({})
  const [selected, setSelected] = useState(null)
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [fileState, setFileState] = useState(EMPTY_FILE)
  const [fileDraft, setFileDraft] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const dirSeq = useRef({})
  const fileSeq = useRef(0)
  const saveSeq = useRef(0)
  const saveBusyRef = useRef(false)
  const selectedRef = useRef(null)
  const dirtyRef = useRef(false)
  const fileData = fileState.data
  const savedContent = fileData && typeof fileData.content === 'string' ? fileData.content : ''
  const fileDirty = fileState.status === 'ready' && fileData && fileData.editable === true &&
    fileDraft !== savedContent
  dirtyRef.current = fileDirty
  useEffect(function () {
    dirSeq.current = {}
    fileSeq.current += 1
    saveSeq.current += 1
    saveBusyRef.current = false
    selectedRef.current = null
    setChildren({})
    setExpanded({})
    setSelected(null)
    setSelectedEntry(null)
    setFileState(EMPTY_FILE)
    setFileDraft('')
    setSaveBusy(false)
    if (props.onBusyChange) props.onBusyChange(false)
  }, [props.workspaceId, props.requirementId, props.revision])
  useEffect(function () {
    if (typeof props.onDirtyChange === 'function') props.onDirtyChange(fileDirty)
  }, [fileDirty])
  const sel = { workspaceId: props.workspaceId, id: props.requirementId }
  function loadDir(path) {
    const token = (dirSeq.current[path] || 0) + 1
    dirSeq.current[path] = token
    return listFiles(sel, path).then(function (value) {
      if (dirSeq.current[path] !== token) return
      setChildren(function (prev) {
        const next = Object.assign({}, prev)
        next[path] = value.entries || []
        return next
      })
    }, function (err) {
      if (dirSeq.current[path] !== token || isAbortError(err)) return
      props.showToast('error', errorText(err))
    })
  }
  function toggleDir(path) {
    if (props.disabled || saveBusyRef.current) return
    if (!expanded[path] && !children[path]) loadDir(path)
    setExpanded(function (prev) {
      const next = Object.assign({}, prev)
      next[path] = !prev[path]
      return next
    })
  }
  function loadFile(entry) {
    const token = ++fileSeq.current
    selectedRef.current = entry.path
    setSelected(entry.path)
    setSelectedEntry(entry)
    setFileState({ status: 'loading', data: null, error: '' })
    setFileDraft('')
    listFiles(sel, entry.path).then(function (value) {
      if (fileSeq.current !== token) return
      setFileState({ status: 'ready', data: value, error: '' })
      setFileDraft(value.kind === 'file' && value.content !== undefined ? value.content : '')
    }, function (err) {
      if (fileSeq.current !== token || isAbortError(err)) return
      setFileState({ status: 'error', data: null, error: errorText(err) })
    })
  }
  function showFile(entry) {
    if (props.disabled || saveBusyRef.current) return Promise.resolve(false)
    if (selectedRef.current === entry.path && !dirtyRef.current) return Promise.resolve(true)
    if (!dirtyRef.current) {
      loadFile(entry)
      return Promise.resolve(true)
    }
    return confirmDialog({
      title: t('detail.files.dirtyConfirm.title'),
      body: t('detail.files.dirtyConfirm.body'),
      confirmText: t('detail.files.discardAndLeave'),
      cancelText: t('detail.files.keepEditing'),
      tone: 'danger',
    }).then(function (discard) {
      if (discard !== true) return false
      loadFile(entry)
      return true
    })
  }
  function openEntry(entry) {
    if (entry.isRequirementDoc) return
    if (entry.type === 'dir') {
      toggleDir(entry.path)
      return
    }
    showFile(entry).catch(noop)
  }
  function saveFile() {
    const current = fileState.data
    if (saveBusyRef.current || props.disabled || fileState.status !== 'ready') return
    if (!selected || !current || !current.editable) return
    saveBusyRef.current = true
    setSaveBusy(true)
    if (props.onBusyChange) props.onBusyChange(true)
    const path = selected
    const content = fileDraft
    const token = ++saveSeq.current
    writeFile({ workspaceId: props.workspaceId, id: props.requirementId, path: path, content: content })
      .then(function () {
        props.showToast('info', t('detail.saved'))
        if (selectedRef.current === path && saveSeq.current === token) {
          setFileState(function (prev) {
            return Object.assign({}, prev, {
              data: Object.assign({}, prev.data, { content: content }),
            })
          })
        }
      }, function (err) {
        props.showToast('error', errorText(err))
      })
      .finally(function () {
        if (saveSeq.current === token) {
          saveBusyRef.current = false
          setSaveBusy(false)
          if (props.onBusyChange) props.onBusyChange(false)
        }
      })
  }
  function reveal(path, isDir) {
    openFile({
      workspaceId: props.workspaceId, id: props.requirementId,
      path: path, reveal: Boolean(isDir),
    }).catch(function (err) { props.showToast('error', errorText(err)) })
  }
  function renderEntries(entries, depth) {
    return entries.map(function (entry) {
      const isDir = entry.type === 'dir'
      const isOpen = isDir && expanded[entry.path]
      const actionDisabled = props.disabled === true || saveBusy
      return h(getFragment(), { key: entry.path },
        h('div', {
          className: 'devbench-file-row' + (selected === entry.path ? ' active' : ''),
          role: 'button', tabIndex: 0,
          'aria-expanded': isDir ? Boolean(isOpen) : undefined,
          style: { paddingLeft: (12 + depth * 16) + 'px' },
          onClick() { openEntry(entry) },
          onKeyDown(event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); openEntry(entry)
            }
          },
        },
        h('span', {
          style: { width: '14px', display: 'inline-flex', justifyContent: 'center',
            transform: isOpen ? 'rotate(90deg)' : 'none' },
        }, isDir ? h(IconArrow, { size: 12 }) : null),
        h(entry.type === 'dir' ? IconFolder : IconFile, { size: 14 }),
        h('span', { className: 'devbench-file-name' }, entry.name),
        entry.size === undefined ? null : h('span', { className: 'devbench-file-size' }, String(entry.size) + ' B'),
        entry.isRequirementDoc ? null : h('span', { className: 'devbench-inline', style: { gap: '2px' } },
          h('button', {
            className: 'devbench-icon-btn', title: t('detail.files.open'), disabled: actionDisabled,
            onClick(event) { event.stopPropagation(); if (!actionDisabled) reveal(entry.path, isDir) },
          }, h(IconExternal, { size: 13 })),
          h('button', {
            className: 'devbench-icon-btn', title: t('detail.files.delete'), disabled: actionDisabled,
            onClick(event) { event.stopPropagation(); if (!actionDisabled) props.onDelete(entry.path) },
          }, h(IconTrash, { size: 13 })))),
        isDir && isOpen ? renderEntries(children[entry.path] || [], depth + 1) : null)
    })
  }
  let content = null
  if (props.loading) {
    content = h('div', { className: 'devbench-hint' }, t('panel.loading'))
  } else if (props.error) {
    content = h('div', null,
      h(Banner, { kind: 'error' }, props.error),
      h('button', { className: 'devbench-btn', onClick: props.onReloadRoot }, t('panel.retry')))
  } else if (!props.rootEntries || props.rootEntries.length === 0) {
    content = h('div', { className: 'devbench-empty' }, t('detail.files.empty'))
  } else {
    content = h('div', { className: 'devbench-filetree' }, renderEntries(props.rootEntries, 0))
  }
  let editor = null
  if (selected) {
    const header = h('div', { className: 'devbench-section-title' },
      h('span', { className: 'devbench-mono', style: { fontWeight: 400 } }, selected),
      fileDirty
        ? h('span', { className: 'devbench-pill', style: { color: 'var(--dsw-alias-state-warn-primary)' } },
          t('detail.files.unsaved'))
        : null,
      h('span', { className: 'spacer' }),
      fileData && fileData.editable ? h('button', {
        className: 'devbench-btn primary',
        disabled: saveBusy || props.disabled || fileDirty !== true,
        onClick: saveFile,
      }, saveBusy ? t('detail.files.saving') : t('detail.files.save')) : null,
      h('button', {
        className: 'devbench-btn ghost', disabled: props.disabled,
        onClick() { reveal(selected, false) },
      }, h(IconExternal, { size: 13 }), t('detail.files.open')))
    if (fileState.status === 'loading') {
      editor = h('div', { style: { marginTop: '16px' } }, header,
        h('div', { className: 'devbench-hint' }, t('panel.loading')))
    } else if (fileState.status === 'error') {
      editor = h('div', { style: { marginTop: '16px' } }, header,
        h(Banner, { kind: 'error' }, fileState.error),
        h('button', {
          className: 'devbench-btn',
          onClick() { if (selectedEntry) loadFile(selectedEntry) },
        }, t('panel.retry')))
    } else if (fileData && fileData.kind === 'dir') {
      editor = h('div', { style: { marginTop: '16px' } }, header,
        h('div', { className: 'devbench-filetree' }, (fileData.entries || []).map(function (entry) {
          return h('div', { className: 'devbench-file-row', key: entry.path },
            h(entry.type === 'dir' ? IconFolder : IconFile, { size: 14 }),
            h('span', { className: 'devbench-file-name' }, entry.name))
        })))
    } else if (!fileData || !fileData.editable) {
      editor = h('div', { style: { marginTop: '16px' } }, header,
        h('div', { className: 'devbench-hint' }, t('detail.files.binary')))
    } else {
      editor = h('div', { style: { marginTop: '16px' } }, header,
        h('textarea', {
          className: 'devbench-textarea devbench-mono',
          rows: 18,
          value: fileDraft,
          disabled: saveBusy || props.disabled,
          onChange(event) { setFileDraft(event.target.value) },
          onKeyDown(event) {
            if ((event.metaKey || event.ctrlKey) && event.key === 's') {
              event.preventDefault()
              if (!saveBusyRef.current) saveFile()
            }
          },
        }))
    }
  }
  return h('div', null, content, editor)
}
