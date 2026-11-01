/** Workbench home: stats, recent tasks, unfinished work and the weekly report. */
import {
  h, useState, useEffect, useRef, errorText, isAbortError, t as translate,
} from '../runtime.js'
import * as api from '../core/api.js'
import type { Dashboard, WeeklyReport } from '../../shared/api-types.js'
import { Banner, formatTime, formatShortTime } from '../ui/common.js'
import { ListFooter, useListPage } from '../ui/list-page.js'
import { useEmptySessions } from '../ui/session-row.js'
import { renderMarkdown } from '../ui/markdown.js'
import { IconRefresh, IconSettings, IconChevron, IconServer } from '../ui/icons.js'
import { HomeMcpPanel } from './mcp.js'
import { PluginAboutPanel } from './plugin-update.js'
/**
 * Resolve whether a task session still exists. The session list snapshot starts
 * in `pending`; until it is `ready` the id cannot be verified, so the row stays
 * non-navigable instead of guessing (a missing session must not be opened).
 */
function sessionStateOf(sessionsHook, sessionId) {
  const snapshot = sessionsHook(function (state) { return state })
  const phase = snapshot && typeof snapshot === 'object' && typeof snapshot.phase === 'string'
    ? snapshot.phase
    : ''
  const byId = snapshot && typeof snapshot === 'object' && snapshot.byId ? snapshot.byId : null
  const known = Boolean(byId && sessionId && byId[sessionId] !== undefined)
  return { phase: phase, known: known }
}
function safeCount(value) {
  const number = Number(value)
  if (Number.isFinite(number) === false || number < 0) return 0
  return number
}
function safeText(value) {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return String(value)
}
function firstLine(value) {
  const text = safeText(value)
  const index = text.indexOf('\n')
  if (index < 0) return text
  return text.slice(0, index).trim()
}
function activateOnKey(event, handler) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    handler()
  }
}
/** One compact line per task: status dot, kind, project, commit, subject, time and an open action. */
export function HomeTaskRow(props) {
  const t = props.t || translate
  const task = props.task && typeof props.task === 'object' ? props.task : {}
  const status = typeof task.status === 'string' && task.status !== '' ? task.status : 'queued'
  const statusText = t('status.' + status)
  const isRequirement = task.kind === 'requirement'
  const kind = task.kind === 'commit' || task.kind === 'review' || isRequirement ? task.kind : ''
  const commitShort = safeText(task.commitShort)
  const proposed = safeText(task.proposedMessage)
  const subject = safeText(task.commitSubject)
  const uncommittedReview = task.kind === 'review' && task.reviewTarget === 'uncommitted'
  let fullDetail = isRequirement ? safeText(task.title) : (proposed !== '' ? proposed : subject)
  // An uncommitted review has no commit subject/message; name the target instead.
  if (uncommittedReview && fullDetail === '') fullDetail = t('project.review.uncommittedTarget')
  const detail = firstLine(fullDetail)
  const chip = isRequirement ? safeText(task.requirementId) : (uncommittedReview ? '' : commitShort)
  const projectTitle = safeText(task.projectTitle)
  const updatedAt = safeText(task.updatedAt)
  const shortTime = formatShortTime(updatedAt)
  const fullTime = formatTime(updatedAt)
  const workspaceId = task.workspaceId
  const hasWorkspace = workspaceId !== undefined && workspaceId !== null && workspaceId !== ''
  const sessionId = task.sessionId
  const hasSession = sessionId !== undefined && sessionId !== null && sessionId !== ''
  const sessionsHook = typeof props.useSessions === 'function' ? props.useSessions : useEmptySessions
  const sessionState = sessionStateOf(sessionsHook, hasSession ? sessionId : '')
  const canOpenSession = hasSession && sessionState.phase === 'ready' && sessionState.known === true
  const sessionMissing = hasSession && sessionState.phase === 'ready' && sessionState.known === false
  const key = safeText(task.id) !== '' ? safeText(task.id) : 'task-' + String(props.index || 0)
  function openProject(event?) {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
    if (typeof props.onOpenProject === 'function') props.onOpenProject(workspaceId)
  }
  function openSession(event) {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
    if (canOpenSession !== true) return
    if (typeof props.onOpenSession === 'function') props.onOpenSession(sessionId)
  }
  const rowTitle = canOpenSession
    ? t('home.openSession')
    : (sessionMissing ? t('home.sessionMissing') : undefined)
  const rowProps = {
    className: 'devbench-task-row' + (canOpenSession ? ' clickable' : ''),
    key: key,
    title: rowTitle,
    onClick: canOpenSession ? openSession : undefined,
  }
  return h('div', rowProps,
    h('span', {
      className: 'devbench-task-dot ' + status,
      title: statusText,
      role: 'img',
      'aria-label': statusText,
    }),
    kind !== '' ? h('span', { className: 'devbench-task-kind' }, t('task.kind.' + kind)) : null,
    projectTitle !== ''
      ? h('span', {
        className: 'devbench-task-project' + (hasWorkspace ? ' link' : ''),
        title: projectTitle,
        role: hasWorkspace ? 'button' : undefined,
        tabIndex: hasWorkspace ? 0 : undefined,
        onClick: hasWorkspace ? openProject : undefined,
        onKeyDown: hasWorkspace
          ? function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
              if (typeof event.stopPropagation === 'function') event.stopPropagation()
              activateOnKey(event, function () { openProject() })
            }
          }
          : undefined,
      }, projectTitle)
      : null,
    chip !== '' ? h('span', { className: 'devbench-mono devbench-task-hash', title: isRequirement ? fullDetail : subject }, chip) : null,
    detail !== '' ? h('span', { className: 'devbench-task-subject', title: fullDetail }, detail) : null,
    shortTime !== '' ? h('span', { className: 'devbench-task-time', title: fullTime }, shortTime) : null,
    canOpenSession
      ? h('button', {
        className: 'devbench-task-open',
        type: 'button',
        title: t('home.openSession'),
        'aria-label': t('home.openSession'),
        onClick: openSession,
      }, h(IconChevron, { size: 12 }))
      : null)
}
/** One compact line per running requirement: status dot, project, requirement id, title and time. */
export function HomeRunningRow(props) {
  const t = props.t || translate
  const item = props.item && typeof props.item === 'object' ? props.item : {}
  const id = safeText(item.id)
  const title = safeText(item.title)
  const projectTitle = safeText(item.projectTitle)
  const folder = safeText(item.folder)
  const updatedAt = safeText(item.updatedAt)
  const shortTime = formatShortTime(updatedAt)
  const fullTime = formatTime(updatedAt)
  const workspaceId = item.workspaceId
  const hasWorkspace = workspaceId !== undefined && workspaceId !== null && workspaceId !== ''
  const key = id !== '' ? id : 'running-' + String(props.index || 0)
  function openProject() {
    if (typeof props.onOpenProject === 'function') props.onOpenProject(workspaceId)
  }
  const rowProps = {
    className: 'devbench-task-row' + (hasWorkspace ? ' clickable' : ''),
    key: key,
    role: hasWorkspace ? 'button' : undefined,
    tabIndex: hasWorkspace ? 0 : undefined,
    title: t('home.openProject') + (folder !== '' ? ' · ' + folder : ''),
    onClick: hasWorkspace ? openProject : undefined,
    onKeyDown: hasWorkspace
      ? function (event) { activateOnKey(event, openProject) }
      : undefined,
  }
  return h('div', rowProps,
    h('span', {
      className: 'devbench-task-dot running',
      title: t('status.running'),
      role: 'img',
      'aria-label': t('status.running'),
    }),
    projectTitle !== '' ? h('span', { className: 'devbench-task-project', title: projectTitle }, projectTitle) : null,
    id !== '' ? h('span', { className: 'devbench-mono devbench-task-hash' }, id) : null,
    title !== '' ? h('span', { className: 'devbench-task-subject', title: title }, title) : null,
    shortTime !== '' ? h('span', { className: 'devbench-task-time', title: fullTime }, shortTime) : null)
}
function dayText(value) {
  const text = safeText(value)
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text)
  return match ? match[1] : text
}
export function HomeView(props) {
  const t = props.t || translate
  const showToast = typeof props.showToast === 'function' ? props.showToast : function () {}
  const [dashboard, setDashboard] = useState<{ loading: boolean; error: string; data: Dashboard | null }>({ loading: true, error: '', data: null })
  const [weekly, setWeekly] = useState<{ loading: boolean; error: string; data: WeeklyReport | null }>({ loading: false, error: '', data: null })
  const dashboardSeqRef = useRef(0)
  const weeklySeqRef = useRef(0)
  const weeklyBusyRef = useRef(false)
  function openProject(workspaceId) {
    if (workspaceId === undefined || workspaceId === null || workspaceId === '') return
    if (typeof props.onOpenProject === 'function') props.onOpenProject(workspaceId)
  }
  function openSession(sessionId) {
    if (sessionId === undefined || sessionId === null || sessionId === '') return
    if (typeof props.onOpenSession === 'function') props.onOpenSession(sessionId)
  }
  function openSettings() {
    if (typeof props.onOpenSettings === 'function') props.onOpenSettings()
  }
  function openMcp() {
    if (typeof props.onOpenMcp === 'function') props.onOpenMcp()
  }
  function loadDashboard(silent) {
    const seq = ++dashboardSeqRef.current
    if (silent !== true) {
      setDashboard(function (prev) {
        return { loading: prev.data === null, error: '', data: prev.data }
      })
    }
    return api.getDashboard().then(function (value) {
      if (dashboardSeqRef.current !== seq) return null
      setDashboard({ loading: false, error: '', data: value || null })
      return value
    }, function (err) {
      if (dashboardSeqRef.current !== seq || isAbortError(err)) return null
      setDashboard(function (prev) {
        return { loading: false, error: errorText(err), data: prev.data }
      })
      return null
    })
  }
  function reloadDashboard() {
    loadDashboard(false).catch(function () {})
  }
  function generateWeekly() {
    if (weeklyBusyRef.current) return
    weeklyBusyRef.current = true
    const seq = ++weeklySeqRef.current
    setWeekly(function (prev) {
      return { loading: true, error: '', data: prev.data }
    })
    api.generateWeeklyReport({ days: 7 }).then(function (value) {
      if (weeklySeqRef.current !== seq) return null
      setWeekly({ loading: false, error: '', data: value || null })
      return value
    }, function (err) {
      if (weeklySeqRef.current !== seq || isAbortError(err)) return null
      setWeekly(function (prev) {
        return { loading: false, error: errorText(err), data: prev.data }
      })
      return null
    }).finally(function () {
      weeklyBusyRef.current = false
    })
  }
  function copyWeeklyMarkdown() {
    const markdown = weekly.data && typeof weekly.data.markdown === 'string' ? weekly.data.markdown : ''
    if (markdown === '') return
    const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard
    if (clipboard === null || clipboard === undefined || typeof clipboard.writeText !== 'function') {
      showToast('error', t('home.error'))
      return
    }
    Promise.resolve(clipboard.writeText(markdown)).then(function () {
      showToast('info', t('home.weekly.copied'))
    }, function (err) {
      showToast('error', errorText(err) || t('home.error'))
    })
  }
  useEffect(function () {
    reloadDashboard()
  }, [])
  useEffect(function () {
    function onFocus() {
      loadDashboard(true).catch(function () {})
    }
    window.addEventListener('focus', onFocus)
    return function () {
      window.removeEventListener('focus', onFocus)
    }
  }, [])
  const data = dashboard.data && typeof dashboard.data === 'object' ? dashboard.data : null
  const totals: Partial<Dashboard['totals']> = data && data.totals && typeof data.totals === 'object' ? data.totals : {}
  const week: Partial<Dashboard['week']> = data && data.week && typeof data.week === 'object' ? data.week : {}
  const recentTasks = data && Array.isArray(data.recentTasks) ? data.recentTasks : []
  const activeTasks = data && Array.isArray(data.activeTasks) ? data.activeTasks : []
  const runningRequirements = data && Array.isArray(data.runningRequirements) ? data.runningRequirements : []
  const recentPage = useListPage(recentTasks)
  const activeEntries = [
    ...activeTasks.map(function (task) { return { kind: 'task' as const, task: task } }),
    ...runningRequirements.map(function (item) { return { kind: 'running' as const, item: item } }),
  ]
  const activePage = useListPage(activeEntries)
  const statItems = [
    { key: 'projects', label: 'home.stats.projects', value: safeCount(totals.projects) },
    { key: 'requirements', label: 'home.stats.requirements', value: safeCount(totals.requirements) },
    { key: 'activeTasks', label: 'home.stats.activeTasks', value: safeCount(totals.activeTasks) },
    { key: 'runningRequirements', label: 'home.stats.runningRequirements', value: safeCount(totals.runningRequirements) },
  ]
  const statsGrid = h('div', { className: 'devbench-stat-grid' }, statItems.map(function (item) {
    return h('div', { className: 'devbench-stat-card', key: item.key },
      h('div', { className: 'devbench-stat-value', title: String(item.value) }, String(item.value)),
      h('div', { className: 'devbench-stat-label' }, t(item.label)))
  }))
  const weekStart = dayText(week.start)
  const weekEnd = dayText(week.end)
  const weekNote = h('div', { className: 'devbench-muted', style: { margin: '-4px 0 12px' } },
    t('home.weekLabel') + ' · ' + t('home.taskCount', { count: safeCount(totals.tasksThisWeek) }) +
    (weekStart !== '' && weekEnd !== ''
      ? ' · ' + t('home.weekly.range', { start: weekStart, end: weekEnd })
      : ''))
  const unconfigured = Boolean(props.stateData && props.stateData.configured === false)
  const emptyHint = safeCount(totals.projects) === 0
    ? h('div', { className: 'devbench-empty-panel', style: { marginBottom: '12px' } },
      h('div', null, t('home.empty')),
      unconfigured
        ? h('button', { className: 'devbench-btn', style: { marginTop: '10px' }, onClick: openSettings }, t('panel.settings'))
        : null)
    : null
  const sessionsHook = props.useSessions
  const recentRows = recentPage.rows.map(function (task, index) {
    return h(HomeTaskRow, {
      key: safeText(task.id) !== '' ? safeText(task.id) : 'recent-' + String(index),
      t: t, task: task, index: index,
      onOpenProject: openProject, onOpenSession: openSession,
      useSessions: sessionsHook,
    })
  })
  const activeRows = []
  let runningHeadingShown = false
  let visibleActiveCount = 0
  activePage.rows.forEach(function (entry, index) {
    if (entry.kind === 'running') {
      if (runningHeadingShown === false) {
        runningHeadingShown = true
        activeRows.push(h('div', {
          className: 'devbench-section-title',
          key: 'running-requirements',
          style: { marginTop: visibleActiveCount === 0 ? '2px' : '12px' },
        }, t('home.runningRequirements')))
      }
      activeRows.push(h(HomeRunningRow, {
        key: safeText(entry.item.id) !== '' ? safeText(entry.item.id) : 'running-' + String(index),
        t: t, item: entry.item, index: index, onOpenProject: openProject,
      }))
      return
    }
    visibleActiveCount += 1
    activeRows.push(h(HomeTaskRow, {
      key: safeText(entry.task.id) !== '' ? safeText(entry.task.id) : 'active-' + String(index),
      t: t, task: entry.task, index: index,
      onOpenProject: openProject, onOpenSession: openSession,
      useSessions: sessionsHook,
    }))
  })
  const recentPanel = h('div', { className: 'devbench-panel' },
    h('div', { className: 'devbench-panel-head' }, t('home.recentTasks')),
    h('div', { className: 'devbench-panel-body' },
      recentPage.total === 0
        ? h('div', { className: 'devbench-empty-panel' }, t('home.noRecentTasks'))
        : h('div', null, recentRows, h(ListFooter, { t: t, page: recentPage }))))
  const activePanel = h('div', { className: 'devbench-panel' },
    h('div', { className: 'devbench-panel-head' }, t('home.activeTasks')),
    h('div', { className: 'devbench-panel-body' },
      activePage.total === 0
        ? h('div', { className: 'devbench-empty-panel' }, t('home.noActiveTasks'))
        : h('div', null, activeRows, h(ListFooter, { t: t, page: activePage }))))
  const weeklyData = weekly.data && typeof weekly.data === 'object' ? weekly.data : null
  const weeklyCounts: Partial<WeeklyReport['counts']> = weeklyData && weeklyData.counts && typeof weeklyData.counts === 'object' ? weeklyData.counts : {}
  const weeklyWeek: Partial<WeeklyReport['week']> = weeklyData && weeklyData.week && typeof weeklyData.week === 'object' ? weeklyData.week : {}
  const weeklyMarkdown = weeklyData && typeof weeklyData.markdown === 'string' ? weeklyData.markdown : ''
  const weeklySummary = weeklyData
    ? h('div', { className: 'devbench-weekly-summary' },
      h('span', null, t('home.weekly.summary', {
        commits: safeCount(weeklyCounts.commits),
        reviews: safeCount(weeklyCounts.reviews),
        tasks: safeCount(weeklyCounts.tasks),
        requirements: safeCount(weeklyCounts.requirementsCreated) + safeCount(weeklyCounts.requirementsUpdated),
      })),
      safeText(weeklyWeek.start) !== '' || safeText(weeklyWeek.end) !== ''
        ? h('span', null, t('home.weekly.range', { start: dayText(weeklyWeek.start), end: dayText(weeklyWeek.end) }))
        : null,
      weeklyData.generatedAt
        ? h('span', null, t('home.weekly.generatedAt', { time: formatTime(weeklyData.generatedAt) }))
        : null)
    : null
  let weeklyBody
  if (weekly.loading && weeklyData === null) {
    weeklyBody = h('div', { className: 'devbench-inline-loading' }, t('home.weekly.generating'))
  } else if (weeklyData !== null) {
    weeklyBody = h('div', null,
      weeklySummary,
      weeklyMarkdown !== ''
        ? h('div', { className: 'devbench-weekly-preview' },
          h('div', { className: 'devbench-md' }, renderMarkdown(weeklyMarkdown)))
        : h('div', { className: 'devbench-empty-panel' }, t('home.weekly.empty')))
  } else {
    weeklyBody = h('div', { className: 'devbench-empty-panel' }, t('home.weekly.empty'))
  }
  const weeklyPanel = h('div', { className: 'devbench-panel' },
    h('div', { className: 'devbench-panel-head' }, t('home.weekly')),
    h('div', { className: 'devbench-panel-body' },
      h('div', { className: 'devbench-hint', style: { marginTop: '0' } }, t('home.weekly.hint', { days: 7 })),
      h('div', { className: 'devbench-weekly-actions' },
        h('button', {
          className: 'devbench-btn primary',
          disabled: weekly.loading,
          onClick: generateWeekly,
        }, weekly.loading
          ? t('home.weekly.generating')
          : (weeklyData !== null ? t('home.weekly.regenerate') : t('home.weekly.generate'))),
        weeklyMarkdown !== ''
          ? h('button', { className: 'devbench-btn ghost', onClick: copyWeeklyMarkdown }, t('home.weekly.copy'))
          : null),
      weekly.error
        ? h('div', { style: { marginBottom: '10px' } },
          h(Banner, { kind: 'error' }, weekly.error),
          h('button', { className: 'devbench-btn', onClick: generateWeekly }, t('panel.retry')))
        : null,
      weeklyBody))
  const header = h('div', { className: 'devbench-home-head' },
    h('div', { className: 'devbench-data-main' },
      h('div', { className: 'devbench-home-title' }, t('home.title')),
      h('div', { className: 'devbench-home-subtitle' }, t('home.subtitle'))),
    h('div', { className: 'devbench-inline' },
      h('button', { className: 'devbench-btn', onClick: reloadDashboard },
        h(IconRefresh, { size: 15 }), t('home.refresh')),
      h('button', { className: 'devbench-btn ghost', onClick: openMcp },
        h(IconServer, { size: 15 }), t('home.mcp.entry')),
      h('button', { className: 'devbench-btn ghost', onClick: openSettings },
        h(IconSettings, { size: 15 }), t('panel.settings'))))
  const dashboardError = dashboard.error
    ? h('div', null,
      h(Banner, { kind: 'error' }, dashboard.error),
      h('button', { className: 'devbench-btn', style: { marginBottom: '12px' }, onClick: reloadDashboard },
        t('panel.retry')))
    : null
  let leftColumn
  if (data !== null) {
    leftColumn = h('div', { className: 'devbench-home-col' }, recentPanel, activePanel)
  } else if (dashboard.loading) {
    leftColumn = h('div', { className: 'devbench-home-col' },
      h('div', { className: 'devbench-panel' },
        h('div', { className: 'devbench-panel-body' },
          h('div', { className: 'devbench-inline-loading' }, t('home.loading')))))
  } else {
    leftColumn = h('div', { className: 'devbench-home-col' })
  }
  return h('div', { className: 'devbench-home' },
    header,
    dashboardError,
    data !== null ? h('div', null, statsGrid, weekNote, emptyHint) : null,
    h('div', { className: 'devbench-home-grid' },
      leftColumn,
      h('div', { className: 'devbench-home-col' },
        h(HomeMcpPanel, { t: t, onOpenMcp: props.onOpenMcp }),
        h(PluginAboutPanel, { t: t }),
        weeklyPanel)))
}
