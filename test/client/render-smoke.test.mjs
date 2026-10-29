import test from 'node:test'
import assert from 'node:assert/strict'
import { initRuntime } from '../../src/client/runtime.js'
import { uiStore, setSelection, setListState, resetListState } from '../../src/client/core/ui-store.js'
import { WelcomeView } from '../../src/client/views/welcome.js'
import { SettingsView } from '../../src/client/views/settings.js'
import { LinkView } from '../../src/client/views/link.js'
import { DetailView } from '../../src/client/views/project/requirement-detail.js'
import { FileTree } from '../../src/client/ui/file-tree.js'
import { SessionRow } from '../../src/client/ui/session-row.js'
import { SessionRequirementAction } from '../../src/client/views/project/session-action.js'
import { RequirementsPage } from '../../src/client/views/requirements-page.js'
import { ProjectSidebar } from '../../src/client/views/project/sidebar.js'
import { ProjectOverview } from '../../src/client/views/project/overview.js'
import { ProjectCommits } from '../../src/client/views/project/commits.js'
import { WorkspaceChangesPanel } from '../../src/client/views/project/workspace-changes.js'
import { ProjectWorktrees } from '../../src/client/views/project/worktrees.js'
import { ProjectReviews } from '../../src/client/views/project/reviews.js'
import { ProjectTasks } from '../../src/client/views/project/tasks.js'
import {
  ProjectRequirements, titleMatches, mergeSearchItems, createFullTextSearch,
} from '../../src/client/views/project/requirements.js'
import { CommitConfirmModal } from '../../src/client/ui/commit-confirm-modal.js'
import { CommitDiffBrowser, buildCommitFileTree } from '../../src/client/ui/commit-diff-browser.js'
import { HomeView, HomeTaskRow, HomeRunningRow } from '../../src/client/views/home.js'
import { closeDialog } from '../../src/client/ui/dialogs.js'
import { DevbenchIcon, IconReq } from '../../src/client/ui/icons.js'
import { CSS } from '../../src/client/ui/styles.js'
const instances = new Map()
let current = null
let hookIndex = 0
function slot(init) {
  const index = hookIndex++
  if (!(index in current.hooks)) current.hooks[index] = init()
  return current.hooks[index]
}
const React = {
  Fragment: 'Fragment',
  createElement(type, props) {
    return { type: type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
  },
  useState(initial) {
    const item = slot(function () { return { value: initial } })
    function setValue(next) {
      item.value = typeof next === 'function' ? next(item.value) : next
    }
    return [item.value, setValue]
  },
  useRef(initial) { return slot(function () { return { current: initial } }) },
  useEffect(fn, deps) { slot(function () { return { fn: fn, deps: deps } }) },
  useCallback(fn, deps) {
    const item = slot(function () { return { fn: fn, deps: deps } })
    const same = item.deps && deps && item.deps.length === deps.length &&
      item.deps.every(function (value, index) { return Object.is(value, deps[index]) })
    if (!same) { item.fn = fn; item.deps = deps }
    return item.fn
  },
  useSyncExternalStore(subscribe, snapshot) { slot(function () { return {} }); return snapshot() },
}
initRuntime(function () { return React })
function renderNode(node, path, out) {
  if (node === null || node === undefined || node === false || node === true) return
  if (Array.isArray(node)) {
    node.forEach(function (child, index) { renderNode(child, path + '.' + index, out) })
    return
  }
  if (typeof node !== 'object') return
  if (typeof node.type === 'function') {
    const key = path + ':' + (node.props && node.props.key ? node.props.key : '')
    let instance = instances.get(key)
    if (!instance) { instance = { hooks: [] }; instances.set(key, instance) }
    const merged = Object.assign({}, node.props)
    if (node.children.length === 1) merged.children = node.children[0]
    else if (node.children.length > 1) merged.children = node.children
    const previous = current
    current = instance
    hookIndex = 0
    const rendered = node.type(merged)
    current = previous
    renderNode(rendered, key, out)
    return
  }
  out.push(node)
  if (!Array.isArray(node.children)) return
  node.children.forEach(function (child, index) { renderNode(child, path + '.' + index, out) })
}
function render(element) {
  const out = []
  renderNode(element, 'root', out)
  return out
}
function textOf(value, out) {
  const list = out || []
  if (Array.isArray(value)) {
    value.forEach(function (item) { textOf(item, list) })
    return list
  }
  if (typeof value === 'string') { list.push(value); return list }
  if (value && typeof value === 'object') {
    list.push.apply(list, textOf(value.children, []))
  }
  return list
}
/** Seeds the ProjectDevbenchPage hook slots by index; view state lives in uiStore. */
function seedDevbenchInstance() {
  const instance = { hooks: [] }
  instance.hooks[0] = {}
  instance.hooks[1] = { value: { data: stateData, loading: false, error: '' } }
  instance.hooks[2] = { value: { loading: false, error: '', data: overviewData, key: 'w1' } }
  instance.hooks[3] = { value: { loading: false, error: '', data: [taskData], key: 'w1' } }
  instance.hooks[4] = { value: { loading: false, error: '', data: null, name: '', key: 'w1' } }
  instance.hooks[5] = { value: '' }
  instance.hooks[6] = { value: false }
  instance.hooks[7] = { value: '' }
  instance.hooks[8] = { value: false }
  instance.hooks[9] = { value: '' }
  instance.hooks[10] = { value: '' }
  instance.hooks[11] = { value: false }
  instance.hooks[12] = { value: false }
  instance.hooks[13] = { value: null }
  instance.hooks[14] = { value: 0 }
  instance.hooks[15] = { value: [] }
  instance.hooks[16] = { value: '' }
  // REQ-20261027-003: reviewingUncommitted busy state (empty = idle); declared
  // after the 16 useState and 17 useRef legacy hooks above.
  instance.hooks[34] = { value: '' }
  instances.set('root:', instance)
  return instance
}
function worktreeProps(overrides) {
  return Object.assign({
    t: t, workspaceId: 'w1', gitReady: true, revision: 0,
    showToast: noop, onCommitTask: noop, activeCommitTask: null,
    openTargets: ['system'], onOpenRequirement: noop, onGoRequirements: noop,
    onOpenCommitPreview: noop, onChanged: noop,
  }, overrides)
}
function seedWorktreesHooks(options) {
  const opts = options || {}
  const instance = { hooks: [] }
  // Hook order of the master-detail worktree tab:
  // state, changesState, changesOpen, busy, pruneBusy, refs..., useUiState, useListPage, effects...
  instance.hooks[0] = {
    value: opts.list || { loading: false, error: '', data: worktreesData, key: 'w1' },
  }
  instance.hooks[1] = {
    value: opts.changes || { loading: false, error: '', data: null, key: '' },
  }
  instance.hooks[2] = { value: opts.expanded !== undefined && opts.expanded !== '' && opts.expanded !== false }
  instance.hooks[3] = { value: opts.busy || {} }
  instance.hooks[4] = { value: opts.pruneBusy === true }
  instances.set('root:', instance)
  return instance
}
function workspaceChangesProps(overrides) {
  return Object.assign({
    t: t, workspaceId: 'w1', revision: 0, activeCommitTask: null,
    onChanged: noop, showToast: noop,
  }, overrides)
}
function seedWorkspaceChangesHooks(options, instanceKey) {
  const opts = options || {}
  const instance = { hooks: [] }
  // Hook order of the working-tree panel (REQ-20261028-003 moved it from the
  // commits tab to the overview tab; hook order is unchanged):
  // 0 state, 1 busy, 2 commitOpen, 3 message, 4 committing, 5 showDiff,
  // 6 collapsed, 7 request seq ref, 8 project ref, 9 load effect (not seeded).
  instance.hooks[0] = {
    value: opts.state || {
      loading: opts.loading === true,
      error: opts.error || '',
      data: opts.data === undefined ? workspaceChangesData : opts.data,
      key: 'w1',
    },
  }
  instance.hooks[1] = { value: opts.busy || '' }
  instance.hooks[2] = { value: opts.commitOpen === true }
  instance.hooks[3] = { value: opts.message || '' }
  instance.hooks[4] = { value: opts.committing === true }
  instance.hooks[5] = { value: opts.showDiff === true }
  instance.hooks[6] = { value: opts.collapsed === true }
  instance.hooks[7] = { current: 0 }
  instance.hooks[8] = { current: 'w1' }
  instances.set(instanceKey || 'root:', instance)
  return instance
}
const summary = {
  id: 'REQ-1', title: 'Sample', status: 'new', workspaceId: 'w1',
  path: '/tmp/root/w1/REQ-1/requirement.md',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', sessions: [],
}
const stateData = {
  rootDir: '/tmp/root', configured: true,
  git: { initialized: true, available: true },
  config: { promptTemplate: '' },
  workspaces: [{ workspaceId: 'w1', title: 'Workspace', path: '/tmp/w1', requirements: [summary], activeTaskCount: 1 }],
}
const detailData = { requirement: summary, body: '# Title\n\nBody', git: { initialized: true }, files: [], gitLog: [] }
const projectData = {
  workspaceId: 'w1', title: 'Workspace', path: '/tmp/w1',
  canonicalPath: '/tmp/w1', missingPath: false, requirementsCount: 1,
}
const commitData = {
  hash: 'aaaaaaaaaaaaaaaa', short: 'aaaaaaa', subject: 'feat: sample',
  authorName: 'A', authorEmail: 'a@example.com', date: '2026-01-01T00:00:00.000Z',
  parents: [], reviewed: false, reviewName: null,
}
const reviewData = {
  name: '20260101-review.md', size: 10, modifiedAt: '2026-01-01T00:00:00.000Z',
  commit: commitData.hash, commitSubject: commitData.subject, summary: 'ok',
}
const taskData = {
  id: 't1', kind: 'commit', status: 'awaiting_confirmation', workspaceId: 'w1',
  projectTitle: 'Workspace', projectPath: '/tmp/w1', sessionId: 's1',
  changedFiles: ['a.js'], proposedMessage: 'feat: sample', commitHash: null,
  commitShort: null, commitSubject: null, reviewFile: null, error: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}
const overviewData = {
  project: projectData,
  git: { available: true, initialized: true, branch: 'main', head: commitData.hash, changes: [{ path: 'a.js', status: 'M' }] },
  commits: [commitData], reviews: [reviewData], tasks: [taskData],
}
const worktreeRowData = {
  requirementId: 'REQ-1', title: 'Sample requirement', status: 'running',
  path: '/Users/me/.dsh-devbench/worktrees/w1-REQ-1',
  branch: 'devbench/REQ-1', base: 'main', exists: true,
  dirty: true, changesCount: 2, ahead: 1, behind: 0,
  lastCommit: {
    hash: 'bbbbbbbbbbbbbbbb', short: 'bbbbbbb', subject: 'feat: worktree change',
    date: '2026-01-01T00:00:00.000Z',
  },
  upstream: null, remote: 'origin',
}
const worktreesData = {
  git: { available: true, initialized: true },
  defaultRoot: '/Users/me/.dsh-devbench/worktrees',
  remote: 'origin',
  worktrees: [worktreeRowData],
}
const worktreeChangesData = {
  worktree: worktreeRowData, hasChanges: true,
  changedFiles: ['src/a.js', 'src/b.js'],
  files: [{ path: 'src/a.js', status: 'M' }, { path: 'src/b.js', status: '??' }],
  diffText: 'diff --git a/src/a.js b/src/a.js\n+added line',
  truncated: true, head: 'bbbbbbbbbbbbbbbb', branch: 'devbench/REQ-1',
}
// REQ-20261027-004: `GET /project/changes` snapshot for the commits tab panel.
const workspaceChangesData = {
  initialized: true, branch: 'main', head: 'dddddddddddddddd', detached: false,
  statusKnown: true, hasChanges: true,
  files: [
    { path: 'src/a.js', from: '', status: 'M' },
    { path: 'src/new name.js', from: 'src/old name.js', status: 'R' },
  ],
  changedFiles: ['src/new name.js', 'src/a.js'],
  diffText: 'STAGED DIFF:\nM  src/a.js\n\nUNSTAGED DIFF:\n\nUNTRACKED FILES:\n',
  truncated: false,
  remotes: ['origin'], remote: 'origin',
  upstream: { remote: 'origin', branch: 'main', ahead: 2, behind: 1 },
  ahead: 2, behind: 1, aheadKnown: true, behindKnown: true,
}
const worktreeCommitTask = Object.assign({}, taskData, {
  id: 'wt1', status: 'awaiting_confirmation',
  worktreePath: worktreeRowData.path, worktreeBranch: worktreeRowData.branch, requirementId: 'REQ-1',
})
const noop = function () {}
const t = function (key) { return key }
/** Ready session list snapshot used by row existence checks. */
const sessionsSnapshot = {
  phase: 'ready',
  ids: ['s1', 'session-1'],
  byId: { s1: { id: 's1', title: 'Task session' }, 'session-1': { id: 'session-1', title: 'Requirement session' } },
}
function fakeUseSessions(selector) { return selector(sessionsSnapshot) }
function pendingUseSessions(selector) {
  return selector({ phase: 'pending', ids: [], byId: {} })
}
test('all client views render once without undefined references', function () {
  const views = [
    WelcomeView,
    SettingsView,
    LinkView,
    DetailView,
    FileTree,
    SessionRow,
    SessionRequirementAction,
    RequirementsPage,
    ProjectSidebar,
    ProjectOverview,
    ProjectCommits,
    ProjectWorktrees,
    ProjectReviews,
    ProjectTasks,
    ProjectRequirements,
    CommitConfirmModal,
    HomeView,
  ]
  views.forEach(function (View) {
    const props = {
      t: t, data: stateData, showToast: noop, reload: function () { return Promise.resolve() },
      runtimeCtx: { uiWorkspace: { pickDirectory: function () { return Promise.resolve('') } } },
      linking: false, onPick: noop, onCancel: function () { return Promise.resolve() },
      selected: { workspaceId: 'w1', id: 'REQ-1' }, summary: summary,
      detail: { loading: false, error: '', data: detailData, key: 'w1/REQ-1' },
      onBack: noop, onExecute: function () { return Promise.resolve() },
      onReloadDetail: function () { return Promise.resolve() }, onReloadState: function () { return Promise.resolve() },
      onOpenSession: noop, onUnlinkSession: noop,
      workspaceId: 'w1', requirementId: 'REQ-1', revision: 0,
      rootEntries: [{ path: 'docs', name: 'docs', type: 'dir' }], loading: false, error: '',
      onDelete: noop, onReloadRoot: noop, onBusyChange: noop,
      sessionId: 's1', useSessions: undefined,
      projects: stateData.workspaces, selectedProjectId: 'w1', onSelect: noop, onAdd: noop,
      adding: false, addError: '', onRefresh: noop,
      overview: { loading: false, error: '', data: overviewData, key: 'w1' },
      tasks: [taskData], taskList: [taskData], workspace: stateData.workspaces[0],
      configured: true, commits: [commitData], reviews: [reviewData],
      reviewingCommit: '', selectedName: reviewData.name, selectedReview: reviewData,
      content: { loading: false, error: '', data: { name: reviewData.name, content: '# Review' } },
      onReview: noop, onOpen: noop, onRetry: noop, onViewTab: noop, onOpenReview: noop,
      onCancelTask: noop, onRetryTask: noop, busyKey: '',
      modal: { task: taskData, message: 'feat: sample', busy: false, cancelling: false, error: '' },
      onChangeMessage: noop, onConfirm: noop,
      stateData: stateData, onOpenProject: noop, onOpenSettings: noop,
    }
    instances.clear()
    const nodes = render({ type: View, props: props, children: [] })
    assert.equal(nodes.length > 0, true)
  })
})

test('project workbench renders every workspace tab', function () {
  uiStore.set({
    view: 'project', selectedProjectId: 'w1', selectedRequirement: null, activeTab: 'overview',
  })
  instances.clear()
  seedDevbenchInstance()
  const tabs = ['overview', 'requirements', 'commits', 'worktrees', 'reviews', 'tasks']
  tabs.forEach(function (tab) {
    uiStore.set({ activeTab: tab })
    const nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
    const frame = nodes.find(function (node) { return node.props && node.props.className === 'devbench-workbench' })
    assert.equal(Boolean(frame), true)
    // Two-column workbench: style tag + project sidebar + main pane, no right rail.
    assert.equal(frame.children.length, 3)
    assert.equal(nodes.some(function (node) { return node.props && String(node.props.className || '').indexOf('devbench-workbench-main') >= 0 }), true)
    assert.equal(nodes.some(function (node) { return node.props && node.props.className === 'devbench-rail' }), false)
    if (tab === 'overview') {
      assert.equal(nodes.some(function (node) {
        return node.type === 'button' && node.props && node.props.disabled === true &&
          textOf(node, []).join(' ').indexOf('project.ai.commitActive') >= 0
      }), true)
    }
  })
  uiStore.set({ activeTab: 'overview' })
  const nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
  const tabBar = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-project-tabs'
  })
  const tabText = textOf(tabBar, []).join(' ')
  const commitsIndex = tabText.indexOf('project.tab.commits')
  const worktreesIndex = tabText.indexOf('project.tab.worktrees')
  const reviewsIndex = tabText.indexOf('project.tab.reviews')
  assert.equal(worktreesIndex > commitsIndex, true)
  assert.equal(reviewsIndex > worktreesIndex, true)
  assert.equal(tabText.indexOf('project.tab.tasks') > reviewsIndex, true)
})
test('workbench disables the review action when the repository has no commit', function () {
  uiStore.set({
    view: 'project', selectedProjectId: 'w1', selectedRequirement: null, activeTab: 'overview',
  })
  instances.clear()
  const instance = seedDevbenchInstance()
  instance.hooks[2] = {
    value: {
      loading: false, error: '', key: 'w1',
      data: Object.assign({}, overviewData, { commits: [] }),
    },
  }
  const nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
  const reviewButton = nodes.find(function (node) {
    return node.type === 'button' && textOf(node, []).join(' ').indexOf('project.ai.reviewLatest') >= 0
  })
  assert.equal(Boolean(reviewButton), true)
  assert.equal(reviewButton.props.disabled, true)
  assert.equal(textOf(nodes, []).join(' ').indexOf('project.ai.noCommit') >= 0, true)
})
test('review preview falls back to list metadata and sidebar exposes settings', function () {
  instances.clear()
  const reviewNodes = render({
    type: ProjectReviews,
    props: {
      t: t, reviews: [reviewData], selectedName: reviewData.name, selectedReview: reviewData,
      content: { loading: false, error: '', data: { name: reviewData.name, content: '# Review' } },
      onOpen: noop, onRetry: noop,
    },
    children: [],
  })
  const reviewText = textOf(reviewNodes, []).join(' ')
  assert.equal(reviewText.indexOf('aaaaaaaa') >= 0, true)
  assert.equal(reviewText.indexOf('feat: sample') >= 0, true)
  assert.equal(reviewText.indexOf('10 B') >= 0, true)
  instances.clear()
  const sidebarNodes = render({
    type: ProjectSidebar,
    props: {
      t: t, projects: stateData.workspaces, selectedProjectId: 'w1',
      adding: false, addError: '', onSelect: noop, onAdd: noop, onRefresh: noop, onSettings: noop,
    },
    children: [],
  })
  assert.equal(sidebarNodes.some(function (node) {
    return node.props && node.props.title === 'panel.settings'
  }), true)
  assert.equal(sidebarNodes.some(function (node) {
    return node.props && node.props.className === 'devbench-project-activity-dot'
  }), true)
})

