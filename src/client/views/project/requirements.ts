/** Requirements master-detail: list on the left, DetailView on the right.
 *  List search/filter/pagination/scroll live in uiStore; the search box filters
 *  title+id locally (default) or debounces a host-side full-text search; selecting
 *  a row runs the leave guard first so unsaved detail drafts are never discarded. */
import { h, getFragment, useState, useEffect, useRef, errorText, t as translate, getRuntimeContext } from '../../runtime.js'
import { useUiState, uiStore, setListState } from '../../core/ui-store.js'
import { runLeaveGuard } from '../../core/navigation.js'
import { confirmDialog } from '../../ui/dialogs.js'
import * as api from '../../core/api.js'
import type { RequirementDetail, RequirementSummary, RequirementSelection, RequirementSearchItem, SearchResult } from '../../../shared/api-types.js'
import type { FullTextSearch } from '../../core/search.js'
import { createSingleFlight } from '../../core/async.js'
import { createFullTextSearch, mergeSearchItems } from '../../core/search.js'
import { isActiveTask } from '../../core/project-utils.js'
import { Banner, Modal, formatShortTime } from '../../ui/common.js'
import { DetailView } from './requirement-detail.js'
import { IconPlus, IconTrash, IconReq, IconStar } from '../../ui/icons.js'
const requirementExecutions = createSingleFlight()
const REQUIREMENT_STATUSES = ['new', 'running', 'done', 'archived', 'cancelled']
const DEFAULT_LIST_STATE = { search: '', status: 'all', favoriteOnly: false, scope: 'title', limit: 10, scrollTop: 0 }
const LIST_PAGE_SIZE = 10
const SEARCH_SCOPE_TITLE = 'title'
const SEARCH_SCOPE_FULL = 'full'
/** Search result state; `scope === ''` means "no full-text result cached yet". */
const EMPTY_FULL_SEARCH = {
  scope: '', query: '', loading: false, error: '', items: [], hasMore: false, total: 0,
}
function noop() {}
function keyOf(selected) {
  return selected ? selected.workspaceId + '/' + selected.id : ''
}
function trimSearch(value) {
  return String(value === undefined || value === null ? '' : value).trim()
}
/** Title-scope filter: case-insensitive substring over the requirement title and id. */
export function titleMatches(item, query) {
  if (!item) return false
  const needle = trimSearch(query).toLowerCase()
  if (needle === '') return true
  return String(item.title || '').toLowerCase().indexOf(needle) >= 0 ||
    String(item.id || '').toLowerCase().indexOf(needle) >= 0
}
export function ProjectRequirements(props) {
  const t = props.t || translate
  const ui = useUiState()
  const [detail, setDetail] = useState<{ loading: boolean; error: string; data: RequirementDetail | null; key: string }>({ loading: false, error: '', data: null, key: '' })
  const [createModal, setCreateModal] = useState<{ title: string; body: string; worktree: boolean; busy: boolean; error: string } | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ item: RequirementSelection & Partial<RequirementSummary>; busy: boolean; error: string } | null>(null)
  const [unlinkBusy, setUnlinkBusy] = useState(false)
  const [fullSearch, setFullSearch] = useState<{
    scope: string; query: string; loading: boolean; error: string; items: RequirementSearchItem[]; hasMore: boolean; total: number
  }>(EMPTY_FULL_SEARCH)
  const [favoriteBusyId, setFavoriteBusyId] = useState('')
  const detailSeqRef = useRef(0)
  const createBusyRef = useRef(false)
  const deleteBusyRef = useRef(false)
  const unlinkBusyRef = useRef(false)
  const favoriteBusyRef = useRef(new Set<string>())
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const scrollFrameRef = useRef(0)
  const searchRef = useRef<FullTextSearch<SearchResult<RequirementSearchItem>> | null>(null)
  if (searchRef.current === null) {
    searchRef.current = createFullTextSearch({
      search(workspaceId, query) {
        return api.searchRequirements(workspaceId, query, SEARCH_SCOPE_FULL)
      },
      onEvent(event) {
        if (event.type === 'start') {
          setFullSearch({
            scope: SEARCH_SCOPE_FULL, query: event.query, loading: true,
            error: '', items: [], hasMore: false, total: 0,
          })
          return
        }
        if (event.type === 'success') {
          const value: Partial<SearchResult<RequirementSearchItem>> = event.value || {}
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
          error: errorText(event.error) || t('project.requirements.search.failed'),
          items: [], hasMore: false, total: 0,
        })
      },
    })
  }
  const showToast = typeof props.showToast === 'function' ? props.showToast : noop
  function reloadState() {
    return typeof props.onReloadState === 'function' ? props.onReloadState() : Promise.resolve(null)
  }
  const workspace = props.workspace || null
  const workspaceId = workspace ? workspace.workspaceId : (ui.selectedProjectId || '')
  const rawSelected = ui.selectedRequirement
  const selected = workspace && rawSelected && rawSelected.workspaceId === workspace.workspaceId
    ? rawSelected
    : null
  const selectedKey = keyOf(selected)
  const lists = (ui.lists && ui.lists.requirements) || DEFAULT_LIST_STATE
  const tasks = Array.isArray(props.tasks) ? props.tasks : []
  function selectedMatches(item) {
    const current = uiStore.state.selectedRequirement
    return Boolean(current && item && current.workspaceId === item.workspaceId && current.id === item.id)
  }
  function loadDetail(item) {
    if (!item) return Promise.resolve(null)
    const key = keyOf(item)
    const seq = ++detailSeqRef.current
    setDetail(function (prev) {
      return { loading: true, error: '', data: prev.key === key ? prev.data : null, key: key }
    })
    return api.getRequirement({ workspaceId: item.workspaceId, id: item.id }).then(function (value) {
      if (detailSeqRef.current !== seq || selectedMatches(item) === false) return null
      setDetail({ loading: false, error: '', data: value, key: key })
      return value
    }, function (err) {
      if (detailSeqRef.current !== seq || selectedMatches(item) === false) return null
      setDetail(function (prev) {
        return { loading: false, error: errorText(err), data: prev.key === key ? prev.data : null, key: key }
      })
      throw err
    })
  }
  useEffect(function () {
    if (selected) {
      loadDetail(selected).catch(noop)
      return
    }
    detailSeqRef.current += 1
    setDetail({ loading: false, error: '', data: null, key: '' })
  }, [selectedKey])
  useEffect(function () {
    function onFocus() {
      const current = uiStore.state.selectedRequirement
      if (current) loadDetail(current).catch(noop)
    }
    window.addEventListener('focus', onFocus)
    return function () { window.removeEventListener('focus', onFocus) }
  }, [])
  useEffect(function () {
    const el = listBodyRef.current
    if (!el || typeof el.scrollTop !== 'number') return
    const current = uiStore.state.lists && uiStore.state.lists.requirements
    const top = current ? Number(current.scrollTop) || 0 : 0
    if (top > 0) el.scrollTop = top
  }, [workspaceId])
  // Full-text scope: debounce the persisted query, cancel on scope change/unmount
  // and re-run automatically when the tab mounts again with a saved query.
  useEffect(function () {
    const controller = searchRef.current
    const scope = lists.scope === SEARCH_SCOPE_FULL ? SEARCH_SCOPE_FULL : SEARCH_SCOPE_TITLE
    const trimmed = trimSearch(lists.search)
    const activeWorkspaceId = workspace ? workspace.workspaceId : ''
    if (scope !== SEARCH_SCOPE_FULL || trimmed === '' || activeWorkspaceId === '') {
      controller.cancel()
      setFullSearch(function (prev) {
        if (prev.scope === '' && prev.query === '' && prev.loading === false &&
            prev.error === '' && prev.items.length === 0) return prev
        return EMPTY_FULL_SEARCH
      })
      return undefined
    }
    controller.schedule(activeWorkspaceId, trimmed)
    return function () { controller.cancel() }
  }, [lists.scope, lists.search, workspace ? workspace.workspaceId : ''])
  function hasActiveTask(requirementId) {
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index]
      if (task && task.kind === 'requirement' && task.requirementId === requirementId && isActiveTask(task)) {
        return true
      }
    }
    return false
  }
  function selectRequirement(nextWorkspaceId, id) {
    const current = uiStore.state.selectedRequirement
    if (current && current.workspaceId === nextWorkspaceId && current.id === id) return Promise.resolve(true)
    return runLeaveGuard().then(function (allowed) {
      if (!allowed) return false
      uiStore.set({
        view: 'project',
        selectedProjectId: nextWorkspaceId,
        selectedRequirement: { workspaceId: nextWorkspaceId, id: id },
        activeTab: 'requirements',
      })
      return true
    })
  }
  function backToList() {
    return runLeaveGuard().then(function (allowed) {
      if (!allowed) return false
      detailSeqRef.current += 1
      setDetail({ loading: false, error: '', data: null, key: '' })
      uiStore.set({ selectedRequirement: null })
      return true
    })
  }
  function changeSearch(value) {
    setListState('requirements', { search: value, limit: LIST_PAGE_SIZE })
  }
  function changeScope(value) {
    const next = value === SEARCH_SCOPE_FULL ? SEARCH_SCOPE_FULL : SEARCH_SCOPE_TITLE
    setListState('requirements', { scope: next, limit: LIST_PAGE_SIZE })
  }
  function retrySearch() {
    if (!workspace) return Promise.resolve(null)
    return searchRef.current.run(workspace.workspaceId, lists.search)
  }
  function changeStatus(value) {
    setListState('requirements', { status: value, limit: LIST_PAGE_SIZE })
  }
  function loadMore() {
    const limit = Number(lists.limit) > 0 ? Number(lists.limit) : LIST_PAGE_SIZE
    setListState('requirements', { limit: limit + LIST_PAGE_SIZE })
  }
  function onListScroll(event) {
    const target = event && event.target
    if (!target) return
    const top = Number(target.scrollTop) || 0
    if (scrollFrameRef.current !== 0) return
    function save() {
      scrollFrameRef.current = 0
      setListState('requirements', { scrollTop: top })
    }
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      scrollFrameRef.current = window.requestAnimationFrame(save)
      return
    }
    save()
  }
  function openCreateModal() {
    if (createModal !== null) return
    setCreateModal({ title: '', body: '', worktree: false, busy: false, error: '' })
  }
  function createDraftDirty(modal) {
    if (!modal) return false
    return modal.title.trim() !== '' || modal.body.trim() !== '' || modal.worktree === true
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
    if (createModal === null || createBusyRef.current) return
    const title = createModal.title.trim()
    if (title === '') return
    createBusyRef.current = true
    setCreateModal(function (prev) { return Object.assign({}, prev, { busy: true, error: '' }) })
    const targetWorkspaceId = workspace ? workspace.workspaceId : workspaceId
    api.createRequirement({
      workspaceId: targetWorkspaceId,
      title: title,
      body: createModal.body,
      worktree: createModal.worktree === true,
    }).then(function (result) {
      createBusyRef.current = false
      setCreateModal(null)
      const created = result && result.requirement ? result.requirement : null
      reloadState().catch(function () { showToast('error', t('common.refreshFailed')) })
      if (created && created.id) {
        selectRequirement(targetWorkspaceId, created.id).catch(noop)
      }
    }, function (err) {
      createBusyRef.current = false
      setCreateModal(function (prev) {
        return prev ? Object.assign({}, prev, { busy: false, error: errorText(err) }) : null
      })
    })
  }
  function openDeleteModal(item) {
    if (item.status === 'running') {
      showToast('info', t('delete.requirement.running'))
      return
    }
    if (hasActiveTask(item.id)) {
      showToast('info', t('detail.delete.blockedActive'))
      return
    }
    const current = uiStore.state.selectedRequirement
    const deletingSelected = Boolean(current && current.workspaceId === item.workspaceId && current.id === item.id)
    if (!deletingSelected) {
      setDeleteModal({ item: item, busy: false, error: '' })
      return
    }
    runLeaveGuard().then(function (allowed) {
      if (allowed) setDeleteModal({ item: item, busy: false, error: '' })
    }).catch(noop)
  }
  function submitDelete() {
    if (deleteModal === null || deleteBusyRef.current) return
    const item = deleteModal.item
    deleteBusyRef.current = true
    setDeleteModal(function (prev) {
      return prev ? Object.assign({}, prev, { busy: true, error: '' }) : null
    })
    api.deleteRequirement({ workspaceId: item.workspaceId, id: item.id }).then(function () {
      deleteBusyRef.current = false
      setDeleteModal(null)
      showToast('info', t('project.requirements.deleted'))
      const current = uiStore.state.selectedRequirement
      if (current && current.workspaceId === item.workspaceId && current.id === item.id) {
        detailSeqRef.current += 1
        setDetail({ loading: false, error: '', data: null, key: '' })
        uiStore.set({ selectedRequirement: null })
      }
      reloadState().catch(function () { showToast('error', t('common.refreshFailed')) })
    }, function (err) {
      deleteBusyRef.current = false
      setDeleteModal(function (prev) {
        return prev ? Object.assign({}, prev, { busy: false, error: errorText(err) }) : null
      })
    })
  }
  function markFavoriteLocally(id, favorite) {
    setFullSearch(function (prev) {
      if (!prev.items.some(function (hit) { return hit && hit.id === id })) return prev
      return Object.assign({}, prev, {
        items: prev.items.map(function (hit) {
          return hit && hit.id === id ? Object.assign({}, hit, { favorite: favorite }) : hit
        }),
      })
    })
  }
  function toggleFavorite(item) {
    if (!item || typeof item.id !== 'string' || item.id === '') return
    if (favoriteBusyRef.current.has(item.id)) return
    const targetWorkspaceId = item.workspaceId || (workspace ? workspace.workspaceId : workspaceId)
    if (!targetWorkspaceId) return
    const nextFavorite = item.favorite !== true
    favoriteBusyRef.current.add(item.id)
    setFavoriteBusyId(item.id)
    api.setRequirementFavorite({
      workspaceId: targetWorkspaceId, id: item.id, favorite: nextFavorite,
    }).then(function () {
      favoriteBusyRef.current.delete(item.id)
      setFavoriteBusyId('')
      markFavoriteLocally(item.id, nextFavorite)
      reloadState().catch(function () { showToast('error', t('common.refreshFailed')) })
    }, function (err) {
      favoriteBusyRef.current.delete(item.id)
      setFavoriteBusyId('')
      showToast('error', errorText(err) || t('project.requirements.favoriteFailed'))
    })
  }
  function markRequirementRunning(item) {
    return api.saveRequirement({
      workspaceId: item.workspaceId, id: item.id, status: 'running',
    }).catch(function (err) {
      showToast('error', t('detail.execute.markRunningFailed', { error: errorText(err) }))
    })
  }
  function runExecution(item) {
    const ctx = getRuntimeContext()
    let promptText = ''
    let promptSent = false
    let linkedSummary = null
    return api.executeRequirement({ workspaceId: item.workspaceId, id: item.id, markRunning: false })
      .then(function (result) {
        promptText = result.prompt
        if (result.worktree && result.worktree.enabled === true &&
            typeof result.cwd === 'string' && result.cwd.length > 0) {
          return ctx.sessions.create({ cwd: result.cwd })
        }
        return ctx.sessions.create({ workspaceId: item.workspaceId })
      })
      .then(function (id) {
        return api.linkSession({ workspaceId: item.workspaceId, id: item.id, sessionId: id })
          .then(function (value) {
            linkedSummary = value && value.requirement ? value.requirement : null
            return id
          })
      })
      .then(function (id) {
        const requestId = 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
        return ctx.remote.session.prompt({
          requestId: requestId, sessionId: id, mode: 'queue',
          content: [{ type: 'text', text: promptText }],
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }).then(function (result) {
          if (result.ok === false) throw new Error(result.error.message)
          promptSent = true
          return id
        })
      })
      .then(function (id) {
        return api.recordRequirementTask({
          workspaceId: item.workspaceId, id: item.id, sessionId: id,
        }).then(function () { return id }, function (err) {
          showToast('error', t('project.task.recordFailed') + ': ' + errorText(err))
          return id
        })
      })
      .then(function (id) {
        ctx.remote.session.rename({ sessionId: id, title: item.title }).catch(noop)
        return markRequirementRunning(item).then(function () { return id })
      })
      .then(function (id) {
        const selectedNext = { workspaceId: item.workspaceId, id: item.id }
        const key = keyOf(selectedNext)
        if (linkedSummary) {
          setDetail(function (prev) {
            if (prev.key !== key || prev.data === null) return prev
            return Object.assign({}, prev, {
              data: Object.assign({}, prev.data, { requirement: linkedSummary }),
            })
          })
        }
        const reloadTasks = typeof props.onReloadTasks === 'function'
          ? props.onReloadTasks()
          : Promise.resolve(null)
        return Promise.allSettled([loadDetail(selectedNext), reloadState(), reloadTasks]).then(function () {
          ctx.uiWorkspace.openSession(id)
          return id
        })
      }, function (err) {
        let rollback = Promise.resolve()
        if (promptSent === false && item.previousStatus && item.previousStatus !== 'running') {
          rollback = api.saveRequirement({
            workspaceId: item.workspaceId, id: item.id, status: item.previousStatus,
          }).then(noop, noop)
        }
        return rollback.then(function () {
          loadDetail({ workspaceId: item.workspaceId, id: item.id }).catch(noop)
          reloadState().catch(noop)
          throw err
        })
      })
  }
  function executeRequirement(item) {
    const key = item.workspaceId + '/' + item.id
    return requirementExecutions.run(key, function () {
      return runExecution(item)
    }).catch(function (err) {
      showToast('error', errorText(err))
      throw err
    })
  }
  function unlinkSession(requirement, sessionId) {
    if (unlinkBusyRef.current) return
    unlinkBusyRef.current = true
    setUnlinkBusy(true)
    api.unlinkSession({
      workspaceId: requirement.workspaceId, id: requirement.id, sessionId: sessionId,
    }).then(function () {
      const current = uiStore.state.selectedRequirement
      if (current) loadDetail(current).catch(function () { showToast('error', t('common.refreshFailed')) })
      reloadState().catch(function () { showToast('error', t('common.refreshFailed')) })
    }, function (err) {
      showToast('error', errorText(err))
    }).finally(function () {
      unlinkBusyRef.current = false
      setUnlinkBusy(false)
    })
  }
  const requirements = workspace && Array.isArray(workspace.requirements) ? workspace.requirements : []
  const search = typeof lists.search === 'string' ? lists.search : ''
  const statusFilter = typeof lists.status === 'string' && lists.status !== '' ? lists.status : 'all'
  const favoriteOnly = lists.favoriteOnly === true
  const scope = lists.scope === SEARCH_SCOPE_FULL ? SEARCH_SCOPE_FULL : SEARCH_SCOPE_TITLE
  const limit = Number(lists.limit) > 0 ? Number(lists.limit) : LIST_PAGE_SIZE
  const trimmedQuery = search.trim()
  const query = trimmedQuery.toLowerCase()
  const fullSearchActive = scope === SEARCH_SCOPE_FULL && trimmedQuery !== ''
  const remoteResult = fullSearchActive && fullSearch.scope === SEARCH_SCOPE_FULL &&
    fullSearch.query === trimmedQuery ? fullSearch : null
  const searching = fullSearchActive && (remoteResult === null || remoteResult.loading === true)
  const searchError = fullSearchActive && remoteResult !== null && remoteResult.loading !== true
    ? remoteResult.error
    : ''
  let scoped
  if (scope === SEARCH_SCOPE_FULL) {
    if (trimmedQuery === '') scoped = requirements
    else if (remoteResult === null) scoped = []
    else scoped = mergeSearchItems(remoteResult.items, requirements)
  } else {
    scoped = requirements.filter(function (item) { return titleMatches(item, query) })
  }
  const filtered = scoped.filter(function (item) {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false
    if (favoriteOnly && item.favorite !== true) return false
    return true
  })
  const visible = filtered.slice(0, limit)
  const hasMore = filtered.length > visible.length
  const searchHasMore = fullSearchActive && remoteResult !== null && searchError === '' &&
    remoteResult.hasMore === true
  let summary = null
  if (selected) {
    summary = requirements.find(function (item) { return item.id === selected.id }) || null
  }
  const configured = props.configured !== false
  function statusTitle(item) {
    if (hasActiveTask(item.id)) return t('detail.delete.blockedActive')
    if (item.status === 'running') return t('delete.requirement.running')
    return t('project.requirements.delete')
  }
  function rowSnippet(item) {
    const match = item && item.match ? item.match : null
    if (!match || match.field !== 'body') return null
    const snippet = typeof match.snippet === 'string' ? match.snippet : ''
    if (snippet === '') return null
    return h('div', { className: 'devbench-master-row-snippet', title: snippet }, snippet)
  }
  function listRow(item) {
    const active = Boolean(selected && selected.workspaceId === workspace.workspaceId && selected.id === item.id)
    const blocked = hasActiveTask(item.id) || item.status === 'running'
    const title = statusTitle(item)
    return h('div', {
      key: item.id,
      className: 'devbench-master-row' + (active ? ' active' : ''),
      role: 'button', tabIndex: 0,
      'aria-current': active ? 'page' : undefined,
      onClick() { selectRequirement(workspace.workspaceId, item.id).catch(noop) },
      onKeyDown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          selectRequirement(workspace.workspaceId, item.id).catch(noop)
        }
      },
    },
    h('span', { className: 'devbench-dot ' + item.status }),
    h('div', { className: 'devbench-master-row-main' },
      h('div', { className: 'devbench-master-row-title', title: item.title }, item.title || item.id),
      rowSnippet(item),
      h('div', { className: 'devbench-master-row-meta' },
        h('span', { className: 'devbench-mono' }, item.id),
        h('span', null, t('status.' + item.status)),
        hasActiveTask(item.id)
          ? h('span', { className: 'devbench-pill running' }, t('detail.list.activeTask'))
          : null,
        item.worktree === true
          ? h('span', { className: 'devbench-pill' }, t('project.requirements.worktree'))
          : null,
        h('span', null, formatShortTime(item.updatedAt)))),
    h('div', { className: 'devbench-master-row-actions' },
      h('button', {
        className: 'devbench-icon-btn' + (item.favorite === true ? ' active' : ''),
        type: 'button',
        title: item.favorite === true
          ? t('project.requirements.unfavorite')
          : t('project.requirements.favorite'),
        'aria-label': item.favorite === true
          ? t('project.requirements.unfavorite')
          : t('project.requirements.favorite'),
        'aria-pressed': item.favorite === true,
        disabled: favoriteBusyId === item.id,
        onClick(event) {
          event.stopPropagation()
          toggleFavorite(item)
        },
        onKeyDown(event) { event.stopPropagation() },
      }, h(IconStar, { size: 14, filled: item.favorite === true })),
      h('button', {
        className: 'devbench-icon-btn',
        title: title,
        'aria-label': title,
        disabled: blocked,
        onClick(event) {
          event.stopPropagation()
          if (!blocked) openDeleteModal(item)
        },
        onKeyDown(event) { event.stopPropagation() },
      }, h(IconTrash, { size: 14 }))))
  }
  let listBody
  if (!configured) {
    listBody = h('div', { className: 'devbench-empty-panel', style: { margin: '10px 4px' } },
      h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, t('project.requirements.unconfigured')),
      typeof props.onOpenSettings === 'function'
        ? h('button', { className: 'devbench-btn primary', style: { marginTop: '10px' }, onClick: props.onOpenSettings },
          t('project.requirements.settings'))
        : null)
  } else if (requirements.length === 0) {
    listBody = h('div', { className: 'devbench-hint', style: { padding: '18px 8px', textAlign: 'center' } },
      t('project.requirements.empty'))
  } else if (searching) {
    listBody = h('div', { className: 'devbench-inline-loading' }, t('project.requirements.search.loading'))
  } else if (searchError !== '') {
    listBody = h('div', { className: 'devbench-flexcol', style: { padding: '10px 4px' } },
      h(Banner, { kind: 'error' }, searchError),
      h('button', {
        className: 'devbench-btn',
        type: 'button',
        title: t('project.requirements.search.retry'),
        onClick() { return retrySearch() },
      }, t('project.requirements.search.retry')))
  } else if (filtered.length === 0) {
    listBody = h('div', { className: 'devbench-hint', style: { padding: '18px 8px', textAlign: 'center' } },
      t('detail.list.emptyFilter'))
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
    }, t('project.requirements.search.hasMore', { count: remoteResult.items.length })))
  }
  if (footItems.length === 0 && filtered.length > 0 && searching === false && searchError === '') {
    footItems.push(h('span', { key: 'all', className: 'devbench-hint' }, t('list.shownAll', { total: filtered.length })))
  }
  let listFoot = null
  if (footItems.length === 1) listFoot = footItems[0]
  else if (footItems.length > 1) listFoot = h('div', { className: 'devbench-flexcol', style: { alignItems: 'center' } }, footItems)
  const masterList = h('aside', { className: 'devbench-master-list', 'aria-label': t('detail.list.title') },
    h('div', { className: 'devbench-master-list-head' },
      h('div', { className: 'devbench-master-list-title' },
        h('span', null, t('detail.list.title')),
        filtered.length > 0
          ? h('span', { className: 'devbench-muted' }, t('detail.list.count', { count: filtered.length }))
          : null,
        h('span', { className: 'spacer' }),
        h('button', {
          className: 'devbench-btn primary',
          type: 'button',
          disabled: !configured,
          title: configured ? t('project.requirements.new') : t('project.requirements.unconfigured'),
          onClick: openCreateModal,
        }, h(IconPlus, { size: 13 }), t('project.requirements.new'))),
      h('div', { className: 'devbench-inline devbench-master-list-search', style: { gap: '6px' } },
        h('input', {
          className: 'devbench-input',
          style: { fontSize: '12px', padding: '5px 8px', minWidth: 0, flex: '1 1 108px' },
          placeholder: t('project.requirements.search'),
          'aria-label': t('project.requirements.search'),
          value: search,
          onChange(event) { changeSearch(event.target.value) },
        }),
        h('select', {
          className: 'devbench-input devbench-search-scope',
          value: scope,
          title: t('project.requirements.search.scope'),
          'aria-label': t('project.requirements.search.scope'),
          onChange(event) { changeScope(event.target.value) },
        }, [SEARCH_SCOPE_TITLE, SEARCH_SCOPE_FULL].map(function (value) {
          return h('option', { key: value, value: value }, t('project.requirements.search.' + value))
        })),
        h('select', {
          className: 'devbench-input',
          style: { width: 'auto', maxWidth: '118px', fontSize: '12px', padding: '5px 6px', flex: 'none' },
          value: statusFilter,
          title: t('detail.list.filterStatus'),
          'aria-label': t('detail.list.filterStatus'),
          onChange(event) { changeStatus(event.target.value) },
        }, [['all', t('detail.list.filterAll')]].concat(REQUIREMENT_STATUSES.map(function (status) {
          return [status, t('status.' + status)]
        })).map(function (entry) {
          return h('option', { key: entry[0], value: entry[0] }, entry[1])
        })),
        h('button', {
          className: 'devbench-btn' + (favoriteOnly ? ' primary' : ' ghost'),
          type: 'button',
          style: { flex: 'none', height: '26px', padding: '0 8px', fontSize: '12px' },
          title: t('project.requirements.favoriteOnly'),
          'aria-label': t('project.requirements.favoriteOnly'),
          'aria-pressed': favoriteOnly,
          onClick() {
            setListState('requirements', { favoriteOnly: !favoriteOnly, limit: LIST_PAGE_SIZE })
          },
        }, h(IconStar, { size: 13, filled: favoriteOnly }), t('project.requirements.favoriteOnly')))),
    h('div', { className: 'devbench-master-list-body', ref: listBodyRef, onScroll: onListScroll }, listBody),
    listFoot ? h('div', { className: 'devbench-master-list-foot' }, listFoot) : null)
  let detailSide
  if (selected) {
    const currentDetail = detail.key === selectedKey
      ? detail
      : { loading: true, error: '', data: null, key: selectedKey }
    detailSide = h(DetailView, {
      key: 'requirement-' + selectedKey,
      t: t,
      selected: selected,
      workspace: workspace,
      summary: summary,
      detail: currentDetail,
      sessionsHook: props.sessionsHook,
      tasks: tasks,
      onBack: backToList,
      onExecute: executeRequirement,
      onStatusToast: typeof props.onStatusToast === 'function' ? props.onStatusToast : undefined,
      onReloadDetail() {
        const current = uiStore.state.selectedRequirement
        return current ? loadDetail(current) : Promise.resolve(null)
      },
      onReloadState: reloadState,
      onOpenCommit(hash) {
        if (typeof props.onOpenCommit === 'function') props.onOpenCommit(selected.workspaceId, hash)
      },
      onOpenSession(sessionId) {
        runLeaveGuard().then(function (allowed) {
          if (!allowed) return
          const ctx = getRuntimeContext()
          if (ctx && ctx.uiWorkspace && typeof ctx.uiWorkspace.openSession === 'function') {
            try {
              ctx.uiWorkspace.openSession(sessionId)
            } catch (err) {
              showToast('error', errorText(err))
            }
          }
        }).catch(noop)
      },
      onUnlinkSession: unlinkSession,
      showToast: showToast,
      onGoSettings: props.onOpenSettings,
      unlinkBusy: unlinkBusy,
    })
  } else {
    detailSide = h('div', { className: 'devbench-master-empty' },
      h(IconReq, { size: 22 }),
      h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, t('detail.empty.title')),
      h('div', null, t('detail.empty.body')),
      configured
        ? h('button', { className: 'devbench-btn primary', type: 'button', onClick: openCreateModal },
          h(IconPlus, { size: 14 }), t('project.requirements.new'))
        : null)
  }
  let createModalElement = null
  if (createModal) {
    createModalElement = h(Modal, {
      t: t,
      title: t('new.title'),
      onClose: requestCreateClose,
      onCancel: requestCreateClose,
      confirmText: createModal.busy ? t('new.creating') : t('new.create'),
      confirmDisabled: createModal.busy === true || createModal.title.trim() === '',
      onConfirm: submitCreate,
    }, h('div', { className: 'devbench-flexcol' },
      h('label', { className: 'devbench-hint' }, t('new.name')),
      h('input', {
        className: 'devbench-input', autoFocus: true,
        placeholder: t('new.name.placeholder'),
        value: createModal.title, disabled: createModal.busy === true,
        onChange(event) {
          const value = event.target.value
          setCreateModal(function (prev) { return Object.assign({}, prev, { title: value }) })
        },
        onKeyDown(event) {
          if (event.key === 'Enter' && createModal.busy === false && createModal.title.trim() !== '') submitCreate()
        },
      }),
      h('label', { className: 'devbench-hint' }, t('new.body')),
      h('textarea', {
        className: 'devbench-textarea devbench-mono', rows: 9,
        placeholder: t('new.body.placeholder'),
        value: createModal.body, disabled: createModal.busy === true,
        onChange(event) {
          const value = event.target.value
          setCreateModal(function (prev) { return Object.assign({}, prev, { body: value }) })
        },
      }),
      h('label', { className: 'devbench-check' },
        h('input', {
          type: 'checkbox',
          checked: createModal.worktree === true,
          disabled: createModal.busy === true,
          onChange(event) {
            const value = event.target.checked
            setCreateModal(function (prev) { return Object.assign({}, prev, { worktree: value }) })
          },
        }),
        h('span', null, t('new.worktree'))),
      createModal.error ? h(Banner, { kind: 'error' }, createModal.error) : null))
  }
  let deleteModalElement = null
  if (deleteModal) {
    const item = deleteModal.item
    const sessions = Array.isArray(item.sessions) ? item.sessions : []
    deleteModalElement = h(Modal, {
      t: t,
      title: t('delete.requirement.title'),
      danger: true,
      confirmText: deleteModal.busy ? t('detail.delete.busy') : t('action.delete'),
      confirmDisabled: deleteModal.busy,
      onCancel() { if (deleteModal.busy === false) setDeleteModal(null) },
      onConfirm: submitDelete,
    }, h('div', { className: 'devbench-flexcol' },
      h('div', { className: 'devbench-hint' },
        t('delete.requirement.body', { name: item.title })),
      sessions.length > 0
        ? h('div', { className: 'devbench-hint' }, t('delete.requirement.sessions', { count: sessions.length }))
        : null,
      item.worktree === true
        ? h('div', { className: 'devbench-hint' }, t('detail.delete.impactWorktree', { branch: 'devbench/' + item.id }))
        : null,
      deleteModal.error ? h(Banner, { kind: 'error' }, deleteModal.error) : null))
  }
  const master = workspace
    ? h('div', { className: 'devbench-master' },
      masterList,
      h('div', { className: 'devbench-master-detail' }, detailSide))
    : h('div', { className: 'devbench-master' },
      h('div', { className: 'devbench-master-empty' }, t('project.selectHint')))
  return h(getFragment(), null, master, createModalElement, deleteModalElement)
}
