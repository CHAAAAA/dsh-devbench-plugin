/**
 * Project overview: full-width dashboard with stats, AI actions, the working-tree
 * panel (uncommitted changes with manual commit/pull/push), running tasks,
 * recent commits, recent reviews and a compact task summary.
 */
import { h } from '../../runtime.js'
import { activeTasks, taskCanCancel } from '../../core/project-utils.js'
import { WorkspaceChangesPanel } from './workspace-changes.js'
function shortDate(value) {
  if (value === undefined || value === null || value === '') return ''
  try { return new Date(value).toLocaleString() } catch (err) { return String(value) }
}
function shortCommit(value) {
  const text = String(value || '')
  return text.length > 8 ? text.slice(0, 8) : text
}
function reviewTitle(name) {
  const text = String(name || '')
  return text.slice(-3) === '.md' ? text.slice(0, -3) : text
}
function activateOnKey(event, handler) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    handler()
  }
}
function taskLabel(task, t) {
  if (task.kind === 'requirement') return task.title || task.requirementId || ''
  if (task.kind === 'review' && task.reviewTarget === 'uncommitted') return t('project.review.uncommittedTarget')
  return task.commitSubject || task.proposedMessage || task.commitShort || ''
}
function taskChip(task, _t) {
  if (task.kind === 'requirement') return task.requirementId || ''
  // An uncommitted review has no commit id; taskLabel names the target instead.
  if (task.kind === 'review' && task.reviewTarget === 'uncommitted') return ''
  return task.commitShort || ''
}
export function ProjectOverview(props) {
  const t = props.t
  const data = props.overview && props.overview.data
  if (!data) return h('div', { className: 'devbench-inline-loading' }, t('panel.loading'))
  const git = data.git || {}
  const commits = data.commits || []
  const reviews = data.reviews || []
  const tasks = props.tasks || []
  const changes = git.changes || []
  const latestCommit = commits[0]
  const latestReview = reviews[0]
  const latestReviewValue = latestReview
    ? (latestReview.target === 'uncommitted'
      ? t('project.review.uncommittedTarget')
      : shortCommit(latestReview.commit))
    : t('project.none')
  const running = activeTasks(tasks)
  const stats = [
    { label: t('project.stats.requirements'), value: data.project.requirementsCount || 0 },
    { label: t('project.stats.changes'), value: changes.length },
    { label: t('project.stats.latestCommit'), value: latestCommit ? latestCommit.short : t('project.none') },
    { label: t('project.stats.latestReview'), value: latestReviewValue },
  ]
  const statGrid = h('div', { className: 'devbench-stat-grid' }, stats.map(function (stat) {
    return h('div', { className: 'devbench-stat-card', key: stat.label },
      h('div', { className: 'devbench-stat-value', title: String(stat.value) }, String(stat.value)),
      h('div', { className: 'devbench-stat-label' }, stat.label))
  }))
  // AI actions panel.
  let aiHint = ''
  if (git.available === false) aiHint = t('project.gitUnavailable')
  else if (git.initialized === false) aiHint = t('project.gitNotInitialized')
  else if (changes.length === 0) aiHint = t('project.ai.clean')
  else aiHint = t('project.ai.changesHint', { count: changes.length })
  const commitLabel = props.previewBusy === true
    ? t('project.ai.commitBusy')
    : (props.activeCommitTask !== null && props.activeCommitTask !== undefined
      ? t('project.ai.commitActive')
      : t('project.ai.commit'))
  const reviewLabel = props.reviewBusy === true
    ? t('project.ai.reviewBusy')
    : t('project.ai.reviewLatest')
  const reviewUncommittedLabel = props.activeUncommittedReviewTask
    ? t('project.ai.reviewUncommittedActive')
    : (props.reviewUncommittedBusy === true
      ? t('project.ai.reviewUncommittedBusy')
      : t('project.ai.reviewUncommitted'))
  const reviewHint = latestCommit
    ? t('project.ai.reviewHint', {
      short: latestCommit.short || shortCommit(latestCommit.hash),
      subject: latestCommit.subject || '',
    })
    : t('project.ai.noCommit')
  const aiPanel = h('div', { className: 'devbench-panel devbench-overview-ai' },
    h('div', { className: 'devbench-panel-head' }, t('project.ai.title')),
    h('div', { className: 'devbench-panel-body devbench-overview-ai-body' },
      h('div', { className: 'devbench-overview-ai-actions' },
        h('button', {
          className: 'devbench-btn primary',
          disabled: props.canCommit !== true,
          onClick() { if (typeof props.onStartCommit === 'function') props.onStartCommit() },
        }, commitLabel),
        h('button', {
          className: 'devbench-btn',
          disabled: props.canReviewLatest !== true,
          onClick() { if (typeof props.onStartReview === 'function') props.onStartReview(latestCommit) },
        }, reviewLabel),
        h('button', {
          className: 'devbench-btn',
          disabled: props.canReviewUncommitted !== true,
          title: changes.length > 0
            ? t('project.ai.reviewUncommittedHint', { count: changes.length })
            : t('project.ai.clean'),
          onClick() { if (typeof props.onStartUncommittedReview === 'function') props.onStartUncommittedReview() },
        }, reviewUncommittedLabel)),
      h('div', { className: 'devbench-overview-ai-hints' },
        h('span', { className: 'devbench-hint', title: aiHint }, aiHint),
        h('span', { className: 'devbench-hint', title: reviewHint }, reviewHint))))
  // Working-tree panel: uncommitted changes with manual commit, pull and push.
  const workspacePanel = h(WorkspaceChangesPanel, {
    t: t,
    workspaceId: props.workspaceId,
    revision: props.revision,
    activeCommitTask: props.activeCommitTask,
    onChanged: props.onChanged,
    showToast: props.showToast,
  })
  // Recent commits.
  const commitRows = commits.slice(0, 5).map(function (commit) {
    return h('div', { className: 'devbench-data-row', key: commit.hash },
      h('div', { className: 'devbench-data-main' },
        h('div', { className: 'devbench-data-title', title: commit.subject }, commit.subject),
        h('div', { className: 'devbench-data-meta' },
          h('span', { className: 'devbench-mono' }, commit.short || shortCommit(commit.hash)),
          h('span', { className: 'devbench-overview-meta-text', title: commit.authorName || '' }, commit.authorName || ''),
          h('span', { className: 'devbench-overview-meta-text' }, shortDate(commit.date)))),
      commit.reviewed ? h('span', { className: 'devbench-pill succeeded' }, t('project.commit.reviewed')) : null)
  })
  const commitPanel = h('div', { className: 'devbench-panel' },
    h('div', { className: 'devbench-panel-head' },
      h('span', null, t('project.recentCommits')),
      h('span', { style: { flex: 1 } }),
      h('button', { className: 'devbench-btn ghost', onClick() { props.onViewTab('commits') } }, t('project.viewAll'))),
    h('div', { className: 'devbench-panel-body' },
      commitRows.length === 0 ? h('div', { className: 'devbench-empty-panel' }, t('project.commit.empty')) : commitRows))
  // Recent reviews: short commit id and a stacked summary so nothing overlaps.
  // Uncommitted-tree reviews have no commit, so their target text takes that slot.
  const reviewRows = reviews.slice(0, 3).map(function (review) {
    const title = reviewTitle(review.name)
    const uncommitted = review.target === 'uncommitted'
    const targetText = uncommitted ? t('project.review.uncommittedTarget') : shortCommit(review.commit)
    const subject = review.commitSubject || ''
    return h('div', {
      className: 'devbench-data-row devbench-overview-review',
      key: review.name,
      role: 'button',
      tabIndex: 0,
      title: review.name,
      onClick() { props.onOpenReview(review) },
      onKeyDown(event) { activateOnKey(event, function () { props.onOpenReview(review) }) },
    },
    h('div', { className: 'devbench-data-main' },
      h('div', { className: 'devbench-data-title', title: review.name }, title),
      h('div', { className: 'devbench-data-meta' },
        h('span', { className: 'devbench-mono devbench-overview-review-commit' }, targetText),
        subject !== ''
          ? h('span', { className: 'devbench-overview-review-subject', title: subject }, subject)
          : null,
        h('span', { className: 'devbench-overview-meta-text' }, shortDate(review.modifiedAt))),
      review.summary
        ? h('div', { className: 'devbench-overview-review-summary', title: review.summary }, review.summary)
        : null))
  })
  const reviewPanel = h('div', { className: 'devbench-panel' },
    h('div', { className: 'devbench-panel-head' },
      h('span', null, t('project.recentReviews')),
      h('span', { style: { flex: 1 } }),
      h('button', { className: 'devbench-btn ghost', onClick() { props.onViewTab('reviews') } }, t('project.viewAll'))),
    h('div', { className: 'devbench-panel-body' },
      reviewRows.length === 0 ? h('div', { className: 'devbench-empty-panel' }, t('project.noReviews')) : reviewRows))
  // Running tasks: awaiting commit tasks can open the confirmation preview again.
  const runningRows = running.map(function (task) {
    const cancelKey = 'cancel:' + task.id
    const canPreview = task.kind === 'commit' && task.status === 'awaiting_confirmation' &&
      typeof props.onOpenCommitPreview === 'function'
    const actions = []
    if (canPreview) {
      actions.push(h('button', {
        className: 'devbench-btn ghost',
        key: 'preview',
        onClick() { props.onOpenCommitPreview(task) },
      }, t('tabs.overview.preview')))
    }
    if (task.sessionId) {
      actions.push(h('button', {
        className: 'devbench-btn ghost',
        key: 'open',
        onClick() { if (typeof props.onOpenSession === 'function') props.onOpenSession(task.sessionId) },
      }, t('project.task.openSession')))
    }
    if (taskCanCancel(task)) {
      actions.push(h('button', {
        className: 'devbench-btn ghost danger',
        key: 'cancel',
        disabled: props.taskBusyKey === cancelKey,
        onClick() { if (typeof props.onCancelTask === 'function') props.onCancelTask(task) },
      }, props.taskBusyKey === cancelKey ? t('project.task.cancelling') : t('project.task.cancel')))
    }
    return h('div', { className: 'devbench-data-row devbench-overview-tasks', key: task.id },
      h('div', { className: 'devbench-data-main' },
        h('div', { className: 'devbench-overview-task-line' },
          h('span', { className: 'devbench-task-dot ' + task.status, title: t('status.' + task.status) }),
          h('span', { className: 'devbench-pill ' + task.status }, t('status.' + task.status)),
          h('span', { className: 'devbench-task-kind' }, t('task.kind.' + (task.kind || 'commit'))),
          h('span', { className: 'devbench-task-subject', title: taskLabel(task, t) }, taskLabel(task, t))),
        h('div', { className: 'devbench-data-meta' },
          taskChip(task, t) !== '' ? h('span', { className: 'devbench-mono' }, taskChip(task, t)) : null,
          h('span', null, shortDate(task.updatedAt || task.createdAt)),
          task.sessionId ? h('span', { className: 'devbench-mono' }, task.sessionId) : h('span', null, t('project.task.noSession')))),
      h('div', { className: 'devbench-data-actions' }, actions))
  })
  const activePanel = h('div', { className: 'devbench-panel' },
    h('div', { className: 'devbench-panel-head' },
      h('span', null, t('project.activeTasks')),
      running.length > 0 ? h('span', { className: 'devbench-pill running' }, String(running.length)) : null),
    h('div', { className: 'devbench-panel-body' },
      runningRows.length === 0
        ? h('div', { className: 'devbench-empty-panel' }, t('project.noActiveTasks'))
        : runningRows))
  // Task summary: compact inline pills instead of one row per status.
  const taskCounts = {}
  tasks.forEach(function (task) {
    taskCounts[task.status] = (taskCounts[task.status] || 0) + 1
  })
  const taskKeys = Object.keys(taskCounts)
  const summaryRows = taskKeys.length === 0
    ? h('div', { className: 'devbench-empty-panel' }, t('project.task.empty'))
    : h('div', { className: 'devbench-inline' }, taskKeys.map(function (status) {
      return h('span', { className: 'devbench-pill ' + status, key: status },
        t('status.' + status) + ' ' + String(taskCounts[status]))
    }))
  const taskPanel = h('div', { className: 'devbench-panel' },
    h('div', { className: 'devbench-panel-head' },
      h('span', null, t('project.taskSummary')),
      h('span', { style: { flex: 1 } }),
      h('span', { className: 'devbench-muted' }, t('home.taskCount', { count: tasks.length })),
      h('button', { className: 'devbench-btn ghost', onClick() { props.onViewTab('tasks') } }, t('project.viewAll'))),
    h('div', { className: 'devbench-panel-body' }, summaryRows))
  return h('div', { className: 'devbench-overview' },
    statGrid,
    aiPanel,
    workspacePanel,
    h('div', { className: 'devbench-overview-grid' },
      h('div', { className: 'devbench-overview-col' }, commitPanel, reviewPanel),
      h('div', { className: 'devbench-overview-col' }, activePanel, taskPanel)))
}