test('project reviews label uncommitted targets in the list, detail and search', function () {
  const uncommittedReview = {
    name: '20260102-uncommitted-review.md', size: 20,
    modifiedAt: '2026-01-02T00:00:00.000Z', commit: '', commitSubject: '',
    target: 'uncommitted', summary: 'working tree',
  }
  function renderReviews(selectedName, selectedReview, content) {
    instances.clear()
    return render({
      type: ProjectReviews,
      props: {
        t: t, reviews: [reviewData, uncommittedReview], selectedName: selectedName,
        selectedReview: selectedReview, content: content, onOpen: noop, onRetry: noop,
      },
      children: [],
    })
  }
  function masterRows(nodes) {
    return nodes.filter(function (node) {
      const tokens = String(node.props && node.props.className || '').split(/\s+/)
      return node.type === 'div' && tokens.indexOf('devbench-master-row') >= 0
    })
  }
  let nodes = renderReviews('', null, { loading: false, error: '', data: null })
  let rows = masterRows(nodes)
  assert.equal(rows.length, 2)
  assert.equal(textOf(rows[0], []).join(' ').indexOf('project.review.uncommittedTarget') >= 0, false)
  assert.equal(textOf(rows[1], []).join(' ').indexOf('project.review.uncommittedTarget') >= 0, true)

  // Searching for the uncommitted target text keeps only that review.
  setListState('reviews', { search: 'project.review.uncommitted' })
  nodes = renderReviews(
    uncommittedReview.name,
    uncommittedReview,
    {
      loading: false, error: '',
      data: {
        name: uncommittedReview.name, content: '# Review', target: 'uncommitted',
        commit: '', commitSubject: '',
      },
    },
  )
  rows = masterRows(nodes)
  assert.equal(rows.length, 1)
  assert.equal(textOf(rows[0], []).join(' ').indexOf('project.review.uncommittedTarget') >= 0, true)
  const detail = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-master-detail'
  })
  assert.equal(Boolean(detail), true)
  const detailText = textOf(detail, []).join(' ')
  assert.equal(detailText.indexOf('project.review.uncommittedTarget') >= 0, true)
  setListState('reviews', { search: '' })
  instances.clear()
})
test('requirement list exposes delete only for non-running requirements', function () {
  uiStore.set({
    view: 'project', selectedProjectId: 'w1', selectedRequirement: null,
    activeTab: 'requirements',
  })
  instances.clear()
  const props = {
    t: t,
    configured: true,
    workspace: stateData.workspaces[0],
    onReloadState: function () { return Promise.resolve() },
    showToast: noop,
  }
  let nodes = render({ type: ProjectRequirements, props: props, children: [] })
  let deleteButton = nodes.find(function (node) {
    return node.type === 'button' && node.props && node.props.title === 'project.requirements.delete'
  })
  assert.equal(Boolean(deleteButton), true)
  assert.equal(deleteButton.props.disabled, false)

  instances.clear()
  const runningWorkspace = Object.assign({}, stateData.workspaces[0], {
    requirements: [Object.assign({}, summary, { status: 'running' })],
  })
  nodes = render({
    type: ProjectRequirements,
    props: Object.assign({}, props, { workspace: runningWorkspace }),
    children: [],
  })
  deleteButton = nodes.find(function (node) {
    return node.type === 'button' && node.props && node.props.title === 'delete.requirement.running'
  })
  assert.equal(Boolean(deleteButton), true)
  assert.equal(deleteButton.props.disabled, true)
})

/** Props shared by the requirement-list search tests (REQ-20261028-001). */
function requirementListProps(overrides) {
  return Object.assign({
    t: t,
    configured: true,
    workspace: stateData.workspaces[0],
    onReloadState: function () { return Promise.resolve() },
    showToast: noop,
  }, overrides)
}
const searchWorkspace = Object.assign({}, stateData.workspaces[0], {
  requirements: [
    summary,
    Object.assign({}, summary, {
      id: 'REQ-2', title: 'Second requirement', status: 'running',
      updatedAt: '2026-01-03T00:00:00.000Z', sessions: [{ id: 's2' }],
    }),
  ],
})
const bodySearchHit = {
  id: 'REQ-2', title: 'Second requirement', status: 'running',
  updatedAt: '2026-01-03T00:00:00.000Z', worktree: false,
  match: { field: 'body', snippet: '…正文中出现的 needle 上下文…' },
}
const titleSearchHit = {
  id: 'REQ-1', title: 'Sample', status: 'new',
  updatedAt: '2026-01-02T00:00:00.000Z', worktree: false,
  match: { field: 'title', snippet: '' },
}
function requirementFullSearchState(overrides) {
  return Object.assign({
    scope: 'full', query: 'needle', loading: false, error: '',
    items: [], hasMore: false, total: 0,
  }, overrides)
}
/** Render once to allocate the hooks, then seed the full-text result state slot. */
function renderRequirementsWithFullSearch(props, state) {
  instances.clear()
  render({ type: ProjectRequirements, props: props, children: [] })
  const instance = instances.get('root:')
  const index = instance.hooks.findIndex(function (hook) {
    return hook && hook.value && typeof hook.value === 'object' &&
      typeof hook.value.scope === 'string' && Array.isArray(hook.value.items)
  })
  assert.equal(index >= 0, true)
  instance.hooks[index].value = state
  return render({ type: ProjectRequirements, props: props, children: [] })
}
function fakeTimers() {
  let nextId = 1
  const pending = new Map()
  return {
    setTimeout(fn, delay) {
      const id = nextId
      nextId += 1
      pending.set(id, { fn: fn, delay: delay })
      return id
    },
    clearTimeout(id) { pending.delete(id) },
    pending() { return pending.size },
    delays() {
      return Array.from(pending.values()).map(function (item) { return item.delay })
    },
    run() {
      const items = Array.from(pending.values())
      pending.clear()
      items.forEach(function (item) { item.fn() })
    },
  }
}
function flushMicrotasks() {
  return new Promise(function (resolve) { setImmediate(resolve) })
}
test('requirement search row offers a title/full scope selector and persists the switch', function () {
  try {
    resetListState('requirements')
    uiStore.set({
      view: 'project', selectedProjectId: 'w1', selectedRequirement: null,
      activeTab: 'requirements',
    })
    instances.clear()
    const props = requirementListProps()
    let nodes = render({ type: ProjectRequirements, props: props, children: [] })
    const scopeSelects = nodes.filter(function (node) {
      return node.type === 'select' && node.props['aria-label'] === 'project.requirements.search.scope'
    })
    assert.equal(scopeSelects.length, 1)
    const scopeSelect = scopeSelects[0]
    assert.equal(scopeSelect.props.value, 'title')
    assert.equal(scopeSelect.props.title, 'project.requirements.search.scope')
    const options = scopeSelect.children[0]
    assert.deepEqual(options.map(function (option) { return option.props.value }), ['title', 'full'])
    assert.deepEqual(options.map(function (option) { return textOf(option, []).join(' ') }),
      ['project.requirements.search.title', 'project.requirements.search.full'])
    // 搜索框与状态筛选仍在同一行。
    assert.equal(nodes.some(function (node) {
      return node.type === 'input' && node.props['aria-label'] === 'project.requirements.search'
    }), true)
    assert.equal(nodes.some(function (node) {
      return node.type === 'select' && node.props['aria-label'] === 'detail.list.filterStatus'
    }), true)
    scopeSelect.props.onChange({ target: { value: 'full' } })
    assert.equal(uiStore.state.lists.requirements.scope, 'full')
    assert.equal(uiStore.state.lists.requirements.limit, 10)
    nodes = render({ type: ProjectRequirements, props: props, children: [] })
    const switched = nodes.filter(function (node) {
      return node.type === 'select' && node.props['aria-label'] === 'project.requirements.search.scope'
    })[0]
    assert.equal(switched.props.value, 'full')
  } finally {
    resetListState('requirements')
  }
})
test('title scope keeps local filtering and never hits the search endpoint', function () {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async function () { calls += 1; throw new Error('unexpected request') }
  try {
    resetListState('requirements')
    uiStore.set({
      view: 'project', selectedProjectId: 'w1', selectedRequirement: null,
      activeTab: 'requirements',
    })
    setListState('requirements', { scope: 'title', search: 'sample' })
    instances.clear()
    const props = requirementListProps({ workspace: searchWorkspace })
    const nodes = render({ type: ProjectRequirements, props: props, children: [] })
    assert.equal(dataRows(nodes).length, 1)
    const instance = instances.get('root:')
    const effectIndex = instance.hooks.findIndex(function (hook) {
      return hook && typeof hook.fn === 'function' && Array.isArray(hook.deps) && hook.deps.length === 3
    })
    assert.equal(effectIndex >= 0, true)
    assert.equal(instance.hooks[effectIndex].fn(), undefined)
    const searchIndex = instance.hooks.findIndex(function (hook) {
      return hook && hook.current && typeof hook.current.pending === 'function'
    })
    assert.equal(instance.hooks[searchIndex].current.pending(), false)
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
    resetListState('requirements')
  }
})
test('full scope renders seeded hits with snippets, hasMore and the status filter', function () {
  try {
    resetListState('requirements')
    uiStore.set({
      view: 'project', selectedProjectId: 'w1', selectedRequirement: null,
      activeTab: 'requirements',
    })
    setListState('requirements', { scope: 'full', search: 'needle' })
    const props = requirementListProps({ workspace: searchWorkspace })
    let nodes = renderRequirementsWithFullSearch(props, requirementFullSearchState({
      items: [bodySearchHit, titleSearchHit], hasMore: true, total: 12,
    }))
    let rows = dataRows(nodes)
    assert.equal(rows.length, 2)
    assert.equal(textOf(rows[0], []).join(' ').indexOf('Second requirement') >= 0, true)
    const snippets = nodes.filter(function (node) {
      return node.props && node.props.className === 'devbench-master-row-snippet'
    })
    assert.equal(snippets.length, 1)
    assert.equal(snippets[0].props.title, bodySearchHit.match.snippet)
    assert.equal(textOf(snippets[0], []).join(' '), bodySearchHit.match.snippet)
    let text = textOf(nodes, []).join(' ')
    assert.equal(text.indexOf('project.requirements.search.hasMore') >= 0, true)
    assert.equal(text.indexOf('project.requirements.search.loading') >= 0, false)
    // 状态筛选继续在全文结果上生效。
    setListState('requirements', { status: 'new' })
    nodes = render({ type: ProjectRequirements, props: props, children: [] })
    rows = dataRows(nodes)
    assert.equal(rows.length, 1)
    assert.equal(textOf(rows[0], []).join(' ').indexOf('Sample') >= 0, true)
    setListState('requirements', { status: 'all' })
    // 加载中 / 失败 / 空结果沿用既有空态与重试入口。
    nodes = renderRequirementsWithFullSearch(props, requirementFullSearchState({ loading: true }))
    assert.equal(dataRows(nodes).length, 0)
    assert.equal(textOf(nodes, []).join(' ').indexOf('project.requirements.search.loading') >= 0, true)
    nodes = renderRequirementsWithFullSearch(props, requirementFullSearchState({ error: 'search failed' }))
    text = textOf(nodes, []).join(' ')
    assert.equal(text.indexOf('search failed') >= 0, true)
    assert.equal(text.indexOf('project.requirements.search.retry') >= 0, true)
    assert.equal(dataRows(nodes).length, 0)
    nodes = renderRequirementsWithFullSearch(props, requirementFullSearchState({ items: [] }))
    assert.equal(textOf(nodes, []).join(' ').indexOf('detail.list.emptyFilter') >= 0, true)
  } finally {
    resetListState('requirements')
  }
})
test('full scope retries a failed search on demand', async function () {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async function (url, init) {
    calls.push({ url: String(url), method: init.method })
    return {
      status: 200,
      json: async function () {
        return {
          ok: true,
          value: {
            query: 'needle', scope: 'full', total: 1, hasMore: false,
            items: [bodySearchHit],
          },
        }
      },
    }
  }
  try {
    resetListState('requirements')
    uiStore.set({
      view: 'project', selectedProjectId: 'w1', selectedRequirement: null,
      activeTab: 'requirements',
    })
    setListState('requirements', { scope: 'full', search: 'needle' })
    const props = requirementListProps({ workspace: searchWorkspace })
    let nodes = renderRequirementsWithFullSearch(props, requirementFullSearchState({
      loading: false, error: 'search failed',
    }))
    const retry = findButton(nodes, 'project.requirements.search.retry')
    assert.equal(Boolean(retry), true)
    await retry.props.onClick()
    await flushMicrotasks()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'GET')
    assert.equal(calls[0].url.indexOf('/requirement/search?') > 0, true)
    assert.equal(calls[0].url.indexOf('q=needle') > 0, true)
    assert.equal(calls[0].url.indexOf('scope=full') > 0, true)
    nodes = render({ type: ProjectRequirements, props: props, children: [] })
    assert.equal(dataRows(nodes).length, 1)
    assert.equal(textOf(nodes, []).join(' ').indexOf(bodySearchHit.match.snippet) >= 0, true)
  } finally {
    globalThis.fetch = originalFetch
    resetListState('requirements')
  }
})
test('full scope debounces the persisted query and searches again on mount', async function (t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const originalFetch = globalThis.fetch
  const calls = []
  const labels = []
  function trackingT(key, params) {
    if (params !== undefined) labels.push({ key: key, params: params })
    return key
  }
  globalThis.fetch = async function (url, init) {
    calls.push({ url: String(url), method: init.method })
    return {
      status: 200,
      json: async function () {
        return {
          ok: true,
          value: {
            query: 'needle', scope: 'full', total: 12, hasMore: true,
            items: [bodySearchHit],
          },
        }
      },
    }
  }
  try {
    resetListState('requirements')
    uiStore.set({
      view: 'project', selectedProjectId: 'w1', selectedRequirement: null,
      activeTab: 'requirements',
    })
    // 持久化的范围与关键词来自 uiStore：离开再返回时自动重新检索。
    setListState('requirements', { scope: 'full', search: '  needle  ' })
    instances.clear()
    const props = requirementListProps({ workspace: searchWorkspace, t: trackingT })
    let nodes = render({ type: ProjectRequirements, props: props, children: [] })
    assert.equal(textOf(nodes, []).join(' ').indexOf('project.requirements.search.loading') >= 0, true)
    assert.equal(calls.length, 0)
    const instance = instances.get('root:')
    const effectIndex = instance.hooks.findIndex(function (hook) {
      return hook && typeof hook.fn === 'function' && Array.isArray(hook.deps) && hook.deps.length === 3
    })
    const searchIndex = instance.hooks.findIndex(function (hook) {
      return hook && hook.current && typeof hook.current.pending === 'function'
    })
    const cleanup = instance.hooks[effectIndex].fn()
    assert.equal(typeof cleanup, 'function')
    assert.equal(instance.hooks[searchIndex].current.pending(), true)
    t.mock.timers.tick(249)
    await flushMicrotasks()
    assert.equal(calls.length, 0)
    t.mock.timers.tick(1)
    await flushMicrotasks()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'GET')
    assert.equal(calls[0].url.indexOf('/requirement/search?') > 0, true)
    assert.equal(calls[0].url.indexOf('workspaceId=w1') > 0, true)
    assert.equal(calls[0].url.indexOf('q=needle') > 0, true)
    assert.equal(calls[0].url.indexOf('scope=full') > 0, true)
    nodes = render({ type: ProjectRequirements, props: props, children: [] })
    assert.equal(dataRows(nodes).length, 1)
    assert.equal(textOf(nodes, []).join(' ').indexOf('project.requirements.search.loading') >= 0, false)
    assert.equal(labels.some(function (item) {
      return item.key === 'project.requirements.search.hasMore' && item.params.count === 1
    }), true)
    cleanup()
  } finally {
    globalThis.fetch = originalFetch
    t.mock.timers.reset()
    resetListState('requirements')
  }
})
test('full-text search controller debounces, drops stale responses and cancels', async function () {
  const timers = fakeTimers()
  const events = []
  const requests = []
  const controller = createFullTextSearch({
    delay: 250,
    timers: timers,
    onEvent: function (event) { events.push(event) },
    search: function (workspaceId, query) {
      return new Promise(function (resolve) {
        requests.push({ workspaceId: workspaceId, query: query, resolve: resolve })
      })
    },
  })
  controller.schedule('w1', ' nee ')
  controller.schedule('w1', 'needle')
  controller.schedule('w1', '   ')
  assert.equal(controller.pending(), false)
  controller.schedule('w1', 'needle ')
  assert.deepEqual(timers.delays(), [250])
  timers.run()
  assert.equal(controller.pending(), false)
  await flushMicrotasks()
  assert.deepEqual(requests.map(function (item) { return item.query }), ['needle'])
  // 新请求作废旧请求：旧响应被丢弃。
  const stalePromise = controller.run('w1', 'old')
  await flushMicrotasks()
  const freshPromise = controller.run('w1', 'new')
  await flushMicrotasks()
  assert.deepEqual(requests.map(function (item) { return item.query }), ['needle', 'old', 'new'])
  requests[2].resolve({ query: 'new', items: [{ id: 'REQ-2' }], hasMore: false, total: 1 })
  await freshPromise
  requests[1].resolve({ query: 'old', items: [{ id: 'REQ-1' }], hasMore: false, total: 1 })
  await stalePromise
  let successes = events.filter(function (event) { return event.type === 'success' })
  assert.equal(successes.length, 1)
  assert.equal(successes[0].query, 'new')
  // cancel 清掉防抖定时器并让在途响应失效。
  controller.schedule('w1', 'later')
  assert.equal(controller.pending(), true)
  controller.cancel()
  assert.equal(controller.pending(), false)
  timers.run()
  await flushMicrotasks()
  assert.equal(requests.length, 3)
  const cancelledPromise = controller.run('w1', 'cancelled')
  await flushMicrotasks()
  assert.equal(requests.length, 4)
  controller.cancel()
  requests[3].resolve({ items: [{ id: 'REQ-3' }], hasMore: false })
  await cancelledPromise
  successes = events.filter(function (event) { return event.type === 'success' })
  assert.equal(successes.length, 1)
})
test('requirement title filter and search result merge keep ids and hit order', function () {
  assert.equal(titleMatches({ id: 'REQ-1', title: 'Sample' }, 'sam'), true)
  assert.equal(titleMatches({ id: 'REQ-1', title: 'Sample' }, 'req-1'), true)
  assert.equal(titleMatches({ id: 'REQ-1', title: 'Sample' }, 'body'), false)
  assert.equal(titleMatches({ id: 'REQ-1', title: 'Sample' }, '   '), true)
  const local = [
    Object.assign({}, summary, { sessions: [{ id: 's1' }], path: '/tmp/root/w1/REQ-1/requirement.md' }),
  ]
  const merged = mergeSearchItems([
    { id: 'REQ-1', title: 'Sample', status: 'running', match: { field: 'body', snippet: 'x' } },
    { id: 'REQ-9', title: 'Remote only', match: { field: 'title', snippet: '' } },
    { id: 'REQ-1', title: 'duplicate' },
  ], local)
  assert.deepEqual(merged.map(function (item) { return item.id }), ['REQ-1', 'REQ-9'])
  assert.equal(merged[0].sessions[0].id, 's1')
  assert.equal(merged[0].path, '/tmp/root/w1/REQ-1/requirement.md')
  assert.equal(merged[0].status, 'running')
  assert.equal(merged[0].match.field, 'body')
  assert.equal(merged[1].title, 'Remote only')
})

