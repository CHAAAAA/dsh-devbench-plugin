/**
 * Project worktrees: master-detail list + detail.
 *
 * Rows cover three states: `ready` (directory exists), `missing` (registered
 * but the directory was deleted outside the plugin) and `absent` (the
 * requirement enabled worktrees but none was created yet). Every state has a
 * direct recovery/create action, so the tab never dead-ends.
 */
import { h, useState, useEffect, useRef, errorText, isAbortError } from '../../runtime.js'
import { useUiState, setSelection } from '../../core/ui-store.js'
import * as api from '../../core/api.js'
import type { ProjectWorktrees as ProjectWorktreesDto, WorktreeChanges } from '../../../shared/api-types.js'
import { ListFooter, useListPage } from '../../ui/list-page.js'
import { Banner, formatShortTime } from '../../ui/common.js'
import { confirmDialog } from '../../ui/dialogs.js'
import { IconRefresh, IconCode, IconTerminal, IconFolder, IconExternal } from '../../ui/icons.js'
const EMPTY_CHANGES = { loading: false, error: '', data: null, key: '' }
const KNOWN_STATUSES = ['new', 'running', 'done', 'archived', 'cancelled', 'missing']
const OPEN_TARGET_ICONS = { vscode: IconCode, system: IconFolder, iterm: IconTerminal }
function noop() {}
function formatDate(value) {
  if (value === undefined || value === null || value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  try { return date.toLocaleString() } catch (err) { return String(value) }
}
function statusText(t, status) {
  const value = KNOWN_STATUSES.indexOf(status) >= 0 ? status : 'new'
  return t('status.' + value)
}
function safeCount(value) {
  const number = Number(value)
  if (Number.isFinite(number) === false || number < 0) return 0
  return number
}
function activateOnKey(event, handler) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    handler()
  }
}
function worktreeState(worktree) {
  if (worktree === null || worktree === undefined) return 'missing'
  if (worktree.state === 'ready' || worktree.state === 'missing' || worktree.state === 'absent') {
    return worktree.state
  }
  return worktree.exists === false ? 'missing' : 'ready'
}
/** Label/value row used by the detail pane. */
function metaRow(key, label, value, options?) {
  const opts = options || {}
  const style = {
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: opts.breakAll === true ? 'normal' : 'nowrap',
    wordBreak: opts.breakAll === true ? 'break-all' : 'normal',
    textAlign: 'right',
  }
  return h('div', { className: 'devbench-overview-summary-row', key: key },
    h('span', { className: 'devbench-hint' }, label),
    h('span', { className: opts.mono === true ? 'devbench-mono' : '', style: style }, value))
}
function stateLabel(t, state) {
  if (state === 'absent') return t('project.worktrees.notCreated')
  if (state === 'missing') return t('project.worktrees.missingDir')
  return t('project.worktrees.ready')
}
export function ProjectWorktrees(props) {
  const t = props.t
  const workspaceId = props.workspaceId
  const openTargets = Array.isArray(props.openTargets) && props.openTargets.length > 0
    ? props.openTargets
    : ['system']
  const [state, setState] = useState<{ loading: boolean; error: string; data: ProjectWorktreesDto | null; key: string }>({ loading: true, error: '', data: null, key: '' })
  const [changesState, setChangesState] = useState<{ loading: boolean; error: string; data: WorktreeChanges | null; key: string }>(EMPTY_CHANGES)
  const [changesOpen, setChangesOpen] = useState(false)
  const [busy, setBusy] = useState({})
  const [pruneBusy, setPruneBusy] = useState(false)
  const listSeqRef = useRef(0)
  const changesSeqRef = useRef(0)
  const inFlightRef = useRef(new Set())
  const pruneBusyRef = useRef(false)
  const projectRef = useRef('')
  const ui = useUiState()
  const selection = ui.selection || {}
  const selectedId = selection.worktrees || ''
  const activeCommitTask = props.activeCommitTask || null
  const data = state.data
  const worktrees = data && Array.isArray(data.worktrees) ? data.worktrees : []
  const page = useListPage(worktrees)
  const selected = worktrees.find(function (item) { return item.requirementId === selectedId }) ||
    worktrees[0] || null
  const rowsRef = useRef([])
  const workspaceRef = useRef(workspaceId)
  rowsRef.current = worktrees
  workspaceRef.current = workspaceId
  /** Start one in-flight action for a row; other rows stay interactive. */
  function beginRowAction(id, action) {
    if (inFlightRef.current.has(id)) return false
    inFlightRef.current.add(id)
    setBusy(function (prev) {
      const next = Object.assign({}, prev)
      next[id] = action
      return next
    })
    return true
  }
  function endRowAction(id) {
    inFlightRef.current.delete(id)
    setBusy(function (prev) {
      const next = Object.assign({}, prev)
      delete next[id]
      return next
    })
  }
  function currentRow(requirementId) {
    return worktrees.find(function (item) { return item.requirementId === requirementId }) || null
  }
  /** Commit task (if any) that belongs to this worktree row. */
  function commitTaskFor(worktree) {
    if (activeCommitTask === null || !worktree) return null
    if (typeof activeCommitTask.worktreePath === 'string' && activeCommitTask.worktreePath !== '' &&
        activeCommitTask.worktreePath === worktree.path) {
      return activeCommitTask
    }
    if (typeof activeCommitTask.requirementId === 'string' && activeCommitTask.requirementId !== '' &&
        activeCommitTask.requirementId === worktree.requirementId) {
      return activeCommitTask
    }
    return null
  }
  function showToast(kind, text, options?) {
    if (typeof props.showToast === 'function') props.showToast(kind, text, options)
  }
  function refreshAfterMutation() {
    if (typeof props.onChanged === 'function') props.onChanged()
  }
  function loadList() {
    if (workspaceId === null || workspaceId === undefined || workspaceId === '') {
      return Promise.resolve(null)
    }
    const seq = ++listSeqRef.current
    const projectId = workspaceId
    setState(function (prev) {
      const same = prev.key === projectId
      return {
        loading: same ? prev.data === null : true,
        error: '',
        data: same ? prev.data : null,
        key: projectId,
      }
    })
    return api.getProjectWorktrees(projectId, { timeoutMs: 60000 }).then(function (value) {
      if (listSeqRef.current !== seq) return null
      setState({ loading: false, error: '', data: value, key: projectId })
      return value
    }, function (err) {
      if (listSeqRef.current !== seq || isAbortError(err)) return null
      setState(function (prev) {
        return {
          loading: false,
          error: errorText(err),
          data: prev.key === projectId ? prev.data : null,
          key: projectId,
        }
      })
      return null
    })
  }
  useEffect(function () {
    if (projectRef.current !== workspaceId) {
      projectRef.current = workspaceId
      setChangesOpen(false)
      setChangesState(EMPTY_CHANGES)
      changesSeqRef.current += 1
    }
    if (props.gitReady === false) {
      setState({ loading: false, error: '', data: null, key: workspaceId || '' })
      return
    }
    loadList().catch(noop)
    return function () { listSeqRef.current += 1 }
  }, [workspaceId, props.revision, props.gitReady])
  useEffect(function () {
    if (worktrees.length === 0) return
    const hit = worktrees.some(function (item) { return item.requirementId === selectedId })
    if (hit === false) setSelection('worktrees', worktrees[0].requirementId)
  }, [selectedId, state.data])
  useEffect(function () {
    // Refresh the expanded changes panel after external mutations (commit,
    // push, remove) instead of leaving a stale diff on screen.
    if (changesOpen === false) return
    const current = worktrees.find(function (item) {
      return item.requirementId === selectedId
    })
    if (current === undefined || worktreeState(current) !== 'ready') return
    loadChanges(current).catch(noop)
  }, [props.revision])
  useEffect(function () {
    // A row that lost its directory (or vanished) must not keep a stale diff panel.
    if (changesOpen === false) return
    const current = worktrees.find(function (item) { return item.requirementId === selectedId })
    if (current !== undefined && worktreeState(current) === 'ready') return
    closeChanges()
  }, [state.data])
  useEffect(function () {
    // Keep the detail pane consistent with the visible page: selecting a row
    // beyond the current page would otherwise show a row that cannot be seen.
    if (page.rows.length === 0) return
    const visible = page.rows.some(function (item) { return item.requirementId === selectedId })
    if (visible === false) setSelection('worktrees', page.rows[0].requirementId)
  }, [state.data, selectedId, page.rows.length])
  function selectWorktree(worktree) {
    if (!worktree || !worktree.requirementId) return
    if (worktree.requirementId !== selectedId) {
      setChangesOpen(false)
      setChangesState(EMPTY_CHANGES)
      changesSeqRef.current += 1
    }
    setSelection('worktrees', worktree.requirementId)
  }
  function loadChanges(worktree) {
    if (!worktree || workspaceId === null || workspaceId === undefined) return Promise.resolve(null)
    const id = worktree.requirementId
    const projectId = workspaceId
    const seq = ++changesSeqRef.current
    setChangesState(function (prev) {
      return { loading: true, error: '', data: prev.key === id ? prev.data : null, key: id }
    })
    return api.getProjectWorktreeChanges(projectId, id, { timeoutMs: 60000 }).then(function (value) {
      if (changesSeqRef.current !== seq) return null
      setChangesState({ loading: false, error: '', data: value, key: id })
      return value
    }, function (err) {
      if (changesSeqRef.current !== seq || isAbortError(err)) return null
      setChangesState(function (prev) {
        return { loading: false, error: errorText(err), data: prev.key === id ? prev.data : null, key: id }
      })
      return null
    })
  }
  function closeChanges() {
    setChangesOpen(false)
    setChangesState(EMPTY_CHANGES)
    changesSeqRef.current += 1
  }
  function openChanges(worktree) {
    if (!worktree || worktreeState(worktree) !== 'ready') return Promise.resolve(null)
    setChangesOpen(true)
    return loadChanges(worktree)
  }
  function toggleChanges(worktree) {
    if (!worktree || worktreeState(worktree) !== 'ready') return Promise.resolve(null)
    if (changesOpen === true && changesState.key === worktree.requirementId) {
      closeChanges()
      return Promise.resolve(null)
    }
    return openChanges(worktree)
  }
  /** Map stable host error codes to a recovery action inside the toast. */
  function showActionError(err, worktree) {
    const message = errorText(err)
    const code = err && err.code ? String(err.code) : ''
    const projectId = workspaceId
    const requirementId = worktree && worktree.requirementId ? worktree.requirementId : ''
    // Toast actions outlive the component render that created them: resolve the
    // row again when clicked so stale references cannot hit another project.
    function onCurrentRow(callback) {
      if (workspaceRef.current !== projectId) return
      const row = currentRow(requirementId)
      if (row === null) {
        loadList().catch(noop)
        return
      }
      callback(row)
    }
    if (worktree && code === 'stale-preview') {
      showToast('error', message, {
        actionLabel: t('project.worktrees.repreview'),
        onAction() { onCurrentRow(function (row) { previewCommit(row) }) },
      })
      return
    }
    if (worktree && code === 'worktree-dirty') {
      showToast('error', message, {
        actionLabel: t('project.worktrees.changes'),
        onAction() { onCurrentRow(function (row) { openChanges(row) }) },
      })
      return
    }
    if (worktree && (code === 'worktree-in-use' || code === 'worktree-requirement-running')) {
      showToast('error', message, {
        actionLabel: t('project.worktrees.openRequirement'),
        onAction() { onCurrentRow(function (row) { openRequirement(row) }) },
      })
      return
    }
    if (code === 'worktree-not-found' || code === 'worktree-gone') {
      showToast('error', message, {
        actionLabel: t('project.refresh'),
        onAction() { loadList().catch(noop) },
      })
      return
    }
    showToast('error', message)
  }
  function copyText(value) {
    if (typeof value !== 'string' || value.length === 0) return
    const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard
    if (clipboard === null || clipboard === undefined || typeof clipboard.writeText !== 'function') {
      showToast('error', t('project.worktrees.copyUnavailable'))
      return
    }
    Promise.resolve(clipboard.writeText(value)).then(function () {
      showToast('info', t('project.worktrees.copied'))
    }, function (err) {
      showToast('error', errorText(err) || t('project.worktrees.copyUnavailable'))
    })
  }
  function openRequirement(worktree) {
    if (!worktree || typeof props.onOpenRequirement !== 'function') return
    props.onOpenRequirement(workspaceId, worktree.requirementId)
  }
  function openCommitPreview(task) {
    const target = task || activeCommitTask
    if (target === null) return
    if (typeof props.onOpenCommitPreview === 'function') props.onOpenCommitPreview(target)
  }
  function createWorktree(worktree) {
    if (pruneBusyRef.current) return Promise.resolve(null)
    if (!worktree || workspaceId === null || workspaceId === undefined) return Promise.resolve(null)
    const projectId = workspaceId
    const id = worktree.requirementId
    if (beginRowAction(id, 'create') === false) return Promise.resolve(null)
    return api.createProjectWorktree(projectId, id).then(function (result) {
      showToast('info', t('project.worktrees.created'))
      loadList().catch(noop)
      refreshAfterMutation()
      return result
    }, function (err) {
      showActionError(err, worktree)
      return null
    }).finally(function () {
      endRowAction(id)
    })
  }
  function previewCommit(worktree) {
    if (pruneBusyRef.current) return Promise.resolve(null)
    if (workspaceId === null || workspaceId === undefined) return Promise.resolve(null)
    if (!worktree || worktreeState(worktree) !== 'ready' || worktree.dirty !== true) {
      return Promise.resolve(null)
    }
    const matchingTask = commitTaskFor(worktree)
    if (activeCommitTask !== null) {
      if (matchingTask !== null) openCommitPreview(matchingTask)
      else showToast('info', t('project.ai.commitActive'))
      return Promise.resolve(null)
    }
    const projectId = workspaceId
    const id = worktree.requirementId
    if (beginRowAction(id, 'commit') === false) return Promise.resolve(null)
    return api.previewWorktreeCommit(projectId, id).then(function (result) {
      const task = result && result.task ? result.task : null
      if (task && typeof props.onCommitTask === 'function') props.onCommitTask(task)
      showToast('info', t('project.commit.previewCreated'))
      loadList().catch(noop)
      return result
    }, function (err) {
      showActionError(err, worktree)
      return null
    }).finally(function () {
      endRowAction(id)
    })
  }
  function push(worktree) {
    if (pruneBusyRef.current) return Promise.resolve(null)
    if (workspaceId === null || workspaceId === undefined) return Promise.resolve(null)
    if (!worktree || worktreeState(worktree) !== 'ready' || !worktree.remote) return Promise.resolve(null)
    const projectId = workspaceId
    const id = worktree.requirementId
    const remote = String(worktree.remote || '')
    const branch = String(worktree.branch || '')
    return confirmDialog({
      title: t('tabs.worktrees.pushConfirmTitle'),
      body: t('tabs.worktrees.pushConfirmBody', { branch: branch, remote: remote }),
      confirmText: t('project.worktrees.push'),
      cancelText: t('action.cancel'),
    }).then(function (ok) {
      if (ok !== true) return null
      if (beginRowAction(id, 'push') === false) return null
      const fallbackRemote = remote
      return api.pushWorktree(projectId, id, { timeoutMs: 120000 }).then(function (result) {
        if (result && result.alreadyUpToDate === true) {
          showToast('info', t('project.worktrees.pushedUpToDate'))
        } else {
          showToast('info', t('project.worktrees.pushed', {
            remote: (result && result.remote) || fallbackRemote,
            branch: (result && result.branch) || branch,
          }))
        }
        loadList().catch(noop)
        return result
      }, function (err) {
        showActionError(err, worktree)
        return null
      }).finally(function () {
        endRowAction(id)
      })
    })
  }
  function reveal(worktree, target) {
    if (pruneBusyRef.current) return Promise.resolve(null)
    if (!worktree || workspaceId === null || workspaceId === undefined) return Promise.resolve(null)
    const projectId = workspaceId
    const id = worktree.requirementId
    if (beginRowAction(id, 'reveal') === false) return Promise.resolve(null)
    return api.revealProjectWorktree(projectId, id, target).then(function (result) {
      showToast('info', t('project.worktrees.revealed'))
      return result
    }, function (err) {
      showActionError(err, worktree)
      return null
    }).finally(function () {
      endRowAction(id)
    })
  }
  function doPrune(worktree) {
    if (pruneBusyRef.current) return Promise.resolve(null)
    if (workspaceId === null || workspaceId === undefined) return Promise.resolve(null)
    const projectId = workspaceId
    const id = worktree && worktree.requirementId ? worktree.requirementId : ''
    pruneBusyRef.current = true
    setPruneBusy(true)
    return api.pruneProjectWorktree(projectId, id).then(function (result) {
      const count = result && Array.isArray(result.pruned) ? result.pruned.length : 0
      showToast('info', t('project.worktrees.pruned', { count: count }))
      if (id !== '' && changesState.key === id) {
        setChangesOpen(false)
        setChangesState(EMPTY_CHANGES)
        changesSeqRef.current += 1
      }
      loadList().catch(noop)
      refreshAfterMutation()
      return result
    }, function (err) {
      showActionError(err, worktree)
      return null
    }).finally(function () {
      pruneBusyRef.current = false
      setPruneBusy(false)
    })
  }
  function requestPrune(worktree) {
    if (pruneBusyRef.current) return Promise.resolve(null)
    const branch = String((worktree && worktree.branch) || '')
    return confirmDialog({
      title: t('project.worktrees.pruneTitle'),
      body: t('project.worktrees.pruneBody', { path: String((worktree && worktree.path) || ''), branch: branch }),
      confirmText: t('project.worktrees.prune'),
      cancelText: t('action.cancel'),
    }).then(function (ok) {
      if (ok !== true) return null
      return doPrune(worktree)
    })
  }
  function requestPruneAll() {
    if (pruneBusyRef.current) return Promise.resolve(null)
    const missing = worktrees.filter(function (item) { return worktreeState(item) === 'missing' })
    if (missing.length === 0) return Promise.resolve(null)
    return confirmDialog({
      tone: 'danger',
      title: t('project.worktrees.pruneAllTitle'),
      body: t('project.worktrees.pruneAllBody', { count: missing.length }),
      confirmText: t('project.worktrees.pruneAll'),
      cancelText: t('action.cancel'),
    }).then(function (ok) {
      if (ok !== true) return null
      return doPrune(null)
    })
  }
  function requestRemove(worktree) {
    if (pruneBusyRef.current) return Promise.resolve(null)
    if (!worktree || worktreeState(worktree) !== 'ready') return Promise.resolve(null)
    if (worktree.dirty === true) {
      showToast('info', t('tabs.worktrees.deleteDirtyReason'), {
        actionLabel: t('project.worktrees.changes'),
        onAction() { toggleChanges(worktree) },
      })
      return Promise.resolve(null)
    }
    const branch = String(worktree.branch || '')
    const detailLines = [
      h('div', { key: 'name' }, String(worktree.title || '') + ' · ' + String(worktree.requirementId || '')),
      h('div', { key: 'dirty' }, worktree.dirty === true
        ? t('project.worktrees.dirty', { count: safeCount(worktree.changesCount) })
        : t('project.worktrees.clean')),
      h('div', { key: 'keep' }, t('tabs.worktrees.retainBranch', { branch: branch })),
    ]
    return confirmDialog({
      tone: 'danger',
      title: t('project.worktrees.removeTitle'),
      body: t('project.worktrees.removeBody', {
        path: String(worktree.path || ''),
        branch: branch,
      }),
      detail: h('div', { className: 'devbench-flexcol' }, detailLines),
      confirmText: t('action.delete'),
      cancelText: t('action.cancel'),
    }).then(function (ok) {
      if (ok !== true) return null
      return confirmRemove(worktree)
    })
  }
  function confirmRemove(worktree) {
    if (pruneBusyRef.current) return Promise.resolve(null)
    if (workspaceId === null || workspaceId === undefined || workspaceId === '') {
      return Promise.resolve(null)
    }
    const projectId = workspaceId
    const id = worktree.requirementId
    pruneBusyRef.current = true
    setPruneBusy(true)
    return api.removeProjectWorktree(projectId, id).then(function (result) {
      pruneBusyRef.current = false
      setPruneBusy(false)
      if (changesState.key === id) {
        setChangesOpen(false)
        setChangesState(EMPTY_CHANGES)
        changesSeqRef.current += 1
      }
      if (selectedId === id) setSelection('worktrees', null)
      showToast('info', t('project.worktrees.removed'))
      loadList().catch(noop)
      refreshAfterMutation()
      return result
    }, function (err) {
      pruneBusyRef.current = false
      setPruneBusy(false)
      showActionError(err, worktree)
      return null
    })
  }
  function changesPanel(worktree) {
    const content = changesState.key === worktree.requirementId ? changesState : EMPTY_CHANGES
    let body
    if (content.loading) {
      body = h('div', { className: 'devbench-inline-loading' }, t('panel.loading'))
    } else if (content.error) {
      body = h('div', null,
        h(Banner, { kind: 'error' }, content.error),
        h('button', {
          className: 'devbench-btn',
          onClick() { loadChanges(worktree).catch(noop) },
        }, t('panel.retry')))
    } else {
      const changes = content.data
      const files = changes && Array.isArray(changes.files) ? changes.files : []
      const fileList = files.length > 0
        ? h('div', { className: 'devbench-wt-files' }, files.map(function (file, index) {
          const path = String(file && file.path ? file.path : '')
          const from = file && file.from ? String(file.from) : ''
          return h('div', {
            className: 'devbench-wt-file',
            key: path + ':' + index,
            title: from ? from + ' -> ' + path : path,
          },
          h('span', { className: 'devbench-wt-file-status' }, String(file && file.status ? file.status : '')),
          h('span', { className: 'devbench-wt-file-path' }, from ? from + ' -> ' + path : path))
        }))
        : h('div', { className: 'devbench-muted' }, t('project.worktrees.changesEmpty'))
      body = h('div', null,
        h('div', { className: 'devbench-wt-changes-head' },
          h('span', { className: 'devbench-hint' }, t('project.worktrees.files')),
          h('span', { style: { flex: 1 } }),
          changes && changes.branch
            ? h('span', { className: 'devbench-mono devbench-wt-change-branch', title: changes.branch }, changes.branch)
            : null,
          changes && changes.head
            ? h('span', { className: 'devbench-mono' }, String(changes.head).slice(0, 8))
            : null,
          h('button', {
            className: 'devbench-btn ghost',
            disabled: pruneBusy,
            onClick() { loadChanges(worktree).catch(noop) },
          }, t('project.refresh')),
          h('button', {
            className: 'devbench-btn ghost',
            onClick() { closeChanges() },
          }, t('project.worktrees.hideChanges'))),
        fileList,
        changes && changes.diffText
          ? h('div', null,
            h('div', { className: 'devbench-wt-changes-head', style: { marginTop: '10px' } },
              h('span', { className: 'devbench-hint' }, t('project.worktrees.diff'))),
            h('pre', { className: 'devbench-worktree-diff' }, changes.diffText),
            changes.truncated
              ? h('div', { className: 'devbench-hint' }, t('project.worktrees.truncated'))
              : null)
          : h('div', { className: 'devbench-hint', style: { marginTop: '10px' } },
            t('project.worktrees.changesEmpty')))
    }
    return h('div', { className: 'devbench-wt-changes', style: { margin: '12px 0 0' } }, body)
  }
  function worktreeRow(worktree) {
    const id = worktree.requirementId
    const active = selected !== null && selected.requirementId === id
    const stateName = worktreeState(worktree)
    const ready = stateName === 'ready'
    const dirty = ready && worktree.dirty === true
    const meta = []
    if (ready) {
      meta.push(h('span', { className: 'devbench-wt-branch', key: 'branch', title: worktree.branch },
        t('project.worktrees.branch') + ': ' + String(worktree.branch || '')))
      meta.push(h('span', {
        className: 'devbench-wt-dirty' + (dirty ? ' dirty' : ''),
        key: 'dirty',
      }, dirty
        ? t('project.worktrees.dirty', { count: safeCount(worktree.changesCount) })
        : (worktree.statusKnown === false
          ? t('project.worktrees.statusUnknown')
          : t('project.worktrees.clean'))))
      if (safeCount(worktree.ahead) > 0) {
        meta.push(h('span', { className: 'devbench-pill', key: 'ahead' },
          t('project.worktrees.ahead', { count: safeCount(worktree.ahead) })))
      }
      if (safeCount(worktree.behind) > 0) {
        meta.push(h('span', { className: 'devbench-pill', key: 'behind' },
          t('project.worktrees.behind', { count: safeCount(worktree.behind) })))
      }
    } else {
      meta.push(h('span', {
        className: stateName === 'missing' ? 'devbench-wt-missing' : 'devbench-muted',
        key: 'state',
      }, stateLabel(t, stateName)))
      meta.push(h('span', { className: 'devbench-wt-branch', key: 'branch', title: worktree.branch },
        t('project.worktrees.branch') + ': ' + String(worktree.branch || '')))
    }
    return h('div', {
      key: id,
      className: 'devbench-master-row' + (active ? ' active' : ''),
      role: 'button',
      tabIndex: 0,
      'aria-pressed': active ? 'true' : 'false',
      title: String(worktree.title || id || ''),
      onClick() { selectWorktree(worktree) },
      onKeyDown(event) { activateOnKey(event, function () { selectWorktree(worktree) }) },
    },
    h('div', { className: 'devbench-master-row-main' },
      h('div', { className: 'devbench-master-row-title' },
        h('span', { className: 'devbench-pill ' + (KNOWN_STATUSES.indexOf(worktree.status) >= 0 ? worktree.status : 'new'), style: { marginRight: '6px' } },
          statusText(t, worktree.status)),
        String(worktree.title || id || ''),
        h('span', { className: 'devbench-wt-id devbench-mono', style: { marginLeft: '6px' } }, String(id || ''))),
      h('div', { className: 'devbench-master-row-meta' }, meta)))
  }
  function openTargetButtons(worktree) {
    if (worktreeState(worktree) !== 'ready') return null
    return openTargets.map(function (target) {
      const Icon = OPEN_TARGET_ICONS[target]
      if (Icon === undefined) return null
      const busyTarget = busy[worktree.requirementId] === 'reveal'
      return h('button', {
        key: 'open-' + target,
        className: 'devbench-icon-btn',
        title: t('project.worktrees.openIn', { target: t('project.open.' + target) }),
        'aria-label': t('project.worktrees.openIn', { target: t('project.open.' + target) }),
        disabled: busyTarget || pruneBusy,
        onClick() { return reveal(worktree, target).catch(noop) },
      }, h(Icon, { size: 15 }))
    })
  }
  function readyActions(worktree, id, rowBusy) {
    const dirty = worktree.dirty === true
    const remote = worktree.remote || null
    const commitBusy = busy[id] === 'commit'
    const anyBusy = rowBusy || pruneBusy
    const matchingTask = commitTaskFor(worktree)
    let commitLabel = t('project.worktrees.commit')
    let commitTitle = worktree.branch
    let commitDisabled = dirty === false || anyBusy
    if (matchingTask !== null) {
      commitLabel = t('project.worktrees.viewPreview')
      commitTitle = t('project.ai.commitActive')
      commitDisabled = false
    } else if (activeCommitTask !== null) {
      commitTitle = t('project.ai.commitActive')
      commitDisabled = true
    } else if (dirty === false) {
      commitTitle = t('project.worktrees.noChanges')
    }
    const pushTitle = remote === null
      ? (Array.isArray(worktree.remotes) && worktree.remotes.length > 1
        ? t('project.worktrees.remoteAmbiguous')
        : t('project.worktrees.pushNoRemote'))
      : worktree.branch
    return [
      h('button', {
        className: 'devbench-btn',
        key: 'changes',
        disabled: anyBusy,
        onClick() { return toggleChanges(worktree).catch(noop) },
      }, changesOpen ? t('project.worktrees.hideChanges') : t('project.worktrees.changes')),
      h('button', {
        className: 'devbench-btn primary',
        key: 'commit',
        disabled: commitDisabled,
        title: commitTitle,
        onClick() {
          if (matchingTask !== null) { openCommitPreview(matchingTask); return }
          return previewCommit(worktree).catch(noop)
        },
      }, commitBusy
        ? t('project.worktrees.commitBusy')
        : commitLabel),
      h('button', {
        className: 'devbench-btn',
        key: 'push',
        disabled: remote === null || busy[id] === 'push' || anyBusy,
        title: pushTitle,
        onClick() { return push(worktree).catch(noop) },
      }, busy[id] === 'push'
        ? t('project.worktrees.pushBusy')
        : t('project.worktrees.push')),
    ]
  }
  let listBody
  const gitMissing = Boolean(data && data.git && data.git.available === false)
  const notGit = props.gitReady === false || Boolean(data && data.git && data.git.initialized === false)
  if (workspaceId === null || workspaceId === undefined || workspaceId === '') {
    listBody = h('div', { className: 'devbench-empty-panel' }, t('project.selectHint'))
  } else if (gitMissing) {
    listBody = h('div', { className: 'devbench-empty-panel' }, t('project.gitUnavailable'))
  } else if (notGit) {
    listBody = h('div', { className: 'devbench-empty-panel' }, t('project.worktrees.notGit'))
  } else if (state.loading && data === null) {
    listBody = h('div', { className: 'devbench-inline-loading' }, t('panel.loading'))
  } else if (state.error && data === null) {
    listBody = h('div', null,
      h(Banner, { kind: 'error' }, state.error),
      h('button', { className: 'devbench-btn', onClick() { loadList().catch(noop) } }, t('panel.retry')))
  } else if (worktrees.length === 0) {
    listBody = h('div', { className: 'devbench-empty-panel' },
      h('div', null, t('project.worktrees.emptyNoRequirement')),
      typeof props.onGoRequirements === 'function'
        ? h('button', {
          className: 'devbench-btn',
          style: { marginTop: '10px' },
          onClick() { props.onGoRequirements() },
        }, t('project.worktrees.goEnable'))
        : null)
  } else {
    listBody = page.rows.map(worktreeRow)
  }
  const pager = page.total > page.size
    ? h('div', { className: 'devbench-master-list-foot' }, h(ListFooter, { t: t, page: page }))
    : null
  const dataRemotes = data && Array.isArray(data.remotes) ? data.remotes : []
  const metaLine = []
  if (data && data.defaultRoot) {
    metaLine.push(h('span', { className: 'devbench-wt-root devbench-mono', key: 'root', title: data.defaultRoot },
      t('project.worktrees.root') + ': ' + data.defaultRoot))
  }
  if (dataRemotes.length > 0) {
    metaLine.push(h('span', { className: 'devbench-muted', key: 'remote' },
      t('project.worktrees.remotes', { list: dataRemotes.join(', ') }) +
      (data.remote ? '' : ' · ' + t('project.worktrees.remoteAmbiguous'))))
  } else if (data) {
    metaLine.push(h('span', { className: 'devbench-muted', key: 'remote' }, t('project.worktrees.noRemote')))
  }
  const missingCount = worktrees.filter(function (item) {
    return worktreeState(item) === 'missing'
  }).length
  const absentCount = worktrees.filter(function (item) {
    return worktreeState(item) === 'absent'
  }).length
  if (missingCount > 0) {
    metaLine.push(h('span', { className: 'devbench-wt-missing', key: 'missing-count' },
      t('project.worktrees.missingCount', { count: missingCount })))
  }
  if (absentCount > 0) {
    metaLine.push(h('span', { className: 'devbench-muted', key: 'absent-count' },
      t('project.worktrees.absentCount', { count: absentCount })))
  }
  let detail
  if (selected === null) {
    detail = h('div', { className: 'devbench-master-empty' },
      h('div', null, t('tabs.worktrees.selectHint')))
  } else {
    const worktree = selected
    const id = worktree.requirementId
    const stateName = worktreeState(worktree)
    const ready = stateName === 'ready'
    const dirty = ready && worktree.dirty === true
    const remote = worktree.remote || null
    const remotes = Array.isArray(worktree.remotes) ? worktree.remotes : []
    const rowBusy = busy[id] !== undefined
    const createBusy = busy[id] === 'create'
    const pruneRowBusy = pruneBusy
    const lastCommit = worktree.lastCommit
    const bodyChildren = [
      metaRow('state', t('project.worktrees.state'), stateLabel(t, stateName)),
      metaRow('branch', t('project.worktrees.branch'), String(worktree.branch || '-'), { mono: true }),
      metaRow('path', t('tabs.worktrees.path'), String(worktree.path || '-'), { mono: true, breakAll: true }),
      metaRow('base', t('detail.worktree.base'), String(worktree.base || '-'), { mono: true }),
      ready
        ? metaRow('status', t('tabs.worktrees.changesState'),
          worktree.statusKnown === false
            ? t('project.worktrees.statusUnknown')
            : (dirty
              ? t('project.worktrees.dirty', { count: safeCount(worktree.changesCount) })
              : t('project.worktrees.clean')))
        : null,
      ready
        ? metaRow('ahead', t('tabs.worktrees.ahead'),
          worktree.aheadKnown === false
            ? t('project.worktrees.statusUnknown')
            : t('project.worktrees.ahead', { count: safeCount(worktree.ahead) }))
        : null,
      ready
        ? metaRow('behind', t('tabs.worktrees.behind'), t('project.worktrees.behind', { count: safeCount(worktree.behind) }))
        : null,
      metaRow('remote', t('project.worktrees.remote'),
        remote || (remotes.length > 1
          ? t('project.worktrees.remoteAmbiguous')
          : t('project.worktrees.noRemote'))),
      lastCommit
        ? metaRow('lastCommit', t('project.worktrees.lastCommit'),
          String(lastCommit.short || lastCommit.hash || '').slice(0, 8) + ' ' +
          String(lastCommit.subject || '') + ' · ' + formatDate(lastCommit.date), { breakAll: true })
        : metaRow('lastCommit', t('project.worktrees.lastCommit'), t('project.worktrees.noCommit')),
      worktree.upstream
        ? metaRow('upstream', t('tabs.worktrees.upstream'),
          String(worktree.upstream.remote || '') + '/' + String(worktree.upstream.branch || ''), { mono: true })
        : null,
    ].filter(Boolean)
    const head = h('div', { className: 'devbench-master-detail-head' },
      h('div', { className: 'devbench-title-row' },
        h('span', {
          className: 'devbench-pill ' + (KNOWN_STATUSES.indexOf(worktree.status) >= 0 ? worktree.status : 'new'),
        }, statusText(t, worktree.status)),
        h('span', { className: 'devbench-mono' }, String(id || '')),
        stateName === 'missing'
          ? h('span', { className: 'devbench-wt-missing' }, t('project.worktrees.missingDir'))
          : null,
        stateName === 'absent'
          ? h('span', { className: 'devbench-muted' }, t('project.worktrees.notCreated'))
          : null),
      h('div', {
        className: 'devbench-data-title',
        title: String(worktree.title || id || ''),
        style: { fontSize: '15px', fontWeight: 600, whiteSpace: 'normal', lineHeight: 1.4 },
      }, String(worktree.title || id || '')),
      h('div', { className: 'devbench-project-meta' },
        h('span', { className: 'devbench-mono' }, String(worktree.branch || '')),
        h('span', null, stateLabel(t, stateName)),
        h('span', null, ready ? formatShortTime(lastCommit && lastCommit.date) : String(worktree.path || ''))))
    const footGroups = []
    if (stateName === 'absent') {
      footGroups.push(
        h('button', {
          className: 'devbench-btn primary',
          key: 'create',
          disabled: createBusy || pruneBusy,
          onClick() { return createWorktree(worktree).catch(noop) },
        }, createBusy ? t('project.worktrees.creating') : t('project.worktrees.create')),
        typeof props.onGoRequirements === 'function'
          ? h('button', {
            className: 'devbench-btn',
            key: 'requirements',
            onClick() { props.onGoRequirements() },
          }, t('project.worktrees.goEnable'))
          : null,
        h('button', {
          className: 'devbench-btn ghost',
          key: 'copy-path',
          onClick() { copyText(String(worktree.path || '')) },
        }, t('project.worktrees.copyPath')))
    } else if (stateName === 'missing') {
      footGroups.push(
        h('button', {
          className: 'devbench-btn primary',
          key: 'prune',
          disabled: pruneRowBusy || rowBusy,
          onClick() { return requestPrune(worktree).catch(noop) },
        }, pruneBusy ? t('project.worktrees.pruning') : t('project.worktrees.pruneSingle')),
        typeof props.onOpenRequirement === 'function'
          ? h('button', {
            className: 'devbench-btn',
            key: 'requirements',
            onClick() { openRequirement(worktree) },
          }, t('project.worktrees.openRequirement'))
          : null,
        h('button', {
          className: 'devbench-btn ghost',
          key: 'copy-path',
          onClick() { copyText(String(worktree.path || '')) },
        }, t('project.worktrees.copyPath')))
    } else {
      footGroups.push(...readyActions(worktree, id, rowBusy))
      footGroups.push(
        typeof props.onOpenRequirement === 'function'
          ? h('button', {
            className: 'devbench-btn ghost',
            key: 'requirements',
            disabled: rowBusy || pruneRowBusy,
            onClick() { openRequirement(worktree) },
          }, h(IconExternal, { size: 13 }), t('project.worktrees.openRequirement'))
          : null,
        h('button', {
          className: 'devbench-btn ghost',
          key: 'copy-path',
          disabled: rowBusy || pruneRowBusy,
          onClick() { copyText(String(worktree.path || '')) },
        }, t('project.worktrees.copyPath')),
        h('button', {
          className: 'devbench-btn ghost',
          key: 'copy-branch',
          disabled: rowBusy || pruneRowBusy,
          onClick() { copyText(String(worktree.branch || '')) },
        }, t('project.worktrees.copyBranch')),
        h('button', {
          className: 'devbench-btn ghost danger',
          key: 'remove',
          disabled: dirty || pruneRowBusy || rowBusy,
          title: dirty ? t('tabs.worktrees.deleteDirtyReason') : t('project.worktrees.remove'),
          onClick() { return requestRemove(worktree).catch(noop) },
        }, t('project.worktrees.remove')))
      const targets = openTargetButtons(worktree)
      if (targets !== null && targets.length > 0) footGroups.push(...targets)
    }
    const footChildren = footGroups.filter(Boolean)
    detail = h('div', { className: 'devbench-master-detail' },
      head,
      h('div', { className: 'devbench-master-detail-body' },
        h('div', { className: 'devbench-flexcol' }, bodyChildren),
        stateName === 'absent'
          ? h('div', { className: 'devbench-hint', style: { marginTop: '10px' } },
            t('project.worktrees.absentHint'))
          : null,
        changesOpen ? changesPanel(worktree) : null),
      h('div', { className: 'devbench-master-detail-foot' }, footChildren))
  }
  return h('div', { className: 'devbench-master' },
    h('div', { className: 'devbench-master-list' },
      h('div', { className: 'devbench-master-list-head' },
        h('div', { className: 'devbench-master-list-title' },
          h('span', null, t('project.worktrees.title')),
          h('span', { className: 'spacer' }),
          missingCount > 0
            ? h('button', {
              className: 'devbench-btn ghost',
              disabled: pruneBusy,
              title: t('project.worktrees.pruneAllTitle'),
              onClick() { return requestPruneAll().catch(noop) },
            }, pruneBusy ? t('project.worktrees.pruning') : t('project.worktrees.pruneAll'))
            : null,
          h('span', { className: 'devbench-muted' }, t('tabs.listCount', { count: worktrees.length })),
          h('button', {
            className: 'devbench-icon-btn',
            title: t('project.refresh'),
            onClick() { loadList().catch(noop) },
          }, h(IconRefresh, { size: 15 }))),
        metaLine.length > 0
          ? h('div', { className: 'devbench-wt-head-meta', style: { border: 'none', paddingBottom: '0', marginBottom: '0' } }, metaLine)
          : null),
      state.error && data !== null
        ? h('div', { style: { padding: '8px 10px 0' } }, h(Banner, { kind: 'error' }, state.error))
        : null,
      h('div', { className: 'devbench-master-list-body' }, listBody),
      pager),
    detail)
}
