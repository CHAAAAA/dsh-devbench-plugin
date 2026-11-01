/** Project commits: master-detail list, commit files/diffs, review and requirement links. */
import { h, useState, useEffect, useRef, errorText } from '../../runtime.js'
import { useUiState, setSelection } from '../../core/ui-store.js'
import * as api from '../../core/api.js'
import type { ProjectCommitDetail } from '../../../shared/api-types.js'
import { findActiveReviewTask, findReviewForCommit } from '../../core/project-utils.js'
import { Banner, Modal } from '../../ui/common.js'
import { ListFooter } from '../../ui/list-page.js'
import { CommitDiffBrowser } from '../../ui/commit-diff-browser.js'
import {
  IconRefresh, IconExternal, IconLink, IconTrash, IconPlay,
} from '../../ui/icons.js'
const COMMIT_PAGE_SIZE = 10
function formatDate(value) {
  if (value === undefined || value === null || value === '') return ''
  try { return new Date(value).toLocaleString() } catch (err) { return String(value) }
}
function activateOnKey(event, handler) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    handler()
  }
}
function shortHash(commit) {
  return String((commit && (commit.short || commit.hash)) || '').slice(0, 8)
}
/** Merge newly loaded server pages without duplicating hashes. */
function mergeCommits(rows, incoming) {
  const seen = {}
  const next = rows.slice()
  for (let index = 0; index < next.length; index++) {
    if (next[index] && next[index].hash) seen[next[index].hash] = true
  }
  for (let index = 0; index < incoming.length; index++) {
    const commit = incoming[index]
    if (!commit || !commit.hash || seen[commit.hash]) continue
    seen[commit.hash] = true
    next.push(commit)
  }
  return next
}
function commitMatchesHash(task, hash) {
  const full = String(task && task.commitHash || '')
  const short = String(task && task.commitShort || '')
  if (full !== '' && (full === hash || hash.indexOf(full) === 0 || full.indexOf(hash) === 0)) return true
  return short !== '' && hash.indexOf(short) === 0
}
export function ProjectCommits(props) {
  const t = props.t
  const initialCommits = Array.isArray(props.commits) ? props.commits : []
  const [state, setState] = useState({
    rows: initialCommits,
    hasMore: initialCommits.length >= COMMIT_PAGE_SIZE,
    loadingMore: false,
    refreshing: false,
    error: '',
  })
  const [search, setSearch] = useState('')
  const [reviewFilter, setReviewFilter] = useState('all')
  const [detailState, setDetailState] = useState<{ loading: boolean; error: string; data: ProjectCommitDetail | null; hash: string }>({ loading: false, error: '', data: null, hash: '' })
  const [requirementPicker, setRequirementPicker] = useState(null)
  const [linkBusy, setLinkBusy] = useState('')
  const loadingRef = useRef(false)
  const requestSeqRef = useRef(0)
  const detailSeqRef = useRef(0)
  const ui = useUiState()
  const selection = ui.selection || {}
  const selectedHash = selection.commits || ''
  const workspaceId = props.workspaceId
  const reviews = Array.isArray(props.reviews) ? props.reviews : []
  const requirements = Array.isArray(props.requirements) ? props.requirements : []
  useEffect(function () {
    requestSeqRef.current += 1
    loadingRef.current = false
    const next = Array.isArray(props.commits) ? props.commits : []
    setState({
      rows: next,
      hasMore: next.length >= COMMIT_PAGE_SIZE,
      loadingMore: false,
      refreshing: false,
      error: '',
    })
  }, [props.commits, props.workspaceId])
  function loadMore() {
    if (loadingRef.current) return
    if (workspaceId === null || workspaceId === undefined || workspaceId === '') return
    const seq = ++requestSeqRef.current
    const offset = state.rows.length
    loadingRef.current = true
    setState(function (prev) { return Object.assign({}, prev, { loadingMore: true, error: '' }) })
    api.getProjectCommits(workspaceId, offset, COMMIT_PAGE_SIZE).then(function (value) {
      if (requestSeqRef.current !== seq) return
      loadingRef.current = false
      const commits = value && Array.isArray(value.commits) ? value.commits : []
      setState(function (prev) {
        const rows = mergeCommits(prev.rows, commits)
        const hasMore = value && typeof value.hasMore === 'boolean'
          ? value.hasMore
          : commits.length >= COMMIT_PAGE_SIZE
        return { rows: rows, hasMore: hasMore, loadingMore: false, refreshing: false, error: '' }
      })
    }, function (err) {
      if (requestSeqRef.current !== seq) return
      loadingRef.current = false
      setState(function (prev) {
        return Object.assign({}, prev, {
          loadingMore: false,
          refreshing: false,
          error: errorText(err) || t('project.commits.error'),
        })
      })
    })
  }
  function refresh() {
    if (loadingRef.current) return
    if (workspaceId === null || workspaceId === undefined || workspaceId === '') return
    const seq = ++requestSeqRef.current
    const limit = Math.min(100, Math.max(state.rows.length, COMMIT_PAGE_SIZE))
    loadingRef.current = true
    setState(function (prev) { return Object.assign({}, prev, { refreshing: true, error: '' }) })
    api.getProjectCommits(workspaceId, 0, limit).then(function (value) {
      if (requestSeqRef.current !== seq) return
      loadingRef.current = false
      const commits = value && Array.isArray(value.commits) ? value.commits : []
      setState(function () {
        const hasMore = value && typeof value.hasMore === 'boolean'
          ? value.hasMore
          : commits.length >= limit
        return { rows: commits, hasMore: hasMore, loadingMore: false, refreshing: false, error: '' }
      })
    }, function (err) {
      if (requestSeqRef.current !== seq) return
      loadingRef.current = false
      setState(function (prev) {
        return Object.assign({}, prev, { refreshing: false, error: errorText(err) })
      })
    })
  }
  function loadDetail(hash, quiet?) {
    if (!workspaceId || !hash) return Promise.resolve(null)
    const seq = ++detailSeqRef.current
    setDetailState(function (prev) {
      return {
        loading: quiet !== true,
        error: '',
        data: prev.hash === hash ? prev.data : null,
        hash: hash,
      }
    })
    return api.getProjectCommitDetail(workspaceId, hash).then(function (value) {
      if (seq !== detailSeqRef.current) return null
      setDetailState({ loading: false, error: '', data: value, hash: hash })
      return value
    }, function (err) {
      if (seq !== detailSeqRef.current) return null
      setDetailState(function (prev) {
        return {
          loading: false,
          error: errorText(err),
          data: prev.hash === hash ? prev.data : null,
          hash: hash,
        }
      })
      return null
    })
  }
  const query = search.trim().toLowerCase()
  const filtered = state.rows.filter(function (commit) {
    if (reviewFilter === 'reviewed' && commit.reviewed !== true) return false
    if (reviewFilter === 'unreviewed' && commit.reviewed === true) return false
    if (query === '') return true
    const text = [
      commit.subject, commit.hash, commit.short,
      commit.authorName, commit.authorEmail,
    ].join(' ').toLowerCase()
    return text.indexOf(query) >= 0
  })
  const selectedCommit = filtered.find(function (commit) { return commit.hash === selectedHash }) || null
  const activeCommit = selectedCommit || filtered[0] || null
  const activeHash = activeCommit ? activeCommit.hash : ''
  useEffect(function () {
    if (filtered.length === 0) return
    const hit = filtered.some(function (commit) { return commit.hash === selectedHash })
    if (hit === false) setSelection('commits', filtered[0].hash)
  }, [selectedHash, search, reviewFilter, state.rows])
  useEffect(function () {
    if (activeHash === '') {
      detailSeqRef.current += 1
      setDetailState({ loading: false, error: '', data: null, hash: '' })
      return undefined
    }
    loadDetail(activeHash).catch(function () {})
    return function () { detailSeqRef.current += 1 }
  }, [activeHash, workspaceId])
  const detail = detailState.hash === activeHash ? detailState : { loading: true, error: '', data: null, hash: activeHash }
  const detailData = detail.data
  let commitMessage = activeCommit ? activeCommit.subject : ''
  if (activeCommit && typeof activeCommit.message === 'string' && activeCommit.message.trim() !== '') {
    commitMessage = activeCommit.message
  }
  if (detailData && detailData.commit && typeof detailData.commit.message === 'string' &&
      detailData.commit.message.trim() !== '') {
    commitMessage = detailData.commit.message
  }
  const activeReviewTask = activeCommit
    ? findActiveReviewTask(props.tasks || [], activeCommit.hash)
    : null
  const reviewing = activeCommit
    ? props.reviewingCommit === activeCommit.hash || activeReviewTask !== null
    : false
  const review = detailData && detailData.review
    ? detailData.review
    : (activeCommit ? findReviewForCommit(reviews, activeCommit.hash) : null)
  const reviewed = Boolean(activeCommit && (activeCommit.reviewed === true || review !== null))
  const reviewTask = activeCommit
    ? (props.tasks || []).find(function (task) {
      return task && task.kind === 'review' && typeof task.sessionId === 'string' &&
        task.sessionId !== '' && commitMatchesHash(task, activeCommit.hash)
    }) || null
    : null
  const linkedRequirements = detailData && Array.isArray(detailData.requirements)
    ? detailData.requirements
    : []
  const changedFiles = detailData && Array.isArray(detailData.files) ? detailData.files : []
  function selectCommit(commit) {
    if (!commit || !commit.hash) return
    setSelection('commits', commit.hash)
  }
  function openReviewFor(commit, found) {
    if (typeof props.onOpenReview !== 'function') return
    if (found && found.name) {
      props.onOpenReview(found)
      return
    }
    const name = commit.reviewName
    if (!name) return
    props.onOpenReview({
      name: name,
      commit: commit.hash,
      commitSubject: commit.subject,
      modifiedAt: commit.date,
    })
  }
  function openRequirement(requirement) {
    if (!requirement || typeof props.onOpenRequirement !== 'function') return
    props.onOpenRequirement(requirement.workspaceId || workspaceId, requirement.id)
  }
  function openRequirementPicker() {
    if (requirementPicker !== null || activeCommit === null) return
    setRequirementPicker({ busy: '', error: '' })
  }
  function closeRequirementPicker() {
    if (requirementPicker !== null && requirementPicker.busy !== '') return
    setRequirementPicker(null)
  }
  function linkRequirement(requirement) {
    if (!requirement || !activeCommit || linkBusy !== '' || requirementPicker === null) return
    setLinkBusy(requirement.id)
    setRequirementPicker(function (prev) {
      return prev === null ? prev : Object.assign({}, prev, { busy: requirement.id, error: '' })
    })
    api.linkRequirementCommit({
      workspaceId: requirement.workspaceId || workspaceId,
      id: requirement.id,
      commit: activeCommit.hash,
    }).then(function () {
      setLinkBusy('')
      setRequirementPicker(null)
      if (typeof props.showToast === 'function') props.showToast('info', t('tabs.commits.requirementLinked'))
      loadDetail(activeCommit.hash, true).catch(function () {})
      if (typeof props.onLinkedRequirement === 'function') props.onLinkedRequirement()
    }, function (err) {
      setLinkBusy('')
      setRequirementPicker(function (prev) {
        return prev === null ? null : Object.assign({}, prev, { busy: '', error: errorText(err) })
      })
    })
  }
  function unlinkRequirement(requirement) {
    if (!requirement || !activeCommit || linkBusy !== '') return
    setLinkBusy(requirement.id)
    api.unlinkRequirementCommit({
      workspaceId: requirement.workspaceId || workspaceId,
      id: requirement.id,
      commit: activeCommit.hash,
    }).then(function () {
      setLinkBusy('')
      if (typeof props.showToast === 'function') props.showToast('info', t('tabs.commits.requirementUnlinked'))
      loadDetail(activeCommit.hash, true).catch(function () {})
      if (typeof props.onLinkedRequirement === 'function') props.onLinkedRequirement()
    }, function (err) {
      setLinkBusy('')
      if (typeof props.showToast === 'function') props.showToast('error', errorText(err))
    })
  }
  const filterButtons = [
    { value: 'all', label: t('tabs.commits.filter.all') },
    { value: 'reviewed', label: t('project.commit.reviewed') },
    { value: 'unreviewed', label: t('project.commit.notReviewed') },
  ]
  const rows = filtered.map(function (commit) {
    const active = activeCommit !== null && activeCommit.hash === commit.hash
    return h('div', {
      key: commit.hash,
      className: 'devbench-master-row' + (active ? ' active' : ''),
      role: 'button',
      tabIndex: 0,
      'aria-pressed': active ? 'true' : 'false',
      title: commit.subject,
      onClick() { selectCommit(commit) },
      onKeyDown(event) { activateOnKey(event, function () { selectCommit(commit) }) },
    },
    h('div', { className: 'devbench-master-row-main' },
      h('div', { className: 'devbench-master-row-title' }, commit.subject),
      h('div', { className: 'devbench-master-row-meta' },
        h('span', { className: 'devbench-mono' }, shortHash(commit)),
        h('span', null, commit.authorName || commit.authorEmail || ''),
        h('span', null, formatDate(commit.date)),
        commit.reviewed === true
          ? h('span', { className: 'devbench-pill succeeded' }, t('project.commit.reviewed'))
          : h('span', { className: 'devbench-pill' }, t('project.commit.notReviewed')),
        commit.isFirst === true ? h('span', { className: 'devbench-pill' }, t('project.commit.first')) : null,
        commit.isMerge === true ? h('span', { className: 'devbench-pill' }, t('project.commit.merge')) : null)))
  })
  let listContent
  if (state.rows.length === 0) {
    listContent = h('div', { className: 'devbench-empty-panel' }, t('project.commit.empty'))
  } else if (filtered.length === 0) {
    listContent = h('div', { className: 'devbench-empty-panel' }, t('tabs.commits.empty'))
  } else {
    listContent = rows
  }
  let listError = null
  if (state.error) {
    listError = h('div', { style: { marginBottom: '8px' } },
      h(Banner, { kind: 'error' }, state.error),
      h('button', {
        className: 'devbench-btn',
        disabled: state.loadingMore,
        onClick() { if (state.hasMore) loadMore(); else refresh() },
      }, t('panel.retry')))
  }
  let footer = null
  if (state.loadingMore) {
    footer = h('span', { className: 'devbench-hint' }, t('project.commits.loadingMore'))
  } else if (state.error === '' && (state.hasMore || state.rows.length > COMMIT_PAGE_SIZE)) {
    footer = h(ListFooter, {
      t: t,
      page: {
        rows: state.rows,
        total: state.hasMore ? state.rows.length + 1 : state.rows.length,
        listed: state.rows.length,
        listedRows: state.rows.length,
        size: COMMIT_PAGE_SIZE,
        hasMore: state.hasMore === true,
        loadMore: loadMore,
      },
    })
  }
  let detailView
  if (activeCommit === null) {
    detailView = h('div', { className: 'devbench-master-empty' },
      h('div', null, t('tabs.commits.selectHint')))
  } else {
    const head = h('div', { className: 'devbench-master-detail-head' },
      h('div', { className: 'devbench-title-row' },
        h('span', { className: 'devbench-mono', title: activeCommit.hash }, shortHash(activeCommit)),
        reviewed
          ? h('span', { className: 'devbench-pill succeeded' }, t('project.commit.reviewed'))
          : h('span', { className: 'devbench-pill' }, t('project.commit.notReviewed')),
        activeCommit.isFirst === true ? h('span', { className: 'devbench-pill' }, t('project.commit.first')) : null,
        activeCommit.isMerge === true ? h('span', { className: 'devbench-pill' }, t('project.commit.merge')) : null),
      h('div', {
        className: 'devbench-data-title devbench-commit-detail-subject',
        title: commitMessage,
        style: { fontSize: '15px', fontWeight: 600, lineHeight: 1.4 },
      }, commitMessage),
      h('div', { className: 'devbench-project-meta' },
        h('span', null, activeCommit.authorName || activeCommit.authorEmail || ''),
        h('span', null, formatDate(activeCommit.date))))
    // Primary actions live at the top of the right pane, not in a bottom bar.
    const actions = []
    if (reviewed && (review !== null || activeCommit.reviewName)) {
      actions.push(h('button', {
        className: 'devbench-btn primary',
        key: 'review',
        disabled: typeof props.onOpenReview !== 'function',
        onClick() { openReviewFor(activeCommit, review) },
      }, h(IconExternal, { size: 14 }), t('tabs.commits.openReview')))
    } else {
      actions.push(h('button', {
        className: 'devbench-btn primary',
        key: 'review',
        disabled: reviewing || typeof props.onReview !== 'function',
        onClick() { if (typeof props.onReview === 'function') props.onReview(activeCommit) },
      }, h(IconPlay, { size: 14 }), reviewing ? t('project.ai.reviewBusy') : t('project.commit.review')))
    }
    if (reviewTask && typeof props.onOpenSession === 'function') {
      actions.push(h('button', {
        className: 'devbench-btn',
        key: 'session',
        onClick() { props.onOpenSession(reviewTask.sessionId) },
      }, t('tabs.commits.openSession')))
    }
    actions.push(h('button', {
      className: 'devbench-btn',
      key: 'link',
      disabled: activeCommit === null || requirements.length === 0,
      onClick: openRequirementPicker,
    }, h(IconLink, { size: 14 }), t('tabs.commits.associateRequirement')))
    actions.push(h('button', {
      className: 'devbench-btn ghost',
      key: 'refresh',
      disabled: state.refreshing || detail.loading,
      onClick() {
        refresh()
        loadDetail(activeHash, true).catch(function () {})
      },
    }, h(IconRefresh, { size: 14 }), state.refreshing ? t('panel.loading') : t('project.refresh')))
    let filesSection
    if (detail.loading) {
      filesSection = h('div', { className: 'devbench-commit-browser devbench-commit-browser-empty' },
        h('div', { className: 'devbench-inline-loading' }, t('tabs.commits.loading')))
    } else if (detail.error) {
      filesSection = h('div', { className: 'devbench-commit-browser devbench-commit-browser-empty' },
        h(Banner, { kind: 'error' }, detail.error),
        h('button', { className: 'devbench-btn', onClick() { loadDetail(activeHash).catch(function () {}) } },
          t('panel.retry')))
    } else if (changedFiles.length === 0) {
      filesSection = h('div', { className: 'devbench-commit-browser devbench-commit-browser-empty' },
        h('div', { className: 'devbench-hint' }, t('tabs.commits.noFiles')))
    } else {
      filesSection = h(CommitDiffBrowser, {
        key: 'commit-diff-' + activeHash,
        t: t,
        files: changedFiles,
      })
    }
    const infoItems = []
    if (linkedRequirements.length > 0) {
      infoItems.push(h('div', { className: 'devbench-commit-info-group', key: 'requirements' },
        h('span', { className: 'devbench-commit-info-label' }, t('tabs.commits.associatedRequirements')),
        linkedRequirements.map(function (requirement) {
          return h('span', { className: 'devbench-commit-info-chip', key: requirement.id },
            h('span', { className: 'devbench-mono' }, requirement.id),
            h('span', {
              className: 'devbench-commit-info-chip-title',
              title: requirement.title || requirement.id,
            }, requirement.title || requirement.id),
            h('button', {
              className: 'devbench-icon-btn',
              type: 'button',
              title: t('tabs.commits.openRequirement'),
              'aria-label': t('tabs.commits.openRequirement'),
              onClick() { openRequirement(requirement) },
            }, h(IconExternal, { size: 12 })),
            h('button', {
              className: 'devbench-icon-btn',
              type: 'button',
              title: t('tabs.commits.unlinkRequirement'),
              'aria-label': t('tabs.commits.unlinkRequirement'),
              disabled: linkBusy !== '',
              onClick() { unlinkRequirement(requirement) },
            }, h(IconTrash, { size: 12 })))
        })))
    }
    if (review !== null) {
      infoItems.push(h('div', { className: 'devbench-commit-info-group', key: 'review' },
        h('span', { className: 'devbench-commit-info-label' }, t('tabs.commits.latestReview')),
        h('span', {
          className: 'devbench-commit-info-review',
          title: String(review.name || '') + (review.summary ? ' · ' + review.summary : ''),
        }, String(review.name || '') + (review.modifiedAt ? ' · ' + formatDate(review.modifiedAt) : ''))))
    }
    const infoStrip = infoItems.length > 0
      ? h('div', { className: 'devbench-commit-info' }, infoItems)
      : null
    let filesHead = null
    if (detail.loading !== true) {
      filesHead = h('div', { className: 'devbench-commit-files-head' },
        h('span', null, t('tabs.commits.files')),
        h('span', { className: 'spacer', style: { flex: 1 } }),
        h('span', { className: 'devbench-muted' },
          t('tabs.commits.filesCount', { count: changedFiles.length })),
        detailData && detailData.truncated
          ? h('span', { className: 'devbench-commit-truncated-hint' }, t('tabs.commits.diffTruncated'))
          : null)
    }
    detailView = h('div', { className: 'devbench-master-detail' }, head,
      h('div', { className: 'devbench-master-detail-body devbench-commit-detail-body' },
        h('div', { className: 'devbench-detail-actions' }, actions),
        infoStrip,
        filesHead,
        filesSection))
  }
  let requirementPickerElement = null
  if (requirementPicker) {
    const linkedIds = {}
    linkedRequirements.forEach(function (item) { linkedIds[item.id] = true })
    requirementPickerElement = h(Modal, {
      t: t,
      title: t('tabs.commits.selectRequirement'),
      onCancel: closeRequirementPicker,
      onClose: closeRequirementPicker,
      actions: false,
    }, h('div', { className: 'devbench-flexcol' },
      requirementPicker.error ? h(Banner, { kind: 'error' }, requirementPicker.error) : null,
      requirements.length === 0
        ? h('div', { className: 'devbench-hint' }, t('tabs.commits.noRequirement'))
        : h('div', { className: 'devbench-picker-list' }, requirements.map(function (requirement) {
          const linked = linkedIds[requirement.id] === true
          return h('button', {
            type: 'button',
            key: requirement.id,
            className: 'devbench-picker-row',
            disabled: linked || linkBusy !== '',
            onClick() { if (!linked) linkRequirement(requirement) },
          },
          h('span', { className: 'devbench-picker-main' },
            h('span', { className: 'devbench-picker-title', title: requirement.title }, requirement.title || requirement.id),
            h('span', { className: 'devbench-picker-meta' },
              h('span', { className: 'devbench-mono' }, requirement.id),
              h('span', null, t('status.' + requirement.status)))),
          linked
            ? h('span', { className: 'devbench-pill succeeded' }, t('tabs.commits.requirementLinked'))
            : null)
        }))))
  }
  return h('div', { className: 'devbench-tab-fill' },
    h('div', { className: 'devbench-master' },
      h('div', { className: 'devbench-master-list' },
        h('div', { className: 'devbench-master-list-head' },
          h('div', { className: 'devbench-master-list-title' },
            h('span', null, t('project.tab.commits')),
            h('span', { className: 'spacer' }),
            h('span', { className: 'devbench-muted' }, t('tabs.listCount', { count: filtered.length }))),
          h('input', {
            className: 'devbench-input',
            style: { fontSize: '12px', padding: '5px 8px' },
            placeholder: t('tabs.commits.search'),
            'aria-label': t('tabs.commits.search'),
            value: search,
            onChange(event) { setSearch(event.target.value) },
          }),
          h('div', { className: 'devbench-tabs', style: { marginTop: '8px', marginBottom: '0' } },
            filterButtons.map(function (item) {
              return h('button', {
                key: item.value,
                className: 'devbench-tab' + (reviewFilter === item.value ? ' active' : ''),
                type: 'button',
                onClick() { setReviewFilter(item.value) },
              }, item.label)
            }))),
        h('div', { className: 'devbench-master-list-body' }, listError, listContent),
        footer !== null ? h('div', { className: 'devbench-master-list-foot' }, footer) : null),
      detailView),
    requirementPickerElement)
}