const dashboardData = {
  generatedAt: '2026-01-02T00:00:00.000Z',
  week: { start: '2025-12-26T00:00:00.000Z', end: '2026-01-02T00:00:00.000Z' },
  totals: { projects: 1, requirements: 2, activeTasks: 1, tasksThisWeek: 3, runningRequirements: 1 },
  projects: [{ workspaceId: 'w1', title: 'Workspace', path: '/tmp/w1', requirementsCount: 2, activeTaskCount: 1, runningRequirementsCount: 1, missingPath: false }],
  recentTasks: [taskData, Object.assign({}, taskData, { id: 't2', kind: 'review', status: 'succeeded' })],
  activeTasks: [taskData],
  runningRequirements: [{ workspaceId: 'w1', projectTitle: 'Workspace', id: 'REQ-1', title: 'Sample', updatedAt: '2026-01-02T00:00:00.000Z', folder: '/tmp/root/w1/REQ-1' }],
}
const weeklyData = {
  generatedAt: '2026-01-02T00:00:00.000Z',
  days: 7,
  week: { start: '2025-12-26T00:00:00.000Z', end: '2026-01-02T00:00:00.000Z' },
  markdown: '# 工程周报\n\n## 总览\n\n- 提交：2 个',
  counts: { projects: 1, commits: 2, reviews: 1, tasks: 3, requirementsCreated: 1, requirementsUpdated: 1, runningRequirements: 1 },
  projects: [],
}
function seedHomeInstance(overrides) {
  instances.clear()
  const instance = { hooks: [] }
  instance.hooks[0] = { value: overrides.dashboard || { loading: false, error: '', data: null } }
  instance.hooks[1] = { value: overrides.weekly || { loading: false, error: '', data: null } }
  instance.hooks[2] = { value: { current: 0 } }
  instance.hooks[3] = { value: { current: 0 } }
  instance.hooks[4] = { value: { current: false } }
  instances.set('root:', instance)
  return instance
}
function homeProps() {
  return {
    t: t, stateData: stateData, onOpenProject: noop, onOpenSession: noop,
    onOpenSettings: noop, showToast: noop, useSessions: fakeUseSessions,
  }
}
function renderHome(overrides) {
  seedHomeInstance(overrides)
  return render({ type: HomeView, props: homeProps(), children: [] })
}
test('home view renders stats, task panels and generated weekly report', function () {
  const nodes = renderHome({
    dashboard: { loading: false, error: '', data: dashboardData },
    weekly: { loading: false, error: '', data: weeklyData },
  })
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('home.stats.projects') >= 0, true)
  assert.equal(text.indexOf('home.recentTasks') >= 0, true)
  assert.equal(text.indexOf('home.activeTasks') >= 0, true)
  assert.equal(text.indexOf('home.runningRequirements') >= 0, true)
  assert.equal(text.indexOf('home.weekly') >= 0, true)
  assert.equal(text.indexOf('工程周报') >= 0, true)
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-weekly-preview'
  }), true)
  const taskRows = nodes.filter(function (node) {
    return node.props && String(node.props.className || '').indexOf('devbench-task-row') === 0
  })
  assert.equal(taskRows.length, 4)
  assert.equal(nodes.some(function (node) {
    return node.props && String(node.props.className || '').indexOf('devbench-task-dot succeeded') >= 0
  }), true)
  assert.equal(nodes.some(function (node) {
    return node.props && String(node.props.className || '').indexOf('devbench-task-dot running') >= 0
  }), true)
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-task-open'
  }), true)
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-data-meta'
  }), false)
})
test('home task rows stay single line and truncate long messages', function () {
  instances.clear()
  const task = Object.assign({}, taskData, {
    id: 't-long', status: 'failed', kind: 'review',
    proposedMessage: 'fix(home): 第一行摘要\n\n- 第二行详情不应出现在紧凑行里',
    commitShort: 'abc1234',
    commitSubject: 'fix(home): 提交主题',
    sessionId: '',
  })
  const nodes = render({ type: HomeTaskRow, props: { t: t, task: task }, children: [] })
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('fix(home): 第一行摘要') >= 0, true)
  assert.equal(text.indexOf('第二行详情') >= 0, false)
  assert.equal(text.indexOf('abc1234') >= 0, true)
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-data-meta'
  }), false)
  assert.equal(nodes.some(function (node) {
    return node.props && String(node.props.className || '').indexOf('devbench-task-dot failed') >= 0
  }), true)
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-task-open'
  }), false)
  const subject = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-task-subject'
  })
  assert.equal(subject.props.title.indexOf('fix(home): 第一行摘要') === 0, true)
  assert.equal(subject.children[0], 'fix(home): 第一行摘要')

  instances.clear()
  const running = render({
    type: HomeRunningRow,
    props: {
      t: t,
      item: { id: 'REQ-9', title: '需求标题', projectTitle: 'Workspace', folder: '/tmp/worktrees/REQ-9', workspaceId: 'w1', updatedAt: '2026-01-02T00:00:00.000Z' },
    },
    children: [],
  })
  const runningText = textOf(running, []).join(' ')
  assert.equal(runningText.indexOf('/tmp/worktrees/REQ-9'), -1)
  assert.equal(running.some(function (node) {
    return node.props && String(node.props.className || '').indexOf('devbench-task-dot running') >= 0
  }), true)
  assert.equal(running.some(function (node) {
    return node.props && node.props.className === 'devbench-task-row clickable'
  }), true)
})

test('requirement tasks render their requirement meta in both task surfaces', function () {
  const requirementTask = {
    id: 'REQ-SESSION:session-1', kind: 'requirement', status: 'running',
    title: '修复会话错误', requirementId: 'REQ-20261026-006',
    workspaceId: 'w1', projectTitle: 'Workspace', projectPath: '/tmp/w1',
    sessionId: 'session-1', error: '', createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }
  instances.clear()
  const nodes = render({
    type: ProjectTasks,
    props: {
      t: t, tasks: [requirementTask], busyKey: '',
      onOpenSession: noop, onCancel: noop, onRetry: noop,
    },
    children: [],
  })
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('task.kind.requirement') >= 0, true)
  assert.equal(text.indexOf('REQ-20261026-006') >= 0, true)
  assert.equal(text.indexOf('修复会话错误') >= 0, true)
  assert.equal(text.indexOf('project.task.cancel') >= 0, false)
  assert.equal(text.indexOf('project.task.retry') >= 0, false)
  const open = nodes.filter(function (node) {
    return node.type === 'button' && textOf(node, []).join(' ').indexOf('project.task.openSession') >= 0
  })
  assert.equal(open.length, 1)
  assert.equal(open[0].props.disabled, false)

  instances.clear()
  const rowNodes = render({
    type: HomeTaskRow,
    props: {
      t: t, task: requirementTask, index: 0, onOpenSession: noop, onOpenProject: noop,
      useSessions: fakeUseSessions,
    },
    children: [],
  })
  const rowText = textOf(rowNodes, []).join(' ')
  assert.equal(rowText.indexOf('task.kind.requirement') >= 0, true)
  assert.equal(rowText.indexOf('REQ-20261026-006') >= 0, true)
  assert.equal(rowText.indexOf('修复会话错误') >= 0, true)
  assert.equal(rowNodes.some(function (node) {
    return node.props && node.props.className === 'devbench-task-open'
  }), true)
})

test('project tasks label uncommitted reviews and expose the review target row', function () {
  const uncommittedTask = Object.assign({}, uncommittedReviewTaskData, {
    commitShort: 'deadbee', commitHash: 'deadbeefdeadbeef',
  })
  setSelection('tasks', uncommittedTask.id)
  instances.clear()
  const nodes = render({
    type: ProjectTasks,
    props: {
      t: t, tasks: [uncommittedTask], busyKey: '',
      onOpenSession: noop, onCancel: noop, onRetry: noop,
    },
    children: [],
  })
  const rows = nodes.filter(function (node) {
    const tokens = String(node.props && node.props.className || '').split(/\s+/)
    return node.type === 'div' && tokens.indexOf('devbench-master-row') >= 0
  })
  assert.equal(rows.length, 1)
  const rowText = textOf(rows[0], []).join(' ')
  assert.equal(rowText.indexOf('project.review.uncommittedTarget') >= 0, true)
  // The chip stays empty, so the commit id is not shown for an uncommitted review.
  assert.equal(rowText.indexOf('deadbee'), -1)
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('tabs.tasks.field.target') >= 0, true)
  assert.equal(text.indexOf('project.review.uncommittedTarget') >= 0, true)
  setSelection('tasks', '')
  instances.clear()
})
test('home task rows only navigate to sessions that still exist', function () {
  const opened = []
  function openSession(sessionId) { opened.push(sessionId) }
  instances.clear()
  const nodes = render({
    type: HomeTaskRow,
    props: {
      t: t, task: taskData, index: 0, onOpenSession: openSession, onOpenProject: noop,
      useSessions: fakeUseSessions,
    },
    children: [],
  })
  const clickable = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-task-row clickable'
  })
  assert.equal(Boolean(clickable), true)
  assert.equal(clickable.type, 'div')
  assert.equal(clickable.props.title, 'home.openSession')
  clickable.props.onClick({ stopPropagation: noop })
  clickable.props.onClick({ stopPropagation: noop })
  assert.deepEqual(opened, ['s1', 's1'])
  // The explicit open button shares the row action without double navigation.
  const openButton = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-task-open'
  })
  assert.equal(Boolean(openButton), true)
  openButton.props.onClick({ stopPropagation: noop })
  assert.deepEqual(opened, ['s1', 's1', 's1'])

  // A task whose session is gone renders no row click and no open button.
  instances.clear()
  const missingTask = Object.assign({}, taskData, { id: 't-gone', sessionId: 'session-missing' })
  const missing = render({
    type: HomeTaskRow,
    props: {
      t: t, task: missingTask, index: 0, onOpenSession: openSession, onOpenProject: noop,
      useSessions: fakeUseSessions,
    },
    children: [],
  })
  const missingRow = missing.find(function (node) {
    return node.props && String(node.props.className || '').indexOf('devbench-task-row') === 0
  })
  assert.equal(Boolean(missingRow), true)
  assert.equal(missingRow.props.onClick, undefined)
  assert.equal(missingRow.props.title, 'home.sessionMissing')
  assert.equal(missing.some(function (node) {
    return node.props && node.props.className === 'devbench-task-open'
  }), false)
  assert.equal(opened.length, 3)

  // While the session list is still pending the id cannot be verified: no navigation.
  instances.clear()
  const pending = render({
    type: HomeTaskRow,
    props: {
      t: t, task: taskData, index: 0, onOpenSession: openSession, onOpenProject: noop,
      useSessions: pendingUseSessions,
    },
    children: [],
  })
  const pendingRow = pending.find(function (node) {
    return node.props && String(node.props.className || '').indexOf('devbench-task-row') === 0
  })
  assert.equal(pendingRow.props.onClick, undefined)
  assert.equal(opened.length, 3)
})

