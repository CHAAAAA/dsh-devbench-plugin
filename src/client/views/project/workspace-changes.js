/**
 * Overview tab: working-tree panel with manual commit, pull and push.
 *
 * Manual commit stages everything (`git add -A`) with a hand-written message,
 * pull is always `--ff-only` and push targets the current branch. The panel is
 * rendered on the overview tab right after the AI actions panel, above the
 * recent-commits/reviews grid, and is hidden for non-Git projects.
 */
import { h, useState, useEffect, useRef, errorText, isAbortError } from '../../runtime.js'
import * as api from '../../core/api.js'
import { Banner } from '../../ui/common.js'
import { confirmDialog } from '../../ui/dialogs.js'
import { IconRefresh } from '../../ui/icons.js'
const MANUAL_COMMIT_MAX = 2000
const EMPTY_STATE = { loading: true, error: '', data: null, key: '' }
function noop() {}
function safeCount(value) {
  const number = Number(value)
  if (Number.isFinite(number) === false || number < 0) return 0
  return number
}
export function WorkspaceChangesPanel(props) {
  const t = props.t
  const workspaceId = props.workspaceId
  const activeCommitTask = props.activeCommitTask || null
  const [state, setState] = useState(EMPTY_STATE)
  const [busy, setBusy] = useState('')
  const [commitOpen, setCommitOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const seqRef = useRef(0)
  const projectRef = useRef('')
  function showToast(kind, text, options) {
    if (typeof props.showToast === 'function') props.showToast(kind, text, options)
  }
  function refreshAfterMutation() {
    if (typeof props.onChanged === 'function') props.onChanged()
  }
  /** Reload the working-tree snapshot; the request sequence drops late responses. */
  function load() {
    if (workspaceId === null || workspaceId === undefined || workspaceId === '') {
      return Promise.resolve(null)
    }
    const projectId = workspaceId
    const seq = ++seqRef.current
    setState(function (prev) {
      const same = prev.key === projectId
      return {
        loading: same ? prev.data === null : true,
        error: '',
        data: same ? prev.data : null,
        key: projectId,
      }
    })
    return api.getProjectChanges(projectId, { timeoutMs: 60000 }).then(function (value) {
      if (seqRef.current !== seq) return null
      setState({ loading: false, error: '', data: value, key: projectId })
      return value
    }, function (err) {
      if (seqRef.current !== seq || isAbortError(err)) return null
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
    if (workspaceId === null || workspaceId === undefined || workspaceId === '') return undefined
    if (projectRef.current !== workspaceId) {
      projectRef.current = workspaceId
      setBusy('')
      setCommitOpen(false)
      setMessage('')
      setCommitting(false)
      setShowDiff(false)
      setCollapsed(false)
    }
    load().catch(noop)
    return function () { seqRef.current += 1 }
  }, [workspaceId, props.revision])
  const data = state.data
  if (workspaceId === null || workspaceId === undefined || workspaceId === '') return null
  if (data === null) {
    const failed = state.loading !== true && state.error !== ''
    return h('section', { className: 'devbench-ws-panel' },
      h('header', { className: 'devbench-ws-panel-head' },
        h('span', { className: 'devbench-ws-panel-title' }, t('tabs.overview.workspace')),
        h('span', { className: 'devbench-hint devbench-ws-loading' },
          failed ? t('tabs.overview.workspaceLoadFailed') : t('tabs.overview.workspaceLoading'))),
      failed
        ? h('div', { className: 'devbench-ws-body' },
          h(Banner, { kind: 'error' }, state.error),
          h('button', { className: 'devbench-btn', onClick() { load().catch(noop) } }, t('panel.retry')))
        : null)
  }
  if (data.initialized !== true) return null
  const files = Array.isArray(data.files) ? data.files : []
  const changedFiles = Array.isArray(data.changedFiles) ? data.changedFiles : []
  const fileCount = files.length > 0 ? files.length : changedFiles.length
  const remotes = Array.isArray(data.remotes) ? data.remotes : []
  const remote = typeof data.remote === 'string' && data.remote !== '' ? data.remote : null
  const upstream = data.upstream && typeof data.upstream === 'object' ? data.upstream : null
  const branch = typeof data.branch === 'string' ? data.branch : ''
  const head = typeof data.head === 'string' ? data.head : ''
  const detached = data.detached === true
  const hasChanges = data.hasChanges === true
  const statusKnown = data.statusKnown !== false
  const loading = state.loading === true
  const ahead = safeCount(data.ahead)
  const behind = safeCount(data.behind)
  const canPull = busy === '' && loading === false && detached === false &&
    upstream !== null && activeCommitTask === null
  const canCommit = busy === '' && committing === false && hasChanges === true &&
    detached === false && activeCommitTask === null
  const canPush = busy === '' && detached === false && remote !== null
  let pullTitle
  if (canPull === false) {
    if (detached) pullTitle = t('tabs.overview.workspace.detached')
    else if (activeCommitTask !== null) pullTitle = t('project.ai.commitActive')
    else if (upstream === null) {
      if (remotes.length === 0) pullTitle = t('tabs.overview.workspace.noRemote')
      else if (remotes.length > 1 && remote === null) pullTitle = t('tabs.overview.workspace.remoteAmbiguous')
      else pullTitle = t('tabs.overview.workspace.noUpstream')
    } else if (busy !== '') pullTitle = busy === 'push' ? t('tabs.overview.pushing') : t('tabs.overview.pulling')
    else pullTitle = t('tabs.overview.workspaceLoading')
  }
  let pushTitle
  if (canPush === false) {
    if (detached) pushTitle = t('tabs.overview.workspace.detached')
    else if (remote === null) {
      pushTitle = remotes.length > 1
        ? t('tabs.overview.workspace.remoteAmbiguous')
        : t('tabs.overview.workspace.noRemote')
    } else pushTitle = busy === 'pull' ? t('tabs.overview.pulling') : t('tabs.overview.pushing')
  }
  let commitTitle
  if (canCommit === false) {
    if (activeCommitTask !== null) commitTitle = t('project.ai.commitActive')
    else if (detached) commitTitle = t('tabs.overview.workspace.detached')
    else if (hasChanges === false) commitTitle = t('project.worktrees.noChanges')
    else if (committing) commitTitle = t('tabs.overview.manualCommitting')
    else if (busy !== '') {
      commitTitle = busy === 'pull' ? t('tabs.overview.pulling') : t('tabs.overview.pushing')
    } else commitTitle = t('tabs.overview.workspaceLoading')
  }
  let summaryText
  if (statusKnown === false) summaryText = t('tabs.overview.workspace.statusUnknown')
  else if (hasChanges) summaryText = t('tabs.overview.workspace.changes', { count: fileCount })
  else summaryText = t('tabs.overview.workspace.clean')
  let upstreamText
  if (upstream !== null) {
    upstreamText = t('tabs.overview.workspace.upstream', {
      remote: String(upstream.remote || ''),
      branch: String(upstream.branch || branch),
    })
  } else if (remotes.length === 0) {
    upstreamText = t('tabs.overview.workspace.noRemote')
  } else if (remotes.length > 1 && remote === null) {
    upstreamText = t('tabs.overview.workspace.remoteAmbiguous')
  } else {
    upstreamText = t('tabs.overview.workspace.noUpstream')
  }
  function requestPull() {
    if (canPull === false) return Promise.resolve(null)
    const branchLabel = branch === '' ? t('project.noBranch') : branch
    const upstreamLabel = upstream === null
      ? ''
      : String(upstream.remote || '') + '/' + String(upstream.branch || branchLabel)
    return confirmDialog({
      title: t('tabs.overview.pullConfirmTitle'),
      body: t('tabs.overview.pullConfirmBody', { branch: branchLabel, upstream: upstreamLabel }),
      confirmText: t('tabs.overview.pull'),
      cancelText: t('action.cancel'),
    }).then(function (ok) {
      if (ok !== true) return null
      setBusy('pull')
      return api.pullProject(workspaceId, { timeoutMs: 120000 }).then(function (result) {
        if (result && result.alreadyUpToDate === true) {
          showToast('info', t('tabs.overview.pullUpToDate'))
        } else {
          showToast('info', t('tabs.overview.pullSuccess'))
        }
        load().catch(noop)
        refreshAfterMutation()
        return result
      }, function (err) {
        showToast('error', errorText(err))
        return null
      }).finally(function () {
        setBusy('')
      })
    })
  }
  function requestPush() {
    if (canPush === false) return Promise.resolve(null)
    const branchLabel = branch === '' ? t('project.noBranch') : branch
    const remoteLabel = remote === null ? '' : remote
    return confirmDialog({
      title: t('tabs.overview.pushConfirmTitle'),
      body: t('tabs.overview.pushConfirmBody', { branch: branchLabel, remote: remoteLabel }),
      confirmText: t('tabs.overview.push'),
      cancelText: t('action.cancel'),
    }).then(function (ok) {
      if (ok !== true) return null
      setBusy('push')
      return api.pushProject(workspaceId, { timeoutMs: 120000 }).then(function (result) {
        if (result && result.alreadyUpToDate === true) {
          showToast('info', t('tabs.overview.pushUpToDate'))
        } else {
          showToast('info', t('tabs.overview.pushSuccess', {
            branch: (result && result.branch) || branchLabel,
            remote: (result && result.remote) || remoteLabel,
          }))
        }
        load().catch(noop)
        refreshAfterMutation()
        return result
      }, function (err) {
        showToast('error', errorText(err))
        return null
      }).finally(function () {
        setBusy('')
      })
    })
  }
  function requestCommit() {
    if (canCommit === false) return Promise.resolve(null)
    const trimmed = message.trim()
    if (trimmed === '') {
      showToast('error', t('tabs.overview.commitEmpty'))
      return Promise.resolve(null)
    }
    return confirmDialog({
      title: t('tabs.overview.commitTitle'),
      body: t('tabs.overview.commitFiles', { count: fileCount }),
      confirmText: t('tabs.overview.commitConfirm'),
      cancelText: t('tabs.overview.commitCancel'),
    }).then(function (ok) {
      if (ok !== true) return null
      setCommitting(true)
      return api.manualProjectCommit({ workspaceId: workspaceId, message: trimmed }, { timeoutMs: 120000 })
        .then(function (result) {
          const commit = result && result.commit ? result.commit : {}
          const short = String(commit.short || commit.hash || '').slice(0, 8)
          showToast('info', t('tabs.overview.commitSuccess', { short: short }))
          setMessage('')
          setCommitOpen(false)
          setShowDiff(false)
          load().catch(noop)
          refreshAfterMutation()
          return result
        }, function (err) {
          showToast('error', errorText(err))
          return null
        }).finally(function () {
          setCommitting(false)
        })
    })
  }
  const fileRows = files.map(function (file, index) {
    const path = String(file && file.path ? file.path : '')
    const from = file && file.from ? String(file.from) : ''
    const status = String(file && file.status ? file.status : '')
    const label = from === '' ? path : from + ' -> ' + path
    return h('div', { className: 'devbench-ws-file', key: path + ':' + index, title: label },
      h('span', { className: 'devbench-ws-file-status' }, status),
      h('span', { className: 'devbench-ws-file-path' }, label))
  })
  let bodyContent
  if (statusKnown === false) {
    bodyContent = h('div', { className: 'devbench-ws-body' },
      h('div', { className: 'devbench-hint' }, t('tabs.overview.workspace.statusUnknown')))
  } else if (hasChanges === false) {
    bodyContent = h('div', { className: 'devbench-ws-body' },
      h('div', { className: 'devbench-hint' }, t('tabs.overview.workspace.clean')))
  } else {
    const diffText = typeof data.diffText === 'string' ? data.diffText : ''
    const headChildren = [
      h('span', { className: 'devbench-ws-files-title', key: 'title' },
        t('tabs.overview.workspace.files', { count: fileCount })),
      h('span', { key: 'spacer', style: { flex: 1 } }),
    ]
    if (collapsed === false && diffText !== '') {
      headChildren.push(h('button', {
        key: 'diff',
        className: 'devbench-btn ghost devbench-ws-diff-toggle',
        disabled: busy !== '',
        onClick() { setShowDiff(function (value) { return value !== true }) },
      }, showDiff ? t('tabs.overview.workspace.hideDiff') : t('tabs.overview.workspace.showDiff')))
    }
    headChildren.push(h('button', {
      key: 'collapse',
      className: 'devbench-btn ghost devbench-ws-collapse',
      title: collapsed ? t('tabs.overview.workspaceExpand') : t('tabs.overview.workspaceCollapse'),
      onClick() { setCollapsed(function (value) { return value !== true }) },
    }, collapsed ? t('tabs.overview.workspaceExpand') : t('tabs.overview.workspaceCollapse')))
    const filesList = fileRows.length > 0
      ? h('div', { className: 'devbench-ws-files' }, fileRows)
      : null
    const diffView = showDiff && diffText !== ''
      ? h('div', { className: 'devbench-ws-diff-wrap' },
        h('pre', { className: 'devbench-ws-diff' }, diffText),
        data.truncated === true
          ? h('div', { className: 'devbench-hint' }, t('tabs.overview.workspace.truncated'))
          : null)
      : null
    if (collapsed) {
      bodyContent = h('div', { className: 'devbench-ws-body devbench-ws-body-collapsed' },
        h('div', { className: 'devbench-ws-body-head' }, headChildren))
    } else {
      bodyContent = h('div', { className: 'devbench-ws-body' },
        h('div', { className: 'devbench-ws-body-head' }, headChildren),
        filesList,
        diffView)
    }
  }
  const commitEditor = commitOpen === false ? null : h('div', { className: 'devbench-ws-commit' },
    h('div', { className: 'devbench-ws-commit-head' },
      h('span', { className: 'devbench-ws-commit-title' }, t('tabs.overview.commitTitle')),
      h('span', { className: 'devbench-hint' }, t('tabs.overview.commitFiles', { count: fileCount }))),
    h('textarea', {
      className: 'devbench-textarea devbench-ws-commit-input',
      rows: 3,
      maxLength: MANUAL_COMMIT_MAX,
      placeholder: t('tabs.overview.commitPlaceholder'),
      'aria-label': t('tabs.overview.commitPlaceholder'),
      value: message,
      disabled: committing,
      onChange(event) { setMessage(event.target.value) },
      onKeyDown(event) {
        if ((event.metaKey === true || event.ctrlKey === true) && event.key === 'Enter') {
          requestCommit().catch(noop)
        }
      },
    }),
    h('div', { className: 'devbench-ws-commit-foot' },
      h('span', { className: 'devbench-hint' }, t('project.commit.charCount', { count: message.length })),
      h('span', { className: 'devbench-hint devbench-ws-commit-hint' }, t('tabs.overview.commitHint')),
      h('span', { style: { flex: 1 } }),
      h('button', {
        className: 'devbench-btn ghost',
        disabled: committing,
        onClick() { setCommitOpen(false) },
      }, t('tabs.overview.commitCancel')),
      h('button', {
        className: 'devbench-btn primary',
        disabled: committing,
        onClick() { return requestCommit().catch(noop) },
      }, committing ? t('tabs.overview.manualCommitting') : t('tabs.overview.commitConfirm'))))
  const actions = h('div', { className: 'devbench-ws-actions' },
    h('button', {
      className: 'devbench-btn',
      title: pullTitle,
      disabled: canPull === false,
      onClick() { return requestPull().catch(noop) },
    }, busy === 'pull' ? t('tabs.overview.pulling') : t('tabs.overview.pull')),
    h('button', {
      className: 'devbench-btn' + (hasChanges ? ' primary' : ''),
      title: commitTitle,
      disabled: canCommit === false,
      onClick() {
        if (canCommit === false) return
        setCommitOpen(function (value) { return value !== true })
      },
    }, t('tabs.overview.manualCommit')),
    h('button', {
      className: 'devbench-btn',
      title: pushTitle,
      disabled: canPush === false,
      onClick() { return requestPush().catch(noop) },
    }, busy === 'push' ? t('tabs.overview.pushing') : t('tabs.overview.push')),
    h('button', {
      className: 'devbench-icon-btn',
      type: 'button',
      title: t('tabs.overview.workspaceRefresh'),
      'aria-label': t('tabs.overview.workspaceRefresh'),
      disabled: busy !== '' || committing,
      onClick() { load().catch(noop) },
    }, h(IconRefresh, { size: 14 })))
  return h('section', { className: 'devbench-ws-panel' },
    h('header', { className: 'devbench-ws-panel-head' },
      h('span', { className: 'devbench-ws-panel-title' }, t('tabs.overview.workspace')),
      branch === ''
        ? (detached
          ? h('span', { className: 'devbench-pill devbench-ws-detached' }, t('tabs.overview.workspace.detached'))
          : null)
        : h('span', { className: 'devbench-pill devbench-ws-branch devbench-mono', title: branch }, branch),
      head === ''
        ? null
        : h('span', { className: 'devbench-mono devbench-ws-head', title: head }, head.slice(0, 8)),
      h('span', { className: 'devbench-ws-summary' }, summaryText),
      h('span', { className: 'devbench-ws-upstream', title: upstreamText }, upstreamText),
      ahead > 0 && data.aheadKnown !== false
        ? h('span', { className: 'devbench-pill' }, t('tabs.overview.workspace.ahead', { count: ahead }))
        : null,
      behind > 0 && data.behindKnown !== false
        ? h('span', { className: 'devbench-pill' }, t('tabs.overview.workspace.behind', { count: behind }))
        : null,
      h('span', { style: { flex: 1 } }),
      actions),
    bodyContent,
    commitEditor)
}
