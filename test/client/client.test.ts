import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { initRuntime } from '../../src/client/runtime.js'
import { createLatestRequest, createSingleFlight, createSerialQueue, pathInside } from '../../src/client/core/async.js'
import { sanitizeHref, renderMarkdown } from '../../src/client/ui/markdown.js'
import { zh, en } from '../../src/client/i18n/index.js'
import { request } from '../../src/client/core/api.js'
import { createPlugin } from '../../src/client/plugin.js'
import { formatShortTime } from '../../src/client/ui/common.js'
import { uiStore, resetUiStore, setSelection, setListState, resetListState } from '../../src/client/core/ui-store.js'
import { setLeaveGuard, clearLeaveGuard, navigateView, hasLeaveGuard } from '../../src/client/core/navigation.js'

const anyGlobal: any = globalThis

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const fakeReact = {
  createElement(type, props) {
    const children = Array.prototype.slice.call(arguments, 2)
    return { type: type, props: props || {}, children: children }
  },
  Fragment: 'Fragment',
}
initRuntime(function () { return fakeReact })
function flatten(nodes, out?) {
  const list = out || []
  for (const node of nodes || []) {
    if (Array.isArray(node)) flatten(node, list)
    else if (node && typeof node === 'object') {
      list.push(node)
      flatten(node.children, list)
    }
  }
  return list
}
test('i18n keys stay aligned', function () {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.equal(zh['detail.serverChanged'].length > 0, true)
  assert.equal(en['common.refreshFailed'].length > 0, true)
  assert.equal(zh['project.tab.worktrees'], '工作树')
  assert.equal(en['project.tab.worktrees'], 'Worktrees')
  assert.equal(zh['detail.commits'].length > 0, true)
  assert.equal(en['tabs.commits.files'].length > 0, true)
  assert.equal(zh['tabs.commits.diffTree'].length > 0, true)
  assert.equal(en['tabs.commits.emptyDiff'].length > 0, true)
  assert.equal(zh['project.open.vscode'].length > 0, true)
  assert.equal(zh['project.commit.confirm.worktreeHint'].indexOf('{branch}') >= 0, true)
  assert.equal(zh['project.worktrees.pushNoRemote'].length > 0, true)
  assert.equal(en['project.worktrees.commitSuccess'].indexOf('{short}') >= 0, true)
  assert.equal(zh['project.worktrees.remove'].length > 0, true)
  assert.equal(zh['project.worktrees.removeBody'].indexOf('{path}') >= 0, true)
  assert.equal(en['project.worktrees.removeBody'].indexOf('{branch}') >= 0, true)
  assert.equal(zh['project.worktrees.removed'].length > 0, true)
  assert.equal(zh['project.commit.confirm.hint'].indexOf('不会自动创建评审任务') >= 0, true)
  assert.equal(en['project.commit.confirm.hint'].indexOf('No review task is created automatically') >= 0, true)
  assert.equal(zh['list.loadMore'].indexOf('{count}') >= 0, true)
  assert.equal(en['list.loadMore'].indexOf('{count}') >= 0, true)
  assert.equal(zh['list.shownAll'].indexOf('{total}') >= 0, true)
  assert.equal(en['list.shownAll'].indexOf('{total}') >= 0, true)
  // REQ-20261027-003: uncommitted working-tree review copy.
  assert.equal(zh['project.ai.reviewUncommitted'], '评审未提交')
  assert.equal(en['project.ai.reviewUncommitted'], 'Review uncommitted')
  assert.equal(zh['project.ai.reviewUncommittedBusy'], '正在发起评审…')
  assert.equal(en['project.ai.reviewUncommittedBusy'], 'Starting review...')
  assert.equal(zh['project.ai.reviewUncommittedActive'], '未提交评审进行中')
  assert.equal(zh['project.ai.reviewUncommittedHint'].indexOf('{count}') >= 0, true)
  assert.equal(en['project.ai.reviewUncommittedHint'].indexOf('{count}') >= 0, true)
  assert.equal(zh['project.review.uncommittedTarget'], '未提交变更')
  assert.equal(en['project.review.uncommittedTarget'], 'Uncommitted changes')
  assert.equal(zh['project.review.uncommittedStarted'], '未提交变更评审任务已创建')
  assert.equal(en['project.review.uncommittedStarted'], 'Uncommitted review task created')
  assert.equal(zh['tabs.tasks.field.target'], '评审目标')
  assert.equal(en['tabs.tasks.field.target'], 'Review target')
  // REQ-20261027-004 / REQ-20261028-003: working-tree panel copy (now on the overview tab).
  assert.equal(zh['tabs.overview.workspace'], '工作区')
  assert.equal(en['tabs.overview.workspace'], 'Working tree')
  assert.equal(zh['tabs.overview.workspace.changes'].indexOf('{count}') >= 0, true)
  assert.equal(en['tabs.overview.workspace.changes'].indexOf('{count}') >= 0, true)
  assert.equal(zh['tabs.overview.workspace.upstream'].indexOf('{remote}') >= 0, true)
  assert.equal(en['tabs.overview.workspace.upstream'].indexOf('{branch}') >= 0, true)
  assert.equal(zh['tabs.overview.workspace.ahead'].indexOf('{count}') >= 0, true)
  assert.equal(en['tabs.overview.workspace.behind'].indexOf('{count}') >= 0, true)
  assert.equal(zh['tabs.overview.pullConfirmBody'].indexOf('{branch}') >= 0, true)
  assert.equal(en['tabs.overview.pullConfirmBody'].indexOf('{upstream}') >= 0, true)
  assert.equal(zh['tabs.overview.pushConfirmBody'].indexOf('{remote}') >= 0, true)
  assert.equal(en['tabs.overview.commitSuccess'].indexOf('{short}') >= 0, true)
  assert.equal(zh['tabs.commits.workspace'] === undefined, true)
  assert.equal(en['tabs.commits.workspace'] === undefined, true)
  // REQ-20261028-001: requirement list title/full-text search scope copy.
  assert.equal(zh['project.requirements.search.scope'], '检索范围')
  assert.equal(en['project.requirements.search.scope'], 'Search scope')
  assert.equal(zh['project.requirements.search.title'], '标题')
  assert.equal(en['project.requirements.search.title'], 'Title')
  assert.equal(zh['project.requirements.search.full'], '全文')
  assert.equal(en['project.requirements.search.full'], 'Full text')
  assert.equal(zh['project.requirements.search.loading'], '检索中…')
  assert.equal(en['project.requirements.search.loading'], 'Searching...')
  assert.equal(zh['project.requirements.search.failed'], '全文检索失败')
  assert.equal(en['project.requirements.search.failed'], 'Full-text search failed')
  assert.equal(zh['project.requirements.search.hasMore'].indexOf('{count}') >= 0, true)
  assert.equal(en['project.requirements.search.hasMore'].indexOf('{count}') >= 0, true)
  assert.equal(zh['project.requirements.search.retry'], '重试')
  assert.equal(en['project.requirements.search.retry'], 'Retry')
  // REQ-20261028-003: configurable AI commit prompt template copy.
  assert.equal(zh['settings.commitTemplate'], '提交提示词模板')
  assert.equal(en['settings.commitTemplate'], 'Commit prompt template')
  assert.equal(zh['settings.commitTemplate.hint'].indexOf('{worktreeInfo}') >= 0, true)
  assert.equal(en['settings.commitTemplate.hint'].indexOf('{changedFiles}') >= 0, true)
  assert.equal(zh['settings.commitTemplate.hint'].indexOf('{diffText}') >= 0, true)
  assert.equal(zh['settings.commitTemplate.reset'], '恢复默认')
  assert.equal(en['settings.commitTemplate.reset'], 'Reset to default')
  assert.equal(zh['settings.commitTemplate.invalid'].indexOf('{taskId}') >= 0, true)
  assert.equal(en['settings.commitTemplate.invalid'].indexOf('{diffText}') >= 0, true)
  // REQ-20261031-004: project documents tab and requirement favorites copy.
  assert.equal(zh['project.tab.documents'], '文档')
  assert.equal(en['project.tab.documents'], 'Documents')
  assert.equal(zh['project.documents.title'], '文档')
  assert.equal(en['project.documents.title'], 'Documents')
  assert.equal(zh['project.documents.search.full'], '全文')
  assert.equal(en['project.documents.search.full'], 'Full text')
  assert.equal(zh['project.documents.search.hasMore'].indexOf('{count}') >= 0, true)
  assert.equal(en['project.documents.search.hasMore'].indexOf('{count}') >= 0, true)
  assert.equal(zh['project.documents.delete.body'].indexOf('{name}') >= 0, true)
  assert.equal(en['project.documents.delete.body'].indexOf('{name}') >= 0, true)
  assert.equal(zh['project.documents.conflict.overwrite'], '覆盖保存')
  assert.equal(en['project.documents.conflict.overwrite'], 'Overwrite and save')
  assert.equal(zh['project.requirements.favorite'], '收藏')
  assert.equal(en['project.requirements.favorite'], 'Favorite')
  assert.equal(zh['project.requirements.unfavorite'], '取消收藏')
  assert.equal(en['project.requirements.unfavorite'], 'Unfavorite')
  assert.equal(zh['project.requirements.favoriteOnly'], '仅收藏')
  assert.equal(en['project.requirements.favoriteOnly'], 'Favorites only')
})
test('markdown href policy rejects scripts and protocol relative urls', function () {
  assert.equal(sanitizeHref('javascript:alert(1)'), null)
  assert.equal(sanitizeHref('data:text/html,x'), null)
  assert.equal(sanitizeHref('//evil.example/x'), null)
  assert.equal(sanitizeHref('/\\evil.example/x'), null)
  assert.equal(sanitizeHref('https://example.com/a').external, true)
  assert.equal(sanitizeHref('mailto:a@example.com').external, false)
  assert.equal(sanitizeHref('#section').external, false)
  assert.equal(sanitizeHref('/inside/path').external, false)
})
test('markdown never creates raw html and only safe links', function () {
  const body = '<script>window.xss=1</script>\n\n[bad](javascript:alert(1))\n\n[proto](//evil.example/x)\n\n[ok](https://example.com/a)\n\n[anchor](#x)'
  const nodes = flatten(renderMarkdown(body))
  assert.equal(nodes.some(function (n) { return n.type === 'script' || n.type === 'img' }), false)
  const anchors = nodes.filter(function (n) { return n.type === 'a' })
  assert.equal(anchors.length, 2)
  const external = anchors.find(function (n) { return n.props.href === 'https://example.com/a' })
  const anchor = anchors.find(function (n) { return n.props.href === '#x' })
  assert.equal(external.props.target, '_blank')
  assert.equal(external.props.rel, 'noreferrer noopener')
  assert.equal(anchor.props.target, undefined)
})
test('latest request token only accepts the newest response', function () {
  const latest = createLatestRequest()
  const a = latest.next()
  const b = latest.next()
  assert.equal(latest.current(a), false)
  assert.equal(latest.current(b), true)
  latest.invalidate()
  assert.equal(latest.current(b), false)
})
test('single flight deduplicates concurrent work and clears after settle', async function () {
  let count = 0
  let release
  const gate = new Promise(function (resolve) { release = resolve })
  const single = createSingleFlight()
  const first = single.run('r1', function () { count += 1; return gate })
  const second = single.run('r1', function () { count += 1; return 'bad' })
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(count, 1)
  release('ok')
  assert.equal(await first, 'ok')
  assert.equal(single.has('r1'), false)
  assert.equal(await single.run('r1', function () { count += 1; return 'again' }), 'again')
  assert.equal(count, 2)
})
test('serial queue preserves order and survives failures', async function () {
  const queue = createSerialQueue()
  const seen = []
  const one = queue(async function () { seen.push(1); throw new Error('x') })
  const two = queue(async function () { seen.push(2); return 2 })
  await assert.rejects(one)
  assert.equal(await two, 2)
  assert.deepEqual(seen, [1, 2])
  assert.equal(pathInside('docs', 'docs/a.md'), true)
  assert.equal(pathInside('docs', 'docs2/a.md'), false)
})
test('api request unwraps values, preserves error codes and times out', async function () {
  const originalFetch = globalThis.fetch
  try {
    let seenHeader = ''
    anyGlobal.fetch = async function (url, init) {
      seenHeader = init.headers['x-dsh-devbench']
      return { status: 200, json: async function () { return { ok: true, value: { id: 'r1' } } } }
    }
    assert.deepEqual(await request('/x'), { id: 'r1' })
    assert.equal(seenHeader, '1')
    anyGlobal.fetch = async function () {
      return { status: 400, json: async function () { return { ok: false, error: { code: 'bad', message: 'bad request' } } } }
    }
    await assert.rejects(request('/x'), function (err: any) { return err.code === 'bad' })
    anyGlobal.fetch = function (url, init) {
      return new Promise(function (resolve, reject) {
        init.signal.addEventListener('abort', function () {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }
    await assert.rejects(request('/slow', undefined, { timeoutMs: 10 }), function (err: any) {
      return err.name === 'TimeoutError'
    })
  } finally {
    anyGlobal.fetch = originalFetch
  }
})
test('plugin keeps DSH inject and slot registration contract', function () {
  const registered = []
  let dictionaries = null
  const ctx = {
    effect(fn) { fn() },
    locale: {
      register(ns, value) { dictionaries = { ns: ns, value: value } },
      bind() { return function (key) { return key } },
    },
    slots: {
      inject(name, fn) { fn() },
      register(config, component) { registered.push({ config: config, component: component }); return {} },
    },
  }
  const plugin = createPlugin()
  assert.equal(plugin.inject.includes('remote.session'), true)
  plugin.apply(ctx)
  assert.equal(dictionaries.ns, 'devbench')
  assert.equal(registered.length, 3)
  assert.equal(registered[0].config.key, 'devbench')
  assert.equal(registered[1].config.id, 'devbench')
  assert.equal(registered[2].config.id, 'devbench-link')
})
test('built client preserves module loader id and externalizes react', function () {
  const code = fs.readFileSync('dist/client.js', 'utf8')
  assert.equal(code.includes('__ModuleLoader__.load'), true)
  assert.equal(code.includes(pkg.name), true)
  assert.equal(code.includes('factory(require)'), true)
  assert.equal(code.includes('require("react")'), true)
  assert.equal(code.includes('import '), false)
  let definition = null
  const window = { __ModuleLoader__: { load(value) { definition = value } } }
  const sandbox = {
    window: window, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    AbortController: AbortController, URL: URL, Intl: Intl,
  }
  vm.runInNewContext(code, sandbox, { filename: 'dist/client.js' })
  assert.equal(definition.id, pkg.name)
  const plugin = definition.factory(function (name) {
    assert.equal(name, 'react')
    return fakeReact
  })
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale', 'layout', 'uiWorkspace', 'sessions', 'remote', 'remote.session'])
})
test('critical race guards remain wired in the source modules', function () {
  const page = fs.readFileSync('src/client/views/project/devbench.ts', 'utf8')
  const requirements = fs.readFileSync('src/client/views/project/requirements.ts', 'utf8')
  const sidebar = fs.readFileSync('src/client/views/project/sidebar.ts', 'utf8')
  const detail = fs.readFileSync('src/client/views/project/requirement-detail.ts', 'utf8')
  const worktrees = fs.readFileSync('src/client/views/project/worktrees.ts', 'utf8')
  const listPage = fs.readFileSync('src/client/ui/list-page.ts', 'utf8')
  const home = fs.readFileSync('src/client/views/home.ts', 'utf8')
  const tasks = fs.readFileSync('src/client/views/project/tasks.ts', 'utf8')
  const reviews = fs.readFileSync('src/client/views/project/reviews.ts', 'utf8')
  const commitsView = fs.readFileSync('src/client/views/project/commits.ts', 'utf8')
  const overviewView = fs.readFileSync('src/client/views/project/overview.ts', 'utf8')
  const workspaceChanges = fs.readFileSync('src/client/views/project/workspace-changes.ts', 'utf8')
  const settingsView = fs.readFileSync('src/client/views/settings.ts', 'utf8')
  const diffBrowser = fs.readFileSync('src/client/ui/commit-diff-browser.ts', 'utf8')
  const confirmModal = fs.readFileSync('src/client/ui/commit-confirm-modal.ts', 'utf8')
  const hostState = fs.readFileSync('src/host/services/state.ts', 'utf8')
  const background = fs.readFileSync('src/host/services/background-agent.ts', 'utf8')
  const tree = fs.readFileSync('src/client/ui/file-tree.ts', 'utf8')
  const action = fs.readFileSync('src/client/views/project/session-action.ts', 'utf8')
  const apiSource = fs.readFileSync('src/client/core/api.ts', 'utf8')
  const uiStoreSource = fs.readFileSync('src/client/core/ui-store.ts', 'utf8')
  const projectStyles = fs.readFileSync('src/client/ui/styles-project.ts', 'utf8')
  assert.equal(page.includes('stateSeqRef.current !== seq'), true)
  assert.equal(page.includes('overviewSeqRef.current !== seq'), true)
  assert.equal(page.includes('tasksGateRef.current.begin()'), true)
  assert.equal(page.includes('tasksGateRef.current.finish(controller)'), true)
  assert.equal(page.includes('activeCommitTask === null'), true)
  assert.equal(page.includes('setInterval'), true)
  assert.equal(page.includes('2000'), true)
  assert.equal(page.includes('findAwaitingCommitTask'), true)
  assert.equal(page.includes('confirmBusyRef.current'), true)
  assert.equal(page.includes('cancelBusyRef.current'), true)
  assert.equal(page.includes('previewBusyRef.current'), true)
  assert.equal(page.includes('addBusyRef.current'), true)
  assert.equal(page.includes('gitBusyRef.current'), true)
  assert.equal(requirements.includes('detailSeqRef.current !== seq'), true)
  assert.equal(requirements.includes('requirementExecutions.run'), true)
  assert.equal(requirements.includes('createBusyRef.current'), true)
  assert.equal(requirements.includes('unlinkBusyRef.current'), true)
  assert.equal(requirements.includes('deleteBusyRef.current'), true)
  assert.equal(requirements.includes("ctx.sessions.create({ workspaceId: item.workspaceId })"), true)
  assert.equal(requirements.includes("ctx.sessions.create({ cwd: result.cwd })"), true)
  assert.equal(requirements.includes('result.worktree'), true)
  assert.equal(requirements.includes("item.status === 'running'"), true)
  assert.equal(requirements.includes('Promise.allSettled([loadDetail(selectedNext), reloadState(), reloadTasks])'), true)
  assert.equal(requirements.includes('api.recordRequirementTask'), true)
  // REQ-20261028-001: title/full-text requirement search wiring.
  assert.equal(apiSource.includes("'/requirement/search?'"), true)
  assert.equal(apiSource.includes('export function searchRequirements'), true)
  assert.equal(uiStoreSource.includes("scope: 'title'"), true)
  assert.equal(requirements.includes('SEARCH_DEBOUNCE_MS = 250'), true)
  assert.equal(requirements.includes('createFullTextSearch'), true)
  assert.equal(requirements.includes('api.searchRequirements'), true)
  assert.equal(requirements.includes('mergeSearchItems'), true)
  assert.equal(requirements.includes('remoteResult.hasMore === true'), true)
  assert.equal(requirements.includes('project.requirements.search.hasMore'), true)
  assert.equal(requirements.includes('project.requirements.search.loading'), true)
  assert.equal(requirements.includes('project.requirements.search.retry'), true)
  assert.equal(requirements.includes('project.requirements.search.scope'), true)
  assert.equal(projectStyles.includes('.devbench-master-row-snippet{'), true)
  assert.equal(projectStyles.includes('.devbench-search-scope{'), true)
  assert.equal(page.includes("onReloadTasks: function () { return loadTasks(currentWorkspace.workspaceId) }"), true)
  assert.equal(page.includes("ui.view === 'home'"), true)
  assert.equal(page.includes('HomeView'), true)
  assert.equal(page.includes("activeTab === 'commits'"), true)
  assert.equal(page.includes('workspaceId: selectedProjectId'), true)
  assert.equal(page.includes('ProjectWorktrees'), true)
  assert.equal(page.includes('refreshAfterCommit(selectedProjectId)'), true)
  assert.equal((page.match(/revision: worktreeRevision/g) || []).length, 2)
  assert.equal(page.includes("['worktrees', 'project.tab.worktrees']"), true)
  assert.equal(page.includes('confirmWorktreeCommit'), true)
  assert.equal(page.includes('worktreeRevision'), true)
  assert.equal(page.includes("const inProjectView = uiStore.state.view === 'project'"), true)
  assert.equal(page.includes('if (current === workspaceId && inProjectView)'), true)
  assert.equal(page.includes('onWorktreeCommitTask'), true)
  assert.equal(sidebar.includes('props.onHome'), true)
  assert.equal(sidebar.includes('devbench-project-activity-dot'), true)
  assert.equal(hostState.includes('activeTaskCount'), true)
  // REQ-20261028-003: configurable commit prompt template is persisted and exposed in /state.
  assert.equal(hostState.includes('commitPromptTemplate'), true)
  assert.equal(hostState.includes('defaultCommitPromptTemplate'), true)
  assert.equal(settingsView.includes('commitTemplateProblem'), true)
  assert.equal(settingsView.includes('commitPromptTemplate: commitTemplate'), true)
  assert.equal(settingsView.includes('defaultCommitPromptTemplate'), true)
  assert.equal(settingsView.includes('resetCommitTemplate'), true)
  assert.equal(background.includes('workspace.attachSession(sessionId)'), true)
  assert.equal(detail.includes('createSerialQueue()'), true)
  assert.equal(detail.includes('saveFields({ status: status })'), true)
  assert.equal(detail.includes('saveBeforeExecute'), true)
  assert.equal(detail.includes("key: 'tree-' + key + '-' + fileRevision"), true)
  assert.equal(detail.includes('loadGitLog'), false)
  assert.equal(detail.includes('detail.git.settingsOnly'), false)
  assert.equal(detail.includes("detailTabButton('git'"), false)
  assert.equal(detail.includes('detail.commits'), true)
  assert.equal(detail.includes('linkRequirementCommit'), true)
  assert.equal(commitsView.includes('getProjectCommitDetail'), true)
  assert.equal(commitsView.includes('CommitDiffBrowser'), true)
  assert.equal(commitsView.includes("className: 'devbench-tab-fill'"), true)
  // REQ-20261028-003: the working-tree panel moved from the commits tab to the overview tab.
  assert.equal(commitsView.includes('WorkspaceChangesPanel'), false)
  assert.equal(commitsView.includes('activeCommitTask: props.activeCommitTask'), false)
  assert.equal(overviewView.includes('WorkspaceChangesPanel'), true)
  assert.equal(overviewView.includes('workspaceId: props.workspaceId'), true)
  assert.equal(overviewView.includes('activeCommitTask: props.activeCommitTask'), true)
  assert.equal(page.includes("activeTab === 'overview'"), true)
  assert.equal(workspaceChanges.includes('getProjectChanges'), true)
  assert.equal(workspaceChanges.includes('manualProjectCommit'), true)
  assert.equal(workspaceChanges.includes('pullProject'), true)
  assert.equal(workspaceChanges.includes('pushProject'), true)
  assert.equal(workspaceChanges.includes('seqRef.current !== seq'), true)
  assert.equal(workspaceChanges.includes('data.initialized !== true'), true)
  assert.equal(workspaceChanges.includes('confirmDialog'), true)
  assert.equal(workspaceChanges.includes('project.worktrees.noChanges'), true)
  assert.equal(workspaceChanges.includes('tabs.overview.workspace'), true)
  assert.equal(workspaceChanges.includes('tabs.commits.workspace'), false)
  assert.equal(diffBrowser.includes('buildCommitFileTree'), true)
  assert.equal(diffBrowser.includes('devbench-commit-browser'), true)
  assert.equal(diffBrowser.includes('devbench-commit-diff'), true)
  assert.equal(commitsView.includes('tabs.commits.openSession'), true)
  assert.equal(commitsView.includes('linkRequirementCommit'), true)
  assert.equal(tasks.includes('devbench-detail-actions'), true)
  assert.equal(page.includes('getProjectOpenTargets'), true)
  assert.equal(page.includes('startUncommittedReview'), true)
  assert.equal(page.includes('findActiveUncommittedReviewTask'), true)
  assert.equal(page.includes("t('project.review.uncommittedStarted')"), true)
  assert.equal(reviews.includes('project.review.uncommittedTarget'), true)
  assert.equal(tasks.includes('tabs.tasks.field.target'), true)
  assert.equal(home.includes('project.review.uncommittedTarget'), true)
  assert.equal(page.includes('project.open.'), true)
  assert.equal(detail.includes('submitCommit'), false)
  assert.equal(detail.includes('gitCommit'), false)
  assert.equal(detail.includes('gitBusy'), false)
  assert.equal(detail.includes('commitModal'), false)
  assert.equal(detail.includes('detail.git.commit'), false)
  assert.equal(worktrees.includes('getProjectWorktrees'), true)
  assert.equal(worktrees.includes('getProjectWorktreeChanges'), true)
  assert.equal(worktrees.includes('previewWorktreeCommit'), true)
  assert.equal(worktrees.includes('pushWorktree'), true)
  assert.equal(worktrees.includes('revealProjectWorktree'), true)
  assert.equal(worktrees.includes('createProjectWorktree'), true)
  assert.equal(worktrees.includes('pruneProjectWorktree'), true)
  assert.equal(worktrees.includes('devbench-worktree-diff'), true)
  assert.equal(worktrees.includes('project.worktrees.pushNoRemote'), true)
  assert.equal(worktrees.includes('project.worktrees.notCreated'), true)
  assert.equal(worktrees.includes('project.worktrees.pruneAll'), true)
  assert.equal(worktrees.includes('project.worktrees.repreview'), true)
  assert.equal(page.includes('onGoRequirements'), true)
  assert.equal(page.includes('onOpenCommitPreview: openCommitPreview'), true)
  assert.equal(page.includes('repreviewWorktreeTask'), true)
  assert.equal(worktrees.includes('beginRowAction'), true)
  assert.equal(worktrees.includes('commitTaskFor'), true)
  assert.equal(worktrees.includes('closeChanges'), true)
  assert.equal(confirmModal.includes('project.commit.confirm.worktreeHint'), true)
  assert.equal(confirmModal.includes('isWorktree && worktreeBranch !=='), true)
  assert.equal(tree.includes('fileSeq.current !== token'), true)
  assert.equal(tree.includes('props.revision'), true)
  assert.equal(action.includes("activeTab: 'requirements'"), true)
  assert.equal(action.includes('selectedProjectId'), true)
  assert.equal(listPage.includes('LIST_PAGE_SIZE = 10'), true)
  assert.equal(listPage.includes('page.total <= page.size'), true)
  assert.equal(home.includes('useListPage(recentTasks)'), true)
  assert.equal(home.includes('useListPage(activeEntries)'), true)
  assert.equal(tasks.includes('useListPage(filtered)'), true)
  assert.equal(reviews.includes('useListPage(filtered)'), true)
})

test('formatShortTime keeps dense list timestamps short', function () {
  const now = new Date(2026, 9, 26, 15, 30, 0)
  assert.equal(formatShortTime('', now), '')
  assert.equal(formatShortTime('not-a-date', now), 'not-a-date')
  assert.equal(formatShortTime(new Date(2026, 9, 26, 9, 5, 0).toISOString(), now), '09:05')
  assert.equal(formatShortTime(new Date(2026, 9, 25, 22, 8, 0).toISOString(), now), '10-25 22:08')
  assert.equal(formatShortTime(new Date(2025, 11, 31, 8, 0, 0).toISOString(), now), '2025-12-31')
})

test('sidebar workbench icon matches the package icon asset', function () {
  const source = fs.readFileSync('icon.svg', 'utf8')
  assert.equal(source.includes('<svg'), true)
  assert.equal(source.includes('M9.6 4.2v15.6'), true)
  assert.equal(source.includes('width="17.2"'), true)
  assert.equal(source.includes('M8.8 11.6'), false)
  const plugin = fs.readFileSync('src/client/plugin.ts', 'utf8')
  assert.equal(plugin.includes('DevbenchIcon'), true)
  assert.equal(plugin.includes('RequirementsIcon'), false)
})


test('ui store keeps view history, per-tab selection and list state', function () {
  resetUiStore()
  uiStore.set({ view: 'project', selectedProjectId: 'w1', selectedRequirement: null, activeTab: 'overview' })
  uiStore.enterView({ view: 'settings' })
  assert.equal(uiStore.state.view, 'settings')
  assert.equal(uiStore.state.history.length, 1)
  assert.equal(uiStore.back({ view: 'home' }), true)
  assert.equal(uiStore.state.view, 'project')
  assert.equal(uiStore.state.selectedProjectId, 'w1')
  assert.equal(uiStore.state.history.length, 0)

  setSelection('tasks', { id: 't1' })
  assert.deepEqual(uiStore.state.selection.tasks, { id: 't1' })
  setListState('requirements', { search: 'draft', limit: 20 })
  assert.equal(uiStore.state.lists.requirements.search, 'draft')
  assert.equal(uiStore.state.lists.requirements.limit, 20)
  assert.equal(uiStore.state.lists.requirements.scope, 'title')
  setListState('requirements', { scope: 'full' })
  assert.equal(uiStore.state.lists.requirements.scope, 'full')
  resetListState('requirements')
  assert.equal(uiStore.state.lists.requirements.search, '')
  assert.equal(uiStore.state.lists.requirements.limit, 10)
  assert.equal(uiStore.state.lists.requirements.scope, 'title')
  resetUiStore()
})

test('navigation guard blocks dirty view changes and allows clean ones', async function () {
  resetUiStore()
  uiStore.set({ view: 'project', selectedProjectId: 'w1' })
  assert.equal(hasLeaveGuard(), false)
  assert.equal(await navigateView({ view: 'settings' }), true)
  assert.equal(uiStore.state.view, 'settings')

  let guardCalls = 0
  setLeaveGuard(async function () {
    guardCalls += 1
    return false
  })
  assert.equal(hasLeaveGuard(), true)
  assert.equal(await navigateView({ view: 'home' }), false)
  assert.equal(uiStore.state.view, 'settings')
  assert.equal(guardCalls, 1)

  setLeaveGuard(async function () { return true })
  assert.equal(await navigateView({ view: 'home' }, { history: true }), true)
  assert.equal(uiStore.state.view, 'home')
  assert.equal(uiStore.state.history.length, 1)
  clearLeaveGuard()
  assert.equal(hasLeaveGuard(), false)
  resetUiStore()
})