test('home task row falls back to the uncommitted target when no commit subject exists', function () {
  instances.clear()
  const task = Object.assign({}, taskData, {
    id: 'home-uncommitted', kind: 'review', status: 'running',
    reviewTarget: 'uncommitted', commitSubject: null, proposedMessage: null,
    commitShort: 'feedbee', commitHash: '', sessionId: '',
  })
  let nodes = render({
    type: HomeTaskRow,
    props: { t: t, task: task, index: 0, useSessions: fakeUseSessions },
    children: [],
  })
  let text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('project.review.uncommittedTarget') >= 0, true)
  // The chip stays empty and the commit id never leaks into the row.
  assert.equal(text.indexOf('feedbee'), -1)
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-task-hash'
  }), false)
  const subject = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-task-subject'
  })
  assert.equal(Boolean(subject), true)
  assert.equal(subject.children[0], 'project.review.uncommittedTarget')

  // A commit subject, when present, keeps priority over the fallback label.
  instances.clear()
  nodes = render({
    type: HomeTaskRow,
    props: {
      t: t, task: Object.assign({}, task, { id: 'home-uncommitted-2', commitSubject: 'fix: sample' }),
      index: 0, useSessions: fakeUseSessions,
    },
    children: [],
  })
  text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('fix: sample') >= 0, true)
  assert.equal(text.indexOf('project.review.uncommittedTarget') >= 0, false)
  instances.clear()
})
test('home recent tasks include requirement execution tasks from the dashboard', function () {
  const requirementTask = {
    id: 'TASK-REQ-1', kind: 'requirement', status: 'running',
    title: '修复需求', requirementId: 'REQ-1', workspaceId: 'w1',
    projectTitle: 'Workspace', sessionId: 'session-1',
    createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  }
  const data = Object.assign({}, dashboardData, {
    recentTasks: [requirementTask].concat(dashboardData.recentTasks),
  })
  const nodes = renderHome({ dashboard: { loading: false, error: '', data: data } })
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('task.kind.requirement') >= 0, true)
  assert.equal(text.indexOf('REQ-1') >= 0, true)
  const row = nodes.find(function (node) {
    return node.props && String(node.props.className || '').indexOf('devbench-task-row clickable') === 0 &&
      textOf(node, []).join(' ').indexOf('REQ-1') >= 0
  })
  assert.equal(Boolean(row), true)
})

test('project overview integrates AI actions, running tasks and recent reviews', function () {
  instances.clear()
  const calls = { commit: 0, review: 0, uncommitted: 0, opened: [], cancelled: [] }
  const nodes = render({
    type: ProjectOverview,
    props: {
      t: t,
      overview: { loading: false, error: '', data: overviewData },
      tasks: [taskData],
      onViewTab: noop, onOpenReview: noop,
      onStartCommit() { calls.commit += 1 }, onStartReview() { calls.review += 1 },
      canCommit: true, previewBusy: false, activeCommitTask: null,
      canReviewLatest: true, reviewBusy: false,
      onStartUncommittedReview() { calls.uncommitted += 1 },
      canReviewUncommitted: true, reviewUncommittedBusy: false, activeUncommittedReviewTask: null,
      onOpenSession(sessionId) { calls.opened.push(sessionId) },
      onCancelTask(task) { calls.cancelled.push(task.id) },
      taskBusyKey: '',
    },
    children: [],
  })
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('project.ai.title') >= 0, true)
  assert.equal(text.indexOf('project.activeTasks') >= 0, true)
  assert.equal(text.indexOf('project.recentReviews') >= 0, true)
  assert.equal(text.indexOf('project.recentCommits') >= 0, true)
  assert.equal(text.indexOf('project.taskSummary') >= 0, true)
  assert.equal(text.indexOf('project.ai.changesHint') >= 0, true)
  // The review row shows only the short commit id and keeps the summary stacked.
  const reviewRow = nodes.find(function (node) {
    return node.props && String(node.props.className || '').indexOf('devbench-overview-review') >= 0
  })
  assert.equal(Boolean(reviewRow), true)
  const reviewText = textOf(reviewRow, []).join(' ')
  assert.equal(reviewText.indexOf('aaaaaaaa') >= 0, true)
  assert.equal(reviewText.indexOf(commitData.hash), -1)
  assert.equal(reviewText.indexOf(reviewData.summary) >= 0, true)
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-overview-review-summary'
  }), true)
  // AI actions render as buttons in the overview, not in a right rail.
  const aiButton = nodes.find(function (node) {
    return node.type === 'button' && textOf(node, []).join(' ').indexOf('project.ai.commit') >= 0
  })
  assert.equal(Boolean(aiButton), true)
  assert.equal(aiButton.props.disabled, false)
  const reviewButton = nodes.find(function (node) {
    return node.type === 'button' && textOf(node, []).join(' ').indexOf('project.ai.reviewLatest') >= 0
  })
  assert.equal(Boolean(reviewButton), true)
  assert.equal(reviewButton.props.disabled, false)
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-rail'
  }), false)
  // AI action buttons call the workbench handlers.
  aiButton.props.onClick()
  reviewButton.props.onClick()
  assert.equal(calls.commit, 1)
  assert.equal(calls.review, 1)
  const uncommittedButton = nodes.find(function (node) {
    return node.type === 'button' && textOf(node, []).join(' ').indexOf('project.ai.reviewUncommitted') >= 0
  })
  assert.equal(Boolean(uncommittedButton), true)
  assert.equal(uncommittedButton.props.disabled, false)
  uncommittedButton.props.onClick()
  assert.equal(calls.uncommitted, 1)
  // Running-task rows expose open-session and cancel actions wired to callbacks.
  const openSessionButton = nodes.find(function (node) {
    return node.type === 'button' && textOf(node, []).join(' ').indexOf('project.task.openSession') >= 0
  })
  assert.equal(Boolean(openSessionButton), true)
  openSessionButton.props.onClick()
  assert.deepEqual(calls.opened, ['s1'])
  const cancelButton = nodes.find(function (node) {
    return node.type === 'button' && textOf(node, []).join(' ').indexOf('project.task.cancel') >= 0
  })
  assert.equal(Boolean(cancelButton), true)
  cancelButton.props.onClick()
  assert.deepEqual(calls.cancelled, ['t1'])
})

const uncommittedReviewTaskData = {
  id: 'review-uncommitted-1', kind: 'review', status: 'running', workspaceId: 'w1',
  projectTitle: 'Workspace', projectPath: '/tmp/w1', sessionId: 's1',
  reviewTarget: 'uncommitted', commitHash: '', commitShort: null, commitSubject: null,
  changedFiles: ['a.js'], createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
}
test('project overview adds the uncommitted review action after the latest-commit review', function () {
  let clicked = 0
  function renderOverview(overrides) {
    instances.clear()
    return render({
      type: ProjectOverview,
      props: Object.assign({
        t: tWithParams,
        overview: { loading: false, error: '', data: overviewData },
        tasks: [],
        onViewTab: noop, onOpenReview: noop, onStartCommit: noop, onStartReview: noop,
        canCommit: true, previewBusy: false, activeCommitTask: null,
        canReviewLatest: true, reviewBusy: false,
        onStartUncommittedReview() { clicked += 1 },
        canReviewUncommitted: true, reviewUncommittedBusy: false, activeUncommittedReviewTask: null,
      }, overrides),
      children: [],
    })
  }
  function uncommittedButtonOf(nodes) {
    return nodes.find(function (node) {
      if (node.type !== 'button') return false
      return textOf(node, []).join(' ').indexOf('project.ai.reviewUncommitted') === 0
    })
  }
  let nodes = renderOverview({})
  // The AI actions keep their fixed order: commit, review latest commit, review uncommitted.
  const actions = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-overview-ai-actions'
  })
  assert.equal(Boolean(actions), true)
  assert.deepEqual(textOf(actions, []), [
    'project.ai.commit', 'project.ai.reviewLatest', 'project.ai.reviewUncommitted',
  ])
  let button = uncommittedButtonOf(nodes)
  assert.equal(Boolean(button), true)
  assert.equal(button.props.disabled, false)
  assert.equal(button.props.title, 'project.ai.reviewUncommittedHint{count=1}')
  button.props.onClick()
  assert.equal(clicked, 1)

  // While the request is in flight the label reflects the busy state.
  nodes = renderOverview({ canReviewUncommitted: false, reviewUncommittedBusy: true })
  button = uncommittedButtonOf(nodes)
  assert.equal(textOf(button, []).join(' '), 'project.ai.reviewUncommittedBusy')
  assert.equal(button.props.disabled, true)

  // A running uncommitted review task wins over the busy label.
  nodes = renderOverview({
    canReviewUncommitted: false,
    reviewUncommittedBusy: true,
    activeUncommittedReviewTask: uncommittedReviewTaskData,
  })
  button = uncommittedButtonOf(nodes)
  assert.equal(textOf(button, []).join(' '), 'project.ai.reviewUncommittedActive')
  assert.equal(button.props.disabled, true)

  // A clean working tree disables the action and explains why via the clean hint.
  const cleanOverview = Object.assign({}, overviewData, {
    git: Object.assign({}, overviewData.git, { changes: [] }),
  })
  nodes = renderOverview({
    overview: { loading: false, error: '', data: cleanOverview },
    canReviewUncommitted: false,
  })
  button = uncommittedButtonOf(nodes)
  assert.equal(button.props.disabled, true)
  assert.equal(button.props.title, 'project.ai.clean')
})
test('workbench only enables the uncommitted review when the working tree has changes', function () {
  uiStore.set({
    view: 'project', selectedProjectId: 'w1', selectedRequirement: null, activeTab: 'overview',
  })
  instances.clear()
  let instance = seedDevbenchInstance()
  instance.hooks[2] = {
    value: {
      loading: false, error: '', key: 'w1',
      data: Object.assign({}, overviewData, {
        git: Object.assign({}, overviewData.git, { changes: [] }),
      }),
    },
  }
  let nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
  let button = findButton(nodes, 'project.ai.reviewUncommitted')
  assert.equal(Boolean(button), true)
  assert.equal(button.props.disabled, true)

  // A dirty working tree enables the action; no active uncommitted review exists yet.
  instances.clear()
  seedDevbenchInstance()
  nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
  button = findButton(nodes, 'project.ai.reviewUncommitted')
  assert.equal(Boolean(button), true)
  assert.equal(button.props.disabled, false)

  // A running uncommitted review task keeps the action disabled and explains why.
  instances.clear()
  instance = seedDevbenchInstance()
  instance.hooks[3] = {
    value: {
      loading: false, error: '', key: 'w1',
      data: [taskData, uncommittedReviewTaskData],
    },
  }
  nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
  button = findButton(nodes, 'project.ai.reviewUncommittedActive')
  assert.equal(Boolean(button), true)
  assert.equal(button.props.disabled, true)
  assert.equal(textOf(button, []).join(' '), 'project.ai.reviewUncommittedActive')

  // While the start request is in flight the workbench reports the busy label.
  instances.clear()
  instance = seedDevbenchInstance()
  instance.hooks[34] = { value: 'w1' }
  nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
  button = findButton(nodes, 'project.ai.reviewUncommittedBusy')
  assert.equal(Boolean(button), true)
  assert.equal(button.props.disabled, true)
  assert.equal(textOf(button, []).join(' '), 'project.ai.reviewUncommittedBusy')
})
test('sidebar workbench icon is a panel layout instead of the requirements clipboard', function () {
  instances.clear()
  const nodes = render({ type: DevbenchIcon, props: {}, children: [] })
  const svg = nodes.find(function (node) { return node.type === 'svg' })
  assert.equal(Boolean(svg), true)
  assert.equal(svg.props.viewBox, '0 0 24 24')
  const paths = nodes.filter(function (node) { return node.type === 'path' }).map(function (node) {
    return node.props.d
  })
  assert.equal(paths.indexOf('M9.6 4.2v15.6') >= 0, true)
  assert.equal(paths.some(function (value) { return String(value).indexOf('M8.8 11.6') >= 0 }), false)
  const rect = nodes.find(function (node) { return node.type === 'rect' })
  assert.equal(Boolean(rect), true)
  assert.equal(rect.props.width, 17.2)
})

test('workbench starts an uncommitted review once and merges the returned task', async function () {
  const originalFetch = globalThis.fetch
  const calls = []
  const createdTask = Object.assign({}, uncommittedReviewTaskData, { id: 'new-uncommitted-task' })
  globalThis.fetch = async function (url, init) {
    const target = String(url)
    calls.push({ url: target, method: init.method, body: init.body ? JSON.parse(init.body) : null })
    let value = {}
    if (target.indexOf('/project/review/uncommitted') > 0) {
      value = { task: createdTask }
    } else if (target.indexOf('/project/overview') > 0) {
      // The refresh returns the old snapshot: only the merged task may surface.
      value = overviewData
    } else if (target.indexOf('/project/tasks') > 0) {
      value = { tasks: [] }
    } else {
      value = stateData
    }
    return { status: 200, json: async function () { return { ok: true, value: value } } }
  }
  try {
    uiStore.set({
      view: 'project', selectedProjectId: 'w1', selectedRequirement: null, activeTab: 'overview',
    })
    instances.clear()
    seedDevbenchInstance()
    let nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
    const button = findButton(nodes, 'project.ai.reviewUncommitted')
    assert.equal(Boolean(button), true)
    assert.equal(button.props.disabled, false)
    // A double click while the request is in flight must not start a second task.
    button.props.onClick()
    button.props.onClick()
    await new Promise(function (resolve) { setTimeout(resolve, 0) })
    const posts = calls.filter(function (call) {
      return call.url.indexOf('/project/review/uncommitted') > 0
    })
    assert.equal(posts.length, 1)
    assert.equal(posts[0].method, 'POST')
    assert.deepEqual(posts[0].body, { workspaceId: 'w1' })
    nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
    // Success toast and the refreshed task state both surface in the workbench.
    assert.equal(textOf(nodes, []).join(' ').indexOf('project.review.uncommittedStarted') >= 0, true)
    const activeButton = findButton(nodes, 'project.ai.reviewUncommittedActive')
    assert.equal(Boolean(activeButton), true)
    assert.equal(activeButton.props.disabled, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('project overview labels uncommitted reviews with the target instead of an empty commit', function () {
  instances.clear()
  const uncommittedReview = Object.assign({}, reviewData, {
    name: '20260102-uncommitted-review.md', commit: '', commitSubject: '', target: 'uncommitted',
  })
  const data = Object.assign({}, overviewData, { reviews: [uncommittedReview] })
  const nodes = render({
    type: ProjectOverview,
    props: {
      t: t,
      overview: { loading: false, error: '', data: data },
      tasks: [],
      onViewTab: noop, onOpenReview: noop,
    },
    children: [],
  })
  const reviewRow = nodes.find(function (node) {
    return node.props && String(node.props.className || '').indexOf('devbench-overview-review') >= 0
  })
  assert.equal(Boolean(reviewRow), true)
  const reviewText = textOf(reviewRow, []).join(' ')
  assert.equal(reviewText.indexOf('project.review.uncommittedTarget') >= 0, true)
  // There is no commit subject to stack below the target label.
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-overview-review-subject'
  }), false)
  // The latest-review stat card falls back to the target text too.
  const statValues = nodes.filter(function (node) {
    return node.props && node.props.className === 'devbench-stat-value'
  }).map(function (node) { return textOf(node, []).join(' ') })
  assert.equal(statValues.indexOf('project.review.uncommittedTarget') >= 0, true)
})
test('requirements clipboard icon is kept for the conversation header action', function () {
  instances.clear()
  const nodes = render({ type: IconReq, props: { size: 14 }, children: [] })
  const svg = nodes.find(function (node) { return node.type === 'svg' })
  assert.equal(svg.props.width, 14)
  const paths = nodes.filter(function (node) { return node.type === 'path' }).map(function (node) {
    return node.props.d
  })
  assert.equal(paths.some(function (value) { return String(value).indexOf('M8.8 11.6') >= 0 }), true)
})

test('home view tolerates empty dashboard data', function () {
  const nodes = renderHome({})
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('home.weekly') >= 0, true)
  assert.equal(text.indexOf('home.weekly.generate') >= 0, true)
  assert.equal(text.indexOf('home.noRecentTasks') >= 0, false)
})

test('commit list renders load-more for a full first page', function () {
  const commits = []
  for (let index = 0; index < 10; index += 1) {
    commits.push(Object.assign({}, commitData, {
      hash: 'hash-' + String(index).padStart(4, '0'),
      short: 'hash' + index,
      subject: 'commit ' + index,
    }))
  }
  instances.clear()
  const nodes = render({
    type: ProjectCommits,
    props: { t: t, commits: commits, tasks: [], workspaceId: 'w1', reviewingCommit: '', onReview: noop },
    children: [],
  })
  const loadMore = nodes.find(function (node) {
    return node.type === 'button' && textOf(node, []).join(' ').indexOf('list.loadMore') >= 0
  })
  assert.equal(Boolean(loadMore), true)
})

