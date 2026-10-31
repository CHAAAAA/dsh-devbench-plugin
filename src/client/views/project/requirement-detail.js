/**
 * Requirement detail panel. Invariants: serial mutations, one execute flight,
 * draft protection (localStorage + leave guard), status changes are explicit.
 */
import { h, useState, useEffect, useRef, errorText, isAbortError } from '../../runtime.js'
import * as api from '../../core/api.js'
import { createSerialQueue } from '../../core/async.js'
import { setLeaveGuard, clearLeaveGuard } from '../../core/navigation.js'
import { choiceDialog, confirmDialog } from '../../ui/dialogs.js'
import { isActiveTask } from '../../core/project-utils.js'
import { Banner, Modal, formatTime, formatShortTime } from '../../ui/common.js'
import { FileTree } from '../../ui/file-tree.js'
import { SessionRow, useEmptySessions } from '../../ui/session-row.js'
import { renderMarkdown } from '../../ui/markdown.js'
import { MarkdownEditor, MarkdownHelp } from '../../ui/markdown-editor.js'
import {
  IconBack, IconPlay, IconFolder, IconTrash, IconPlus, IconExternal, IconLink,
  IconEdit, IconMaximize, IconMinimize,
} from '../../ui/icons.js'
function selectSessionsSnapshot(snapshot) { return snapshot }
const EMPTY_FILES = { loading: false, error: '', data: null, seq: 0 }
const EMPTY_WORKTREE = { enabled: false, exists: false, path: '', branch: '', base: '' }
const STATUS_ORDER = ['new', 'running', 'done', 'archived', 'cancelled']
const CONFIRM_STATUSES = ['done', 'cancelled', 'archived']
const DRAFT_STORAGE_PREFIX = 'devbench:requirement-draft:v1:'
const DRAFT_DEBOUNCE_MS = 500
function draftStorageKey(sel) {
  return DRAFT_STORAGE_PREFIX + sel.workspaceId + ':' + sel.id
}
function readStoredDraft(sel) {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(draftStorageKey(sel))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.title !== 'string' || typeof parsed.body !== 'string') return null
    return {
      title: parsed.title,
      body: parsed.body,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    }
  } catch (err) {
    return null
  }
}
function writeStoredDraft(sel, draft) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(draftStorageKey(sel), JSON.stringify(draft))
  } catch (err) {
    // Quota/security failures must never break editing.
  }
}
function clearStoredDraft(sel) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.removeItem(draftStorageKey(sel))
  } catch (err) {
    // ignore
  }
}
function isConflictError(err) {
  return Boolean(err && err.code === 'requirement-conflict')
}
function noop() {}
export function DetailView(props) {
  const t = props.t
  const detail = props.detail
  const data = detail ? detail.data : null
  const sessionsHook = props.sessionsHook || useEmptySessions
  const sessionsSnapshot = sessionsHook(selectSessionsSnapshot) || { byId: {} }
  const tasks = Array.isArray(props.tasks) ? props.tasks : []
  const [tab, setTab] = useState('doc')
  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [conflict, setConflict] = useState(false)
  const [recoverDraft, setRecoverDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [executeBusy, setExecuteBusy] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [pendingStatus, setPendingStatus] = useState('')
  const [commitSubjects, setCommitSubjects] = useState({})
  const [commitPicker, setCommitPicker] = useState(null)
  const [commitBusyHash, setCommitBusyHash] = useState('')
  const [filesState, setFilesState] = useState(EMPTY_FILES)
  const [fileRevision, setFileRevision] = useState(0)
  const [fileDirty, setFileDirty] = useState(false)
  const [fileTreeBusy, setFileTreeBusy] = useState(false)
  const [fileModal, setFileModal] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [busy, setBusy] = useState(false)
  const [worktreeBusy, setWorktreeBusy] = useState(false)
  const [removeWorktreeOpen, setRemoveWorktreeOpen] = useState(false)
  const [removeWorktreeBusy, setRemoveWorktreeBusy] = useState(false)
  const [removeWorktreeError, setRemoveWorktreeError] = useState('')
  const [markdownModalOpen, setMarkdownModalOpen] = useState(false)
  const [markdownModalFullscreen, setMarkdownModalFullscreen] = useState(false)
  const [markdownHelpOpen, setMarkdownHelpOpen] = useState(false)
  const queueRef = useRef(null)
  if (!queueRef.current) queueRef.current = createSerialQueue()
  const pendingRef = useRef(0)
  const savingRef = useRef(false)
  const dirtyRef = useRef(false)
  const fileDirtyRef = useRef(false)
  const titleRef = useRef('')
  const bodyRef = useRef('')
  const serverTitleRef = useRef('')
  const serverBodyRef = useRef('')
  const serverUpdatedAtRef = useRef('')
  const expectedUpdatedAtRef = useRef('')
  const versionRef = useRef(0)
  const loadedKeyRef = useRef('')
  const filesSeqRef = useRef(0)
  const executeBusyRef = useRef(false)
  const statusBusyRef = useRef(false)
  const deleteBusyRef = useRef(false)
  const fileBusyRef = useRef(false)
  const worktreeBusyRef = useRef(false)
  const removeWorktreeBusyRef = useRef(false)
  const guardRef = useRef(null)
  const draftTimerRef = useRef(null)
  fileDirtyRef.current = fileDirty
  dirtyRef.current = dirty
  const sel = props.selected || { workspaceId: '', id: '' }
  const key = sel.workspaceId + '/' + sel.id
  function pushToast(kind, text, options) {
    if (typeof props.showToast === 'function') props.showToast(kind, text, options)
  }
  function reloadState() {
    return typeof props.onReloadState === 'function' ? props.onReloadState() : Promise.resolve(null)
  }
  function reloadDetail() {
    return typeof props.onReloadDetail === 'function' ? props.onReloadDetail() : Promise.resolve(null)
  }
  function refreshDetailsNonBlocking() {
    reloadDetail().catch(function () { pushToast('error', t('common.refreshFailed')) })
    reloadState().catch(function () { pushToast('error', t('common.refreshFailed')) })
  }
  function clearDraftTimer() {
    if (draftTimerRef.current !== null) {
      clearTimeout(draftTimerRef.current)
      draftTimerRef.current = null
    }
  }
  function persistDraftNow() {
    if (!dirtyRef.current) return
    writeStoredDraft(sel, {
      title: titleRef.current,
      body: bodyRef.current,
      savedAt: new Date().toISOString(),
    })
  }
  function scheduleDraftPersist() {
    clearDraftTimer()
    draftTimerRef.current = setTimeout(function () {
      draftTimerRef.current = null
      persistDraftNow()
    }, DRAFT_DEBOUNCE_MS)
  }
  function markDirty(nextTitle, nextBody) {
    titleRef.current = nextTitle
    bodyRef.current = nextBody
    versionRef.current += 1
    const next = nextTitle !== serverTitleRef.current || nextBody !== serverBodyRef.current
    dirtyRef.current = next
    setDirty(next)
    if (recoverDraft !== null) setRecoverDraft(null)
    if (!next) {
      setConflict(false)
      clearDraftTimer()
      clearStoredDraft(sel)
      return
    }
    scheduleDraftPersist()
  }
  function syncDirty() {
    const next = titleRef.current !== serverTitleRef.current || bodyRef.current !== serverBodyRef.current
    dirtyRef.current = next
    setDirty(next)
    if (!next) {
      setConflict(false)
      clearDraftTimer()
      clearStoredDraft(sel)
    }
  }
  function discardDrafts() {
    titleRef.current = serverTitleRef.current
    bodyRef.current = serverBodyRef.current
    versionRef.current += 1
    setTitleDraft(serverTitleRef.current)
    setBodyDraft(serverBodyRef.current)
    dirtyRef.current = false
    setDirty(false)
    setConflict(false)
    setEditing(false)
    clearDraftTimer()
    clearStoredDraft(sel)
  }
  function restoreDraft(draft) {
    titleRef.current = draft.title
    bodyRef.current = draft.body
    versionRef.current += 1
    setTitleDraft(draft.title)
    setBodyDraft(draft.body)
    dirtyRef.current = true
    setDirty(true)
    setEditing(true)
    setRecoverDraft(null)
    scheduleDraftPersist()
    pushToast('info', t('detail.draftRecover.restored'))
  }
  function discardRecoveredDraft() {
    setRecoverDraft(null)
    clearDraftTimer()
    clearStoredDraft(sel)
    pushToast('info', t('detail.draftRecover.discarded'))
  }
  function enqueueMutation(task) {
    pendingRef.current += 1
    savingRef.current = true
    setSaving(true)
    const result = queueRef.current(task)
    result.finally(function () {
      pendingRef.current -= 1
      if (pendingRef.current === 0) {
        savingRef.current = false
        setSaving(false)
      }
    }).catch(noop)
    return result
  }
  useEffect(function () {
    if (!data) return
    const requirement = data.requirement || {}
    const incomingTitle = typeof requirement.title === 'string' ? requirement.title : ''
    const incomingBody = typeof data.body === 'string' ? data.body : ''
    const incomingUpdatedAt = typeof requirement.updatedAt === 'string' ? requirement.updatedAt : ''
    const remoteChanged = loadedKeyRef.current === key &&
      (incomingTitle !== serverTitleRef.current || incomingBody !== serverBodyRef.current)
    if (loadedKeyRef.current !== key) {
      loadedKeyRef.current = key
      serverTitleRef.current = incomingTitle
      serverBodyRef.current = incomingBody
      serverUpdatedAtRef.current = incomingUpdatedAt
      expectedUpdatedAtRef.current = incomingUpdatedAt
      titleRef.current = incomingTitle
      bodyRef.current = incomingBody
      versionRef.current += 1
      dirtyRef.current = false
      setDirty(false)
      setTitleDraft(incomingTitle)
      setBodyDraft(incomingBody)
      setEditing(false)
      setMarkdownModalOpen(false)
      setMarkdownModalFullscreen(false)
      setMarkdownHelpOpen(false)
      setTab('doc')
      setConflict(false)
      setError('')
      setSavedAt(0)
      setPendingStatus('')
      setRecoverDraft(null)
      setFilesState(EMPTY_FILES)
      setFileRevision(function (value) { return value + 1 })
      setFileDirty(false)
      fileDirtyRef.current = false
      const stored = readStoredDraft(sel)
      if (stored && (stored.title !== incomingTitle || stored.body !== incomingBody)) {
        setRecoverDraft(stored)
      } else if (stored) {
        clearStoredDraft(sel)
      }
      return
    }
    serverTitleRef.current = incomingTitle
    serverBodyRef.current = incomingBody
    serverUpdatedAtRef.current = incomingUpdatedAt
    if (dirtyRef.current) {
      if (remoteChanged) setConflict(true)
      return
    }
    expectedUpdatedAtRef.current = incomingUpdatedAt
    titleRef.current = incomingTitle
    bodyRef.current = incomingBody
    versionRef.current += 1
    setTitleDraft(incomingTitle)
    setBodyDraft(incomingBody)
    setConflict(false)
    if (!fileDirtyRef.current) setFileRevision(function (value) { return value + 1 })
    if (tab === 'files') reloadFiles().catch(noop)
  }, [data, key])
  useEffect(function () {
    if (tab !== 'files' || !data) return
    reloadFiles().catch(noop)
    return function () { filesSeqRef.current += 1 }
  }, [tab, key, data === null])
  useEffect(function () {
    const commits = data && data.requirement && Array.isArray(data.requirement.commits)
      ? data.requirement.commits
      : []
    if (commits.length === 0) {
      setCommitSubjects({})
      return undefined
    }
    let cancelled = false
    api.getProjectCommits(sel.workspaceId, 0, 100).then(function (value) {
      if (cancelled) return
      const map = {}
      ;((value && value.commits) || []).forEach(function (commit) {
        if (!commit || typeof commit.hash !== 'string') return
        map[commit.hash] = commit
        if (commit.short) map[commit.short] = commit
      })
      setCommitSubjects(map)
    }, function () {})
    return function () { cancelled = true }
  }, [data === null, data && data.requirement ? (data.requirement.commits || []).join(',') : '', sel.workspaceId])
  useEffect(function () {
    if (typeof window === 'undefined') return undefined
    function onBeforeUnload(event) {
      if (!dirtyRef.current && !fileDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return function () { window.removeEventListener('beforeunload', onBeforeUnload) }
  }, [])
  useEffect(function () {
    return function () {
      clearDraftTimer()
      if (dirtyRef.current) persistDraftNow()
    }
  }, [])
  useEffect(function () {
    if (!dirty && !fileDirty) {
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
  }, [dirty, fileDirty])
  useEffect(function () {
    if (typeof props.onDirtyChange === 'function') props.onDirtyChange(Boolean(dirty || fileDirty))
  }, [dirty, fileDirty])
  useEffect(function () {
    if (pendingStatus === '') return
    const currentStatus = data && data.requirement ? data.requirement.status : ''
    if (currentStatus === pendingStatus) setPendingStatus('')
  }, [data && data.requirement && data.requirement.status,
    data && data.requirement && data.requirement.updatedAt, pendingStatus])
  function reloadFiles() {
    const token = ++filesSeqRef.current
    setFilesState(function (prev) {
      return { loading: true, error: '', data: prev.data, seq: token }
    })
    return api.listFiles(sel).then(function (value) {
      if (filesSeqRef.current !== token) return null
      setFilesState({ loading: false, error: '', data: value, seq: token })
      return value
    }, function (err) {
      if (filesSeqRef.current !== token || isAbortError(err)) return null
      setFilesState(function (prev) {
        return { loading: false, error: errorText(err), data: prev.data, seq: token }
      })
      throw err
    })
  }
  function commitInfoFor(hash) {
    const value = String(hash || '')
    if (value === '') return null
    const keys = Object.keys(commitSubjects)
    for (let index = 0; index < keys.length; index += 1) {
      const info = commitSubjects[keys[index]]
      if (!info || typeof info.hash !== 'string') continue
      if (info.hash === value || info.hash.startsWith(value) || value.startsWith(info.hash)) return info
    }
    return null
  }
  function openCommitPicker() {
    if (commitPicker !== null) return
    setCommitPicker({ loading: true, error: '', rows: [], busy: '' })
    api.getProjectCommits(sel.workspaceId, 0, 50).then(function (value) {
      setCommitPicker({
        loading: false,
        error: '',
        rows: value && Array.isArray(value.commits) ? value.commits : [],
        busy: '',
      })
    }, function (err) {
      setCommitPicker({ loading: false, error: errorText(err), rows: [], busy: '' })
    })
  }
  function closeCommitPicker() {
    if (commitPicker !== null && commitPicker.busy !== '') return
    setCommitPicker(null)
  }
  function linkCommit(hash) {
    if (commitPicker === null || commitPicker.busy !== '' || typeof hash !== 'string' || hash === '') return
    setCommitPicker(function (prev) {
      return prev === null ? prev : Object.assign({}, prev, { busy: hash, error: '' })
    })
    api.linkRequirementCommit({ workspaceId: sel.workspaceId, id: sel.id, commit: hash }).then(function () {
      setCommitPicker(null)
      pushToast('info', t('detail.commits.linked'))
      refreshDetailsNonBlocking()
    }, function (err) {
      setCommitPicker(function (prev) {
        return prev === null ? null : Object.assign({}, prev, { busy: '', error: errorText(err) })
      })
    })
  }
  function unlinkCommit(hash) {
    if (commitBusyHash !== '') return
    setCommitBusyHash(hash)
    api.unlinkRequirementCommit({ workspaceId: sel.workspaceId, id: sel.id, commit: hash }).then(function () {
      setCommitBusyHash('')
      pushToast('info', t('detail.commits.unlinked'))
      refreshDetailsNonBlocking()
    }, function (err) {
      setCommitBusyHash('')
      pushToast('error', errorText(err))
    })
  }
  function openConflictDialog() {
    return choiceDialog({
      title: t('detail.conflict.title'),
      body: t('detail.conflict.body'),
      detail: serverUpdatedAtRef.current !== ''
        ? t('detail.updatedAt') + ': ' + formatTime(serverUpdatedAtRef.current)
        : null,
      tone: 'default',
      dismissible: true,
      cancelValue: 'cancel',
      actions: [
        { label: t('detail.conflict.reload'), value: 'reload', kind: 'ghost' },
        { label: t('detail.conflict.overwrite'), value: 'overwrite', kind: 'primary danger' },
        { label: t('detail.conflict.cancel'), value: 'cancel', kind: 'ghost' },
      ],
    })
  }
  function reloadFromServer() {
    discardDrafts()
    return reloadDetail().then(function () {
      pushToast('info', t('detail.conflict.reloaded'))
    }, function (err) {
      setError(errorText(err))
      throw err
    })
  }
  function handleSaveError(err, fields, options) {
    const opts = options || {}
    if (!isConflictError(err)) {
      setError(errorText(err))
      throw err
    }
    setConflict(true)
    if (opts.force === true) {
      setError(t('detail.conflict.banner'))
      throw err
    }
    return openConflictDialog().then(function (choice) {
      if (choice === 'overwrite') {
        return saveFields(fields, Object.assign({}, opts, { force: true })).then(function (result) {
          pushToast('info', t('detail.conflict.overwritten'))
          return result
        })
      }
      if (choice === 'reload') {
        return reloadFromServer().then(function () { throw err })
      }
      setError(t('detail.conflict.banner'))
      throw err
    })
  }
  function saveFields(fields, options) {
    const opts = options || {}
    const payload = { workspaceId: sel.workspaceId, id: sel.id }
    if (fields.title !== undefined) payload.title = fields.title
    if (fields.body !== undefined) payload.body = fields.body
    if (fields.status !== undefined) payload.status = fields.status
    if (opts.force === true) {
      payload.force = true
    } else if (typeof expectedUpdatedAtRef.current === 'string' && expectedUpdatedAtRef.current !== '') {
      payload.expectedUpdatedAt = expectedUpdatedAtRef.current
    }
    const version = versionRef.current
    return enqueueMutation(function () {
      return api.saveRequirement(payload)
    }).then(function (result) {
      if (payload.title !== undefined) serverTitleRef.current = payload.title
      if (payload.body !== undefined) serverBodyRef.current = payload.body
      const nextUpdated = result && result.requirement && typeof result.requirement.updatedAt === 'string'
        ? result.requirement.updatedAt
        : ''
      if (nextUpdated !== '') {
        serverUpdatedAtRef.current = nextUpdated
        expectedUpdatedAtRef.current = nextUpdated
      }
      if (versionRef.current === version) {
        if (payload.title !== undefined) {
          titleRef.current = payload.title
          setTitleDraft(payload.title)
        }
        if (payload.body !== undefined) {
          bodyRef.current = payload.body
          setBodyDraft(payload.body)
        }
        setSavedAt(Date.now())
        syncDirty()
      } else {
        dirtyRef.current = true
        setDirty(true)
      }
      setError('')
      setConflict(false)
      if (opts.refresh !== false) refreshDetailsNonBlocking()
      return result
    }, function (err) {
      return handleSaveError(err, fields, options)
    })
  }
  function currentTitleValid() {
    const title = titleRef.current.trim()
    if (title === '') {
      setError(t('detail.titleRequired'))
      return null
    }
    return title
  }
  function saveDocument(options) {
    const opts = options || {}
    if (savingRef.current || executeBusyRef.current || pendingRef.current > 0) return Promise.resolve(false)
    const title = currentTitleValid()
    if (title === null) return Promise.resolve(false)
    // REQ-20261031-003: saving never leaves the editing state by itself; the
    // explicit Done / Save-and-close controls are the only ways out.
    return saveFields({ title: title, body: bodyRef.current }, { refresh: opts.refresh }).then(function () {
      return true
    }, function () {
      return false
    })
  }
  function overwriteSave() {
    if (savingRef.current) return
    const title = currentTitleValid()
    if (title === null) return
    saveFields({ title: title, body: bodyRef.current }, { force: true }).then(function () {
      pushToast('info', t('detail.conflict.overwritten'))
    }, function () {})
  }
  function discardPrompt() {
    return confirmDialog({
      title: t('detail.discardDraft.title'),
      body: t('detail.discardDraft.body'),
      confirmText: t('dialog.unsaved.discard'),
      cancelText: t('dialog.unsaved.stay'),
      tone: 'danger',
    })
  }
  function exitEditing() {
    if (!editing) return
    if (!dirtyRef.current) {
      setEditing(false)
      return
    }
    discardPrompt().then(function (discard) {
      if (discard === true) {
        discardDrafts()
        setEditing(false)
      }
    }).catch(noop)
  }
  function openMarkdownModal() {
    setMarkdownModalOpen(true)
  }
  function closeMarkdownModal() {
    if (savingRef.current) return
    setMarkdownModalOpen(false)
    setMarkdownModalFullscreen(false)
  }
  function toggleMarkdownFullscreen() {
    setMarkdownModalFullscreen(markdownModalFullscreen === false)
  }
  function saveMarkdownModal() {
    if (savingRef.current) return Promise.resolve(false)
    if (dirtyRef.current === false) {
      closeMarkdownModal()
      return Promise.resolve(true)
    }
    return saveDocument({ refresh: true }).then(function (saved) {
      if (saved === true) closeMarkdownModal()
      return saved
    }, function () {
      return false
    })
  }
  /** REQ-20261031-003: keep the popup open after Cmd+S / Enter; saving feedback via toast. */
  function saveMarkdownEditor() {
    if (savingRef.current) return Promise.resolve(false)
    if (dirtyRef.current === false) return Promise.resolve(true)
    return saveDocument({ refresh: true }).then(function (saved) {
      if (saved === true) pushToast('info', t('detail.saved'))
      return saved
    }, function () {
      return false
    })
  }
  function requestLeave() {
    if (savingRef.current) {
      pushToast('info', t('detail.saveState.saving'))
      return Promise.resolve(false)
    }
    if (!dirtyRef.current && !fileDirtyRef.current) return Promise.resolve(true)
    function finishFileDirty() {
      if (!fileDirtyRef.current) return Promise.resolve(true)
      return confirmDialog({
        title: t('detail.files.dirtyConfirm.title'),
        body: t('detail.files.dirtyConfirm.body'),
        confirmText: t('detail.files.discardAndLeave'),
        cancelText: t('detail.files.keepEditing'),
        tone: 'danger',
      }).then(function (discard) {
        if (discard !== true) return false
        setFileDirty(false)
        fileDirtyRef.current = false
        return true
      })
    }
    if (!dirtyRef.current) return finishFileDirty()
    return choiceDialog({
      title: t('dialog.unsaved.title'),
      body: t('dialog.unsaved.body'),
      detail: t('detail.saveState.unsaved') + (props.summary && props.summary.title ? ' · ' + props.summary.title : ''),
      dismissible: true,
      cancelValue: 'stay',
      actions: [
        { label: t('dialog.unsaved.save'), value: 'save', kind: 'primary' },
        { label: t('dialog.unsaved.discard'), value: 'discard', kind: 'ghost' },
        { label: t('dialog.unsaved.stay'), value: 'stay', kind: 'ghost' },
      ],
    }).then(function (value) {
      if (value === 'save') {
        return saveDocument({ refresh: true }).then(function (saved) {
          if (!saved) return false
          return finishFileDirty()
        })
      }
      if (value === 'discard') {
        discardDrafts()
        return finishFileDirty()
      }
      return false
    })
  }
  function emitStatusToast(nextStatus, previousStatus) {
    const text = t('detail.status.saved', { status: t('status.' + nextStatus) })
    const options = {
      actionLabel: t('detail.status.undo'),
      onAction() { setStatus(previousStatus, { skipConfirm: true }) },
    }
    if (typeof props.onStatusToast === 'function') {
      props.onStatusToast('info', text, options)
      return
    }
    pushToast('info', text, options)
  }
  function runStatusChange(status) {
    statusBusyRef.current = true
    setStatusBusy(true)
    setPendingStatus(status)
    setError('')
    return saveFields({ status: status }).then(function () {
      const previous = data && data.requirement ? data.requirement.status : 'new'
      emitStatusToast(status, previous)
      return true
    }, function (err) {
      setPendingStatus('')
      if (!isConflictError(err)) {
        const text = errorText(err)
        setError(text === '' ? t('detail.status.failed') : text)
      }
      return false
    }).finally(function () {
      statusBusyRef.current = false
      setStatusBusy(false)
    })
  }
  function setStatus(nextStatus, options) {
    const opts = options || {}
    if (!data || statusBusyRef.current || executeBusyRef.current) return Promise.resolve(false)
    const currentStatus = data.requirement.status
    if (nextStatus === currentStatus || STATUS_ORDER.indexOf(nextStatus) < 0) return Promise.resolve(false)
    if (dirtyRef.current) {
      return saveDocument({ refresh: false }).then(function (saved) {
        if (!saved) return false
        return setStatus(nextStatus, opts)
      })
    }
    if (opts.skipConfirm === true || CONFIRM_STATUSES.indexOf(nextStatus) < 0) {
      return runStatusChange(nextStatus)
    }
    return confirmDialog({
      title: t('detail.status.confirm.title', { status: t('status.' + nextStatus) }),
      body: t('detail.status.confirm.body'),
      confirmText: t('detail.status.confirm.action'),
      cancelText: t('dialog.unsaved.stay'),
      tone: nextStatus === 'cancelled' ? 'danger' : 'default',
    }).then(function (confirmed) {
      if (confirmed !== true) return false
      return runStatusChange(nextStatus)
    })
  }
  function activeRequirementTaskFor() {
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index]
      if (task && task.kind === 'requirement' && task.requirementId === sel.id && isActiveTask(task)) {
        return task
      }
    }
    return null
  }
  function activeWorktreeTaskFor() {
    const requirementTask = activeRequirementTaskFor()
    if (requirementTask !== null) return requirementTask
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index]
      if (!task || !isActiveTask(task)) continue
      if (typeof task.worktreePath === 'string' && task.worktreePath !== '' &&
          typeof worktreePath === 'string' && worktreePath !== '' && task.worktreePath === worktreePath) {
        return task
      }
    }
    return null
  }
  function findRunningSessionId(activeTask) {
    if (!data) return null
    const requirement = data.requirement || {}
    const sessionIds = Array.isArray(requirement.sessions) ? requirement.sessions : []
    for (let index = 0; index < sessionIds.length; index += 1) {
      const summary = sessionsSnapshot.byId ? sessionsSnapshot.byId[sessionIds[index]] : null
      if (summary && summary.running) return sessionIds[index]
    }
    if (activeTask && typeof activeTask.sessionId === 'string' && activeTask.sessionId !== '') {
      return activeTask.sessionId
    }
    if (requirement.status === 'running' && sessionIds.length > 0) {
      const candidate = sessionIds[sessionIds.length - 1]
      const known = sessionsSnapshot.byId ? sessionsSnapshot.byId[candidate] : null
      if (!known) return candidate
    }
    return null
  }
  function saveBeforeExecute() {
    if (!dirtyRef.current) return Promise.resolve(true)
    const title = currentTitleValid()
    if (title === null) return Promise.reject(new Error(t('detail.titleRequired')))
    return saveFields({ title: title, body: bodyRef.current }, { refresh: false }).then(function () { return true })
  }
  function execute() {
    if (executeBusyRef.current || savingRef.current || !data) return Promise.resolve()
    const requirement = data.requirement
    const activeTask = activeRequirementTaskFor()
    const runningSessionId = findRunningSessionId(activeTask)
    if (runningSessionId !== null) {
      if (typeof props.onOpenSession === 'function') props.onOpenSession(runningSessionId)
      return Promise.resolve()
    }
    if (activeTask !== null) {
      setError(t('detail.execute.blockedActive'))
      return Promise.resolve()
    }
    executeBusyRef.current = true
    setExecuteBusy(true)
    setError('')
    return saveBeforeExecute().then(function () {
      return props.onExecute({
        workspaceId: sel.workspaceId,
        id: sel.id,
        title: requirement.title,
        previousStatus: requirement.status,
      })
    }).catch(function (err) {
      setError(errorText(err))
    }).finally(function () {
      executeBusyRef.current = false
      setExecuteBusy(false)
    })
  }
  function openFolder() {
    api.openFile({ workspaceId: sel.workspaceId, id: sel.id, path: '' })
      .catch(function (err) { pushToast('error', errorText(err)) })
  }
  function openCreateFileModal(kind) {
    if (executeBusy || fileTreeBusy) return
    setFileModal({ kind: kind, value: kind === 'dir' ? 'docs' : 'notes.md', busy: false, error: '' })
  }
  function requestFileModalClose() {
    if (!fileModal || fileBusyRef.current) return
    const defaultName = fileModal.kind === 'dir' ? 'docs' : 'notes.md'
    const modalDirty = fileModal.kind !== 'delete' && fileModal.value !== defaultName
    if (!modalDirty) {
      setFileModal(null)
      return
    }
    discardPrompt().then(function (discard) {
      if (discard === true) setFileModal(null)
    }).catch(noop)
  }
  function requestDeleteFile(path) {
    if (executeBusy || fileTreeBusy) return
    setFileModal({ kind: 'delete', path: path, busy: false, error: '' })
  }
  function submitFileModal() {
    if (!fileModal || fileBusyRef.current) return
    fileBusyRef.current = true
    setFileModal(function (prev) {
      return Object.assign({}, prev, { busy: true, error: '' })
    })
    let promise
    if (fileModal.kind === 'delete') {
      promise = api.deleteFile({ workspaceId: sel.workspaceId, id: sel.id, path: fileModal.path })
    } else {
      promise = api.createFile({
        workspaceId: sel.workspaceId, id: sel.id,
        path: fileModal.value.trim(),
        type: fileModal.kind === 'dir' ? 'dir' : 'file',
      })
    }
    promise.then(function () {
      setFileModal(null)
      if (!fileDirtyRef.current) setFileRevision(function (value) { return value + 1 })
      reloadFiles().catch(function () { pushToast('error', t('common.refreshFailed')) })
    }, function (err) {
      setFileModal(function (prev) {
        return Object.assign({}, prev, { busy: false, error: errorText(err) })
      })
    }).finally(function () {
      fileBusyRef.current = false
    })
  }
  function confirmDeleteRequirement() {
    if (deleteBusyRef.current) return
    deleteBusyRef.current = true
    setBusy(true)
    setDeleteError('')
    api.deleteRequirement({ workspaceId: sel.workspaceId, id: sel.id }).then(function () {
      deleteBusyRef.current = false
      setBusy(false)
      setDeleteOpen(false)
      clearDraftTimer()
      clearStoredDraft(sel)
      dirtyRef.current = false
      fileDirtyRef.current = false
      setDirty(false)
      setFileDirty(false)
      pushToast('info', t('detail.deleted'))
      if (typeof props.onBack === 'function') {
        const result = props.onBack()
        if (result && typeof result.catch === 'function') result.catch(noop)
      }
      reloadState().catch(function () { pushToast('error', t('common.refreshFailed')) })
    }, function (err) {
      deleteBusyRef.current = false
      setBusy(false)
      setDeleteError(errorText(err))
    })
  }
  function refreshDetailAfterWorktree() {
    reloadDetail().catch(function () { pushToast('error', t('common.refreshFailed')) })
    reloadState().catch(function () { pushToast('error', t('common.refreshFailed')) })
  }
  function toggleWorktree(event) {
    if (worktreeBusyRef.current || executeBusy || saving || activeRequirementTaskFor() !== null) return
    const enabled = event.target.checked === true
    worktreeBusyRef.current = true
    setWorktreeBusy(true)
    setError('')
    api.setRequirementWorktree({ workspaceId: sel.workspaceId, id: sel.id, enabled: enabled }).then(function () {
      worktreeBusyRef.current = false
      setWorktreeBusy(false)
      pushToast('info', enabled ? t('detail.worktree.enabled') : t('detail.worktree.disabled'))
      refreshDetailAfterWorktree()
    }, function (err) {
      worktreeBusyRef.current = false
      setWorktreeBusy(false)
      setError(errorText(err))
    })
  }
  function revealWorktree() {
    if (worktreeBusyRef.current || removeWorktreeBusyRef.current) return
    worktreeBusyRef.current = true
    setWorktreeBusy(true)
    setError('')
    api.revealRequirementWorktree({ workspaceId: sel.workspaceId, id: sel.id }).then(function () {
      worktreeBusyRef.current = false
      setWorktreeBusy(false)
    }, function (err) {
      worktreeBusyRef.current = false
      setWorktreeBusy(false)
      setError(errorText(err))
    })
  }
  function requestRemoveWorktree() {
    if (worktreeBusyRef.current || removeWorktreeBusyRef.current) return
    if (activeWorktreeTaskFor() !== null) {
      pushToast('info', t('detail.worktree.remove.blockedActive'))
      return
    }
    setRemoveWorktreeError('')
    setRemoveWorktreeOpen(true)
  }
  function confirmRemoveWorktree() {
    if (removeWorktreeBusyRef.current) return
    if (activeWorktreeTaskFor() !== null) {
      setRemoveWorktreeError(t('detail.worktree.remove.blockedActive'))
      return
    }
    removeWorktreeBusyRef.current = true
    setRemoveWorktreeBusy(true)
    setRemoveWorktreeError('')
    api.removeRequirementWorktree({ workspaceId: sel.workspaceId, id: sel.id }).then(function () {
      removeWorktreeBusyRef.current = false
      setRemoveWorktreeBusy(false)
      setRemoveWorktreeOpen(false)
      pushToast('info', t('detail.worktree.removed'))
      refreshDetailAfterWorktree()
    }, function (err) {
      removeWorktreeBusyRef.current = false
      setRemoveWorktreeBusy(false)
      setRemoveWorktreeError(errorText(err))
    })
  }
  function switchTab(nextTab) {
    if (nextTab === tab) return Promise.resolve(true)
    if (tab === 'files' && fileDirtyRef.current) {
      return confirmDialog({
        title: t('detail.files.dirtyConfirm.title'),
        body: t('detail.files.dirtyConfirm.body'),
        confirmText: t('detail.files.discardAndLeave'),
        cancelText: t('detail.files.keepEditing'),
        tone: 'danger',
      }).then(function (discard) {
        if (discard !== true) return false
        setFileDirty(false)
        fileDirtyRef.current = false
        setTab(nextTab)
        return true
      })
    }
    setTab(nextTab)
    return Promise.resolve(true)
  }
  function handleBack() {
    try {
      const result = typeof props.onBack === 'function' ? props.onBack() : null
      if (result && typeof result.catch === 'function') result.catch(noop)
    } catch (err) {
      pushToast('error', errorText(err))
    }
  }
  function retryDetail() {
    reloadDetail().catch(function (err) { pushToast('error', errorText(err)) })
  }
  if (!data) {
    const loading = Boolean(detail && detail.loading)
    return h('div', { className: 'devbench-detail-page' },
      h('div', { className: 'devbench-detail-head' },
        h('div', { className: 'devbench-inline', style: { gap: '8px' } },
          h('button', {
            className: 'devbench-icon-btn',
            title: t('project.requirements.back'),
            'aria-label': t('project.requirements.back'),
            onClick: handleBack,
          }, h(IconBack, { size: 16 })),
          h('span', { className: 'devbench-hint' }, loading ? t('panel.loading') : t('panel.error')))),
      h('div', { className: 'devbench-detail-body' },
        loading
          ? h('div', { className: 'devbench-inline-loading' }, t('panel.loading'))
          : h('div', null,
            h(Banner, { kind: 'error' }, (detail && detail.error) || t('panel.error')),
            h('button', { className: 'devbench-btn', onClick: retryDetail }, t('panel.retry')))))
  }
  const summary = data.requirement || {}
  const detailError = detail && detail.error ? detail.error : ''
  const worktree = data.worktree || EMPTY_WORKTREE
  const worktreeEnabled = worktree.enabled === true
  const worktreeExists = worktree.exists === true
  const worktreePath = typeof worktree.path === 'string' ? worktree.path : ''
  const worktreeBranch = typeof worktree.branch === 'string' ? worktree.branch : ''
  const worktreeBase = typeof worktree.base === 'string' ? worktree.base : ''
  const sessionIds = Array.isArray(summary.sessions) ? summary.sessions : []
  const activeRequirementTask = activeRequirementTaskFor()
  const activeWorktreeTask = activeWorktreeTaskFor()
  const requirementRunning = summary.status === 'running'
  const hardDisabled = executeBusy || fileTreeBusy
  const destructiveDisabled = saving || hardDisabled
  const runningSessionId = findRunningSessionId(activeRequirementTask)
  const displayStatus = pendingStatus !== '' ? pendingStatus : summary.status
  const executeDisabled = executeBusy || saving || fileTreeBusy || statusBusy ||
    (runningSessionId === null && activeRequirementTask !== null)
  const worktreeToggleDisabled = hardDisabled || saving || worktreeBusy || statusBusy ||
    activeRequirementTask !== null
  const statusSelect = h('select', {
    className: 'devbench-input',
    style: { width: 'auto', minWidth: '104px', maxWidth: '132px', height: '28px', padding: '0 8px', fontSize: '12px', flex: 'none' },
    value: displayStatus,
    disabled: hardDisabled || statusBusy,
    title: t('status.label'),
    'aria-label': t('status.label'),
    onChange(event) { setStatus(event.target.value).catch(noop) },
  }, STATUS_ORDER.map(function (status) {
    return h('option', { key: status, value: status }, t('status.' + status))
  }))
  let saveStateView = null
  if (saving) {
    saveStateView = h('span', { className: 'devbench-hint' }, t('detail.saveState.saving'))
  } else if (dirty || fileDirty) {
    saveStateView = h('span', {
      className: 'devbench-hint',
      style: { color: 'var(--dsw-alias-state-warn-primary)', fontWeight: 600 },
    }, t('detail.saveState.unsaved'))
  } else if (savedAt > 0) {
    saveStateView = h('span', { className: 'devbench-hint' },
      t('detail.saveState.saved', { time: formatShortTime(new Date(savedAt).toISOString()) }))
  }
  const head = h('div', { className: 'devbench-detail-head' },
    h('div', { className: 'devbench-inline', style: { gap: '8px', alignItems: 'flex-start' } },
      h('button', {
        className: 'devbench-icon-btn',
        title: t('project.requirements.back'),
        'aria-label': t('project.requirements.back'),
        disabled: hardDisabled,
        onClick: handleBack,
      }, h(IconBack, { size: 16 })),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('input', {
          className: 'devbench-input',
          style: { fontSize: '14px', fontWeight: 600, height: '32px' },
          value: titleDraft,
          disabled: hardDisabled,
          title: summary.title,
          'aria-label': t('detail.title'),
          onChange(event) { setTitleDraft(event.target.value); markDirty(event.target.value, bodyRef.current) },
          onKeyDown(event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              saveDocument().catch(noop)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.currentTarget.blur()
            }
          },
        }),
        h('div', { className: 'devbench-inline', style: { marginTop: '6px', gap: '8px' } },
          h('span', { className: 'devbench-mono', title: summary.path }, summary.id),
          statusSelect,
          saveStateView)),
      h('div', { className: 'devbench-page-actions' },
        h('button', {
          className: 'devbench-icon-btn',
          title: t('detail.files.upload'),
          'aria-label': t('detail.files.upload'),
          disabled: hardDisabled,
          onClick: openFolder,
        }, h(IconFolder, { size: 15 })),
        h('button', {
          className: 'devbench-icon-btn',
          title: activeRequirementTask !== null
            ? t('detail.delete.blockedActive')
            : (requirementRunning ? t('delete.requirement.running') : t('detail.delete')),
          'aria-label': activeRequirementTask !== null
            ? t('detail.delete.blockedActive')
            : (requirementRunning ? t('delete.requirement.running') : t('detail.delete')),
          disabled: destructiveDisabled || requirementRunning || activeRequirementTask !== null,
          onClick() {
            if (requirementRunning || activeRequirementTask !== null) return
            setDeleteError('')
            setDeleteOpen(true)
          },
        }, h(IconTrash, { size: 15 })),
        h('button', {
          className: 'devbench-btn primary',
          disabled: executeDisabled,
          title: activeRequirementTask !== null && runningSessionId === null
            ? t('detail.execute.blockedActive')
            : t('detail.execute.hint'),
          onClick() { execute().catch(noop) },
        }, h(IconPlay, { size: 14 }),
          executeBusy
            ? t('detail.executing')
            : (runningSessionId !== null
              ? t('detail.execute.openSession')
              : (sessionIds.length > 0 ? t('detail.execute.again') : t('detail.execute')))))))
  function detailTabButton(nextTab, label) {
    return h('button', {
      className: 'devbench-tab' + (tab === nextTab ? ' active' : ''),
      role: 'tab',
      'aria-selected': tab === nextTab,
      onClick() { switchTab(nextTab).catch(noop) },
    }, label)
  }
  const tabBar = h('div', { className: 'devbench-detail-tabs', role: 'tablist' },
    detailTabButton('doc', t('detail.requirement')),
    detailTabButton('files', t('detail.files') + ' (' +
      (filesState.data ? filesState.data.entries.filter(function (item) { return !item.isRequirementDoc }).length : '...') + ')'))
  const markdownEditorProps = {
    t: t,
    value: bodyDraft,
    disabled: hardDisabled,
    ariaLabel: t('markdown.editor.aria'),
    onChange(value) {
      setBodyDraft(value)
      markDirty(titleRef.current, value)
    },
    onSave() { saveDocument().catch(noop) },
    onOpenHelp() { setMarkdownHelpOpen(true) },
  }
  const docTab = h('div', null,
    h('div', { className: 'devbench-section' },
      h('div', { className: 'devbench-inline', style: { marginBottom: '8px', gap: '8px', flexWrap: 'wrap' } },
        editing
          ? null
          : h('button', {
            className: 'devbench-tab active',
            onClick() { setEditing(true) },
          }, t('detail.edit')),
        h('span', { style: { flex: 1 } }),
        h('button', {
          className: 'devbench-btn',
          onClick: openMarkdownModal,
        }, h(IconEdit, { size: 14 }), t('markdown.openPopup')),
        editing
          ? h('button', {
            className: 'devbench-btn ghost',
            onClick: exitEditing,
          }, t('detail.editor.done'))
          : null,
        h('span', { className: 'devbench-hint' }, t('detail.saveHint'))),
      editing
        ? h(MarkdownEditor, Object.assign({}, markdownEditorProps, {
          height: '48vh',
          onEscape: exitEditing,
        }))
        : h('div', { className: 'devbench-md' }, renderMarkdown(bodyDraft))),
    h('div', {
      className: 'devbench-inline',
      style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', marginTop: '-8px', marginBottom: '14px' },
    },
    h('span', null, t('detail.createdAt') + ': ' + formatTime(summary.createdAt)),
    h('span', null, '.'),
    h('span', null, t('detail.updatedAt') + ': ' + formatTime(summary.updatedAt)),
    h('span', null, '.'),
    h('span', { className: 'devbench-mono', title: summary.path }, summary.id)))
  const sessionsSection = h('div', { className: 'devbench-section' },
    h('div', { className: 'devbench-section-title' }, t('detail.sessions')),
    sessionIds.length === 0
      ? h('div', { className: 'devbench-hint' }, t('detail.sessions.empty'))
      : sessionIds.map(function (sessionId) {
        return h(SessionRow, {
          key: sessionId, t: t, sessionId: sessionId,
          useSessions: sessionsHook,
          disabled: destructiveDisabled,
          onOpen() { if (typeof props.onOpenSession === 'function') props.onOpenSession(sessionId) },
          onUnlink() { if (!destructiveDisabled && typeof props.onUnlinkSession === 'function') props.onUnlinkSession(summary, sessionId) },
        })
      }))
  function worktreeRowView(rowKey, label, value) {
    return h('div', { className: 'devbench-worktree-row', key: rowKey },
      h('span', { className: 'devbench-worktree-label' }, label),
      value)
  }
  const worktreeSection = h('div', { className: 'devbench-section' },
    h('div', { className: 'devbench-section-title' }, t('detail.worktree')),
    h('label', { className: 'devbench-worktree-toggle' },
      h('input', {
        type: 'checkbox',
        checked: worktreeEnabled,
        disabled: worktreeToggleDisabled,
        onChange: toggleWorktree,
      }),
      h('span', null, t('detail.worktree.enable')),
      worktreeBusy ? h('span', { className: 'devbench-muted' }, t('detail.worktree.toggleBusy')) : null),
    h('div', { className: 'devbench-hint' }, t('detail.worktree.hint')),
    activeRequirementTask !== null
      ? h('div', { className: 'devbench-hint' }, t('detail.worktree.remove.activeNote'))
      : null,
    worktreeEnabled
      ? h('div', { className: 'devbench-worktree-card' },
        worktreeRowView('path', t('detail.worktree.path'),
          h('span', { className: 'devbench-worktree-value', title: worktreePath }, worktreePath || '-')),
        worktreeRowView('branch', t('detail.worktree.branch'),
          h('span', { className: 'devbench-worktree-value' }, worktreeBranch || '-')),
        worktreeBase !== ''
          ? worktreeRowView('base', t('detail.worktree.base'),
            h('span', { className: 'devbench-worktree-value' }, worktreeBase))
          : null,
        h('div', { className: 'devbench-worktree-row', key: 'status' },
          h('span', { className: 'devbench-worktree-label' }, ''),
          h('span', { className: 'devbench-pill' + (worktreeExists ? ' succeeded' : '') },
            worktreeExists ? t('detail.worktree.created') : t('detail.worktree.notCreated'))),
        worktreeExists
          ? h('div', { className: 'devbench-worktree-actions', key: 'actions' },
            h('button', {
              className: 'devbench-btn',
              disabled: worktreeBusy || removeWorktreeBusy,
              onClick: revealWorktree,
            }, t('detail.worktree.reveal')),
            h('button', {
              className: 'devbench-btn ghost danger',
              disabled: worktreeBusy || removeWorktreeBusy || activeWorktreeTask !== null,
              title: activeWorktreeTask !== null ? t('detail.worktree.remove.blockedActive') : t('detail.worktree.remove'),
              onClick: requestRemoveWorktree,
            }, removeWorktreeBusy ? t('detail.worktree.removing') : t('detail.worktree.remove')))
          : null)
      : null)
  const requirementCommits = Array.isArray(summary.commits) ? summary.commits : []
  const commitsSection = h('div', { className: 'devbench-section' },
    h('div', { className: 'devbench-section-title' },
      t('detail.commits'),
      h('span', { className: 'spacer' }),
      h('button', {
        className: 'devbench-btn',
        disabled: destructiveDisabled,
        title: t('detail.commits.linkHint'),
        onClick: openCommitPicker,
      }, h(IconLink, { size: 13 }), t('detail.commits.link'))),
    h('div', { className: 'devbench-hint' }, t('detail.commits.hint')),
    requirementCommits.length === 0
      ? h('div', { className: 'devbench-hint' }, t('detail.commits.empty'))
      : requirementCommits.map(function (hash) {
        const info = commitInfoFor(hash)
        return h('div', { className: 'devbench-commit-chip', key: hash },
          h('div', { className: 'devbench-commit-chip-main' },
            h('div', {
              className: 'devbench-commit-chip-title',
              title: info ? info.subject : hash,
            }, info ? info.subject : hash.slice(0, 12)),
            h('div', { className: 'devbench-commit-chip-meta' },
              h('span', { className: 'devbench-mono' }, info ? info.short : hash.slice(0, 8)),
              info && info.date ? h('span', null, formatTime(info.date)) : null)),
          h('div', { className: 'devbench-commit-chip-actions' },
            h('button', {
              className: 'devbench-icon-btn',
              title: t('detail.commits.open'),
              'aria-label': t('detail.commits.open'),
              disabled: destructiveDisabled || typeof props.onOpenCommit !== 'function',
              onClick() {
                if (typeof props.onOpenCommit === 'function') props.onOpenCommit(hash)
              },
            }, h(IconExternal, { size: 14 })),
            h('button', {
              className: 'devbench-icon-btn',
              title: t('detail.commits.unlink'),
              'aria-label': t('detail.commits.unlink'),
              disabled: destructiveDisabled || commitBusyHash !== '',
              onClick() { unlinkCommit(hash) },
            }, h(IconTrash, { size: 14 }))))
      }))
  const docContent = h('div', null, docTab, commitsSection, sessionsSection, worktreeSection)
  const filesTab = h('div', null,
    h('div', { className: 'devbench-section' },
      h('div', { className: 'devbench-section-title' },
        t('detail.files'),
        h('span', { className: 'spacer' }),
        h('button', { className: 'devbench-btn', disabled: hardDisabled, onClick() { openCreateFileModal('file') } },
          h(IconPlus, { size: 13 }), t('detail.files.newfile')),
        h('button', { className: 'devbench-btn', disabled: hardDisabled, onClick() { openCreateFileModal('dir') } },
          h(IconFolder, { size: 13 }), t('detail.files.newdir')),
        h('button', {
          className: 'devbench-btn ghost', disabled: hardDisabled,
          onClick: openFolder,
        }, h(IconExternal, { size: 13 }), t('detail.files.upload'))),
      h(FileTree, {
        key: 'tree-' + key + '-' + fileRevision,
        t: t,
        workspaceId: sel.workspaceId,
        requirementId: sel.id,
        revision: fileRevision,
        disabled: hardDisabled,
        onBusyChange: setFileTreeBusy,
        onDirtyChange: setFileDirty,
        rootEntries: filesState.data ? filesState.data.entries : [],
        loading: filesState.loading,
        error: filesState.error,
        onDelete: requestDeleteFile,
        onReloadRoot() { reloadFiles().catch(noop) },
        showToast: props.showToast,
      })))
  let fileModalElement = null
  if (fileModal) {
    if (fileModal.kind === 'delete') {
      fileModalElement = h(Modal, {
        t: t,
        title: t('delete.confirm.title'),
        danger: true,
        confirmText: fileModal.busy ? t('detail.files.deleteBusy') : t('action.delete'),
        confirmDisabled: fileModal.busy,
        onCancel() { if (!fileModal.busy) setFileModal(null) },
        onConfirm: submitFileModal,
      }, h('div', null,
        h('div', { className: 'devbench-hint' }, t('delete.confirm.body').replace('{name}', fileModal.path)),
        fileModal.error ? h(Banner, { kind: 'error' }, fileModal.error) : null))
    } else {
      fileModalElement = h(Modal, {
        t: t,
        title: fileModal.kind === 'dir' ? t('detail.files.newdir') : t('detail.files.newfile'),
        onClose: requestFileModalClose,
        onCancel: requestFileModalClose,
        confirmText: fileModal.busy ? t('detail.files.createBusy') : t('action.confirm'),
        confirmDisabled: fileModal.busy || fileModal.value.trim() === '',
        onConfirm: submitFileModal,
      }, h('div', { className: 'devbench-flexcol' },
        h('label', { className: 'devbench-hint' }, t('detail.files.name')),
        h('input', {
          className: 'devbench-input devbench-mono', autoFocus: true,
          value: fileModal.value, disabled: fileModal.busy,
          onChange(event) {
            const value = event.target.value
            setFileModal(function (prev) { return Object.assign({}, prev, { value: value }) })
          },
          onKeyDown(event) {
            if (event.key === 'Enter' && !fileModal.busy && fileModal.value.trim()) submitFileModal()
          },
        }),
        fileModal.error ? h(Banner, { kind: 'error' }, fileModal.error) : null))
    }
  }
  const deleteRequirementElement = deleteOpen
    ? h(Modal, {
      t: t,
      title: t('delete.requirement.title'),
      danger: true,
      confirmText: busy ? t('detail.delete.busy') : t('action.delete'),
      confirmDisabled: busy || requirementRunning || activeRequirementTask !== null,
      onCancel() { if (!busy) setDeleteOpen(false) },
      onConfirm: confirmDeleteRequirement,
    }, h('div', { className: 'devbench-flexcol' },
      h('div', { className: 'devbench-hint' },
        t('delete.requirement.body', { name: summary.title })),
      sessionIds.length > 0
        ? h('div', { className: 'devbench-hint' }, t('delete.requirement.sessions', { count: sessionIds.length }))
        : null,
      activeRequirementTask !== null
        ? h('div', { className: 'devbench-hint' }, t('detail.delete.impactTasks', { count: 1 }))
        : null,
      dirty
        ? h('div', { className: 'devbench-hint' }, t('detail.discardDraft.body'))
        : null,
      worktreeEnabled && worktreeBranch !== ''
        ? h('div', { className: 'devbench-hint' }, t('detail.delete.impactWorktree', { branch: worktreeBranch }))
        : null,
      deleteError ? h(Banner, { kind: 'error' }, deleteError) : null))
    : null
  const removeWorktreeElement = removeWorktreeOpen
    ? h(Modal, {
      t: t,
      title: t('detail.worktree.remove.title'),
      danger: true,
      confirmText: removeWorktreeBusy ? t('detail.worktree.removing') : t('action.delete'),
      confirmDisabled: removeWorktreeBusy || activeWorktreeTask !== null,
      onCancel() { if (!removeWorktreeBusy) setRemoveWorktreeOpen(false) },
      onConfirm: confirmRemoveWorktree,
    }, h('div', { className: 'devbench-flexcol' },
      h('div', { className: 'devbench-hint' },
        t('detail.worktree.remove.body', { path: worktreePath, branch: worktreeBranch })),
      activeWorktreeTask !== null
        ? h('div', { className: 'devbench-hint' }, t('detail.worktree.remove.activeNote'))
        : null,
      removeWorktreeError ? h(Banner, { kind: 'error' }, removeWorktreeError) : null))
    : null
  const tabContent = tab === 'doc' ? docContent : filesTab
  const linkedCommits = Array.isArray(summary.commits) ? summary.commits : []
  let commitPickerElement = null
  if (commitPicker) {
    let pickerBody
    if (commitPicker.loading) {
      pickerBody = h('div', { className: 'devbench-inline-loading' }, t('panel.loading'))
    } else if (commitPicker.rows.length === 0) {
      pickerBody = h('div', { className: 'devbench-hint' }, t('detail.commits.noCommits'))
    } else {
      pickerBody = h('div', { className: 'devbench-picker-list' }, commitPicker.rows.map(function (commit) {
        const linked = linkedCommits.some(function (hash) {
          return hash === commit.hash || commit.hash.indexOf(hash) === 0 || hash.indexOf(commit.hash) === 0
        })
        const busy = commitPicker.busy === commit.hash
        return h('button', {
          type: 'button',
          key: commit.hash,
          className: 'devbench-picker-row',
          disabled: linked || commitPicker.busy !== '',
          onClick() { if (!linked) linkCommit(commit.hash) },
        },
        h('span', { className: 'devbench-mono' }, commit.short || String(commit.hash).slice(0, 8)),
        h('span', { className: 'devbench-picker-main' },
          h('span', { className: 'devbench-picker-title', title: commit.subject }, commit.subject || commit.hash),
          h('span', { className: 'devbench-picker-meta' },
            h('span', null, commit.authorName || ''),
            h('span', null, formatTime(commit.date)))),
        linked
          ? h('span', { className: 'devbench-pill succeeded' }, t('detail.commits.linkedShort'))
          : busy
            ? h('span', { className: 'devbench-hint' }, t('panel.loading'))
            : h('span', { className: 'devbench-pill' }, t('detail.commits.link')))
      }))
    }
    commitPickerElement = h(Modal, {
      t: t,
      title: t('detail.commits.pickerTitle'),
      onCancel: closeCommitPicker,
      onClose: closeCommitPicker,
      actions: false,
    }, h('div', { className: 'devbench-flexcol' },
      h('div', { className: 'devbench-hint' }, t('detail.commits.pickerHint')),
      commitPicker.error ? h(Banner, { kind: 'error' }, commitPicker.error) : null,
      pickerBody))
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
  const markdownPopupHeight = markdownModalFullscreen
    ? 'calc(100vh - 310px)'
    : 'min(52vh, 520px)'
  const markdownModalElement = markdownModalOpen
    ? h(Modal, {
      t: t,
      title: t('markdown.popup.title'),
      size: markdownModalFullscreen ? 'fullscreen' : 'xl',
      headerActions: h('button', {
        className: 'devbench-icon-btn',
        type: 'button',
        title: markdownModalFullscreen
          ? t('markdown.popup.exitFullscreen')
          : t('markdown.popup.fullscreen'),
        'aria-label': markdownModalFullscreen
          ? t('markdown.popup.exitFullscreen')
          : t('markdown.popup.fullscreen'),
        onClick: toggleMarkdownFullscreen,
      }, markdownModalFullscreen
        ? h(IconMinimize, { size: 15 })
        : h(IconMaximize, { size: 15 })),
      onCancel: closeMarkdownModal,
      onClose: closeMarkdownModal,
      cancelText: t('markdown.popup.close'),
      confirmText: saving ? t('detail.saving') : t('markdown.popup.save'),
      confirmDisabled: saving || hardDisabled,
      onConfirm: saveMarkdownModal,
    }, h('div', { className: 'devbench-md-modal-body' },
      error ? h(Banner, { kind: 'error' }, error) : null,
      h('label', { className: 'devbench-field' },
        h('span', { className: 'devbench-hint' }, t('detail.title')),
        h('input', {
          className: 'devbench-input',
          value: titleDraft,
          disabled: hardDisabled,
          'aria-label': t('detail.title'),
          onChange(event) {
            setTitleDraft(event.target.value)
            markDirty(event.target.value, bodyRef.current)
          },
          onKeyDown(event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              saveMarkdownEditor().catch(noop)
            }
          },
        })),
      h(MarkdownEditor, Object.assign({}, markdownEditorProps, {
        height: markdownPopupHeight,
        onSave: function () { saveMarkdownEditor().catch(noop) },
      }))))
    : null
  const recoverBanner = recoverDraft !== null
    ? h(Banner, { kind: 'info' },
      h('div', { className: 'devbench-inline', style: { flexWrap: 'wrap', gap: '8px' } },
        h('span', { style: { flex: 1, minWidth: 0 } },
          h('strong', null, t('detail.draftRecover.title')),
          h('div', { className: 'devbench-hint' },
            t('detail.draftRecover.body', {
              time: recoverDraft.savedAt !== '' ? formatTime(recoverDraft.savedAt) : '-',
            }))),
        h('button', {
          className: 'devbench-btn primary',
          onClick() { restoreDraft(recoverDraft) },
        }, t('detail.draftRecover.restore')),
        h('button', {
          className: 'devbench-btn ghost',
          onClick: discardRecoveredDraft,
        }, t('detail.draftRecover.discard'))))
    : null
  const conflictBanner = conflict
    ? h(Banner, { kind: 'error' },
      h('div', { className: 'devbench-inline', style: { flexWrap: 'wrap', gap: '8px' } },
        h('span', { style: { flex: 1, minWidth: 0 } }, t('detail.conflict.banner')),
        h('button', {
          className: 'devbench-btn',
          onClick() { reloadFromServer().catch(noop) },
        }, t('detail.conflict.reload')),
        h('button', {
          className: 'devbench-btn primary danger',
          disabled: saving,
          onClick: overwriteSave,
        }, t('detail.conflict.overwrite'))))
    : null
  const foot = h('div', { className: 'devbench-detail-foot' },
    h('button', {
      className: 'devbench-btn primary',
      disabled: saving || hardDisabled || !dirty,
      onClick() { saveDocument().catch(noop) },
    }, saving ? t('detail.saving') : t('detail.save')),
    dirty
      ? h('button', {
        className: 'devbench-btn ghost',
        disabled: saving,
        onClick: discardDrafts,
      }, t('dialog.unsaved.discard'))
      : null,
    h('span', { className: 'devbench-hint' }, t('detail.saveHint')),
    h('span', { style: { flex: 1 } }),
    (dirty || fileDirty)
      ? h('span', {
        className: 'devbench-hint',
        style: { color: 'var(--dsw-alias-state-warn-primary)', fontWeight: 600 },
      }, t('detail.saveState.unsaved'))
      : null)
  return h('div', { className: 'devbench-detail-page' },
    head,
    tabBar,
    h('div', { className: 'devbench-detail-body' },
      recoverBanner,
      conflictBanner,
      error || detailError ? h(Banner, { kind: 'error' }, error || detailError) : null,
      tabContent),
    foot,
    fileModalElement,
    deleteRequirementElement,
    removeWorktreeElement,
    commitPickerElement,
    markdownHelpElement,
    markdownModalElement)
}
