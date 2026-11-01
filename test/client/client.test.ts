import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { initRuntime, setRuntimeContext } from '../../src/client/runtime.js'
import type { ClientContext } from '../../src/client/runtime.js'
import type { FileResult, RequirementDetail, RequirementSummary } from '../../src/shared/api-types.js'
import { createLatestRequest, createSingleFlight, createSerialQueue, pathInside } from '../../src/client/core/async.js'
import { sanitizeHref, renderMarkdown } from '../../src/client/ui/markdown.js'
import { zh, en } from '../../src/client/i18n/index.js'
import { request } from '../../src/client/core/api.js'
import { createPlugin } from '../../src/client/plugin.js'
import { DevbenchIcon } from '../../src/client/ui/icons.js'
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
  const ctx: ClientContext = {
    effect(fn) { fn() },
    locale: {
      register(ns, value) { dictionaries = { ns: ns, value: value }; return function () {} },
      bind() { return function (key) { return key } },
    },
    slots: {
      inject(name, fn) { fn() },
      register(config, component) { registered.push({ config: config, component: component }); return function () {} },
    },
    layout: { selectPanel() {} },
    uiWorkspace: { async pickDirectory() { return null }, openSession() {} },
    sessions: { async create() { return 'session-1' } },
    remote: { session: {
      async prompt() { return { ok: true, value: undefined } },
      async rename() { return { ok: true, value: undefined } },
    } },
  }
  const plugin = createPlugin()
  assert.equal(plugin.inject.includes('remote.session'), true)
  plugin.apply(ctx)
  assert.equal(dictionaries.ns, 'devbench')
  assert.equal(registered.length, 3)
  assert.equal(registered[0].config.key, 'devbench')
  assert.equal(registered[1].config.id, 'devbench')
  assert.equal(registered[2].config.id, 'devbench-link')
  assert.equal(registered[1].component, DevbenchIcon)
  setRuntimeContext(null)
})
test('built client preserves module loader id and externalizes react', function () {
  const code = fs.readFileSync('dist/client.js', 'utf8')
  let definition = null
  let registrations = 0
  const window = { __ModuleLoader__: { load(value) { definition = value; registrations += 1 } } }
  const sandbox = {
    window: window, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    AbortController: AbortController, URL: URL, Intl: Intl,
  }
  vm.runInNewContext(code, sandbox, { filename: 'dist/client.js', timeout: 1000 })
  assert.equal(registrations, 1)
  assert.equal(definition.id, pkg.name)
  assert.equal(typeof definition.factory, 'function')
  const requiredModules = []
  const plugin = definition.factory(function (name) {
    requiredModules.push(name)
    return fakeReact
  })
  assert.deepEqual(requiredModules, ['react'])
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale', 'layout', 'uiWorkspace', 'sessions', 'remote', 'remote.session'])
})
test('UI races preserve the latest view and serialize requirement execution', async function () {
  const originalFetch = globalThis.fetch
  const { render, nodes, cleanup, mockApi, findButton, textOf, flushAsyncWork, waitFor } = await import('./helpers.js')
  const { act } = await import('react')
  const { FileTree } = await import('../../src/client/ui/file-tree.js')
  const { WorkspaceChangesPanel } = await import('../../src/client/views/project/workspace-changes.js')
  const { ProjectRequirements } = await import('../../src/client/views/project/requirements.js')
  const t = (key: string): string => key
  function deferred<T>() {
    let resolve: (value: T) => void
    let reject: (reason: unknown) => void
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
    return { promise, resolve: (value: T) => resolve(value), reject: (reason: unknown) => reject(reason) }
  }
  try {
    // A slower file response must not replace the newly selected file or its draft.
    const oldFile = deferred<FileResult>()
    const fileSave = deferred<{ saved: boolean }>()
    const writes: unknown[] = []
    let fileReads = 0
    mockApi((url, init) => {
      if (url.pathname.endsWith('/files/write')) {
        writes.push(JSON.parse(String(init.body)))
        return fileSave.promise
      }
      assert.ok(url.pathname.endsWith('/files'))
      fileReads += 1
      return url.searchParams.get('path') === 'a.txt'
        ? oldFile.promise
        : { kind: 'file', path: 'b.txt', size: 5, editable: true, binary: false, content: 'new B' }
    })
    const treeProps = {
      t, workspaceId: 'w1', requirementId: 'REQ-1', revision: 0,
      rootEntries: [
        { name: 'a.txt', path: 'a.txt', type: 'file' },
        { name: 'b.txt', path: 'b.txt', type: 'file' },
      ],
      showToast() {}, onDelete() {},
    }
    await render({ type: FileTree, props: treeProps })
    const fileRow = (name: string) => nodes().find(node =>
      node.props.className?.startsWith('devbench-file-row') && textOf(node).includes(name))
    await fileRow('a.txt').props.onClick()
    await fileRow('b.txt').props.onClick()
    assert.equal(nodes().find(node => node.type === 'textarea').props.value, 'new B')
    await act(async () => {
      oldFile.resolve({ kind: 'file', path: 'a.txt', size: 5, editable: true, binary: false, content: 'old A' })
    })
    assert.equal(nodes().find(node => node.type === 'textarea').props.value, 'new B')
    await nodes().find(node => node.type === 'textarea').props.onChange({ target: { value: 'edited B' } })
    const save = findButton(nodes(), 'detail.files.save')
    save.props.onClick()
    await save.props.onClick()
    await fileRow('a.txt').props.onClick()
    assert.deepEqual(writes, [{ workspaceId: 'w1', id: 'REQ-1', path: 'b.txt', content: 'edited B' }])
    assert.equal(fileReads, 2, 'saving blocks switching files')
    assert.equal(nodes().find(node => node.type === 'textarea').props.disabled, true)
    await act(async () => { fileSave.resolve({ saved: true }) })
    await waitFor(() => Boolean(findButton(nodes(), 'detail.files.save')), 'file save settles')
    assert.equal(findButton(nodes(), 'detail.files.save').props.disabled, true, 'saved draft is clean')
    await render({ type: FileTree, props: { ...treeProps, revision: 1 } })
    assert.equal(nodes().some(node => node.type === 'textarea'), false, 'revision clears file selection')
    cleanup()

    const oldWorkspace = deferred<unknown>()
    const changes = (branch: string) => ({ initialized: true, branch, head: 'abc', files: [], remotes: [] })
    mockApi(url => {
      assert.ok(url.pathname.endsWith('/project/changes'))
      return url.searchParams.get('workspaceId') === 'w1' ? oldWorkspace.promise : changes('new-branch')
    })
    await render({ type: WorkspaceChangesPanel, props: { t, workspaceId: 'w1' } })
    await render({ type: WorkspaceChangesPanel, props: { t, workspaceId: 'w2' } })
    assert.ok(textOf(nodes()).includes('new-branch'))
    await act(async () => { oldWorkspace.resolve(changes('old-branch')) })
    assert.ok(textOf(nodes()).includes('new-branch'))
    assert.equal(textOf(nodes()).includes('old-branch'), false)
    cleanup()

    const first: RequirementSummary = {
      workspaceId: 'w1', id: 'REQ-1', title: 'First', status: 'new', folder: 'REQ-1',
      path: '/tmp/REQ-1/requirement.md', createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z', sessions: [], commits: [], worktree: false, favorite: false,
    }
    const second = { ...first, id: 'REQ-2', title: 'Second' }
    const worktree = { enabled: false, exists: false, path: '', branch: '', base: '' }
    // Exercise both session locations and a rejected session creation.
    for (const mode of ['workspace', 'worktree', 'failed'] as const) {
      const events: string[] = []
      const posts: Array<{ path: string; body: Record<string, unknown> }> = []
      const locations: Array<{ workspaceId: string } | { cwd: string }> = []
      const opened: string[] = []
      const oldDetail = deferred<RequirementDetail>()
      const draftSave = deferred<void>()
      const session = deferred<Awaited<ReturnType<ClientContext['sessions']['create']>>>()
      const reload = deferred<void>()
      let detail: RequirementDetail = { requirement: { ...second }, body: 'Second body', files: [], worktree }
      const ctx: ClientContext = {
        effect(callback) { callback() },
        locale: { bind: () => t, register: () => () => {} },
        slots: { inject(callbackName, callback) { callback() }, register: () => () => {} },
        layout: { selectPanel() {} },
        uiWorkspace: { async pickDirectory() { return null }, openSession(id) { opened.push(id) } },
        sessions: { create(options) { locations.push(options); events.push('create-session'); return session.promise } },
        remote: { session: {
          async prompt(options) {
            events.push('prompt')
            assert.equal(options.sessionId, 'session-2')
            assert.deepEqual(options.content, [{ type: 'text', text: 'Execute second' }])
            return { ok: true, value: undefined }
          },
          async rename(options) { assert.equal(options.sessionId, 'session-2'); return { ok: true, value: undefined } },
        } },
      }
      setRuntimeContext(ctx)
      mockApi(async (url, init) => {
        const body = JSON.parse(String(init.body))
        const path = url.pathname.replace('/dsh-devbench/api', '')
        if (path === '/requirement/get') return body.id === 'REQ-1' ? oldDetail.promise : detail
        posts.push({ path, body })
        if (path === '/requirement/save') {
          if (body.title) {
            events.push('save-draft')
            await draftSave.promise
            detail = { ...detail, body: body.body, requirement: { ...detail.requirement, title: body.title } }
            events.push('saved-draft')
          } else {
            events.push('status:' + body.status)
            detail = { ...detail, requirement: { ...detail.requirement, status: body.status } }
          }
          return { requirement: detail.requirement }
        }
        if (path === '/requirement/execute') {
          events.push('execute')
          return { prompt: 'Execute second', worktree: { ...worktree, enabled: mode === 'worktree' }, cwd: '/tmp/worktree' }
        }
        if (path === '/requirement/link-session') {
          events.push('link')
          assert.equal(body.sessionId, 'session-2')
          detail = { ...detail, requirement: { ...detail.requirement, sessions: ['session-2'] } }
          return { requirement: detail.requirement }
        }
        assert.equal(path, '/requirement/execute/task')
        events.push('record-task')
        assert.equal(body.sessionId, 'session-2')
        return { task: { id: 'task-2' } }
      })
      resetUiStore()
      uiStore.set({ view: 'project', selectedProjectId: 'w1', activeTab: 'requirements',
        selectedRequirement: { workspaceId: 'w1', id: mode === 'workspace' ? 'REQ-1' : 'REQ-2' } })
      await render({ type: ProjectRequirements, props: {
        t, workspace: { workspaceId: 'w1', requirements: [first, second] }, configured: true,
        tasks: [], showToast() {},
        onReloadState() { events.push('reload-state'); return reload.promise },
        async onReloadTasks() { events.push('reload-tasks'); throw new Error('refresh failed') },
      } })
      if (mode === 'workspace') {
        await act(async () => {
          await nodes().find(node => node.props.className?.startsWith('devbench-master-row') &&
            node.props.role === 'button' && textOf(node).includes('Second')).props.onClick()
        })
        assert.ok(textOf(nodes()).includes('Second body'))
        await act(async () => { oldDetail.resolve({ requirement: first, body: 'Old first body', files: [], worktree }) })
        assert.equal(textOf(nodes()).includes('Old first body'), false)
        assert.ok(textOf(nodes()).includes('Second body'))
      }
      await findButton(nodes(), 'detail.edit').props.onClick()
      await nodes().find(node => node.type === 'textarea').props.onChange({ target: { value: 'Edited second body' } })
      const execute = findButton(nodes(), 'detail.execute')
      execute.props.onClick()
      await execute.props.onClick()
      assert.deepEqual(events, ['save-draft'], 'execution waits for the draft save')
      assert.equal(locations.length, 0)
      assert.equal(posts[0].body.body, 'Edited second body')
      await act(async () => { draftSave.resolve() })
      await waitFor(() => locations.length === 1, 'session creation follows the draft save')
      assert.deepEqual(locations, [mode === 'worktree' ? { cwd: '/tmp/worktree' } : { workspaceId: 'w1' }])
      assert.deepEqual(events, ['save-draft', 'saved-draft', 'execute', 'create-session'])
      await act(async () => {
        if (mode === 'failed') session.reject(new Error('Session creation failed'))
        else session.resolve('session-2')
      })
      await waitFor(() => events.includes('reload-state'), 'execution refreshes the state after settling')
      assert.deepEqual(opened, [], 'session opens only after refreshes settle')
      await act(async () => { reload.resolve() })
      await flushAsyncWork()
      if (mode === 'failed') {
        assert.equal(events.includes('link') || events.includes('prompt') || events.includes('record-task'), false)
        assert.ok(events.includes('status:new'), 'failed execution restores the previous status')
        assert.ok(textOf(nodes()).includes('Session creation failed'))
        assert.deepEqual(opened, [])
      } else {
        assert.deepEqual(events.slice(0, 8), [
          'save-draft', 'saved-draft', 'execute', 'create-session', 'link', 'prompt', 'record-task', 'status:running',
        ])
        assert.equal(posts.filter(post => post.path === '/requirement/execute').length, 1)
        assert.equal(posts.filter(post => post.path === '/requirement/execute/task').length, 1)
        assert.deepEqual(opened, ['session-2'], 'a failed task refresh does not block opening the created session')
      }
      cleanup()
      clearLeaveGuard()
    }
  } finally {
    cleanup()
    clearLeaveGuard()
    resetUiStore()
    setRuntimeContext(null)
    globalThis.fetch = originalFetch
    initRuntime(() => fakeReact)
  }
})

test('formatShortTime keeps dense list timestamps short', function () {
  const now = new Date(2026, 9, 26, 15, 30, 0)
  assert.equal(formatShortTime('', now), '')
  assert.equal(formatShortTime('not-a-date', now), 'not-a-date')
  assert.equal(formatShortTime(new Date(2026, 9, 26, 9, 5, 0).toISOString(), now), '09:05')
  assert.equal(formatShortTime(new Date(2026, 9, 25, 22, 8, 0).toISOString(), now), '10-25 22:08')
  assert.equal(formatShortTime(new Date(2025, 11, 31, 8, 0, 0).toISOString(), now), '2025-12-31')
})

test('package icon asset uses the workbench panel layout', function () {
  const source = fs.readFileSync('icon.svg', 'utf8')
  assert.equal(source.includes('<svg'), true)
  assert.equal(source.includes('M9.6 4.2v15.6'), true)
  assert.equal(source.includes('width="17.2"'), true)
  assert.equal(source.includes('M8.8 11.6'), false)
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