test('commit detail renders changed files, diffs, linked requirements and session actions', function () {
  const detail = {
    commit: commitData,
    files: [
      {
        path: 'src/a.js', oldPath: '', status: 'M', additions: 3, deletions: 1,
        binary: false, truncated: false,
        diff: '@@ -1 +1 @@\n-old line\n+new line\n+another line\n+third line',
      },
      {
        path: 'assets/logo.bin', oldPath: '', status: 'A', additions: 0, deletions: 0,
        binary: true, truncated: false, diff: '',
      },
    ],
    truncated: false,
    review: null,
    requirements: [{ workspaceId: 'w1', id: 'REQ-1', title: 'Sample requirement', status: 'new' }],
  }
  const reviewTask = {
    id: 't-review', kind: 'review', status: 'succeeded', workspaceId: 'w1',
    commitHash: commitData.hash, commitShort: commitData.short, sessionId: 's1',
  }
  setSelection('commits', commitData.hash)
  instances.clear()
  const instance = { hooks: [] }
  instance.hooks[0] = { value: { rows: [commitData], hasMore: false, loadingMore: false, refreshing: false, error: '' } }
  instance.hooks[1] = { value: '' }
  instance.hooks[2] = { value: 'all' }
  instance.hooks[3] = { value: { loading: false, error: '', data: detail, hash: commitData.hash } }
  instance.hooks[4] = { value: null }
  instance.hooks[5] = { value: '' }
  instances.set('root:', instance)
  const opened = []
  const nodes = render({
    type: ProjectCommits,
    props: {
      t: t, commits: [commitData], tasks: [reviewTask], workspaceId: 'w1',
      reviewingCommit: '', onReview: noop, reviews: [],
      requirements: [{ workspaceId: 'w1', id: 'REQ-1', title: 'Sample requirement', status: 'new' }],
      onOpenSession(sessionId) { opened.push(sessionId) },
      onOpenRequirement: noop,
    },
    children: [],
  })
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('tabs.commits.files') >= 0, true)
  assert.equal(text.indexOf('src/a.js') >= 0, true)
  assert.equal(text.indexOf('+3') >= 0, true)
  assert.equal(text.indexOf('-1') >= 0, true)
  assert.equal(text.indexOf('REQ-1') >= 0, true)
  assert.equal(text.indexOf('tabs.commits.openSession') >= 0, true)
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-commit-browser'
  }), true)
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-commit-info'
  }), true)
  const treeRows = nodes.filter(function (node) {
    return node.type === 'button' && String(node.props && node.props.className || '').indexOf('devbench-commit-tree-row') === 0
  })
  assert.equal(treeRows.length, 4)
  const diff = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-commit-diff'
  })
  assert.equal(Boolean(diff), true)
  assert.equal(String(diff.children[0]).indexOf('+new line') >= 0, true)
  const sessionButton = nodes.find(function (node) {
    return node.type === 'button' && textOf(node, []).join(' ').indexOf('tabs.commits.openSession') >= 0
  })
  assert.equal(Boolean(sessionButton), true)
  sessionButton.props.onClick()
  assert.deepEqual(opened, ['s1'])
  // Primary actions now live in the right pane, not a bottom bar.
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-detail-actions'
  }), true)
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-master-detail-foot'
  }), false)
})

test('commit file tree groups paths and aggregates directory stats', function () {
  const tree = buildCommitFileTree([
    { path: 'src/a.js', status: 'M', additions: 3, deletions: 1 },
    { path: 'src/lib/b.js', status: 'A', additions: 5, deletions: 0 },
    { path: 'README.md', status: 'M', additions: 1, deletions: 2 },
  ])
  assert.deepEqual(tree.map(function (node) { return node.name }), ['src', 'README.md'])
  assert.equal(tree[0].type, 'dir')
  assert.equal(tree[0].fileCount, 2)
  assert.equal(tree[0].additions, 8)
  assert.equal(tree[0].deletions, 1)
  assert.deepEqual(tree[0].children.map(function (node) { return node.name }), ['a.js', 'lib'])
  assert.equal(tree[0].children[1].fileCount, 1)
  assert.equal(tree[0].children[1].additions, 5)
  assert.equal(tree[1].type, 'file')
  assert.equal(tree[1].path, 'README.md')
})

test('commit diff browser switches the right pane from the file tree', function () {
  instances.clear()
  const files = [
    {
      path: 'src/a.js', oldPath: '', status: 'M', additions: 3, deletions: 1,
      binary: false, truncated: false, diff: '@@ -1 +1 @@\n-old line\n+new line',
    },
    {
      path: 'assets/logo.bin', oldPath: '', status: 'A', additions: 0, deletions: 0,
      binary: true, truncated: false, diff: '',
    },
  ]
  let nodes = render({ type: CommitDiffBrowser, props: { t: t, files: files }, children: [] })
  const browser = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-commit-browser'
  })
  assert.equal(Boolean(browser), true)
  let diff = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-commit-diff'
  })
  assert.equal(Boolean(diff), true)
  assert.equal(String(diff.children[0]).indexOf('+new line') >= 0, true)
  const fileRows = nodes.filter(function (node) {
    const className = String(node.props && node.props.className || '')
    return node.type === 'button' && className.indexOf('devbench-commit-tree-row file') === 0
  })
  assert.equal(fileRows.length, 2)
  // Picking the second tree row swaps the right pane to that file.
  fileRows[1].props.onClick()
  nodes = render({ type: CommitDiffBrowser, props: { t: t, files: files }, children: [] })
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-commit-diff'
  }), false)
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-commit-diff-note'
  }), true)
  assert.equal(textOf(nodes, []).join(' ').indexOf('tabs.commits.binaryFile') >= 0, true)
})

test('commit diff browser skips the tree for a single changed file', function () {
  instances.clear()
  const nodes = render({
    type: CommitDiffBrowser,
    props: {
      t: t,
      files: [{
        path: 'only.js', oldPath: '', status: 'M', additions: 2, deletions: 0,
        binary: false, truncated: false, diff: '@@ -1 +1 @@\n+only line',
      }],
    },
    children: [],
  })
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-commit-tree'
  }), false)
  const diff = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-commit-diff'
  })
  assert.equal(Boolean(diff), true)
  assert.equal(String(diff.children[0]).indexOf('+only line') >= 0, true)
})

test('requirement detail lists linked commits and removes the Git history tab', function () {
  const commitHash = 'a'.repeat(40)
  setSelection('commits', '')
  instances.clear()
  const linkedSummary = Object.assign({}, summary, { commits: [commitHash] })
  const linkedDetail = Object.assign({}, detailData, {
    requirement: linkedSummary,
    git: undefined,
    gitLog: undefined,
  })
  const opened = []
  const nodes = render({
    type: DetailView,
    props: {
      t: t, selected: { workspaceId: 'w1', id: 'REQ-1' }, summary: linkedSummary,
      detail: { loading: false, error: '', data: linkedDetail, key: 'w1/REQ-1' },
      onBack: noop, onExecute: function () { return Promise.resolve() },
      onReloadDetail: function () { return Promise.resolve() },
      onReloadState: function () { return Promise.resolve() },
      onOpenSession: noop, onUnlinkSession: noop, showToast: noop,
      onOpenCommit(hash) { opened.push(hash) },
    },
    children: [],
  })
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('detail.commits') >= 0, true)
  assert.equal(text.indexOf('aaaaaaaa') >= 0, true)
  assert.equal(text.indexOf('detail.git') >= 0, false)
  const openButton = nodes.find(function (node) {
    return node.type === 'button' && node.props && node.props.title === 'detail.commits.open'
  })
  assert.equal(Boolean(openButton), true)
  openButton.props.onClick()
  assert.deepEqual(opened, [commitHash])
  assert.equal(nodes.some(function (node) {
    return node.type === 'button' && node.props && node.props.title === 'detail.commits.linkHint'
  }), true)
})

test('task detail puts the open-session action in the right pane rather than the footer', function () {
  setSelection('tasks', taskData.id)
  instances.clear()
  const nodes = render({
    type: ProjectTasks,
    props: {
      t: t, tasks: [taskData], busyKey: '',
      onOpenSession: noop, onCancel: noop, onRetry: noop,
    },
    children: [],
  })
  const bodyActions = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-detail-actions'
  })
  assert.equal(Boolean(bodyActions), true)
  assert.equal(textOf(bodyActions, []).join(' ').indexOf('project.task.openSession') >= 0, true)
  const footer = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-master-detail-foot'
  })
  assert.equal(Boolean(footer), true)
  assert.equal(textOf(footer, []).join(' ').indexOf('project.task.openSession') >= 0, false)
})

test('project header exposes detected project launchers', function () {
  setSelection('commits', '')
  uiStore.set({
    view: 'project', selectedProjectId: 'w1', selectedRequirement: null, activeTab: 'overview',
  })
  instances.clear()
  const instance = seedDevbenchInstance()
  instance.hooks[15] = { value: ['vscode', 'system', 'iterm'] }
  const nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
  const titles = nodes.filter(function (node) {
    return node.type === 'button' && node.props && String(node.props.title || '').indexOf('project.open.') === 0
  }).map(function (node) { return node.props.title })
  assert.deepEqual(titles.sort(), ['project.open.iterm', 'project.open.system', 'project.open.vscode'])
})

test('requirement detail exposes worktree controls and settings expose templates', function () {
  instances.clear()
  const worktreeData = Object.assign({}, detailData, {
    worktree: {
      enabled: true, exists: true, path: '/tmp/worktrees/REQ-1',
      branch: 'devbench/REQ-1', base: 'main',
    },
  })
  let nodes = render({
    type: DetailView,
    props: {
      t: t, selected: { workspaceId: 'w1', id: 'REQ-1' }, summary: summary,
      detail: { loading: false, error: '', data: worktreeData, key: 'w1/REQ-1' },
      onBack: noop, onExecute: function () { return Promise.resolve() },
      onReloadDetail: function () { return Promise.resolve() },
      onReloadState: function () { return Promise.resolve() },
      onOpenSession: noop, onUnlinkSession: noop, showToast: noop,
    },
    children: [],
  })
  let text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('detail.worktree') >= 0, true)
  assert.equal(text.indexOf('/tmp/worktrees/REQ-1') >= 0, true)
  assert.equal(nodes.some(function (node) { return node.props && node.props.className === 'devbench-worktree-card' }), true)

  instances.clear()
  const settingsData = Object.assign({}, stateData, {
    config: Object.assign({}, stateData.config, {
      reviewPromptTemplate: 'custom template {taskId}',
      defaultReviewPromptTemplate: 'default template {taskId}',
      commitPromptTemplate: 'custom commit {taskId} {changedFiles} {diffText}',
      defaultCommitPromptTemplate: 'default commit {taskId} {changedFiles} {diffText}',
      worktreeRoot: '/tmp/worktrees',
      defaultWorktreeRoot: '/tmp/default-worktrees',
    }),
  })
  nodes = render({ type: SettingsView, props: { t: t, data: settingsData, reload: function () { return Promise.resolve() }, showToast: noop }, children: [] })
  text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('settings.reviewTemplate') >= 0, true)
  assert.equal(text.indexOf('settings.commitTemplate') >= 0, true)
  assert.equal(text.indexOf('settings.commitTemplate.hint') >= 0, true)
  assert.equal(text.indexOf('settings.commitTemplate.reset') >= 0, true)
  assert.equal(text.indexOf('settings.worktree.root') >= 0, true)
  // Execution, review and commit prompt templates each get their own textarea.
  const promptTextareas = nodes.filter(function (node) { return node.type === 'textarea' })
  assert.equal(promptTextareas.length, 3)
  assert.equal(promptTextareas[2].props.value, 'custom commit {taskId} {changedFiles} {diffText}')
})
test('settings rejects a commit prompt template without the required placeholders', function () {
  instances.clear()
  const toasts = []
  const data = Object.assign({}, stateData, {
    config: Object.assign({}, stateData.config, {
      promptTemplate: 'execute {id}',
      reviewPromptTemplate: 'review {taskId}',
      defaultReviewPromptTemplate: 'default review {taskId}',
      commitPromptTemplate: '自定义提交 {taskId}',
      defaultCommitPromptTemplate: '默认提交 {taskId} {changedFiles} {diffText}',
      worktreeRoot: '',
      defaultWorktreeRoot: '/tmp/default-worktrees',
    }),
  })
  const props = {
    t: t, data: data, reload: function () { return Promise.resolve() },
    showToast: function (kind, text) { toasts.push({ kind: kind, text: text }) },
  }
  const nodes = render({ type: SettingsView, props: props, children: [] })
  const sections = nodes.filter(function (node) {
    return node.props && node.props.className === 'devbench-section'
  })
  const commitSectionIndex = nodes.indexOf(sections.find(function (node) {
    return textOf(node, []).join(' ').indexOf('settings.commitTemplate') >= 0
  }))
  assert.equal(commitSectionIndex >= 0, true)
  const save = nodes.slice(commitSectionIndex).find(function (node) {
    return node.type === 'button' && textOf(node, []).join(' ').indexOf('settings.save') >= 0
  })
  assert.equal(Boolean(save), true)
  save.props.onClick()
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].kind, 'error')
  assert.equal(toasts[0].text, 'settings.commitTemplate.invalid')
})

