import {
  h, getFragment, getRuntimeContext, useState, useEffect, useRef,
  errorText, isAbortError, t as translate,
} from '../../runtime.js'
import { useUiState, uiStore, setSelection } from '../../core/ui-store.js'
import { hasLeaveGuard, navigateView, navigateBack, runLeaveGuard } from '../../core/navigation.js'
import { showToast as pushToast } from '../../ui/toast.js'
import { ToastHost } from '../../ui/toast.js'
import { DialogHost, confirmDialog } from '../../ui/dialogs.js'
import * as api from '../../core/api.js'
import {
  activeTasks, findAwaitingCommitTask, findActiveReviewTask, findActiveUncommittedReviewTask,
  findReviewForCommit, mergeTasks,
} from '../../core/project-utils.js'
import { createTaskRequestGate } from '../../core/task-request-gate.js'
import { Banner, Breadcrumb, Styles } from '../../ui/common.js'
import { IconRefresh, IconCode, IconFolder, IconTerminal } from '../../ui/icons.js'
import { ProjectSidebar } from './sidebar.js'
import { ProjectOverview } from './overview.js'
import { ProjectCommits } from './commits.js'
import { ProjectWorktrees } from './worktrees.js'
import { ProjectReviews } from './reviews.js'
import { ProjectTasks } from './tasks.js'
import { ProjectRequirements } from './requirements.js'
import { CommitConfirmModal } from '../../ui/commit-confirm-modal.js'
import { SettingsView } from '../settings.js'
import { LinkView } from '../link.js'
import { HomeView } from '../home.js'
import { McpView } from '../mcp.js'
const EMPTY_OVERVIEW = { loading: false, error: '', data: null, key: '' }
const EMPTY_TASKS = { loading: false, error: '', data: [], key: '' }
const EMPTY_REVIEW = { loading: false, error: '', data: null, name: '', key: '', meta: null }
const MASTER_TABS = ['requirements', 'commits', 'worktrees', 'reviews', 'tasks']
const OPEN_TARGET_ICONS = { vscode: IconCode, system: IconFolder, iterm: IconTerminal }
const TAB_LABEL_KEYS = {
  overview: 'project.tab.overview',
  requirements: 'project.tab.requirements',
  commits: 'project.tab.commits',
  worktrees: 'project.tab.worktrees',
  reviews: 'project.tab.reviews',
  tasks: 'project.tab.tasks',
}
export function ProjectDevbenchPage(props) {
  const t = props.t || translate
  const ui = useUiState()
  const [state, setState] = useState({ data: null, loading: true, error: '' })
  const [overview, setOverview] = useState(EMPTY_OVERVIEW)
  const [tasksState, setTasksState] = useState(EMPTY_TASKS)
  const [reviewContent, setReviewContent] = useState(EMPTY_REVIEW)
  const [selectedReviewName, setSelectedReviewName] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const [reviewingCommit, setReviewingCommit] = useState('')
  const [taskBusyKey, setTaskBusyKey] = useState('')
  const [gitBusy, setGitBusy] = useState(false)
  const [linkBusy, setLinkBusy] = useState(false)
  const [commitModal, setCommitModal] = useState(null)
  const [worktreeRevision, setWorktreeRevision] = useState(0)
  const [openTargets, setOpenTargets] = useState([])
  const [openTargetBusy, setOpenTargetBusy] = useState('')
  const stateSeqRef = useRef(0)
  const overviewSeqRef = useRef(0)
  const tasksSeqRef = useRef(0)
  const reviewSeqRef = useRef(0)
  const tasksGateRef = useRef(null)
  if (tasksGateRef.current === null) tasksGateRef.current = createTaskRequestGate()
  const addBusyRef = useRef(false)
  const previewBusyRef = useRef(false)
  const gitBusyRef = useRef(false)
  const linkBusyRef = useRef(false)
  const confirmBusyRef = useRef(false)
  const cancelBusyRef = useRef(false)
  const openTargetBusyRef = useRef('')
  const reviewActionRef = useRef(new Set())
  const taskActionRef = useRef(new Set())
  const activeTasksRef = useRef([])
  const previousActiveRef = useRef({ projectId: null, count: 0 })
  const taskStatusRef = useRef({})
  // REQ-20261027-003: working-tree review state. Kept after every legacy hook so
  // the fixed hook indexes seeded by render-smoke tests stay stable.
  const [reviewingUncommitted, setReviewingUncommitted] = useState('')
  const uncommittedReviewRef = useRef(false)
  const selectedProjectId = ui.selectedProjectId
  const currentWorkspace = state.data
    ? state.data.workspaces.find(function (item) { return item.workspaceId === selectedProjectId }) || null
    : null
  const currentOverview = overview.data && overview.key === selectedProjectId ? overview.data : null
  const taskList = tasksState.key === selectedProjectId ? tasksState.data : []
  const overviewTasks = currentOverview && Array.isArray(currentOverview.tasks) ? currentOverview.tasks : []
  const effectiveTaskList = mergeTasks(taskList, overviewTasks)
  const currentReviewContent = reviewContent.key === selectedProjectId ? reviewContent : EMPTY_REVIEW
  const currentReviewName = currentReviewContent.key === selectedProjectId ? selectedReviewName : ''
  const activeTaskList = activeTasks(effectiveTaskList)
  const activeCommitTask = activeTaskList.find(function (task) { return task.kind === 'commit' }) || null
  activeTasksRef.current = activeTaskList
  const activeTab = ui.activeTab || 'overview'
  const awaitingCommitTask = findAwaitingCommitTask(effectiveTaskList)
  function showToast(kind, text, options) { return pushToast(kind, text, options) }
  function applyView(patch, options) {
    if (!hasLeaveGuard()) {
      if (options && options.history) uiStore.enterView(patch)
      else uiStore.set(patch)
      return true
    }
    navigateView(patch, options).catch(function () {})
    return false
  }
  function selectProject(workspaceId) {
    const current = uiStore.state.selectedProjectId
    const inProjectView = uiStore.state.view === 'project'
    if (current === workspaceId && inProjectView) {
      loadOverview(workspaceId).catch(function () {})
      loadTasks(workspaceId).catch(function () {})
      return
    }
    if (applyView({
      view: 'project',
      selectedProjectId: workspaceId,
      selectedRequirement: null,
      activeTab: 'overview',
    }) === false) return
    setCommitModal(null)
    setSelectedReviewName('')
    setReviewContent(EMPTY_REVIEW)
    if (current === workspaceId) {
      loadOverview(workspaceId).catch(function () {})
      loadTasks(workspaceId).catch(function () {})
    }
  }
  function selectTab(tab) {
    applyView({ view: 'project', activeTab: tab })
  }
  function backToProject() {
    if (!hasLeaveGuard()) {
      uiStore.set({ view: 'project', selectedRequirement: null })
      return
    }
    navigateBack({ view: 'project', selectedRequirement: null }).catch(function () {})
  }
  function openSettings() {
    applyView({ view: 'settings' }, { history: true })
  }
  function openHome() {
    applyView({ view: 'home', selectedRequirement: null }, { history: true })
  }
  function openMcp() {
    applyView({ view: 'mcp', selectedRequirement: null }, { history: true })
  }
  function openTaskSession(sessionId) {
    if (sessionId === undefined || sessionId === null || sessionId === '') return
    function run() {
      try {
        getRuntimeContext().uiWorkspace.openSession(sessionId)
      } catch (err) {
        showToast('error', errorText(err))
      }
    }
    if (!hasLeaveGuard()) { run(); return }
    runLeaveGuard().then(function (allowed) { if (allowed) run() }).catch(function () {})
  }
  function openCommitFromRequirement(workspaceId, hash) {
    if (typeof hash !== 'string' || hash === '') return
    applyView({
      view: 'project',
      selectedProjectId: workspaceId,
      selectedRequirement: null,
      activeTab: 'commits',
    })
    setSelection('commits', hash)
  }
  function openRequirementFromCommit(workspaceId, id) {
    if (typeof id !== 'string' || id === '') return
    applyView({
      view: 'project',
      selectedProjectId: workspaceId,
      selectedRequirement: { workspaceId: workspaceId, id: id },
      activeTab: 'requirements',
    })
  }
  function openProjectTarget(target) {
    if (openTargetBusyRef.current !== '' || selectedProjectId === null) return
    openTargetBusyRef.current = target
    setOpenTargetBusy(target)
    api.openProjectDirectory({ workspaceId: selectedProjectId, target: target }).then(function () {
      openTargetBusyRef.current = ''
      setOpenTargetBusy('')
    }, function (err) {
      openTargetBusyRef.current = ''
      setOpenTargetBusy('')
      showToast('error', errorText(err))
    })
  }
  function loadState() {
    const seq = ++stateSeqRef.current
    setState(function (prev) {
      return { data: prev.data, loading: prev.data === null, error: '' }
    })
    return api.getState().then(function (next) {
      if (stateSeqRef.current !== seq) return null
      setState({ data: next, loading: false, error: '' })
      const selected = uiStore.state.selectedProjectId
      const exists = next.workspaces.some(function (item) { return item.workspaceId === selected })
      if (exists === false) {
        const first = next.workspaces[0]
        uiStore.set({
          selectedProjectId: first ? first.workspaceId : null,
          selectedRequirement: null,
        })
      }
      return next
    }, function (err) {
      if (stateSeqRef.current !== seq || isAbortError(err)) return null
      setState(function (prev) {
        return { data: prev.data, loading: false, error: errorText(err) }
      })
      throw err
    })
  }
  function loadOverview(workspaceId) {
    if (workspaceId === null || workspaceId === undefined || workspaceId === '') return Promise.resolve(null)
    const seq = ++overviewSeqRef.current
    setOverview(function (prev) {
      return { loading: true, error: '', data: prev.key === workspaceId ? prev.data : null, key: workspaceId }
    })
    return api.getProjectOverview(workspaceId).then(function (value) {
      if (overviewSeqRef.current !== seq || uiStore.state.selectedProjectId !== workspaceId) return null
      setOverview({ loading: false, error: '', data: value, key: workspaceId })
      setTasksState(function (prev) {
        const base = prev.key === workspaceId ? prev.data : []
        return {
          loading: false,
          error: '',
          data: mergeTasks(base, value.tasks || []),
          key: workspaceId,
        }
      })
      return value
    }, function (err) {
      if (overviewSeqRef.current !== seq || uiStore.state.selectedProjectId !== workspaceId) return null
      setOverview(function (prev) {
        return {
          loading: false,
          error: errorText(err),
          data: prev.key === workspaceId ? prev.data : null,
          key: workspaceId,
        }
      })
      throw err
    })
  }
  function stopTaskRequest() {
    tasksGateRef.current.stop()
  }
  function loadTasks(workspaceId) {
    if (workspaceId === null || workspaceId === undefined || workspaceId === '') return Promise.resolve(null)
    const controller = tasksGateRef.current.begin()
    if (controller === null) return Promise.resolve(null)
    const seq = ++tasksSeqRef.current
    setTasksState(function (prev) {
      return {
        loading: prev.data.length === 0,
        error: '',
        data: prev.key === workspaceId ? prev.data : [],
        key: workspaceId,
      }
    })
    return api.getProjectTasks(workspaceId, { signal: controller.signal }).then(function (value) {
      if (tasksSeqRef.current !== seq || uiStore.state.selectedProjectId !== workspaceId) return null
      setTasksState(function (prev) {
        return {
          loading: false,
          error: '',
          data: mergeTasks(prev.key === workspaceId ? prev.data : [], value.tasks || []),
          key: workspaceId,
        }
      })
      return value
    }, function (err) {
      if (isAbortError(err)) return null
      if (tasksSeqRef.current !== seq || uiStore.state.selectedProjectId !== workspaceId) return null
      setTasksState(function (prev) {
        return {
          loading: false,
          error: errorText(err),
          data: prev.key === workspaceId ? prev.data : [],
          key: workspaceId,
        }
      })
      return null
    }).finally(function () {
      tasksGateRef.current.finish(controller)
    })
  }
  useEffect(function () { loadState().catch(function () {}) }, [])
  useEffect(function () {
    let cancelled = false
    api.getProjectOpenTargets().then(function (value) {
      if (cancelled) return
      setOpenTargets(value && Array.isArray(value.targets) ? value.targets : [])
    }, function () {
      if (!cancelled) setOpenTargets([])
    })
    return function () { cancelled = true }
  }, [])
  useEffect(function () {
    const timer = setInterval(function () {
      loadState().catch(function () {})
    }, 5000)
    return function () { clearInterval(timer) }
  }, [])
  useEffect(function () {
    stopTaskRequest()
    setReviewContent(EMPTY_REVIEW)
    setSelectedReviewName('')
    setReviewingCommit('')
    setReviewingUncommitted('')
    setTaskBusyKey('')
    setCommitModal(null)
    if (selectedProjectId === null || selectedProjectId === undefined) {
      setOverview(EMPTY_OVERVIEW)
      setTasksState(EMPTY_TASKS)
      return
    }
    setOverview({ loading: true, error: '', data: null, key: selectedProjectId })
    setTasksState({ loading: true, error: '', data: [], key: selectedProjectId })
    loadOverview(selectedProjectId).catch(function () {})
    loadTasks(selectedProjectId).catch(function () {})
    return function () { stopTaskRequest() }
  }, [selectedProjectId])
  useEffect(function () {
    function onFocus() {
      loadState().catch(function () {})
      const projectId = uiStore.state.selectedProjectId
      if (projectId) {
        loadOverview(projectId).catch(function () {})
        loadTasks(projectId).catch(function () {})
      }
    }
    window.addEventListener('focus', onFocus)
    return function () { window.removeEventListener('focus', onFocus) }
  }, [])
  useEffect(function () {
    if (selectedProjectId === null || selectedProjectId === undefined) return
    if (activeTaskList.length === 0) return
    const timer = setInterval(function () {
      if (activeTasksRef.current.length > 0) loadTasks(selectedProjectId)
    }, 2000)
    return function () { clearInterval(timer) }
  }, [selectedProjectId, activeTaskList.length])
  useEffect(function () {
    const previous = previousActiveRef.current
    const count = activeTaskList.length
    if (previous.projectId === selectedProjectId && previous.count > 0 && count === 0) {
      loadOverview(selectedProjectId).catch(function () {})
      loadState().catch(function () {})
    }
    previousActiveRef.current = { projectId: selectedProjectId, count: count }
  }, [selectedProjectId, activeTaskList.length])
  useEffect(function () {
    const next = {}
    effectiveTaskList.forEach(function (task) {
      const before = taskStatusRef.current[task.id]
      if (before !== undefined && before !== task.status && task.status === 'failed') {
        showToast('error', (task.error || t('status.failed')))
      }
      next[task.id] = task.status
    })
    taskStatusRef.current = next
  }, [tasksState.data, overview.data, selectedProjectId])
  useEffect(function () {
    if (selectedProjectId === null || selectedProjectId === undefined) return
    const awaiting = findAwaitingCommitTask(effectiveTaskList)
    if (awaiting === null) {
      setCommitModal(function (prev) { return prev === null ? prev : null })
      return
    }
    // Do not steal focus automatically: only refresh an already-open dialog.
    setCommitModal(function (prev) {
      if (prev && prev.task && prev.task.id === awaiting.id) {
        return Object.assign({}, prev, { task: awaiting })
      }
      return prev
    })
  }, [tasksState.data, currentOverview, selectedProjectId])
  function openCommitPreview(task) {
    const candidate = task || findAwaitingCommitTask(effectiveTaskList)
    if (!candidate || !candidate.id) return
    setCommitModal({
      task: candidate,
      message: candidate.proposedMessage || '',
      busy: false,
      cancelling: false,
      error: '',
    })
  }
  /**
   * Re-run a stale worktree commit preview in place. Using the project preview
   * here would create a project-root task instead of a worktree commit.
   */
  function repreviewWorktreeTask(projectId, task) {
    const requirementId = task && typeof task.requirementId === 'string' ? task.requirementId : ''
    if (projectId === null || projectId === undefined || requirementId === '') {
      startPreview()
      return Promise.resolve(null)
    }
    previewBusyRef.current = true
    setPreviewBusy(true)
    return api.previewWorktreeCommit(projectId, requirementId).then(function (result) {
      const next = result && result.task ? result.task : null
      if (next) {
        setTasksState(function (prev) {
          return Object.assign({}, prev, { data: mergeTasks(prev.data, [next]) })
        })
        openCommitPreview(next)
      }
      loadTasks(projectId).catch(function () {})
      loadState().catch(function () {})
      return result
    }, function (err) {
      showToast('error', errorText(err))
      return null
    }).finally(function () {
      previewBusyRef.current = false
      setPreviewBusy(false)
    })
  }
  function closeCommitModal() {
    setCommitModal(null)
  }
  function addProject() {
    if (addBusyRef.current) return
    const ctx = getRuntimeContext()
    addBusyRef.current = true
    setAddBusy(true)
    setAddError('')
    ctx.uiWorkspace.pickDirectory().then(function (picked) {
      if (picked === null || picked === undefined || picked === '') return null
      return api.addProject({ path: picked }).then(function (result) {
        if (result && result.project && result.project.workspaceId) {
          applyView({
            view: 'project', selectedProjectId: result.project.workspaceId,
            selectedRequirement: null, activeTab: 'overview',
          })
        }
        loadState().catch(function () {
          showToast('error', t('common.refreshFailed'))
        })
      }, function (err) {
        setAddError(errorText(err))
      })
    }).catch(function (err) {
      setAddError(errorText(err))
    }).finally(function () {
      addBusyRef.current = false
      setAddBusy(false)
    })
  }
  function refreshWorktrees() {
    setWorktreeRevision(function (value) { return value + 1 })
  }
  function initGit() {
    if (gitBusyRef.current || selectedProjectId === null) return
    const projectId = selectedProjectId
    gitBusyRef.current = true
    setGitBusy(true)
    api.initProjectGit(projectId).then(function () {
      if (uiStore.state.selectedProjectId === projectId) {
        showToast('info', t('detail.saved'))
        refreshWorktrees()
        loadOverview(projectId).catch(function () { showToast('error', t('project.refreshFailed')) })
      }
    }, function (err) {
      showToast('error', errorText(err))
    }).finally(function () {
      gitBusyRef.current = false
      setGitBusy(false)
    })
  }
  function startPreview() {
    if (previewBusyRef.current || selectedProjectId === null) return
    if (activeCommitTask !== null) {
      showToast('info', t('project.ai.commitActive'))
      return
    }
    const projectId = selectedProjectId
    previewBusyRef.current = true
    setPreviewBusy(true)
    api.previewProjectCommit(projectId).then(function (result) {
      if (uiStore.state.selectedProjectId !== projectId) return
      const task = result && result.task ? result.task : null
      if (task) {
        setTasksState(function (prev) {
          return {
            loading: false,
            error: '',
            data: mergeTasks(prev.data, [task]),
            key: projectId,
          }
        })
      }
      showToast('info', t('project.commit.previewCreated'))
      loadTasks(projectId).catch(function () {})
      loadState().catch(function () {})
    }, function (err) {
      showToast('error', errorText(err))
    }).finally(function () {
      previewBusyRef.current = false
      setPreviewBusy(false)
    })
  }
  function changeCommitMessage(value) {
    setCommitModal(function (prev) {
      return prev === null ? prev : Object.assign({}, prev, { message: value })
    })
  }
  function onWorktreeCommitTask(task) {
    if (!task || task.id === undefined) return
    const projectId = selectedProjectId
    if (projectId === null || projectId === undefined) return
    setTasksState(function (prev) {
      return {
        loading: false,
        error: '',
        data: mergeTasks(prev.key === projectId ? prev.data : [], [task]),
        key: projectId,
      }
    })
    loadTasks(projectId).catch(function () {})
    loadState().catch(function () {})
  }
  function refreshAfterCommit(projectId) {
    const id = projectId || selectedProjectId
    if (id === null || id === undefined) return
    loadOverview(id).catch(function () { showToast('error', t('project.refreshFailed')) })
    loadTasks(id).catch(function () {})
    loadState().catch(function () {})
    refreshWorktrees()
  }
  function confirmCommit() {
    const modal = commitModal
    if (modal === null || modal.busy === true || modal.cancelling === true || confirmBusyRef.current) return
    const projectId = selectedProjectId
    const worktreeTask = Boolean(modal.task && (modal.task.worktreePath || modal.task.worktreeBranch))
    const payload = {
      workspaceId: projectId,
      taskId: modal.task.id,
      message: modal.message,
    }
    confirmBusyRef.current = true
    setCommitModal(function (prev) { return Object.assign({}, prev, { busy: true, error: '' }) })
    const request = worktreeTask ? api.confirmWorktreeCommit(payload) : api.confirmProjectCommit(payload)
    return request.then(function (result) {
      confirmBusyRef.current = false
      setCommitModal(null)
      if (worktreeTask) {
        showToast('info', t('project.worktrees.commitSuccess', {
          short: result && result.commit ? (result.commit.short || result.commit.hash || '') : '',
        }))
      } else {
        showToast('info', t('project.commit.success'))
      }
      const extra = []
      if (result && result.task) extra.push(result.task)
      if (extra.length > 0) {
        setTasksState(function (prev) {
          return Object.assign({}, prev, { data: mergeTasks(prev.data, extra) })
        })
      }
      refreshAfterCommit(projectId)
    }, function (err) {
      confirmBusyRef.current = false
      const message = errorText(err)
      const task = modal.task
      if (err && err.code === 'stale-preview') {
        setCommitModal(null)
        if (worktreeTask) {
          showToast('error', message, {
            actionLabel: t('project.worktrees.repreview'),
            onAction() { repreviewWorktreeTask(projectId, task) },
          })
        } else {
          showToast('error', message, {
            actionLabel: t('project.ai.commit'),
            onAction() { startPreview() },
          })
        }
      } else {
        showToast('error', message)
        setCommitModal(function (prev) {
          return prev === null ? prev : Object.assign({}, prev, { busy: false, error: message })
        })
      }
      refreshAfterCommit(projectId)
    })
  }
  function cancelCommitTask() {
    const modal = commitModal
    if (modal === null || modal.busy === true || modal.cancelling === true || cancelBusyRef.current) return
    const projectId = selectedProjectId
    cancelBusyRef.current = true
    setCommitModal(function (prev) { return Object.assign({}, prev, { cancelling: true, error: '' }) })
    api.cancelProjectTask({ workspaceId: projectId, taskId: modal.task.id }).then(function (result) {
      cancelBusyRef.current = false
      setCommitModal(null)
      showToast('info', t('project.task.cancelled'))
      if (result && result.task) {
        setTasksState(function (prev) {
          return Object.assign({}, prev, { data: mergeTasks(prev.data, [result.task]) })
        })
      }
      refreshAfterCommit(projectId)
    }, function (err) {
      cancelBusyRef.current = false
      setCommitModal(function (prev) {
        return Object.assign({}, prev, { cancelling: false, error: errorText(err) })
      })
    })
  }
  function loadReviewContent(review) {
    if (selectedProjectId === null || review === null || review === undefined) return Promise.resolve(null)
    const seq = ++reviewSeqRef.current
    const projectId = selectedProjectId
    setReviewContent({ loading: true, error: '', data: null, name: review.name, key: projectId, meta: review })
    return api.getReviewContent(projectId, review.name).then(function (value) {
      if (reviewSeqRef.current !== seq || uiStore.state.selectedProjectId !== projectId) return null
      setReviewContent({ loading: false, error: '', data: value, name: review.name, key: projectId, meta: review })
      return value
    }, function (err) {
      if (reviewSeqRef.current !== seq || uiStore.state.selectedProjectId !== projectId) return null
      setReviewContent({ loading: false, error: errorText(err), data: null, name: review.name, key: projectId, meta: review })
      return null
    })
  }
  function openReview(review) {
    if (review === null || review === undefined) return
    applyView({ view: 'project', activeTab: 'reviews' })
    setSelectedReviewName(review.name)
    loadReviewContent(review).catch(function () {})
  }
  function startReview(commit) {
    if (selectedProjectId === null || commit === null || commit === undefined) return
    const projectId = selectedProjectId
    const hash = typeof commit === 'string' ? commit : commit.hash
    if (hash === undefined || hash === null || hash === '') return
    if (findActiveReviewTask(activeTaskList, hash)) {
      showToast('info', t('project.review.started'))
      return
    }
    if (typeof commit === 'object' && commit.reviewed === true && commit.reviewName) {
      showToast('info', t('project.alreadyReviewed'))
      openReview({
        name: commit.reviewName, commit: hash, commitSubject: commit.subject, modifiedAt: commit.date,
      })
      return
    }
    const key = projectId + ':review:' + hash
    if (reviewActionRef.current.has(key)) return
    reviewActionRef.current.add(key)
    setReviewingCommit(hash)
    api.startProjectReview({ workspaceId: projectId, commit: hash }).then(function (result) {
      if (uiStore.state.selectedProjectId !== projectId) return
      if (result && result.alreadyReviewed === true) {
        showToast('info', t('project.alreadyReviewed'))
        return loadOverview(projectId).then(function (value) {
          const found = value ? findReviewForCommit(value.reviews || [], hash) : null
          if (found) openReview(found)
          else showToast('error', t('project.review.notFound'))
        })
      }
      showToast('info', t('project.review.started'))
      if (result && result.task) {
        setTasksState(function (prev) {
          return Object.assign({}, prev, { data: mergeTasks(prev.data, [result.task]) })
        })
      }
      loadTasks(projectId).catch(function () {})
      loadState().catch(function () {})
    }, function (err) {
      showToast('error', errorText(err))
    }).catch(function () {
      showToast('error', t('project.refreshFailed'))
    }).finally(function () {
      reviewActionRef.current.delete(key)
      if (uiStore.state.selectedProjectId === projectId) setReviewingCommit('')
    })
  }
  function startUncommittedReview() {
    if (uncommittedReviewRef.current || selectedProjectId === null || selectedProjectId === undefined) return
    const projectId = selectedProjectId
    uncommittedReviewRef.current = true
    setReviewingUncommitted(projectId)
    api.startUncommittedReview(projectId).then(function (result) {
      if (uiStore.state.selectedProjectId !== projectId) return
      const task = result && result.task ? result.task : null
      if (task) {
        setTasksState(function (prev) {
          return {
            loading: false,
            error: '',
            data: mergeTasks(prev.key === projectId ? prev.data : [], [task]),
            key: projectId,
          }
        })
      }
      showToast('info', t('project.review.uncommittedStarted'))
      loadTasks(projectId).catch(function () {})
      loadState().catch(function () {})
      loadOverview(projectId).catch(function () {})
    }, function (err) {
      showToast('error', errorText(err))
      // A 409 means another window/tab already started a review: refresh so the
      // button reflects the remote active task instead of staying clickable.
      if (uiStore.state.selectedProjectId === projectId) {
        loadTasks(projectId).catch(function () {})
        loadOverview(projectId).catch(function () {})
      }
    }).finally(function () {
      uncommittedReviewRef.current = false
      if (uiStore.state.selectedProjectId === projectId) setReviewingUncommitted('')
    })
  }
  function runTaskAction(task, action) {
    if (action === 'cancel') {
      confirmDialog({
        title: t('project.task.cancelConfirm.title'),
        body: t('project.task.cancelConfirm.body', {
          name: task.commitSubject || task.requirementId ||
            (task.reviewTarget === 'uncommitted' ? t('project.review.uncommittedTarget') : '') ||
            task.id,
        }),
        confirmText: t('project.task.cancel'),
      }).then(function (ok) { if (ok) performTaskAction(task, action) }).catch(function () {})
      return
    }
    performTaskAction(task, action)
  }
  function performTaskAction(task, action) {
    if (selectedProjectId === null || selectedProjectId === undefined) return
    const projectId = selectedProjectId
    const key = projectId + ':' + action + ':' + task.id
    const uiKey = action + ':' + task.id
    if (taskActionRef.current.has(key)) return
    taskActionRef.current.add(key)
    setTaskBusyKey(uiKey)
    const promise = action === 'cancel'
      ? api.cancelProjectTask({ workspaceId: projectId, taskId: task.id })
      : api.retryProjectTask({ workspaceId: projectId, taskId: task.id })
    promise.then(function (result) {
      if (uiStore.state.selectedProjectId !== projectId) return
      showToast('info', t('project.task.updated'))
      if (result && result.task) {
        setTasksState(function (prev) {
          return Object.assign({}, prev, { data: mergeTasks(prev.data, [result.task]) })
        })
      }
      loadTasks(projectId).catch(function () {})
      loadOverview(projectId).catch(function () {})
      loadState().catch(function () {})
      refreshWorktrees()
    }, function (err) {
      showToast('error', errorText(err))
    }).finally(function () {
      taskActionRef.current.delete(key)
      if (uiStore.state.selectedProjectId === projectId) setTaskBusyKey('')
    })
  }
  function linkSessionToRequirement(workspaceId, id) {
    const sessionId = ui.linkSessionId
    if (sessionId === null || sessionId === undefined || sessionId === '' || linkBusyRef.current) return
    linkBusyRef.current = true
    setLinkBusy(true)
    api.getSessionLink(sessionId).then(function (existing) {
      const current = existing && existing.link ? existing.link : null
      if (current && (current.workspaceId !== workspaceId || current.id !== id)) {
        return api.unlinkSession({
          workspaceId: current.workspaceId, id: current.id, sessionId: sessionId,
        }).then(function () {
          return api.linkSession({ workspaceId: workspaceId, id: id, sessionId: sessionId })
        })
      }
      return api.linkSession({ workspaceId: workspaceId, id: id, sessionId: sessionId })
    }).then(function () {
      applyView({
        view: 'project',
        selectedProjectId: workspaceId,
        selectedRequirement: { workspaceId: workspaceId, id: id },
        activeTab: 'requirements',
        linkSessionId: null,
      })
      loadState().catch(function () { showToast('error', t('common.refreshFailed')) })
    }, function (err) {
      showToast('error', errorText(err))
    }).finally(function () {
      linkBusyRef.current = false
      setLinkBusy(false)
    })
  }
  function refreshAll() {
    const projectId = uiStore.state.selectedProjectId
    loadState().catch(function () { showToast('error', t('project.refreshFailed')) })
    if (projectId) {
      loadOverview(projectId).catch(function () { showToast('error', t('project.refreshFailed')) })
      loadTasks(projectId).catch(function () {})
    }
    if (selectedReviewName !== '' && projectId) {
      loadReviewContent({ name: selectedReviewName }).catch(function () {})
    }
    refreshWorktrees()
  }
  useEffect(function () {
    if (activeTab !== 'reviews' || selectedReviewName !== '' || currentOverview === null) return
    const first = (currentOverview.reviews || [])[0]
    if (first) openReview(first)
  }, [activeTab, currentOverview, selectedReviewName])
  const projects = state.data ? state.data.workspaces : []
  const overviewGit = currentOverview && currentOverview.git ? currentOverview.git : {}
  const gitReady = overviewGit.initialized === true
  const worktreesGitReady = currentOverview !== null && gitReady !== true ? false : null
  const changes = Array.isArray(overviewGit.changes) ? overviewGit.changes : []
  const latestCommit = currentOverview && currentOverview.commits ? currentOverview.commits[0] : null
  const runningCount = activeTaskList.length
  const gitStatus = []
  if (currentOverview === null) {
    gitStatus.push(h('span', { className: 'devbench-pill', key: 'loading' }, t('panel.loading')))
  } else if (overviewGit.available === false) {
    gitStatus.push(h('span', { className: 'devbench-pill failed', key: 'git' }, t('project.gitUnavailable')))
  } else if (gitReady === false) {
    gitStatus.push(h('span', { className: 'devbench-pill', key: 'git' }, t('project.gitNotInitialized')))
    gitStatus.push(h('button', {
      className: 'devbench-btn', key: 'init', disabled: gitBusy,
      onClick: initGit,
    }, gitBusy ? t('project.initingGit') : t('project.initGit')))
  } else {
    gitStatus.push(h('span', { className: 'devbench-pill', key: 'branch' },
      t('project.branch') + ': ' + (overviewGit.branch || t('project.noBranch'))))
    if (overviewGit.head) gitStatus.push(h('span', { className: 'devbench-mono', key: 'head' }, String(overviewGit.head).slice(0, 8)))
    gitStatus.push(h('span', { className: 'devbench-pill', key: 'changes' }, t('project.changes', { count: changes.length })))
  }
  const projectTitle = currentOverview && currentOverview.project ? currentOverview.project.title : (currentWorkspace ? currentWorkspace.title : '')
  const projectPath = currentOverview && currentOverview.project
    ? currentOverview.project.canonicalPath
    : (currentWorkspace ? (currentWorkspace.canonicalPath || currentWorkspace.path) : '')
  const requirements = currentWorkspace && Array.isArray(currentWorkspace.requirements) ? currentWorkspace.requirements : []
  const reviews = currentOverview && Array.isArray(currentOverview.reviews) ? currentOverview.reviews : []
  const overviewCommits = currentOverview && Array.isArray(currentOverview.commits) ? currentOverview.commits : []
  const tabCounts = {
    requirements: requirements.length,
    commits: overviewCommits.length,
    reviews: reviews.length,
    tasks: effectiveTaskList.length,
    worktrees: 0,
  }
  const tabDefs = [
    ['overview', 'project.tab.overview'],
    ['requirements', 'project.tab.requirements'],
    ['sep', ''],
    ['commits', 'project.tab.commits'],
    ['worktrees', 'project.tab.worktrees'],
    ['reviews', 'project.tab.reviews'],
    ['sep', ''],
    ['tasks', 'project.tab.tasks'],
  ]
  const tabs = h('div', { className: 'devbench-project-tabs', role: 'tablist' }, tabDefs.map(function (item, index) {
    if (item[0] === 'sep') return h('span', { className: 'devbench-tab-sep', key: 'sep-' + index })
    const count = tabCounts[item[0]] || 0
    const selected = activeTab === item[0]
    return h('button', {
      key: item[0],
      className: 'devbench-project-tab' + (selected ? ' active' : ''),
      role: 'tab',
      'aria-selected': selected,
      onClick() { selectTab(item[0]) },
    }, t(item[1]), count > 0 ? h('span', { className: 'devbench-tab-count' }, String(count)) : null)
  }))
  function overviewGate(build, fill) {
    const className = fill === true ? 'devbench-tab-fill' : null
    const wrap = function () {
      const children = Array.prototype.slice.call(arguments)
      return className === null
        ? h('div', null, ...children)
        : h('div', { className: className }, ...children)
    }
    if (currentOverview === null) {
      if (overview.loading) return h('div', { className: 'devbench-inline-loading' }, t('panel.loading'))
      if (overview.error) {
        return wrap(h(Banner, { kind: 'error' }, overview.error),
          h('button', { className: 'devbench-btn', onClick: refreshAll }, t('panel.retry')))
      }
      return h('div', { className: 'devbench-empty-panel' }, t('panel.loading'))
    }
    if (overview.error) {
      return wrap(h(Banner, { kind: 'error' }, overview.error), build(currentOverview))
    }
    return wrap(build(currentOverview))
  }
  let tabContent
  const canCommit = currentOverview !== null && gitReady && changes.length > 0 &&
    previewBusy === false && activeCommitTask === null
  const latestReviewTask = latestCommit ? findActiveReviewTask(activeTaskList, latestCommit.hash) : null
  const canReviewLatest = Boolean(latestCommit) && reviewingCommit === '' && latestReviewTask === null
  const reviewBusy = reviewingCommit !== '' || latestReviewTask !== null
  const activeUncommittedReviewTask = findActiveUncommittedReviewTask(activeTaskList)
  // Only the working-tree review (staged + unstaged + untracked files) needs changes.
  const canReviewUncommitted = currentOverview !== null && gitReady === true && changes.length > 0 &&
    reviewingUncommitted === '' && activeUncommittedReviewTask === null
  const reviewUncommittedBusy = reviewingUncommitted !== '' || activeUncommittedReviewTask !== null
  if (activeTab === 'overview') {
    tabContent = overviewGate(function () {
      return h(ProjectOverview, {
        t: t, overview: overview, tasks: effectiveTaskList,
        workspaceId: selectedProjectId, revision: worktreeRevision,
        onViewTab: selectTab, onOpenReview: openReview,
        onStartCommit: startPreview, onStartReview: startReview,
        canCommit: canCommit, previewBusy: previewBusy, activeCommitTask: activeCommitTask,
        canReviewLatest: canReviewLatest, reviewBusy: reviewBusy,
        onStartUncommittedReview: startUncommittedReview,
        canReviewUncommitted: canReviewUncommitted,
        reviewUncommittedBusy: reviewUncommittedBusy,
        activeUncommittedReviewTask: activeUncommittedReviewTask,
        onOpenSession: openTaskSession,
        onCancelTask(task) { runTaskAction(task, 'cancel') },
        taskBusyKey: taskBusyKey,
        onOpenCommitPreview: openCommitPreview,
        showToast: showToast,
        onChanged() {
          refreshAfterCommit(selectedProjectId)
        },
      })
    })
  } else if (activeTab === 'requirements') {
    tabContent = currentWorkspace
      ? h(ProjectRequirements, {
        key: 'requirements-' + currentWorkspace.workspaceId,
        t: t, data: state.data, configured: state.data.configured === true,
        workspace: currentWorkspace, sessionsHook: props.useSessions,
        onReloadState: loadState, onOpenSettings: openSettings, showToast: showToast,
        tasks: effectiveTaskList,
        onReloadTasks: function () { return loadTasks(currentWorkspace.workspaceId) },
        onOpenCommit: openCommitFromRequirement,
      })
      : h('div', { className: 'devbench-empty-panel' }, t('project.selectHint'))
  } else if (activeTab === 'commits') {
    tabContent = h('div', { className: 'devbench-tab-flush-inner' }, overviewGate(function (data) {
      return h(ProjectCommits, {
        t: t, commits: data.commits || [], tasks: effectiveTaskList,
        workspaceId: selectedProjectId,
        requirements: requirements,
        reviewingCommit: reviewingCommit, onReview: startReview,
        reviews: data.reviews || [],
        onOpenReview: openReview,
        onOpenRequirement: openRequirementFromCommit,
        onOpenSession: openTaskSession,
        showToast: showToast,
        onLinkedRequirement() {
          loadOverview(selectedProjectId).catch(function () {})
          loadState().catch(function () {})
        },
      })
    }, true))
  } else if (activeTab === 'worktrees') {
    tabContent = h(ProjectWorktrees, {
      t: t,
      workspaceId: selectedProjectId,
      gitReady: worktreesGitReady,
      revision: worktreeRevision,
      activeCommitTask: activeCommitTask,
      openTargets: openTargets,
      showToast: showToast,
      onCommitTask: onWorktreeCommitTask,
      onOpenRequirement: openRequirementFromCommit,
      onGoRequirements() { selectTab('requirements') },
      onOpenCommitPreview: openCommitPreview,
      onChanged() {
        refreshWorktrees()
        loadState().catch(function () {})
      },
    })
  } else if (activeTab === 'reviews') {
    tabContent = h('div', { className: 'devbench-tab-flush-inner' }, overviewGate(function (data) {
      const selectedReview = (data.reviews || []).find(function (review) {
        return review.name === currentReviewName
      }) || currentReviewContent.meta || null
      return h(ProjectReviews, {
        t: t, reviews: data.reviews || [],
        selectedName: currentReviewName,
        selectedReview: selectedReview,
        content: currentReviewContent,
        onOpen: openReview,
        onRetry() {
          const review = selectedReviewName !== ''
            ? { name: selectedReviewName }
            : (data.reviews || [])[0]
          if (review) loadReviewContent(review).catch(function () {})
        },
      })
    }, true))
  } else {
    let tasksContent
    if (tasksState.error) {
      tasksContent = h('div', { style: { padding: '16px 18px' } },
        h(Banner, { kind: 'error' }, tasksState.error),
        h('button', { className: 'devbench-btn', onClick() { loadTasks(selectedProjectId).catch(function () {}) } }, t('panel.retry')))
    } else if (tasksState.loading && effectiveTaskList.length === 0) {
      tasksContent = h('div', { className: 'devbench-inline-loading' }, t('project.loadingTasks'))
    } else {
      tasksContent = h(ProjectTasks, {
        t: t, tasks: effectiveTaskList, busyKey: taskBusyKey,
        onOpenSession: openTaskSession,
        onCancel(task) { runTaskAction(task, 'cancel') },
        onRetry(task) { runTaskAction(task, 'retry') },
      })
    }
    tabContent = tasksContent
  }
  const isMasterTab = MASTER_TABS.indexOf(activeTab) >= 0
  const tabBody = isMasterTab
    ? h('div', { className: 'devbench-tab-flush' }, tabContent)
    : h('div', { className: 'devbench-tab-body' }, tabContent)
  const commitNotice = awaitingCommitTask !== null && commitModal === null && ui.view === 'project'
    ? h('div', { className: 'devbench-notice' },
      h('span', { className: 'devbench-pill awaiting_confirmation' }, t('status.awaiting_confirmation')),
      h('span', { className: 'devbench-hint', title: awaitingCommitTask.commitSubject || awaitingCommitTask.proposedMessage || '' },
        t('project.commit.notice') + (awaitingCommitTask.commitShort ? ' · ' + awaitingCommitTask.commitShort : '')),
      h('button', {
        className: 'devbench-btn primary',
        onClick() { openCommitPreview(awaitingCommitTask) },
      }, t('project.commit.notice.action')))
    : null
  function simpleBreadcrumb(label) {
    return [
      { label: t('breadcrumb.workbench'), onClick: openHome },
      { label: label, current: true },
    ]
  }
  let mainPane
  if (ui.view === 'settings') {
    mainPane = h('div', { className: 'devbench-page devbench-workbench-main' },
      h('div', { className: 'devbench-page-head' },
        h(Breadcrumb, { t: t, items: simpleBreadcrumb(t('breadcrumb.settings')) })),
      h('div', { className: 'devbench-tab-body' },
        h(SettingsView, {
          data: state.data, t: t, reload: loadState, showToast: showToast,
          runtimeCtx: getRuntimeContext(), onBack: backToProject,
        })))
  } else if (ui.view === 'link') {
    mainPane = h('div', { className: 'devbench-page devbench-workbench-main' },
      h('div', { className: 'devbench-page-head' },
        h(Breadcrumb, { t: t, items: simpleBreadcrumb(t('breadcrumb.link')) })),
      h('div', { className: 'devbench-tab-body' },
        h(LinkView, {
          data: state.data, t: t, linking: linkBusy,
          sessionId: ui.linkSessionId,
          onPick: linkSessionToRequirement, onCancel: backToProject,
        })))
  } else if (ui.view === 'home') {
    mainPane = h('div', { className: 'devbench-page devbench-workbench-main' },
      h('div', { className: 'devbench-page-head' },
        h(Breadcrumb, { t: t, items: simpleBreadcrumb(t('home.title')) })),
      h('div', { className: 'devbench-tab-body' },
        h(HomeView, {
          t: t, stateData: state.data,
          onOpenProject: selectProject,
          onOpenSession: openTaskSession,
          onOpenSettings: openSettings,
          onOpenMcp: openMcp,
          showToast: showToast,
          useSessions: props.useSessions,
        })))
  } else if (ui.view === 'mcp') {
    mainPane = h('div', { className: 'devbench-page devbench-workbench-main' },
      h('div', { className: 'devbench-page-head' },
        h(Breadcrumb, { t: t, items: simpleBreadcrumb(t('breadcrumb.mcp')) })),
      h('div', { className: 'devbench-tab-body' },
        h(McpView, { t: t, showToast: showToast })))
  } else if (currentWorkspace === null) {
    mainPane = h('div', { className: 'devbench-page devbench-workbench-main' },
      h('div', { className: 'devbench-page-head' },
        h(Breadcrumb, { t: t, items: simpleBreadcrumb(t('breadcrumb.project')) })),
      h('div', { className: 'devbench-tab-body' },
        h('div', { className: 'devbench-empty-panel', style: { marginTop: '40px' } }, t('project.selectHint'))))
  } else {
    const projectBreadcrumb = [
      { label: t('breadcrumb.workbench'), onClick: openHome },
      { label: projectTitle, onClick() { selectTab('overview') } },
      { label: t(TAB_LABEL_KEYS[activeTab] || 'project.tab.overview'), current: true },
    ]
    mainPane = h('div', { className: 'devbench-page devbench-workbench-main' },
      h('div', { className: 'devbench-page-head' },
        h(Breadcrumb, { t: t, items: projectBreadcrumb }),
        h('div', { className: 'devbench-project-header devbench-page-title-row' },
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'devbench-page-title', title: projectTitle }, projectTitle),
            h('div', { className: 'devbench-page-meta' },
              h('span', { className: 'devbench-mono', title: projectPath }, projectPath),
              runningCount > 0
                ? h('span', { className: 'devbench-pill running' }, t('project.tasks.activeCount', { count: runningCount }))
                : null,
              gitStatus)),
          h('div', { className: 'devbench-page-actions' },
            (openTargets.length > 0 ? openTargets : ['system']).map(function (target) {
              const Icon = OPEN_TARGET_ICONS[target]
              if (Icon === undefined) return null
              return h('button', {
                key: 'open-' + target,
                className: 'devbench-icon-btn' + (openTargetBusy === target ? ' active' : ''),
                title: t('project.open.' + target),
                'aria-label': t('project.open.' + target),
                disabled: openTargetBusy !== '',
                onClick() { openProjectTarget(target) },
              }, h(Icon, { size: 15 }))
            }),
            h('button', { className: 'devbench-icon-btn', title: t('project.refresh'), onClick: refreshAll },
              h(IconRefresh, { size: 15 })))),
        tabs),
      commitNotice,
      state.error ? h('div', { style: { padding: '8px 18px 0' } }, h(Banner, { kind: 'error' }, state.error)) : null,
      tabBody)
  }
  const commitModalElement = h(CommitConfirmModal, {
    t: t, modal: commitModal,
    projectTitle: projectTitle,
    projectPath: projectPath,
    branch: overviewGit.branch || '',
    onChangeMessage: changeCommitMessage,
    onConfirm: confirmCommit,
    onClose: closeCommitModal,
    onCancelTask: cancelCommitTask,
  })
  let content
  if (state.loading && state.data === null) {
    content = h('div', { className: 'devbench-root' },
      h(Styles), h('div', { className: 'devbench-loading' }, t('panel.loading')))
  } else if (state.error && state.data === null) {
    content = h('div', { className: 'devbench-root' },
      h(Styles),
      h('div', { style: { padding: '30px' } },
        h(Banner, { kind: 'error' }, state.error),
        h('button', { className: 'devbench-btn', onClick: refreshAll }, t('panel.retry'))))
  } else {
    content = h('div', { className: 'devbench-workbench' },
      h(Styles),
      h(ProjectSidebar, {
        t: t, projects: projects,
        selectedProjectId: selectedProjectId,
        view: ui.view,
        adding: addBusy, addError: addError,
        onSelect: selectProject, onAdd: addProject, onRefresh: refreshAll, onSettings: openSettings,
        onHome: openHome,
      }),
      mainPane)
  }
  return h(getFragment(), null, content, commitModalElement,
    h(ToastHost, { key: 'toasts' }),
    h(DialogHost, { key: 'dialogs', t: t }))
}
