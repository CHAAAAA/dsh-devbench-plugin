/**
 * Project documents master-detail tab: file list on the left, Markdown viewer and
 * editor on the right. Documents are Host-managed Markdown files under the
 * requirement root; the list intentionally shows titles only (no id/time/snippet).
 * Full-text search debounces the Host search endpoint, exactly like the
 * requirement tab; the title scope filters the local summaries.
 */
import {
  h, getFragment, useState, useEffect, useRef, errorText, t as translate,
} from '../../runtime.js'
import * as api from '../../core/api.js'
import { setLeaveGuard, clearLeaveGuard } from '../../core/navigation.js'
import { confirmDialog } from '../../ui/dialogs.js'
import { Banner, Modal, formatTime } from '../../ui/common.js'
import { renderMarkdown } from '../../ui/markdown.js'
import { MarkdownEditor, MarkdownHelp } from '../../ui/markdown-editor.js'
import { IconFile, IconPlus, IconTrash, IconEdit } from '../../ui/icons.js'
import { createFullTextSearch, mergeSearchItems } from './requirements.js'

const LIST_PAGE_SIZE = 10
const SEARCH_SCOPE_TITLE = 'title'
const SEARCH_SCOPE_FULL = 'full'
const EMPTY_LIST = { loading: false, error: '', data: [], workspaceId: '' }
const EMPTY_DETAIL = { loading: false, error: '', body: '', data: null, key: '' }
/** `scope === ''` means "no full-text result cached yet". */
const EMPTY_FULL_SEARCH = {
  scope: '', query: '', loading: false, error: '', items: [], hasMore: false, total: 0,
}
function noop() {}
function trimSearch(value) {
  return String(value === undefined || value === null ? '' : value).trim()
}
/** Title-scope filter: case-insensitive substring over the document title only. */
export function documentTitleMatches(doc, query) {
  if (!doc) return false
  const needle = trimSearch(query).toLowerCase()
  if (needle === '') return true
  return String(doc.title || '').toLowerCase().indexOf(needle) >= 0
}
function keyOf(doc) {
  if (!doc || doc.id === undefined || doc.id === null || doc.id === '') return ''
  return String(doc.workspaceId || '') + '/' + String(doc.id)
}
function attachWorkspace(doc, workspaceId) {
  if (!doc || typeof doc.id !== 'string' || doc.id === '') return null
  return Object.assign({}, doc, { workspaceId: workspaceId })
}
/** Edit draft is dirty when it differs from the loaded server document. */
function draftDirty(title, body, detail) {
  const base = detail && detail.data ? detail.data : null
  const baseTitle = base && typeof base.title === 'string' ? base.title : ''
  const baseBody = detail && typeof detail.body === 'string' ? detail.body : ''
  return String(title || '') !== baseTitle || String(body || '') !== baseBody
}
export function ProjectDocuments(props) {
  const t = props.t || translate
  const configured = props.configured !== false
  const workspace = props.workspace || null
  const workspaceId = workspace ? workspace.workspaceId : ''
  // Hook order is documented in test/client/render-smoke.test.mjs (seedDocumentsHooks).
  const [list, setList] = useState(EMPTY_LIST)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(EMPTY_DETAIL)
  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [createModal, setCreateModal] = useState(null)
  const [deleteModal, setDeleteModal] = useState(null)
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState(SEARCH_SCOPE_TITLE)
  const [limit, setLimit] = useState(LIST_PAGE_SIZE)
  const [fullSearch, setFullSearch] = useState(EMPTY_FULL_SEARCH)
  const [markdownHelpOpen, setMarkdownHelpOpen] = useState(false)
  const listSeqRef = useRef(0)
  const detailSeqRef = useRef(0)
  const searchRef = useRef(null)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const createBusyRef = useRef(false)
  const deleteBusyRef = useRef(false)
  const guardRef = useRef(null)
  const expectedUpdatedAtRef = useRef('')
  if (searchRef.current === null) {
    searchRef.current = createFullTextSearch({
      onEvent(event) {
        if (event.type === 'start') {
          setFullSearch({
            scope: SEARCH_SCOPE_FULL, query: event.query, loading: true,
            error: '', items: [], hasMore: false, total: 0,
          })
          return
        }
        if (event.type === 'success') {
          const value = event.value || {}
          setFullSearch({
            scope: SEARCH_SCOPE_FULL,
            query: typeof value.query === 'string' && value.query !== '' ? value.query : event.query,
            loading: false,
            error: '',
            items: Array.isArray(value.items) ? value.items : [],
            hasMore: value.hasMore === true,
            total: Number(value.total) || 0,
          })
          return
        }
        setFullSearch({
          scope: SEARCH_SCOPE_FULL, query: event.query, loading: false,
          error: errorText(event.error) || t('project.documents.search.failed'),
          items: [], hasMore: false, total: 0,
        })
      },
      search(activeWorkspaceId, query) {
        return api.searchDocuments(activeWorkspaceId, query, SEARCH_SCOPE_FULL)
      },
    })
  }
  function showToast(kind, text) {
    if (typeof props.showToast === 'function') props.showToast(kind, text)
  }
  function loadList() {
    if (!workspaceId || configured === false) {
      listSeqRef.current += 1
      setList(EMPTY_LIST)
      return Promise.resolve(null)
    }
    const seq = ++listSeqRef.current
    setList(function (prev) {
      return {
        loading: prev.data.length === 0,
        error: '',
        data: prev.workspaceId === workspaceId ? prev.data : [],
        workspaceId: workspaceId,
      }
    })
    return api.listDocuments(workspaceId).then(function (value) {
      if (listSeqRef.current !== seq) return null
      setList({
        loading: false,
        error: '',
        data: value && Array.isArray(value.documents) ? value.documents : [],
        workspaceId: workspaceId,
      })
      return value
    }, function (err) {
      if (listSeqRef.current !== seq) return null
      setList(function (prev) {
        return {
          loading: false,
          error: errorText(err),
          data: prev.workspaceId === workspaceId ? prev.data : [],
          workspaceId: workspaceId,
        }
      })
      return null
    })
  }
  function resetDrafts() {
    setTitleDraft(detail.data && typeof detail.data.title === 'string' ? detail.data.title : '')
    setBodyDraft(typeof detail.body === 'string' ? detail.body : '')
    dirtyRef.current = false
    setDirty(false)
  }
  function clearSelection() {
    detailSeqRef.current += 1
    setSelected(null)
    setDetail(EMPTY_DETAIL)
    setEditing(false)
    setTitleDraft('')
    setBodyDraft('')
    dirtyRef.current = false
    setDirty(false)
    setConflict(false)
    setSaveError('')
  }
  function loadDetail(doc) {
    if (!doc) {
      detailSeqRef.current += 1
      setDetail(EMPTY_DETAIL)
      return Promise.resolve(null)
    }
    const seq = ++detailSeqRef.current
    const key = keyOf(doc)
    setDetail({ loading: true, error: '', body: '', data: doc, key: key })
    return api.getDocument({ workspaceId: doc.workspaceId, id: doc.id }).then(function (value) {
      if (detailSeqRef.current !== seq) return null
      const summary = value && value.document ? value.document : null
      const body = value && typeof value.body === 'string' ? value.body : ''
      expectedUpdatedAtRef.current = summary && typeof summary.updatedAt === 'string'
        ? summary.updatedAt
        : ''
      setDetail({ loading: false, error: '', body: body, data: summary || doc, key: key })
      setTitleDraft(summary && typeof summary.title === 'string' ? summary.title : (doc.title || ''))
      setBodyDraft(body)
      dirtyRef.current = false
      setDirty(false)
      setConflict(false)
      setSaveError('')
      return value
    }, function (err) {
      if (detailSeqRef.current !== seq) return null
      setDetail(function (prev) {
        return {
          loading: false,
          error: errorText(err) || t('project.documents.loadFailed'),
          body: '',
          data: prev.key === key ? prev.data : doc,
          key: key,
        }
      })
      return null
    })
  }
  function selectDocument(doc) {
    const next = attachWorkspace(doc, workspaceId)
    if (!next) return
    detailSeqRef.current += 1
    setDetail(EMPTY_DETAIL)
    setSelected(next)
    setEditing(false)
    setTitleDraft(next.title || '')
    setBodyDraft('')
    dirtyRef.current = false
    setDirty(false)
    setConflict(false)
    setSaveError('')
  }
  function requestSelect(doc) {
    if (!doc || doc.id === undefined) return
    if (selected && selected.id === doc.id) return
    if (!dirtyRef.current) {
      selectDocument(doc)
      return
    }
    confirmDialog({
      title: t('dialog.unsaved.title'),
      body: t('dialog.unsaved.body'),
      confirmText: t('dialog.unsaved.discard'),
      cancelText: t('dialog.unsaved.stay'),
      tone: 'danger',
    }).then(function (discard) {
      if (discard === true) selectDocument(doc)
    }).catch(noop)
  }
  function requestLeave() {
    if (savingRef.current) {
      showToast('info', t('detail.saveState.saving'))
      return Promise.resolve(false)
    }
    if (!dirtyRef.current) return Promise.resolve(true)
    return confirmDialog({
      title: t('dialog.unsaved.title'),
      body: t('dialog.unsaved.body'),
      confirmText: t('dialog.unsaved.discard'),
      cancelText: t('dialog.unsaved.stay'),
      tone: 'danger',
    }).then(function (discard) {
      if (discard !== true) return false
      resetDrafts()
      return true
    })
  }
  function markDirty(nextTitle, nextBody) {
    const next = draftDirty(nextTitle, nextBody, detail)
    dirtyRef.current = next
    setDirty(next)
  }
  function changeSearch(value) {
    setSearch(value)
    setLimit(LIST_PAGE_SIZE)
  }
  function changeScope(value) {
    setScope(value === SEARCH_SCOPE_FULL ? SEARCH_SCOPE_FULL : SEARCH_SCOPE_TITLE)
    setLimit(LIST_PAGE_SIZE)
  }
  function retrySearch() {
    if (!workspaceId) return Promise.resolve(null)
    return searchRef.current.run(workspaceId, search)
  }
  function loadMore() {
    setLimit(function (value) {
      return (Number(value) > 0 ? Number(value) : LIST_PAGE_SIZE) + LIST_PAGE_SIZE
    })
  }
  function openCreateModal() {
    if (!configured || createModal !== null) return
    setCreateModal({ title: '', body: '', busy: false, error: '' })
  }
  function createDraftDirty(modal) {
    if (!modal) return false
    return modal.title.trim() !== '' || modal.body.trim() !== ''
  }
  function requestCreateClose() {
    if (createModal === null || createBusyRef.current) return
    if (!createDraftDirty(createModal)) {
      setCreateModal(null)
      return
    }
    confirmDialog({
      title: t('detail.discardDraft.title'),
      body: t('detail.discardDraft.body'),
      confirmText: t('dialog.unsaved.discard'),
      cancelText: t('dialog.unsaved.stay'),
      tone: 'danger',
    }).then(function (discard) {
      if (discard === true) setCreateModal(null)
    }).catch(noop)
  }
  function submitCreate() {
    if (createModal === null || createBusyRef.current || !workspaceId) return
    const title = createModal.title.trim()
    if (title === '') return
    createBusyRef.current = true
    setCreateModal(function (prev) { return Object.assign({}, prev, { busy: true, error: '' }) })
    api.createDocument({ workspaceId: workspaceId, title: title, body: createModal.body }).then(function (value) {
      createBusyRef.current = false
      setCreateModal(null)
      const created = value && value.document ? value.document : null
      showToast('info', t('project.documents.created'))
      loadList()
      if (created) selectDocument(created)
    }, function (err) {
      createBusyRef.current = false
      setCreateModal(function (prev) {
        return prev ? Object.assign({}, prev, { busy: false, error: errorText(err) }) : null
      })
    })
  }
  function openDeleteModal(doc) {
    if (!doc || deleteModal !== null || deleteBusyRef.current) return
    setDeleteModal({ doc: doc, busy: false, error: '' })
  }
  function submitDelete() {
    if (deleteModal === null || deleteBusyRef.current || !workspaceId) return
    const doc = deleteModal.doc
    deleteBusyRef.current = true
    setDeleteModal(function (prev) { return prev ? Object.assign({}, prev, { busy: true, error: '' }) : null })
    api.deleteDocument({ workspaceId: workspaceId, id: doc.id }).then(function () {
      deleteBusyRef.current = false
      setDeleteModal(null)
      showToast('info', t('project.documents.deleted'))
      if (selected && selected.id === doc.id) clearSelection()
      loadList()
    }, function (err) {
      deleteBusyRef.current = false
      setDeleteModal(function (prev) {
        return prev ? Object.assign({}, prev, { busy: false, error: errorText(err) }) : null
      })
    })
  }
  function enterEdit() {
    if (!selected || detail.loading || detail.error !== '') return
    setTitleDraft(detail.data && typeof detail.data.title === 'string' ? detail.data.title : '')
    setBodyDraft(typeof detail.body === 'string' ? detail.body : '')
    dirtyRef.current = false
    setDirty(false)
    setConflict(false)
    setSaveError('')
    setEditing(true)
  }
  function exitEditing() {
    if (!editing) return
    if (!dirtyRef.current) {
      setEditing(false)
      return
    }
    confirmDialog({
      title: t('detail.discardDraft.title'),
      body: t('detail.discardDraft.body'),
      confirmText: t('dialog.unsaved.discard'),
      cancelText: t('dialog.unsaved.stay'),
      tone: 'danger',
    }).then(function (discard) {
      if (discard !== true) return
      resetDrafts()
      setEditing(false)
    }).catch(noop)
  }
  function saveDocument(options) {
    const opts = options || {}
    if (!selected || savingRef.current) return Promise.resolve(false)
    const title = titleDraft.trim()
    if (title === '') {
      setSaveError(t('project.documents.titleRequired'))
      return Promise.resolve(false)
    }
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    const payload = { workspaceId: selected.workspaceId, id: selected.id, title: title, body: bodyDraft }
    const expected = expectedUpdatedAtRef.current !== ''
      ? expectedUpdatedAtRef.current
      : (detail.data && typeof detail.data.updatedAt === 'string' ? detail.data.updatedAt : '')
    if (opts.force === true) payload.force = true
    else if (expected !== '') payload.expectedUpdatedAt = expected
    const key = keyOf(selected)
    return api.saveDocument(payload).then(function (value) {
      const summary = value && value.document ? value.document : null
      if (summary && typeof summary.updatedAt === 'string') {
        expectedUpdatedAtRef.current = summary.updatedAt
      }
      setDetail(function (prev) {
        if (prev.key !== key) return prev
        return {
          loading: false, error: '', body: payload.body,
          data: summary || prev.data, key: key,
        }
      })
      setSelected(function (prev) {
        return prev && prev.id === payload.id
          ? Object.assign({}, prev, summary || {}, { title: title })
          : prev
      })
      setList(function (prev) {
        return Object.assign({}, prev, {
          data: prev.data.map(function (doc) {
            if (!doc || doc.id !== payload.id) return doc
            return Object.assign({}, doc, summary || {}, { title: title })
          }),
        })
      })
      dirtyRef.current = false
      setDirty(false)
      setConflict(false)
      showToast('info', opts.successText || t('project.documents.saved'))
      return true
    }, function (err) {
      if (err && err.code === 'document-conflict') {
        setConflict(true)
        setSaveError('')
        return false
      }
      setSaveError(errorText(err))
      return false
    }).finally(function () {
      savingRef.current = false
      setSaving(false)
    })
  }
  function overwriteSave() {
    if (savingRef.current) return
    saveDocument({ force: true, successText: t('project.documents.conflict.overwritten') }).catch(noop)
  }
  function reloadConflict() {
    if (!selected || savingRef.current) return Promise.resolve(false)
    const target = selected
    const key = keyOf(target)
    return api.getDocument({ workspaceId: target.workspaceId, id: target.id }).then(function (value) {
      const summary = value && value.document ? value.document : null
      const body = value && typeof value.body === 'string' ? value.body : ''
      expectedUpdatedAtRef.current = summary && typeof summary.updatedAt === 'string'
        ? summary.updatedAt
        : ''
      setDetail({ loading: false, error: '', body: body, data: summary || target, key: key })
      setConflict(false)
      setSaveError('')
      showToast('info', t('project.documents.conflict.reloaded'))
      return true
    }, function (err) {
      setSaveError(errorText(err))
      return false
    })
  }
  useEffect(function () {
    listSeqRef.current += 1
    detailSeqRef.current += 1
    searchRef.current.cancel()
    setSelected(null)
    setDetail(EMPTY_DETAIL)
    setEditing(false)
    setTitleDraft('')
    setBodyDraft('')
    dirtyRef.current = false
    setDirty(false)
    setSaving(false)
    setSaveError('')
    setConflict(false)
    setCreateModal(null)
    setDeleteModal(null)
    setSearch('')
    setScope(SEARCH_SCOPE_TITLE)
    setLimit(LIST_PAGE_SIZE)
    setFullSearch(EMPTY_FULL_SEARCH)
    loadList()
    return function () {
      listSeqRef.current += 1
      detailSeqRef.current += 1
      searchRef.current.cancel()
    }
  }, [workspaceId, configured])
  useEffect(function () {
    const controller = searchRef.current
    const activeScope = scope === SEARCH_SCOPE_FULL ? SEARCH_SCOPE_FULL : SEARCH_SCOPE_TITLE
    const trimmed = trimSearch(search)
    if (activeScope !== SEARCH_SCOPE_FULL || trimmed === '' || !workspaceId || configured === false) {
      controller.cancel()
      setFullSearch(function (prev) {
        if (prev.scope === '' && prev.query === '' && prev.loading === false &&
            prev.error === '' && prev.items.length === 0) return prev
        return EMPTY_FULL_SEARCH
      })
      return undefined
    }
    controller.schedule(workspaceId, trimmed)
    return function () { controller.cancel() }
  }, [scope, search, workspaceId, configured])
  const selectedKey = keyOf(selected)
  useEffect(function () {
    if (!selected) {
      detailSeqRef.current += 1
      setDetail(EMPTY_DETAIL)
      return undefined
    }
    loadDetail(selected)
    return undefined
  }, [selectedKey])
  useEffect(function () {
    if (!dirty) {
      if (guardRef.current !== null) {
        clearLeaveGuard(guardRef.current)
        guardRef.current = null
      }
      return undefined
    }
    const guard = function () { return requestLeave() }
    guardRef.current = guard
    setLeaveGuard(guard)
    return function () {
      if (guardRef.current === guard) {
        clearLeaveGuard(guard)
        guardRef.current = null
      }
    }
  }, [dirty])
  useEffect(function () {
    if (typeof window === 'undefined') return undefined
    function onBeforeUnload(event) {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return function () { window.removeEventListener('beforeunload', onBeforeUnload) }
  }, [])
  useEffect(function () {
    return function () {
      searchRef.current.cancel()
      if (guardRef.current !== null) {
        clearLeaveGuard(guardRef.current)
        guardRef.current = null
      }
    }
  }, [])
  const documents = (Array.isArray(list.data) ? list.data : []).filter(function (doc) {
    return doc && typeof doc.id === 'string' && doc.id !== ''
  })
  const trimmedQuery = trimSearch(search)
  const fullSearchActive = scope === SEARCH_SCOPE_FULL && trimmedQuery !== ''
  const remoteResult = fullSearchActive && fullSearch.scope === SEARCH_SCOPE_FULL &&
    fullSearch.query === trimmedQuery ? fullSearch : null
  const searching = fullSearchActive && (remoteResult === null || remoteResult.loading === true)
  const searchError = fullSearchActive && remoteResult !== null && remoteResult.loading !== true
    ? remoteResult.error
    : ''
  let scoped
  if (scope === SEARCH_SCOPE_FULL) {
    if (trimmedQuery === '') scoped = documents
    else if (remoteResult === null) scoped = []
    else scoped = mergeSearchItems(remoteResult.items, documents)
  } else {
    scoped = documents.filter(function (doc) { return documentTitleMatches(doc, trimmedQuery) })
  }
  const pageSize = Number(limit) > 0 ? Number(limit) : LIST_PAGE_SIZE
  const visible = scoped.slice(0, pageSize)
  const hasMore = scoped.length > visible.length
  const searchHasMore = fullSearchActive && remoteResult !== null && searchError === '' &&
    remoteResult.hasMore === true
  const currentDetail = selected
    ? (detail.key === selectedKey ? detail : Object.assign({}, EMPTY_DETAIL, { loading: true, data: selected, key: selectedKey }))
    : EMPTY_DETAIL
  const detailTitle = currentDetail.data && typeof currentDetail.data.title === 'string'
    ? currentDetail.data.title
    : (selected ? String(selected.title || selected.id) : '')
  const detailBody = typeof currentDetail.body === 'string' ? currentDetail.body : bodyDraft
  function listRow(doc) {
    const active = Boolean(selected && selected.id === doc.id)
    return h('div', {
      key: doc.id,
      className: 'devbench-master-row' + (active ? ' active' : ''),
      role: 'button', tabIndex: 0,
      'aria-current': active ? 'page' : undefined,
      onClick() { requestSelect(doc) },
      onKeyDown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          requestSelect(doc)
        }
      },
    },
    h('div', { className: 'devbench-master-row-main' },
      h('div', { className: 'devbench-master-row-title', title: doc.title }, doc.title || doc.id)))
  }
  let listBody
  if (!configured) {
    listBody = h('div', { className: 'devbench-empty-panel', style: { margin: '10px 4px' } },
      h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, t('project.documents.unconfigured')),
      typeof props.onOpenSettings === 'function'
        ? h('button', { className: 'devbench-btn primary', style: { marginTop: '10px' }, onClick: props.onOpenSettings },
          t('project.documents.settings'))
        : null)
  } else if (list.loading && documents.length === 0) {
    listBody = h('div', { className: 'devbench-inline-loading' }, t('panel.loading'))
  } else if (list.error !== '') {
    listBody = h('div', { className: 'devbench-flexcol', style: { padding: '10px 4px' } },
      h(Banner, { kind: 'error' }, list.error),
      h('button', {
        className: 'devbench-btn', type: 'button', onClick() { loadList() },
      }, t('panel.retry')))
  } else if (searching) {
    listBody = h('div', { className: 'devbench-inline-loading' }, t('project.documents.search.loading'))
  } else if (searchError !== '') {
    listBody = h('div', { className: 'devbench-flexcol', style: { padding: '10px 4px' } },
      h(Banner, { kind: 'error' }, searchError),
      h('button', {
        className: 'devbench-btn', type: 'button',
        title: t('project.documents.search.retry'),
        onClick() { return retrySearch() },
      }, t('project.documents.search.retry')))
  } else if (documents.length === 0) {
    listBody = h('div', { className: 'devbench-hint', style: { padding: '18px 8px', textAlign: 'center' } },
      t('project.documents.empty'))
  } else if (scoped.length === 0) {
    listBody = h('div', { className: 'devbench-hint', style: { padding: '18px 8px', textAlign: 'center' } },
      t('project.documents.emptyFilter'))
  } else {
    listBody = visible.map(listRow)
  }
  const footItems = []
  if (hasMore) {
    footItems.push(h('button', { key: 'more', className: 'devbench-btn', type: 'button', onClick: loadMore },
      t('list.loadMore', { count: visible.length })))
  }
  if (searchHasMore) {
    footItems.push(h('span', {
      key: 'hasMore',
      className: 'devbench-hint',
      style: { marginTop: 0, textAlign: 'center' },
    }, t('project.documents.search.hasMore', { count: remoteResult.items.length })))
  }
  if (footItems.length === 0 && scoped.length > 0 && searching === false && searchError === '') {
    footItems.push(h('span', { key: 'all', className: 'devbench-hint' }, t('list.shownAll', { total: scoped.length })))
  }
  let listFoot = null
  if (footItems.length === 1) listFoot = footItems[0]
  else if (footItems.length > 1) listFoot = h('div', { className: 'devbench-flexcol', style: { alignItems: 'center' } }, footItems)
  const masterList = h('aside', { className: 'devbench-master-list', 'aria-label': t('project.documents.title') },
    h('div', { className: 'devbench-master-list-head' },
      h('div', { className: 'devbench-master-list-title' },
        h('span', null, t('project.documents.title')),
        scoped.length > 0
          ? h('span', { className: 'devbench-muted' }, t('detail.list.count', { count: scoped.length }))
          : null,
        h('span', { className: 'spacer' }),
        h('button', {
          className: 'devbench-btn primary',
          type: 'button',
          disabled: !configured,
          title: configured ? t('project.documents.new') : t('project.documents.unconfigured'),
          onClick: openCreateModal,
        }, h(IconPlus, { size: 13 }), t('project.documents.new'))),
      h('div', { className: 'devbench-inline devbench-master-list-search', style: { gap: '6px' } },
        h('input', {
          className: 'devbench-input',
          style: { fontSize: '12px', padding: '5px 8px', minWidth: 0, flex: '1 1 108px' },
          placeholder: t('project.documents.search'),
          'aria-label': t('project.documents.search'),
          value: search,
          onChange(event) { changeSearch(event.target.value) },
        }),
        h('select', {
          className: 'devbench-input devbench-search-scope',
          value: scope,
          title: t('project.documents.search.scope'),
          'aria-label': t('project.documents.search.scope'),
          onChange(event) { changeScope(event.target.value) },
        }, [SEARCH_SCOPE_TITLE, SEARCH_SCOPE_FULL].map(function (value) {
          return h('option', { key: value, value: value }, t('project.documents.search.' + value))
        })))),
    h('div', { className: 'devbench-master-list-body' }, listBody),
    listFoot ? h('div', { className: 'devbench-master-list-foot' }, listFoot) : null)
  function editorElement() {
    return h(MarkdownEditor, {
      t: t,
      value: bodyDraft,
      disabled: saving,
      height: '46vh',
      ariaLabel: t('project.documents.editor.aria'),
      onChange(value) {
        setBodyDraft(value)
        markDirty(titleDraft, value)
      },
      onSave() { saveDocument().catch(noop) },
      onOpenHelp() { setMarkdownHelpOpen(true) },
    })
  }
  let detailSide
  if (!selected) {
    detailSide = h('div', { className: 'devbench-master-empty' },
      h(IconFile, { size: 22 }),
      h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } },
        t('project.documents.empty.title')),
      h('div', null, t('project.documents.empty.body')),
      configured
        ? h('button', { className: 'devbench-btn primary', type: 'button', onClick: openCreateModal },
          h(IconPlus, { size: 14 }), t('project.documents.new'))
        : null)
  } else {
    const activeDetail = currentDetail
    let bodyElement
    if (activeDetail.loading) {
      bodyElement = h('div', { className: 'devbench-inline-loading' }, t('panel.loading'))
    } else if (activeDetail.error !== '') {
      bodyElement = h('div', null,
        h(Banner, { kind: 'error' }, activeDetail.error),
        h('button', {
          className: 'devbench-btn', type: 'button', style: { marginTop: '8px' },
          onClick() { loadDetail(selected) },
        }, t('panel.retry')))
    } else if (editing) {
      bodyElement = editorElement()
    } else if (String(detailBody).trim() === '') {
      bodyElement = h('div', { className: 'devbench-hint' }, t('project.documents.noBody'))
    } else {
      bodyElement = h('div', { className: 'devbench-md' }, renderMarkdown(detailBody))
    }
    const headActions = editing
      ? [
        h('button', {
          key: 'save',
          className: 'devbench-btn primary',
          type: 'button',
          disabled: saving || !dirty,
          onClick() { saveDocument().catch(noop) },
        }, saving ? t('project.documents.saving') : t('project.documents.save')),
        h('button', {
          key: 'done',
          className: 'devbench-btn ghost',
          type: 'button',
          disabled: saving,
          onClick: exitEditing,
        }, t('detail.editor.done')),
      ]
      : [
        h('button', {
          key: 'edit',
          className: 'devbench-icon-btn',
          type: 'button',
          title: t('project.documents.edit'),
          'aria-label': t('project.documents.edit'),
          disabled: activeDetail.loading || activeDetail.error !== '',
          onClick: enterEdit,
        }, h(IconEdit, { size: 15 })),
        h('button', {
          key: 'delete',
          className: 'devbench-icon-btn',
          type: 'button',
          title: t('project.documents.delete'),
          'aria-label': t('project.documents.delete'),
          disabled: activeDetail.loading || saving,
          onClick() { openDeleteModal(selected) },
        }, h(IconTrash, { size: 15 })),
      ]
    const created = activeDetail.data && activeDetail.data.createdAt
    const updated = activeDetail.data && activeDetail.data.updatedAt
    detailSide = h('div', { className: 'devbench-master-detail' },
      h('div', { className: 'devbench-master-detail-head' },
        h('div', { className: 'devbench-inline', style: { gap: '8px', alignItems: 'flex-start', minWidth: 0 } },
          h('div', { style: { flex: 1, minWidth: 0 } },
            editing
              ? h('input', {
                className: 'devbench-input',
                style: { fontSize: '14px', fontWeight: 600, height: '32px' },
                value: titleDraft,
                disabled: saving,
                title: detailTitle,
                'aria-label': t('detail.title'),
                onChange(event) {
                  const value = event.target.value
                  setTitleDraft(value)
                  markDirty(value, bodyDraft)
                },
                onKeyDown(event) {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    saveDocument().catch(noop)
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                },
              })
              : h('div', {
                style: { fontSize: '15px', fontWeight: 650, wordBreak: 'break-word', color: 'var(--dsw-alias-label-primary)' },
                title: detailTitle,
              }, detailTitle)),
          h('div', { className: 'devbench-page-actions' }, headActions))),
      h('div', { className: 'devbench-master-detail-body' },
        h('div', {
          className: 'devbench-inline',
          style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' },
        },
        h('span', { className: 'devbench-mono' }, selected.id),
        created ? h('span', null, t('project.documents.createdAt') + ': ' + formatTime(created)) : null,
        updated ? h('span', null, t('project.documents.updatedAt') + ': ' + formatTime(updated)) : null),
        conflict
          ? h(Banner, { kind: 'error' },
            h('div', { className: 'devbench-inline', style: { flexWrap: 'wrap', gap: '8px' } },
              h('span', { style: { flex: 1, minWidth: 0 } }, t('project.documents.conflict.banner')),
              h('button', {
                className: 'devbench-btn', type: 'button', disabled: saving,
                onClick() { reloadConflict().catch(noop) },
              }, t('project.documents.conflict.reload')),
              h('button', {
                className: 'devbench-btn primary danger', type: 'button', disabled: saving,
                onClick: overwriteSave,
              }, t('project.documents.conflict.overwrite'))))
          : null,
        saveError !== '' ? h(Banner, { kind: 'error' }, saveError) : null,
        bodyElement),
      editing
        ? h('div', { className: 'devbench-master-detail-foot' },
          h('span', { className: 'devbench-hint' }, t('project.documents.saveHint')),
          h('span', { style: { flex: 1 } }),
          dirty
            ? h('span', {
              className: 'devbench-hint',
              style: { color: 'var(--dsw-alias-state-warn-primary)', fontWeight: 600 },
            }, t('detail.saveState.unsaved'))
            : null)
        : null)
  }
  const master = workspace
    ? h('div', { className: 'devbench-master' }, masterList, detailSide)
    : h('div', { className: 'devbench-master' },
      h('div', { className: 'devbench-master-empty' }, t('project.selectHint')))
  let createModalElement = null
  if (createModal) {
    createModalElement = h(Modal, {
      t: t,
      title: t('project.documents.new.title'),
      onClose: requestCreateClose,
      onCancel: requestCreateClose,
      confirmText: createModal.busy ? t('project.documents.new.creating') : t('project.documents.new.create'),
      confirmDisabled: createModal.busy === true || createModal.title.trim() === '',
      onConfirm: submitCreate,
    }, h('div', { className: 'devbench-flexcol' },
      h('label', { className: 'devbench-hint' }, t('project.documents.new.name')),
      h('input', {
        className: 'devbench-input', autoFocus: true,
        placeholder: t('project.documents.new.name.placeholder'),
        value: createModal.title, disabled: createModal.busy === true,
        onChange(event) {
          const value = event.target.value
          setCreateModal(function (prev) { return Object.assign({}, prev, { title: value }) })
        },
        onKeyDown(event) {
          if (event.key === 'Enter' && createModal.busy === false && createModal.title.trim() !== '') submitCreate()
        },
      }),
      h('label', { className: 'devbench-hint' }, t('project.documents.new.body')),
      h('textarea', {
        className: 'devbench-textarea devbench-mono', rows: 8,
        placeholder: t('project.documents.new.body.placeholder'),
        value: createModal.body, disabled: createModal.busy === true,
        onChange(event) {
          const value = event.target.value
          setCreateModal(function (prev) { return Object.assign({}, prev, { body: value }) })
        },
      }),
      createModal.error ? h(Banner, { kind: 'error' }, createModal.error) : null))
  }
  let deleteModalElement = null
  if (deleteModal) {
    const doc = deleteModal.doc
    deleteModalElement = h(Modal, {
      t: t,
      title: t('project.documents.delete.title'),
      danger: true,
      confirmText: deleteModal.busy ? t('project.documents.delete.busy') : t('action.delete'),
      confirmDisabled: deleteModal.busy,
      onCancel() { if (deleteModal.busy === false) setDeleteModal(null) },
      onConfirm: submitDelete,
    }, h('div', { className: 'devbench-flexcol' },
      h('div', { className: 'devbench-hint' },
        t('project.documents.delete.body', { name: doc.title || doc.id })),
      deleteModal.error ? h(Banner, { kind: 'error' }, deleteModal.error) : null))
  }
  const markdownHelpElement = markdownHelpOpen
    ? h(Modal, {
      t: t,
      title: t('markdown.help.title'),
      size: 'lg',
      actions: false,
      onCancel() { setMarkdownHelpOpen(false) },
      onClose() { setMarkdownHelpOpen(false) },
    }, h(MarkdownHelp, { t: t }))
    : null
  return h(getFragment(), null, master, createModalElement, deleteModalElement, markdownHelpElement)
}