function findButton(nodes, label) {
  return nodes.find(function (node) {
    return node.type === 'button' && textOf(node, []).join(' ').indexOf(label) >= 0
  })
}
test('worktree tab lists worktrees with branch, path, commit and dirty state', function () {
  seedWorktreesHooks()
  const nodes = render({ type: ProjectWorktrees, props: worktreeProps(), children: [] })
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('Sample requirement') >= 0, true)
  assert.equal(text.indexOf('REQ-1') >= 0, true)
  assert.equal(text.indexOf('devbench/REQ-1') >= 0, true)
  assert.equal(text.indexOf(worktreeRowData.path) >= 0, true)
  assert.equal(text.indexOf('feat: worktree change') >= 0, true)
  assert.equal(text.indexOf('project.worktrees.dirty') >= 0, true)
  assert.equal(text.indexOf('project.worktrees.ahead') >= 0, true)
  assert.equal(text.indexOf(worktreesData.defaultRoot) >= 0, true)
  const changes = findButton(nodes, 'project.worktrees.changes')
  assert.equal(Boolean(changes), true)
  assert.equal(changes.props.disabled, false)
  const commit = findButton(nodes, 'project.worktrees.commit')
  assert.equal(Boolean(commit), true)
  assert.equal(commit.props.disabled, false)
  const push = findButton(nodes, 'project.worktrees.push')
  assert.equal(Boolean(push), true)
  assert.equal(push.props.disabled, false)
  // Build/editor launchers are icon buttons carrying the localized title.
  const launcher = nodes.find(function (node) {
    return node.type === 'button' && node.props && node.props.title === 'project.worktrees.openIn'
  })
  assert.equal(Boolean(launcher), true)
  assert.equal(Boolean(findButton(nodes, 'project.worktrees.copyPath')), true)
  assert.equal(Boolean(findButton(nodes, 'project.worktrees.openRequirement')), true)
  const remove = findButton(nodes, 'project.worktrees.remove')
  assert.equal(Boolean(remove), true)
  assert.equal(remove.props.disabled, true)
  assert.equal(remove.props.title, 'tabs.worktrees.deleteDirtyReason')
})
test('worktree tab disables push without remote and commit without changes', function () {
  seedWorktreesHooks({
    list: {
      loading: false, error: '', key: 'w1',
      data: Object.assign({}, worktreesData, {
        remote: null,
        worktrees: [Object.assign({}, worktreeRowData, { remote: null })],
      }),
    },
  })
  let nodes = render({ type: ProjectWorktrees, props: worktreeProps(), children: [] })
  let push = findButton(nodes, 'project.worktrees.push')
  assert.equal(push.props.disabled, true)
  assert.equal(push.props.title, 'project.worktrees.pushNoRemote')
  assert.equal(findButton(nodes, 'project.worktrees.commit').props.disabled, false)

  seedWorktreesHooks({
    list: {
      loading: false, error: '', key: 'w1',
      data: Object.assign({}, worktreesData, {
        worktrees: [Object.assign({}, worktreeRowData, { dirty: false, changesCount: 0 })],
      }),
    },
  })
  nodes = render({ type: ProjectWorktrees, props: worktreeProps(), children: [] })
  const commit = findButton(nodes, 'project.worktrees.commit')
  assert.equal(commit.props.disabled, true)
  assert.equal(commit.props.title, 'project.worktrees.noChanges')
  assert.equal(textOf(nodes, []).join(' ').indexOf('project.worktrees.clean') >= 0, true)

  seedWorktreesHooks({
    list: {
      loading: false, error: '', key: 'w1',
      data: Object.assign({}, worktreesData, {
        worktrees: [Object.assign({}, worktreeRowData, { exists: false, dirty: false, changesCount: 0 })],
      }),
    },
  })
  nodes = render({ type: ProjectWorktrees, props: worktreeProps(), children: [] })
  // A deleted directory is recoverable through the cleanup action, not a dead end.
  assert.equal(textOf(nodes, []).join(' ').indexOf('project.worktrees.missingDir') >= 0, true)
  assert.equal(Boolean(findButton(nodes, 'project.worktrees.pruneSingle')), true)
  assert.equal(findButton(nodes, 'project.worktrees.remove'), undefined)
})
test('worktree tab renders empty, error and non-git states', function () {
  seedWorktreesHooks({
    list: {
      loading: false, error: '', key: 'w1',
      data: Object.assign({}, worktreesData, { worktrees: [] }),
    },
  })
  let nodes = render({ type: ProjectWorktrees, props: worktreeProps(), children: [] })
  assert.equal(textOf(nodes, []).join(' ').indexOf('project.worktrees.emptyNoRequirement') >= 0, true)
  assert.equal(Boolean(findButton(nodes, 'project.worktrees.goEnable')), true)

  seedWorktreesHooks({ list: { loading: false, error: 'worktree load failed', data: null, key: 'w1' } })
  nodes = render({ type: ProjectWorktrees, props: worktreeProps(), children: [] })
  assert.equal(textOf(nodes, []).join(' ').indexOf('worktree load failed') >= 0, true)
  assert.equal(Boolean(findButton(nodes, 'panel.retry')), true)

  instances.clear()
  nodes = render({ type: ProjectWorktrees, props: worktreeProps({ gitReady: false }), children: [] })
  assert.equal(textOf(nodes, []).join(' ').indexOf('project.worktrees.notGit') >= 0, true)
})
test('worktree changes panel renders files, diff and truncation hint', function () {
  seedWorktreesHooks({
    expanded: 'REQ-1',
    changes: { loading: false, error: '', data: worktreeChangesData, key: 'REQ-1' },
  })
  const nodes = render({ type: ProjectWorktrees, props: worktreeProps(), children: [] })
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('src/a.js') >= 0, true)
  assert.equal(text.indexOf('src/b.js') >= 0, true)
  assert.equal(text.indexOf('??') >= 0, true)
  assert.equal(text.indexOf('diff --git a/src/a.js') >= 0, true)
  assert.equal(text.indexOf('project.worktrees.truncated') >= 0, true)
  const pre = nodes.find(function (node) { return node.type === 'pre' })
  assert.equal(Boolean(pre), true)
  assert.equal(pre.props.className, 'devbench-worktree-diff')
  assert.equal(pre.children[0], worktreeChangesData.diffText)
})
test('worktree changes button fetches and renders the diff', async function () {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async function (url, init) {
    calls.push({ url: String(url), method: init.method })
    return { status: 200, json: async function () { return { ok: true, value: worktreeChangesData } } }
  }
  try {
    seedWorktreesHooks()
    let nodes = render({ type: ProjectWorktrees, props: worktreeProps(), children: [] })
    const button = findButton(nodes, 'project.worktrees.changes')
    await button.props.onClick()
    await new Promise(function (resolve) { setTimeout(resolve, 0) })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'GET')
    assert.equal(calls[0].url.indexOf('/project/worktree/changes?') > 0, true)
    assert.equal(calls[0].url.indexOf('workspaceId=w1') > 0, true)
    assert.equal(calls[0].url.indexOf('id=REQ-1') > 0, true)
    nodes = render({ type: ProjectWorktrees, props: worktreeProps(), children: [] })
    assert.equal(textOf(nodes, []).join(' ').indexOf('diff --git a/src/a.js') >= 0, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('worktree commit preview and push call the frozen endpoints', async function () {
  const originalFetch = globalThis.fetch
  const calls = []
  const tasks = []
  const toasts = []
  globalThis.fetch = async function (url, init) {
    const target = String(url)
    calls.push({ url: target, method: init.method, body: init.body ? JSON.parse(init.body) : null })
    let value = {}
    if (target.indexOf('/project/worktree/commit/preview') > 0) {
      value = { task: worktreeCommitTask }
    } else if (target.indexOf('/project/worktree/push') > 0) {
      value = {
        pushed: true, remote: 'origin', branch: 'devbench/REQ-1',
        upstream: 'origin/devbench/REQ-1', alreadyUpToDate: false, detail: 'pushed',
      }
    } else if (target.indexOf('/project/worktrees') > 0) {
      value = worktreesData
    }
    return { status: 200, json: async function () { return { ok: true, value: value } } }
  }
  try {
    seedWorktreesHooks()
    const props = worktreeProps({
      onCommitTask: function (task) { tasks.push(task) },
      showToast: function (kind, text) { toasts.push({ kind: kind, text: text }) },
    })
    let nodes = render({ type: ProjectWorktrees, props: props, children: [] })
    await findButton(nodes, 'project.worktrees.commit').props.onClick()
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].id, 'wt1')
    const previewCall = calls.find(function (call) {
      return call.url.indexOf('/project/worktree/commit/preview') > 0
    })
    assert.equal(previewCall.method, 'POST')
    assert.deepEqual(previewCall.body, { workspaceId: 'w1', id: 'REQ-1' })
    await new Promise(function (resolve) { setTimeout(resolve, 0) })
    nodes = render({ type: ProjectWorktrees, props: props, children: [] })
    const pushPromise = findButton(nodes, 'project.worktrees.push').props.onClick()
    closeDialog(true)
    await pushPromise
    const pushCall = calls.find(function (call) { return call.url.indexOf('/project/worktree/push') > 0 })
    assert.deepEqual(pushCall.body, { workspaceId: 'w1', id: 'REQ-1' })
    assert.equal(toasts.some(function (toast) { return toast.text === 'project.worktrees.pushed' }), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('worktree remove button opens a confirm modal and calls the remove endpoint', async function () {
  const originalFetch = globalThis.fetch
  const calls = []
  const toasts = []
  globalThis.fetch = async function (url, init) {
    const target = String(url)
    calls.push({ url: target, method: init.method, body: init.body ? JSON.parse(init.body) : null })
    let value = {}
    if (target.indexOf('/project/worktree/remove') > 0) {
      value = {
        removed: true, branch: worktreeRowData.branch,
        path: worktreeRowData.path, requirementId: worktreeRowData.requirementId,
      }
    } else if (target.indexOf('/project/worktrees') > 0) {
      value = Object.assign({}, worktreesData, { worktrees: [] })
    }
    return { status: 200, json: async function () { return { ok: true, value: value } } }
  }
  try {
    seedWorktreesHooks({
      list: {
        loading: false, error: '', key: 'w1',
        data: Object.assign({}, worktreesData, {
          worktrees: [Object.assign({}, worktreeRowData, { dirty: false, changesCount: 0 })],
        }),
      },
    })
    const props = worktreeProps({
      showToast: function (kind, text) { toasts.push({ kind: kind, text: text }) },
    })
    let nodes = render({ type: ProjectWorktrees, props: props, children: [] })
    const open = findButton(nodes, 'project.worktrees.remove')
    assert.equal(open.props.disabled, false)
    const removePromise = open.props.onClick()
    closeDialog(true)
    await removePromise
    const removeCall = calls.find(function (call) {
      return call.url.indexOf('/project/worktree/remove') > 0
    })
    assert.equal(Boolean(removeCall), true)
    assert.equal(removeCall.method, 'POST')
    assert.deepEqual(removeCall.body, { workspaceId: 'w1', id: 'REQ-1' })
    assert.equal(toasts.some(function (toast) {
      return toast.text === 'project.worktrees.removed'
    }), true)
    await new Promise(function (resolve) { setTimeout(resolve, 0) })
    assert.equal(findButton(nodes, 'action.delete'), undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('confirm commit routes worktree tasks to the worktree confirm endpoint', async function () {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async function (url, init) {
    const target = String(url)
    calls.push({ url: target, method: init.method, body: init.body ? JSON.parse(init.body) : null })
    let value = {}
    if (target.indexOf('/project/worktree/commit/confirm') > 0) {
      value = {
        task: Object.assign({}, worktreeCommitTask, { status: 'succeeded' }),
        commit: { hash: 'cccccccccccc', short: 'ccccccc', subject: 'feat: worktree change' },
        pushed: false, warning: '',
      }
    } else if (target.indexOf('/project/overview') > 0) {
      value = overviewData
    } else if (target.indexOf('/project/tasks') > 0) {
      value = { tasks: [] }
    } else if (target.indexOf('/project/worktrees') > 0) {
      value = worktreesData
    } else {
      value = stateData
    }
    return { status: 200, json: async function () { return { ok: true, value: value } } }
  }
  try {
    uiStore.set({
      view: 'project', selectedProjectId: 'w1', selectedRequirement: null, activeTab: 'worktrees',
    })
    instances.clear()
    const instance = seedDevbenchInstance()
    instance.hooks[3].value = { loading: false, error: '', data: [worktreeCommitTask], key: 'w1' }
    instance.hooks[13].value = {
      task: worktreeCommitTask, message: 'feat: worktree change', busy: false, cancelling: false, error: '',
    }
    let nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
    const modalText = textOf(nodes, []).join(' ')
    assert.equal(modalText.indexOf('project.commit.confirm.worktreeHint') >= 0, true)
    assert.equal(modalText.indexOf(worktreeRowData.path) >= 0, true)
    const confirmButton = findButton(nodes, 'project.commit.confirm.action')
    assert.equal(Boolean(confirmButton), true)
    await confirmButton.props.onClick()
    const call = calls.find(function (item) {
      return item.url.indexOf('/project/worktree/commit/confirm') > 0
    })
    assert.equal(Boolean(call), true)
    assert.deepEqual(call.body, { workspaceId: 'w1', taskId: 'wt1', message: 'feat: worktree change' })
    assert.equal(calls.some(function (item) { return item.url.indexOf('/project/commit/confirm') > 0 }), false)
    nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
    assert.equal(textOf(nodes, []).join(' ').indexOf('project.worktrees.commitSuccess') >= 0, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('worktree tab creates enabled-but-absent worktrees from the row', async function () {
  const originalFetch = globalThis.fetch
  const calls = []
  const toasts = []
  const changed = []
  const absentRow = {
    requirementId: 'REQ-2', title: 'Absent requirement', status: 'new',
    state: 'absent', created: false, exists: false,
    path: '/Users/me/.dsh-devbench/worktrees/w1-REQ-2',
    branch: 'devbench/REQ-2', base: 'main', dirty: false, changesCount: 0,
    statusKnown: true, ahead: 0, behind: 0, aheadKnown: true,
    lastCommit: null, upstream: null, remote: 'origin', remotes: ['origin'],
    canCreate: true, canPrune: false,
  }
  globalThis.fetch = async function (url, init) {
    const target = String(url)
    calls.push({ url: target, method: init.method, body: init.body ? JSON.parse(init.body) : null })
    let value = {}
    if (target.indexOf('/project/worktree/create') > 0) {
      value = {
        worktree: { enabled: true, exists: true, path: absentRow.path, branch: absentRow.branch },
        requirement: Object.assign({}, summary, { id: 'REQ-2', worktree: true }),
      }
    } else if (target.indexOf('/project/worktrees') > 0) {
      value = Object.assign({}, worktreesData, { worktrees: [worktreeRowData] })
    }
    return { status: 200, json: async function () { return { ok: true, value: value } } }
  }
  try {
    seedWorktreesHooks({
      list: {
        loading: false, error: '', key: 'w1',
        data: Object.assign({}, worktreesData, { worktrees: [absentRow] }),
      },
    })
    const props = worktreeProps({
      showToast: function (kind, text) { toasts.push({ kind: kind, text: text }) },
      onChanged: function () { changed.push(true) },
      onGoRequirements: noop,
    })
    const nodes = render({ type: ProjectWorktrees, props: props, children: [] })
    const text = textOf(nodes, []).join(' ')
    assert.equal(text.indexOf('project.worktrees.notCreated') >= 0, true)
    assert.equal(text.indexOf('project.worktrees.absentHint') >= 0, true)
    await findButton(nodes, 'project.worktrees.create').props.onClick()
    const call = calls.find(function (item) {
      return item.url.indexOf('/project/worktree/create') > 0
    })
    assert.equal(Boolean(call), true)
    assert.equal(call.method, 'POST')
    assert.deepEqual(call.body, { workspaceId: 'w1', id: 'REQ-2' })
    assert.equal(changed.length, 1)
    assert.equal(toasts.some(function (toast) {
      return toast.text === 'project.worktrees.created'
    }), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('worktree tab cleans missing worktree registrations', async function () {
  const originalFetch = globalThis.fetch
  const calls = []
  const toasts = []
  const missingRow = Object.assign({}, worktreeRowData, {
    state: 'missing', created: true, exists: false, dirty: false, changesCount: 0,
    canCreate: false, canPrune: true,
  })
  globalThis.fetch = async function (url, init) {
    const target = String(url)
    calls.push({ url: target, method: init.method, body: init.body ? JSON.parse(init.body) : null })
    let value = {}
    if (target.indexOf('/project/worktree/prune') > 0) {
      value = { pruned: [{ requirementId: 'REQ-1', path: worktreeRowData.path, branch: worktreeRowData.branch }] }
    } else if (target.indexOf('/project/worktrees') > 0) {
      value = Object.assign({}, worktreesData, { worktrees: [missingRow] })
    }
    return { status: 200, json: async function () { return { ok: true, value: value } } }
  }
  try {
    seedWorktreesHooks({
      list: {
        loading: false, error: '', key: 'w1',
        data: Object.assign({}, worktreesData, { worktrees: [missingRow] }),
      },
    })
    const props = worktreeProps({
      showToast: function (kind, text) { toasts.push({ kind: kind, text: text }) },
      onChanged: noop,
    })
    const nodes = render({ type: ProjectWorktrees, props: props, children: [] })
    const prune = findButton(nodes, 'project.worktrees.pruneSingle')
    assert.equal(Boolean(prune), true)
    const promise = prune.props.onClick()
    closeDialog(true)
    await promise
    const call = calls.find(function (item) {
      return item.url.indexOf('/project/worktree/prune') > 0
    })
    assert.equal(Boolean(call), true)
    assert.deepEqual(call.body, { workspaceId: 'w1', id: 'REQ-1' })
    assert.equal(toasts.some(function (toast) {
      return toast.text === 'project.worktrees.pruned'
    }), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('worktree quick actions open the requirement and external launchers', async function () {
  const originalFetch = globalThis.fetch
  const calls = []
  const opened = []
  globalThis.fetch = async function (url, init) {
    const target = String(url)
    calls.push({ url: target, method: init.method, body: init.body ? JSON.parse(init.body) : null })
    let value = { opened: true, path: worktreeRowData.path, target: 'vscode' }
    if (target.indexOf('/project/worktrees') > 0) value = worktreesData
    return { status: 200, json: async function () { return { ok: true, value: value } } }
  }
  try {
    seedWorktreesHooks()
    const props = worktreeProps({
      openTargets: ['vscode', 'system'],
      onOpenRequirement: function (workspaceId, requirementId) {
        opened.push({ workspaceId: workspaceId, requirementId: requirementId })
      },
      showToast: noop,
    })
    let nodes = render({ type: ProjectWorktrees, props: props, children: [] })
    const launcher = nodes.find(function (node) {
      return node.type === 'button' && node.props && node.props.title === 'project.worktrees.openIn'
    })
    assert.equal(Boolean(launcher), true)
    await launcher.props.onClick()
    const revealCall = calls.find(function (item) {
      return item.url.indexOf('/project/worktree/reveal') > 0
    })
    assert.equal(Boolean(revealCall), true)
    assert.deepEqual(revealCall.body, { workspaceId: 'w1', id: 'REQ-1', target: 'vscode' })

    nodes = render({ type: ProjectWorktrees, props: props, children: [] })
    const openRequirement = findButton(nodes, 'project.worktrees.openRequirement')
    assert.equal(Boolean(openRequirement), true)
    openRequirement.props.onClick()
    assert.deepEqual(opened, [{ workspaceId: 'w1', requirementId: 'REQ-1' }])
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('stale worktree preview errors offer a re-preview action', async function () {
  const originalFetch = globalThis.fetch
  const toasts = []
  globalThis.fetch = async function () {
    return {
      status: 409,
      json: async function () {
        return { ok: false, error: { code: 'stale-preview', message: '提交预览已过期' } }
      },
    }
  }
  try {
    seedWorktreesHooks({
      list: {
        loading: false, error: '', key: 'w1',
        data: Object.assign({}, worktreesData, {
          worktrees: [Object.assign({}, worktreeRowData, { state: 'ready' })],
        }),
      },
    })
    const props = worktreeProps({
      showToast: function (kind, text, options) {
        toasts.push({ kind: kind, text: text, options: options || {} })
      },
    })
    const nodes = render({ type: ProjectWorktrees, props: props, children: [] })
    await findButton(nodes, 'project.worktrees.commit').props.onClick()
    const stale = toasts.find(function (toast) {
      return toast.text === '提交预览已过期'
    })
    assert.equal(Boolean(stale), true)
    assert.equal(stale.options.actionLabel, 'project.worktrees.repreview')
    assert.equal(typeof stale.options.onAction, 'function')
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('sidebar click on the selected project leaves home for the project overview', function () {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async function (url) {
    const target = String(url)
    let value = stateData
    if (target.indexOf('/project/overview') > 0) value = overviewData
    else if (target.indexOf('/project/tasks') > 0) value = { tasks: [] }
    return { status: 200, json: async function () { return { ok: true, value: value } } }
  }
  try {
    uiStore.set({
      view: 'home', selectedProjectId: 'w1', selectedRequirement: null, activeTab: 'overview',
    })
    instances.clear()
    seedDevbenchInstance()
    let nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
    const row = nodes.find(function (node) {
      const cls = String(node.props && node.props.className || '')
      return cls.indexOf('devbench-project-row') === 0 && textOf(node, []).join(' ').indexOf('Workspace') >= 0
    })
    assert.equal(Boolean(row), true)
    row.props.onClick()
    assert.equal(uiStore.state.view, 'project')
    assert.equal(uiStore.state.activeTab, 'overview')
    assert.equal(uiStore.state.selectedProjectId, 'w1')
    nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
    assert.equal(nodes.some(function (node) {
      return node.props && String(node.props.className || '').indexOf('devbench-project-header') >= 0
    }), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('sidebar click inside the project view keeps the current tab', function () {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async function (url) {
    const target = String(url)
    let value = stateData
    if (target.indexOf('/project/overview') > 0) value = overviewData
    else if (target.indexOf('/project/tasks') > 0) value = { tasks: [] }
    return { status: 200, json: async function () { return { ok: true, value: value } } }
  }
  try {
    uiStore.set({
      view: 'project', selectedProjectId: 'w1', selectedRequirement: null, activeTab: 'requirements',
    })
    instances.clear()
    seedDevbenchInstance()
    const nodes = render({ type: RequirementsPage, props: { t: t, useSessions: undefined }, children: [] })
    const row = nodes.find(function (node) {
      return node.props && node.props.className === 'devbench-project-row active'
    })
    assert.equal(Boolean(row), true)
    row.props.onClick()
    assert.equal(uiStore.state.view, 'project')
    assert.equal(uiStore.state.activeTab, 'requirements')
  } finally {
    globalThis.fetch = originalFetch
  }
})

function pageTasks(count) {
  const tasks = []
  for (let index = 0; index < count; index += 1) {
    tasks.push(Object.assign({}, taskData, {
      id: 'page-task-' + String(index).padStart(2, '0'),
      status: 'succeeded',
      sessionId: '',
      updatedAt: '2026-01-01T00:00:' + String(index).padStart(2, '0') + '.000Z',
    }))
  }
  return tasks
}
function dataRows(nodes) {
  return nodes.filter(function (node) {
    const tokens = String(node.props && node.props.className || '').split(/\s+/)
    return tokens.indexOf('devbench-data-row') >= 0 || tokens.indexOf('devbench-master-row') >= 0
  })
}
function homeTaskRows(nodes) {
  return nodes.filter(function (node) {
    return node.props && String(node.props.className || '').indexOf('devbench-task-row') === 0
  })
}
test('project task list shows ten rows per page and loads more', function () {
  instances.clear()
  const tasks = pageTasks(12)
  const props = { t: t, tasks: tasks, busyKey: '', onOpenSession: noop, onCancel: noop, onRetry: noop }
  let nodes = render({ type: ProjectTasks, props: props, children: [] })
  assert.equal(dataRows(nodes).length, 10)
  const loadMore = findButton(nodes, 'list.loadMore')
  assert.equal(Boolean(loadMore), true)
  assert.equal(textOf(nodes, []).join(' ').indexOf('list.shownAll') >= 0, false)
  loadMore.props.onClick()
  nodes = render({ type: ProjectTasks, props: props, children: [] })
  assert.equal(dataRows(nodes).length, 12)
  assert.equal(findButton(nodes, 'list.loadMore'), undefined)
  assert.equal(textOf(nodes, []).join(' ').indexOf('list.shownAll') >= 0, true)
})
test('project task list hides the pager when the list fits one page', function () {
  instances.clear()
  const nodes = render({
    type: ProjectTasks,
    props: { t: t, tasks: pageTasks(10), busyKey: '', onOpenSession: noop, onCancel: noop, onRetry: noop },
    children: [],
  })
  assert.equal(dataRows(nodes).length, 10)
  assert.equal(findButton(nodes, 'list.loadMore'), undefined)
  assert.equal(textOf(nodes, []).join(' ').indexOf('list.shownAll') >= 0, false)
})
function tWithParams(key, params) {
  if (params === undefined || params === null) return key
  const parts = Object.keys(params).map(function (name) {
    return name + '=' + String(params[name])
  })
  return key + '{' + parts.join(',') + '}'
}
test('project task list advances ten rows per load more click until the end', function () {
  instances.clear()
  const tasks = pageTasks(25)
  const props = { t: tWithParams, tasks: tasks, busyKey: '', onOpenSession: noop, onCancel: noop, onRetry: noop }
  let nodes = render({ type: ProjectTasks, props: props, children: [] })
  assert.equal(dataRows(nodes).length, 10)
  let loadMore = findButton(nodes, 'list.loadMore')
  assert.equal(Boolean(loadMore), true)
  assert.equal(textOf(loadMore, []).join(' ').indexOf('count=10') >= 0, true)
  loadMore.props.onClick()
  nodes = render({ type: ProjectTasks, props: props, children: [] })
  assert.equal(dataRows(nodes).length, 20)
  loadMore = findButton(nodes, 'list.loadMore')
  assert.equal(Boolean(loadMore), true)
  assert.equal(textOf(loadMore, []).join(' ').indexOf('count=20') >= 0, true)
  loadMore.props.onClick()
  nodes = render({ type: ProjectTasks, props: props, children: [] })
  assert.equal(dataRows(nodes).length, 25)
  assert.equal(findButton(nodes, 'list.loadMore'), undefined)
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('list.shownAll') >= 0, true)
  assert.equal(text.indexOf('total=25') >= 0, true)
})
test('project review list shows ten rows per page and loads more', function () {
  instances.clear()
  const reviews = []
  for (let index = 0; index < 12; index += 1) {
    reviews.push(Object.assign({}, reviewData, { name: '20260101-review-' + String(index) + '.md' }))
  }
  const props = {
    t: t, reviews: reviews, selectedName: '', selectedReview: null,
    content: { loading: false, error: '', data: null },
    onOpen: noop, onRetry: noop,
  }
  let nodes = render({ type: ProjectReviews, props: props, children: [] })
  assert.equal(dataRows(nodes).length, 10)
  const loadMore = findButton(nodes, 'list.loadMore')
  assert.equal(Boolean(loadMore), true)
  loadMore.props.onClick()
  nodes = render({ type: ProjectReviews, props: props, children: [] })
  assert.equal(dataRows(nodes).length, 12)
  assert.equal(findButton(nodes, 'list.loadMore'), undefined)
  assert.equal(textOf(nodes, []).join(' ').indexOf('list.shownAll') >= 0, true)
})
test('project requirement list shows ten rows, loads more and resets on search', function () {
  uiStore.set({
    view: 'project', selectedProjectId: 'w1', selectedRequirement: null, activeTab: 'requirements',
  })
  instances.clear()
  const requirements = []
  for (let index = 0; index < 12; index += 1) {
    requirements.push(Object.assign({}, summary, {
      id: 'REQ-PAGE-' + String(index).padStart(2, '0'),
      title: 'Paged requirement ' + String(index),
    }))
  }
  const workspace = Object.assign({}, stateData.workspaces[0], { requirements: requirements })
  function props() {
    return {
      t: t, configured: true, workspace: workspace,
      onReloadState: function () { return Promise.resolve() },
      showToast: noop,
    }
  }
  let nodes = render({ type: ProjectRequirements, props: props(), children: [] })
  assert.equal(dataRows(nodes).length, 10)
  const loadMore = findButton(nodes, 'list.loadMore')
  assert.equal(Boolean(loadMore), true)
  loadMore.props.onClick()
  nodes = render({ type: ProjectRequirements, props: props(), children: [] })
  assert.equal(dataRows(nodes).length, 12)
  assert.equal(findButton(nodes, 'list.loadMore'), undefined)
  const search = nodes.find(function (node) {
    return node.type === 'input' && node.props.placeholder === 'project.requirements.search'
  })
  assert.equal(Boolean(search), true)
  search.props.onChange({ target: { value: 'paged' } })
  nodes = render({ type: ProjectRequirements, props: props(), children: [] })
  assert.equal(dataRows(nodes).length, 10)
  assert.equal(Boolean(findButton(nodes, 'list.loadMore')), true)
})
test('home recent task list shows ten rows per page and loads more', function () {
  const recent = pageTasks(12)
  const data = Object.assign({}, dashboardData, {
    recentTasks: recent, activeTasks: [], runningRequirements: [],
  })
  seedHomeInstance({ dashboard: { loading: false, error: '', data: data } })
  let nodes = render({ type: HomeView, props: homeProps(), children: [] })
  assert.equal(homeTaskRows(nodes).length, 10)
  const loadMore = findButton(nodes, 'list.loadMore')
  assert.equal(Boolean(loadMore), true)
  loadMore.props.onClick()
  nodes = render({ type: HomeView, props: homeProps(), children: [] })
  assert.equal(homeTaskRows(nodes).length, 12)
  assert.equal(findButton(nodes, 'list.loadMore'), undefined)
  assert.equal(textOf(nodes, []).join(' ').indexOf('list.shownAll') >= 0, true)
})
test('home unfinished task list pages tasks and running requirements together', function () {
  const active = []
  for (let index = 0; index < 12; index += 1) {
    active.push(Object.assign({}, taskData, {
      id: 'home-active-' + String(index).padStart(2, '0'),
      status: 'running',
      sessionId: '',
    }))
  }
  const running = []
  for (let index = 0; index < 2; index += 1) {
    running.push({
      workspaceId: 'w1', projectTitle: 'Workspace', id: 'home-run-' + String(index),
      title: 'Running requirement ' + String(index),
      folder: '/tmp/root/w1/home-run-' + String(index),
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
  }
  const data = Object.assign({}, dashboardData, {
    recentTasks: [Object.assign({}, taskData, { id: 'home-one', status: 'succeeded', sessionId: '' })],
    activeTasks: active,
    runningRequirements: running,
  })
  seedHomeInstance({ dashboard: { loading: false, error: '', data: data } })
  let nodes = render({ type: HomeView, props: homeProps(), children: [] })
  assert.equal(homeTaskRows(nodes).length, 11)
  let sectionTitles = nodes.filter(function (node) {
    return node.props && node.props.className === 'devbench-section-title'
  })
  assert.equal(sectionTitles.length, 0)
  const loadMore = findButton(nodes, 'list.loadMore')
  assert.equal(Boolean(loadMore), true)
  loadMore.props.onClick()
  nodes = render({ type: HomeView, props: homeProps(), children: [] })
  assert.equal(homeTaskRows(nodes).length, 15)
  sectionTitles = nodes.filter(function (node) {
    return node.props && node.props.className === 'devbench-section-title'
  })
  assert.equal(sectionTitles.length, 1)
  assert.equal(textOf(sectionTitles, []).join(' ').indexOf('home.runningRequirements') >= 0, true)
  assert.equal(findButton(nodes, 'list.loadMore'), undefined)
  assert.equal(textOf(nodes, []).join(' ').indexOf('list.shownAll') >= 0, true)
})

test('workspace changes panel renders loading and hides itself for non-git projects', function () {
  instances.clear()
  seedWorkspaceChangesHooks({ loading: true, data: null })
  let nodes = render({ type: WorkspaceChangesPanel, props: workspaceChangesProps(), children: [] })
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('tabs.overview.workspace') >= 0, true)
  assert.equal(text.indexOf('tabs.overview.workspaceLoading') >= 0, true)
  assert.equal(findButton(nodes, 'tabs.overview.pull'), undefined)

  instances.clear()
  seedWorkspaceChangesHooks({ data: Object.assign({}, workspaceChangesData, { initialized: false }) })
  nodes = render({ type: WorkspaceChangesPanel, props: workspaceChangesProps(), children: [] })
  assert.equal(nodes.length, 0)
})
test('workspace changes panel lists files, branch, upstream and the workflow diff', function () {
  instances.clear()
  seedWorkspaceChangesHooks()
  let nodes = render({ type: WorkspaceChangesPanel, props: workspaceChangesProps(), children: [] })
  let text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('tabs.overview.workspace') >= 0, true)
  assert.equal(text.indexOf('main') >= 0, true)
  assert.equal(text.indexOf('dddddddd') >= 0, true)
  assert.equal(text.indexOf('tabs.overview.workspace.changes') >= 0, true)
  assert.equal(text.indexOf('tabs.overview.workspace.upstream') >= 0, true)
  assert.equal(text.indexOf('tabs.overview.workspace.ahead') >= 0, true)
  assert.equal(text.indexOf('tabs.overview.workspace.behind') >= 0, true)
  assert.equal(text.indexOf('src/a.js') >= 0, true)
  assert.equal(text.indexOf('src/old name.js -> src/new name.js') >= 0, true)
  assert.equal(nodes.filter(function (node) {
    return node.props && node.props.className === 'devbench-ws-file'
  }).length, 2)
  const pull = findButton(nodes, 'tabs.overview.pull')
  const commit = findButton(nodes, 'tabs.overview.manualCommit')
  const push = findButton(nodes, 'tabs.overview.push')
  assert.deepEqual(
    [pull.props.disabled, commit.props.disabled, push.props.disabled],
    [false, false, false],
  )
  // The diff stays collapsed until requested, then scrolls inside the panel.
  assert.equal(nodes.some(function (node) { return node.type === 'pre' }), false)
  findButton(nodes, 'tabs.overview.workspace.showDiff').props.onClick()
  nodes = render({ type: WorkspaceChangesPanel, props: workspaceChangesProps(), children: [] })
  const pre = nodes.find(function (node) { return node.type === 'pre' })
  assert.equal(Boolean(pre), true)
  assert.equal(pre.props.className, 'devbench-ws-diff')
  assert.equal(pre.children[0], workspaceChangesData.diffText)
  assert.equal(textOf(nodes, []).join(' ').indexOf('tabs.overview.workspace.truncated') >= 0, false)

  instances.clear()
  seedWorkspaceChangesHooks({
    showDiff: true,
    data: Object.assign({}, workspaceChangesData, { truncated: true }),
  })
  nodes = render({ type: WorkspaceChangesPanel, props: workspaceChangesProps(), children: [] })
  assert.equal(textOf(nodes, []).join(' ').indexOf('tabs.overview.workspace.truncated') >= 0, true)
})
test('workspace changes panel disables actions without changes, upstream or remote', function () {
  instances.clear()
  seedWorkspaceChangesHooks({
    data: Object.assign({}, workspaceChangesData, {
      hasChanges: false, files: [], changedFiles: [], diffText: '',
      upstream: null, remote: null, remotes: [], ahead: 0, behind: 0,
    }),
  })
  let nodes = render({ type: WorkspaceChangesPanel, props: workspaceChangesProps(), children: [] })
  let text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('tabs.overview.workspace.clean') >= 0, true)
  assert.equal(text.indexOf('tabs.overview.workspace.noRemote') >= 0, true)
  assert.equal(findButton(nodes, 'tabs.overview.pull').props.disabled, true)
  assert.equal(findButton(nodes, 'tabs.overview.pull').props.title, 'tabs.overview.workspace.noRemote')
  assert.equal(findButton(nodes, 'tabs.overview.manualCommit').props.disabled, true)
  assert.equal(findButton(nodes, 'tabs.overview.manualCommit').props.title, 'project.worktrees.noChanges')
  assert.equal(findButton(nodes, 'tabs.overview.push').props.disabled, true)
  assert.equal(findButton(nodes, 'tabs.overview.push').props.title, 'tabs.overview.workspace.noRemote')

  // A missing upstream only blocks pull; push stays available through the remote.
  instances.clear()
  seedWorkspaceChangesHooks({
    data: Object.assign({}, workspaceChangesData, { upstream: null, ahead: 0, behind: 0 }),
  })
  nodes = render({ type: WorkspaceChangesPanel, props: workspaceChangesProps(), children: [] })
  text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('tabs.overview.workspace.noUpstream') >= 0, true)
  assert.equal(findButton(nodes, 'tabs.overview.pull').props.disabled, true)
  assert.equal(findButton(nodes, 'tabs.overview.pull').props.title, 'tabs.overview.workspace.noUpstream')
  assert.equal(findButton(nodes, 'tabs.overview.push').props.disabled, false)
})
test('workspace changes panel blocks write actions during AI commit and on detached HEAD', function () {
  const aiTask = Object.assign({}, taskData, { id: 'ws-commit-task' })
  instances.clear()
  seedWorkspaceChangesHooks()
  let nodes = render({
    type: WorkspaceChangesPanel,
    props: workspaceChangesProps({ activeCommitTask: aiTask }),
    children: [],
  })
  assert.equal(findButton(nodes, 'tabs.overview.manualCommit').props.disabled, true)
  assert.equal(findButton(nodes, 'tabs.overview.manualCommit').props.title, 'project.ai.commitActive')
  assert.equal(findButton(nodes, 'tabs.overview.pull').props.disabled, true)
  assert.equal(findButton(nodes, 'tabs.overview.pull').props.title, 'project.ai.commitActive')

  instances.clear()
  seedWorkspaceChangesHooks({
    data: Object.assign({}, workspaceChangesData, {
      branch: '', head: '', detached: true, upstream: null, ahead: 0, behind: 0,
    }),
  })
  nodes = render({ type: WorkspaceChangesPanel, props: workspaceChangesProps(), children: [] })
  const text = textOf(nodes, []).join(' ')
  assert.equal(text.indexOf('tabs.overview.workspace.detached') >= 0, true)
  assert.equal(findButton(nodes, 'tabs.overview.manualCommit').props.disabled, true)
  assert.equal(findButton(nodes, 'tabs.overview.manualCommit').props.title, 'tabs.overview.workspace.detached')
  assert.equal(findButton(nodes, 'tabs.overview.pull').props.disabled, true)
  assert.equal(findButton(nodes, 'tabs.overview.pull').props.title, 'tabs.overview.workspace.detached')
  assert.equal(findButton(nodes, 'tabs.overview.push').props.disabled, true)
  assert.equal(findButton(nodes, 'tabs.overview.push').props.title, 'tabs.overview.workspace.detached')
})
test('workspace changes panel opens the manual commit editor and validates the message', async function () {
  instances.clear()
  const toasts = []
  seedWorkspaceChangesHooks()
  const props = workspaceChangesProps({
    showToast: function (kind, text) { toasts.push({ kind: kind, text: text }) },
  })
  let nodes = render({ type: WorkspaceChangesPanel, props: props, children: [] })
  findButton(nodes, 'tabs.overview.manualCommit').props.onClick()
  nodes = render({ type: WorkspaceChangesPanel, props: props, children: [] })
  const textarea = nodes.find(function (node) { return node.type === 'textarea' })
  assert.equal(Boolean(textarea), true)
  assert.equal(textarea.props.maxLength, 2000)
  assert.equal(textarea.props.placeholder, 'tabs.overview.commitPlaceholder')
  assert.equal(textOf(nodes, []).join(' ').indexOf('tabs.overview.commitTitle') >= 0, true)
  // Empty messages are rejected before any request is made.
  await findButton(nodes, 'tabs.overview.commitConfirm').props.onClick()
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].kind, 'error')
  assert.equal(toasts[0].text, 'tabs.overview.commitEmpty')
  assert.equal(textOf(nodes, []).join(' ').indexOf('tabs.overview.manualCommitting') >= 0, false)
  // Cancel closes the editor without committing.
  findButton(nodes, 'tabs.overview.commitCancel').props.onClick()
  nodes = render({ type: WorkspaceChangesPanel, props: props, children: [] })
  assert.equal(nodes.some(function (node) { return node.type === 'textarea' }), false)
})
test('manual commit posts the typed message and refreshes the panel', async function () {
  const originalFetch = globalThis.fetch
  const calls = []
  const toasts = []
  let changed = 0
  globalThis.fetch = async function (url, init) {
    const target = String(url)
    calls.push({ url: target, method: init.method, body: init.body ? JSON.parse(init.body) : null })
    let value = {}
    if (target.indexOf('/project/commit/manual') > 0) {
      value = { commit: { hash: 'eeeeeeeeeeeeeeee', short: 'eeeeeee', subject: 'feat: manual' } }
    } else if (target.indexOf('/project/changes') > 0) {
      value = Object.assign({}, workspaceChangesData, {
        hasChanges: false, files: [], changedFiles: [], diffText: '',
      })
    }
    return { status: 200, json: async function () { return { ok: true, value: value } } }
  }
  try {
    instances.clear()
    seedWorkspaceChangesHooks({ commitOpen: true, message: 'feat: 手动提交' })
    const props = workspaceChangesProps({
      showToast: function (kind, text) { toasts.push({ kind: kind, text: text }) },
      onChanged: function () { changed += 1 },
    })
    let nodes = render({ type: WorkspaceChangesPanel, props: props, children: [] })
    const commitPromise = findButton(nodes, 'tabs.overview.commitConfirm').props.onClick()
    // The confirmation dialog shows the staged file count before committing.
    assert.equal(calls.length, 0)
    closeDialog(true)
    await commitPromise
    await new Promise(function (resolve) { setTimeout(resolve, 0) })
    const manual = calls.find(function (call) { return call.url.indexOf('/project/commit/manual') > 0 })
    assert.equal(manual.method, 'POST')
    assert.deepEqual(manual.body, { workspaceId: 'w1', message: 'feat: 手动提交' })
    assert.equal(calls.some(function (call) { return call.url.indexOf('/project/changes?') > 0 }), true)
    assert.equal(toasts.some(function (toast) { return toast.text === 'tabs.overview.commitSuccess' }), true)
    assert.equal(changed, 1)
    nodes = render({ type: WorkspaceChangesPanel, props: props, children: [] })
    assert.equal(nodes.some(function (node) { return node.type === 'textarea' }), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('pull and push confirm before calling the endpoints and toast the result', async function () {
  const originalFetch = globalThis.fetch
  const calls = []
  const toasts = []
  let changed = 0
  let upToDate = false
  globalThis.fetch = async function (url, init) {
    const target = String(url)
    calls.push({ url: target, method: init.method, body: init.body ? JSON.parse(init.body) : null })
    let value = {}
    if (target.indexOf('/project/pull') > 0) {
      value = upToDate
        ? { pulled: false, alreadyUpToDate: true, before: 'a', after: 'a', branch: 'main', upstream: workspaceChangesData.upstream }
        : { pulled: true, alreadyUpToDate: false, before: 'a', after: 'b', branch: 'main', upstream: workspaceChangesData.upstream, detail: 'Fast-forward' }
    } else if (target.indexOf('/project/push') > 0) {
      value = {
        pushed: true, remote: 'origin', branch: 'main',
        upstream: workspaceChangesData.upstream, alreadyUpToDate: false, detail: 'main -> main',
      }
    } else if (target.indexOf('/project/changes') > 0) {
      value = workspaceChangesData
    }
    return { status: 200, json: async function () { return { ok: true, value: value } } }
  }
  function panelProps() {
    return workspaceChangesProps({
      showToast: function (kind, text) { toasts.push({ kind: kind, text: text }) },
      onChanged: function () { changed += 1 },
    })
  }
  try {
    instances.clear()
    seedWorkspaceChangesHooks()
    let nodes = render({ type: WorkspaceChangesPanel, props: panelProps(), children: [] })
    const pullPromise = findButton(nodes, 'tabs.overview.pull').props.onClick()
    assert.equal(calls.length, 0)
    closeDialog(true)
    await pullPromise
    await new Promise(function (resolve) { setTimeout(resolve, 0) })
    const pull = calls.find(function (call) { return call.url.indexOf('/project/pull') > 0 })
    assert.equal(pull.method, 'POST')
    assert.deepEqual(pull.body, { workspaceId: 'w1' })
    assert.equal(toasts.some(function (toast) { return toast.text === 'tabs.overview.pullSuccess' }), true)
    assert.equal(changed, 1)

    instances.clear()
    seedWorkspaceChangesHooks()
    nodes = render({ type: WorkspaceChangesPanel, props: panelProps(), children: [] })
    const pushPromise = findButton(nodes, 'tabs.overview.push').props.onClick()
    assert.equal(calls.some(function (call) { return call.url.indexOf('/project/push') > 0 }), false)
    closeDialog(true)
    await pushPromise
    await new Promise(function (resolve) { setTimeout(resolve, 0) })
    const push = calls.find(function (call) { return call.url.indexOf('/project/push') > 0 })
    assert.equal(push.method, 'POST')
    assert.deepEqual(push.body, { workspaceId: 'w1' })
    assert.equal(toasts.some(function (toast) { return toast.text === 'tabs.overview.pushSuccess' }), true)
    assert.equal(changed, 2)

    // An already-up-to-date pull reports it instead of claiming new commits.
    upToDate = true
    instances.clear()
    seedWorkspaceChangesHooks()
    nodes = render({ type: WorkspaceChangesPanel, props: panelProps(), children: [] })
    const freshPromise = findButton(nodes, 'tabs.overview.pull').props.onClick()
    closeDialog(true)
    await freshPromise
    assert.equal(toasts.some(function (toast) { return toast.text === 'tabs.overview.pullUpToDate' }), true)
    assert.equal(changed, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('commits tab renders only the commit history without the workspace panel', function () {
  setSelection('commits', commitData.hash)
  instances.clear()
  const instance = { hooks: [] }
  instance.hooks[0] = { value: { rows: [commitData], hasMore: false, loadingMore: false, refreshing: false, error: '' } }
  instance.hooks[1] = { value: '' }
  instance.hooks[2] = { value: 'all' }
  instance.hooks[3] = { value: { loading: false, error: '', data: null, hash: '' } }
  instance.hooks[4] = { value: null }
  instance.hooks[5] = { value: '' }
  instances.set('root:', instance)
  const nodes = render({
    type: ProjectCommits,
    props: {
      t: t, commits: [commitData], tasks: [], workspaceId: 'w1', reviewingCommit: '',
      onReview: noop, reviews: [], requirements: [], showToast: noop,
    },
    children: [],
  })
  // REQ-20261028-003: the working-tree panel moved to the overview tab, so the
  // commits tab keeps only the master-detail list (plus the optional picker).
  const tabFill = nodes.find(function (node) {
    return node.props && node.props.className === 'devbench-tab-fill'
  })
  assert.equal(Boolean(tabFill), true)
  assert.equal(tabFill.children.length, 2)
  assert.equal(tabFill.children[0].props.className, 'devbench-master')
  assert.equal(nodes.some(function (node) {
    return node.props && node.props.className === 'devbench-ws-panel'
  }), false)
  assert.equal(textOf(nodes, []).join(' ').indexOf('tabs.overview.workspaceLoading') >= 0, false)
  assert.equal(nodes.filter(function (node) {
    const tokens = String(node.props && node.props.className || '').split(/\s+/)
    return node.type === 'div' && tokens.indexOf('devbench-master-row') >= 0
  }).length, 1)
})
function overviewPanelProps(overrides) {
  return Object.assign({
    t: t,
    overview: { loading: false, error: '', data: overviewData },
    tasks: [taskData],
    onViewTab: noop, onOpenReview: noop,
    onStartCommit: noop, onStartReview: noop,
    canCommit: true, previewBusy: false, activeCommitTask: null,
    canReviewLatest: true, reviewBusy: false,
    onStartUncommittedReview: noop,
    canReviewUncommitted: true, reviewUncommittedBusy: false, activeUncommittedReviewTask: null,
    onOpenSession: noop, onCancelTask: noop, taskBusyKey: '',
    workspaceId: 'w1', revision: 4, showToast: noop, onChanged: noop,
  }, overrides)
}
test('project overview renders the workspace panel between the AI actions and the recent grid', async function () {
  instances.clear()
  // ProjectOverview is the root instance, so its working-tree panel child is
  // the third rendered child (index 2) at instance key 'root:.2:'.
  seedWorkspaceChangesHooks({ loading: true, data: null }, 'root:.2:')
  let nodes = render({ type: ProjectOverview, props: overviewPanelProps({}), children: [] })
  function findIndexByClass(className) {
    return nodes.findIndex(function (node) {
      return node.props && String(node.props.className || '').split(/\s+/).indexOf(className) >= 0
    })
  }
  const aiIndex = findIndexByClass('devbench-overview-ai')
  const panelIndex = findIndexByClass('devbench-ws-panel')
  const gridIndex = findIndexByClass('devbench-overview-grid')
  assert.equal(aiIndex >= 0, true)
  assert.equal(panelIndex >= 0, true)
  assert.equal(gridIndex >= 0, true)
  // AI actions first, then the working-tree panel, then the recent-commit grid.
  assert.equal(aiIndex < panelIndex, true)
  assert.equal(panelIndex < gridIndex, true)
  assert.equal(textOf(nodes, []).join(' ').indexOf('tabs.overview.workspaceLoading') >= 0, true)

  // The panel's own data is seeded; its showToast/onChanged callbacks come from
  // the ProjectOverview props (i.e. the workbench wiring is forwarded).
  const originalFetch = globalThis.fetch
  const toasts = []
  let changed = 0
  globalThis.fetch = async function (url) {
    const target = String(url)
    let value = {}
    if (target.indexOf('/project/pull') > 0) {
      value = {
        pulled: true, alreadyUpToDate: false, before: 'a', after: 'b',
        branch: 'main', upstream: workspaceChangesData.upstream, detail: 'Fast-forward',
      }
    } else if (target.indexOf('/project/changes') > 0) {
      value = workspaceChangesData
    }
    return { status: 200, json: async function () { return { ok: true, value: value } } }
  }
  try {
    instances.clear()
    seedWorkspaceChangesHooks({}, 'root:.2:')
    const props = overviewPanelProps({
      showToast: function (kind, text) { toasts.push({ kind: kind, text: text }) },
      onChanged: function () { changed += 1 },
    })
    nodes = render({ type: ProjectOverview, props: props, children: [] })
    // The seeded panel renders its full working-tree snapshot with live actions.
    findButton(nodes, 'tabs.overview.manualCommit').props.onClick()
    nodes = render({ type: ProjectOverview, props: props, children: [] })
    assert.equal(textOf(nodes, []).join(' ').indexOf('tabs.overview.commitHint') >= 0, true)
    await findButton(nodes, 'tabs.overview.commitConfirm').props.onClick()
    assert.deepEqual(toasts, [{ kind: 'error', text: 'tabs.overview.commitEmpty' }])
    const pullPromise = findButton(nodes, 'tabs.overview.pull').props.onClick()
    closeDialog(true)
    await pullPromise
    await new Promise(function (resolve) { setTimeout(resolve, 0) })
    assert.equal(changed, 1)
    assert.equal(toasts.some(function (toast) { return toast.text === 'tabs.overview.pullSuccess' }), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('project styles keep master-detail panes scrollable and commit diffs independently scrollable', function () {
  assert.equal(CSS.indexOf('.devbench-tab-fill{') >= 0, true)
  assert.equal(CSS.indexOf('.devbench-master-detail-body{flex:1;min-height:0;overflow:auto') >= 0, true)
  assert.equal(CSS.indexOf('.devbench-master-detail-body .devbench-md{overflow:visible') >= 0, true)
  assert.equal(CSS.indexOf('.devbench-commit-detail-body{display:flex;flex-direction:column;gap:10px;overflow:hidden') >= 0, true)
  assert.equal(CSS.indexOf('.devbench-commit-browser{') >= 0, true)
  assert.equal(CSS.indexOf('.devbench-commit-tree{') >= 0, true)
  assert.equal(CSS.indexOf('.devbench-commit-diff{flex:1;min-width:0;min-height:0;margin:0;') >= 0, true)
  assert.equal(CSS.indexOf('max-height:320px'), -1)
  assert.equal(CSS.indexOf('.devbench-detail-actions{') >= 0, true)
  // REQ-20261028-003: the working-tree panel lives on the overview tab and takes
  // its spacing from the overview flex gap, so it keeps no outer margins.
  assert.equal(CSS.indexOf('.devbench-ws-panel{flex:none;display:flex;flex-direction:column;min-width:0;margin:0;') >= 0, true)
  assert.equal(CSS.indexOf('.devbench-ws-files{max-height:140px;overflow:auto') >= 0, true)
  assert.equal(CSS.indexOf('.devbench-ws-diff{max-height:') >= 0, true)
})
