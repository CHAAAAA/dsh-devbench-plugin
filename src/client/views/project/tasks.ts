/** Project tasks: master-detail with status/kind filters; selection persists in uiStore. */
import { h, useEffect } from '../../runtime.js'
import { useUiState, setSelection, setListState } from '../../core/ui-store.js'
import { ListFooter, useListPage } from '../../ui/list-page.js'
import {
  taskStatusKey,
  taskKindKey,
  taskCanCancel,
  taskCanRetry,
} from '../../core/project-utils.js'
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
function safeText(value) {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return String(value)
}
function taskLabel(task, t) {
  if (task.kind === 'requirement') return safeText(task.title) || safeText(task.requirementId)
  if (task.kind === 'review' && task.reviewTarget === 'uncommitted') return t('project.review.uncommittedTarget')
  return safeText(task.commitSubject) || safeText(task.proposedMessage) || safeText(task.commitShort)
}
function taskChip(task, _t) {
  if (task.kind === 'requirement') return safeText(task.requirementId)
  // An uncommitted review has no commit id; taskLabel names the target instead.
  if (task.kind === 'review' && task.reviewTarget === 'uncommitted') return ''
  return safeText(task.commitShort) || safeText(task.commitHash)
}
const STATUS_GROUPS = {
  all: null,
  active: ['queued', 'running', 'awaiting_confirmation'],
  failed: ['failed'],
  done: ['succeeded'],
}
/** Label/value row used by the detail pane. */
function metaRow(key, label, value, options?) {
  const opts = options || {}
  const style = {
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'right',
  }
  return h('div', { className: 'devbench-overview-summary-row', key: key },
    h('span', { className: 'devbench-hint' }, label),
    h('span', { className: opts.mono === true ? 'devbench-mono' : '', style: style }, value))
}
export function ProjectTasks(props) {
  const t = props.t
  const tasks = Array.isArray(props.tasks) ? props.tasks : []
  const ui = useUiState()
  const lists = ui.lists || {}
  const saved = lists.tasks || {}
  const statusFilter = saved.status || 'all'
  const kindFilter = saved.kind || 'all'
  const selection = ui.selection || {}
  const selectedTaskId = selection.tasks || ''
  const statusGroup = STATUS_GROUPS[statusFilter] || null
  const filtered = tasks.filter(function (task) {
    if (kindFilter !== 'all' && task.kind !== kindFilter) return false
    if (statusGroup !== null && statusGroup.indexOf(task.status) < 0) return false
    return true
  })
  const page = useListPage(filtered)
  const selectedTask = tasks.find(function (task) { return task.id === selectedTaskId }) || null
  const activeTask = (selectedTask !== null && filtered.indexOf(selectedTask) >= 0)
    ? selectedTask
    : (filtered[0] || null)
  useEffect(function () {
    if (filtered.length === 0) return
    const hit = filtered.some(function (task) { return task.id === selectedTaskId })
    if (hit === false) setSelection('tasks', filtered[0].id)
  }, [selectedTaskId, statusFilter, kindFilter, tasks])
  function applyStatusFilter(value) {
    setListState('tasks', { status: value })
    page.reset()
  }
  function applyKindFilter(value) {
    setListState('tasks', { kind: value })
    page.reset()
  }
  function clearFilters() {
    setListState('tasks', { status: 'all', kind: 'all' })
    page.reset()
  }
  function selectTask(task) {
    if (!task || task.id === undefined) return
    setSelection('tasks', task.id)
  }
  function openSession(task) {
    if (!task || !task.sessionId) return
    if (typeof props.onOpenSession === 'function') props.onOpenSession(task.sessionId)
  }
  function cancelTask(task) {
    if (typeof props.onCancel === 'function') props.onCancel(task)
  }
  function retryTask(task) {
    if (typeof props.onRetry === 'function') props.onRetry(task)
  }
  const statusFilterDefs = [
    ['all', t('tabs.tasks.filter.all')],
    ['active', t('tabs.tasks.filter.active')],
    ['failed', t('tabs.tasks.filter.failed')],
    ['done', t('tabs.tasks.filter.done')],
  ]
  const kindFilterDefs = [
    ['all', t('tabs.tasks.filter.kindAll')],
    ['commit', t('task.kind.commit')],
    ['review', t('task.kind.review')],
    ['requirement', t('task.kind.requirement')],
  ]
  const rows = page.rows.map(function (task) {
    const active = activeTask !== null && activeTask.id === task.id
    const status = String(task.status || 'queued')
    const chip = taskChip(task, t)
    return h('div', {
      key: task.id,
      className: 'devbench-master-row' + (active ? ' active' : ''),
      role: 'button',
      tabIndex: 0,
      'aria-pressed': active ? 'true' : 'false',
      title: taskLabel(task, t),
      onClick() { selectTask(task) },
      onKeyDown(event) { activateOnKey(event, function () { selectTask(task) }) },
    },
    h('span', { className: 'devbench-task-dot ' + status, title: t(taskStatusKey(status)) }),
    h('div', { className: 'devbench-master-row-main' },
      h('div', { className: 'devbench-master-row-title' },
        t(taskKindKey(task.kind)) + (taskLabel(task, t) !== '' ? ' · ' + taskLabel(task, t) : '')),
      h('div', { className: 'devbench-master-row-meta' },
        h('span', { className: 'devbench-pill ' + status }, t(taskStatusKey(status))),
        chip !== '' ? h('span', { className: 'devbench-mono' }, chip) : null,
        task.projectTitle ? h('span', null, task.projectTitle) : null,
        h('span', null, formatDate(task.updatedAt || task.createdAt)))))
  })
  let listContent
  if (tasks.length === 0) {
    listContent = h('div', { className: 'devbench-empty-panel' }, t('project.task.empty'))
  } else if (filtered.length === 0) {
    listContent = h('div', { className: 'devbench-empty-panel' },
      h('div', null, t('tabs.tasks.filteredEmpty')),
      h('button', {
        className: 'devbench-btn',
        style: { marginTop: '10px' },
        onClick: clearFilters,
      }, t('tabs.tasks.clearFilters')))
  } else {
    listContent = rows
  }
  const pager = page.total > page.size
    ? h('div', { className: 'devbench-master-list-foot' }, h(ListFooter, { t: t, page: page }))
    : null
  let detail
  if (activeTask === null) {
    detail = h('div', { className: 'devbench-master-empty' },
      h('div', null, t('tabs.tasks.selectHint')))
  } else {
    const status = String(activeTask.status || 'queued')
    const kind = activeTask.kind || 'review'
    const cancelKey = 'cancel:' + activeTask.id
    const retryKey = 'retry:' + activeTask.id
    const sessionId = safeText(activeTask.sessionId)
    const requirement = activeTask.kind === 'requirement'
      ? (safeText(activeTask.requirementId) + (safeText(activeTask.title) !== '' ? ' · ' + safeText(activeTask.title) : ''))
      : ''
    const bodyRows = [
      metaRow('status', t('tabs.tasks.field.status'), t(taskStatusKey(status))),
      metaRow('kind', t('tabs.tasks.field.kind'), t(taskKindKey(kind))),
      activeTask.reviewTarget === 'uncommitted'
        ? metaRow('reviewTarget', t('tabs.tasks.field.target'), t('project.review.uncommittedTarget'))
        : null,
      metaRow('project', t('tabs.tasks.field.project'), safeText(activeTask.projectTitle) || safeText(activeTask.projectPath) || '-'),
      metaRow('session', t('tabs.tasks.field.session'), sessionId !== '' ? sessionId : t('project.task.noSession'), { mono: sessionId !== '' }),
      requirement !== '' ? metaRow('requirement', t('tabs.tasks.field.requirement'), requirement) : null,
      metaRow('created', t('tabs.tasks.field.created'), formatDate(activeTask.createdAt)),
      metaRow('updated', t('tabs.tasks.field.updated'), formatDate(activeTask.updatedAt || activeTask.createdAt)),
      activeTask.error ? metaRow('error', t('tabs.tasks.field.error'), safeText(activeTask.error)) : null,
    ].filter(Boolean)
    const head = h('div', { className: 'devbench-master-detail-head' },
      h('div', { className: 'devbench-title-row' },
        h('span', { className: 'devbench-pill ' + status }, t(taskStatusKey(status))),
        h('span', { className: 'devbench-task-kind' }, t(taskKindKey(kind))),
        h('span', { className: 'devbench-mono' }, safeText(activeTask.id))),
      h('div', {
        className: 'devbench-data-title',
        title: taskLabel(activeTask, t),
        style: { fontSize: '15px', fontWeight: 600, whiteSpace: 'normal', lineHeight: 1.4 },
      }, taskLabel(activeTask, t) || t(taskKindKey(kind))))
    const footChildren = []
    if (taskCanCancel(activeTask)) {
      footChildren.push(h('button', {
        className: 'devbench-btn ghost danger',
        disabled: props.busyKey === cancelKey,
        onClick() { cancelTask(activeTask) },
      }, props.busyKey === cancelKey ? t('project.task.cancelling') : t('project.task.cancel')))
    }
    if (taskCanRetry(activeTask)) {
      footChildren.push(h('button', {
        className: 'devbench-btn ghost',
        disabled: props.busyKey === retryKey,
        onClick() { retryTask(activeTask) },
      }, props.busyKey === retryKey ? t('project.task.retrying') : t('project.task.retry')))
    }
    // The session action belongs to the right-hand content, not a bottom bar.
    const actions = h('div', { className: 'devbench-detail-actions' },
      h('button', {
        className: 'devbench-btn primary',
        disabled: sessionId === '',
        title: sessionId === '' ? t('project.task.noSession') : sessionId,
        onClick() { openSession(activeTask) },
      }, t('project.task.openSession')),
      sessionId === ''
        ? h('span', { className: 'devbench-hint' }, t('project.task.noSession'))
        : h('span', { className: 'devbench-hint devbench-mono' }, sessionId))
    detail = h('div', { className: 'devbench-master-detail' },
      head,
      h('div', { className: 'devbench-master-detail-body' },
        actions,
        h('div', { className: 'devbench-flexcol' }, bodyRows)),
      footChildren.length > 0
        ? h('div', { className: 'devbench-master-detail-foot' }, footChildren)
        : null)
  }
  return h('div', { className: 'devbench-master' },
    h('div', { className: 'devbench-master-list' },
      h('div', { className: 'devbench-master-list-head' },
        h('div', { className: 'devbench-master-list-title' },
          h('span', null, t('project.tab.tasks')),
          h('span', { className: 'spacer' }),
          h('span', { className: 'devbench-muted' }, t('tabs.listCount', { count: filtered.length }))),
        h('div', { className: 'devbench-tabs', style: { marginBottom: '4px' } },
          statusFilterDefs.map(function (item) {
            return h('button', {
              key: item[0],
              type: 'button',
              className: 'devbench-tab' + (statusFilter === item[0] ? ' active' : ''),
              onClick() { applyStatusFilter(item[0]) },
            }, item[1])
          })),
        h('div', { className: 'devbench-tabs', style: { marginBottom: '0' } },
          kindFilterDefs.map(function (item) {
            return h('button', {
              key: item[0],
              type: 'button',
              className: 'devbench-tab' + (kindFilter === item[0] ? ' active' : ''),
              onClick() { applyKindFilter(item[0]) },
            }, item[1])
          }))),
      h('div', { className: 'devbench-master-list-body' }, listContent),
      pager),
    detail)
}
