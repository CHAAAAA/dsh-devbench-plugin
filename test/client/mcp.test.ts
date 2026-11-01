/**
 * MCP management page and home overview panel (REQ-20261029-002).
 *
 * Renders with a tiny fake React (the same hook-index seeding approach as
 * test/client/render-smoke.test.ts) and covers the pure form/value helpers.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { initRuntime } from '../../src/client/runtime.js'
import { MCP_SECRET_MASK } from '../../src/shared/protocol.js'
import { zh, en } from '../../src/client/i18n/index.js'
import {
  McpView, HomeMcpPanel, emptyMcpForm, serverToForm, formToServer, buildSavePayload,
  parseKeyValueLines, formatKeyValueLines, parseArgsText, formatArgsText, validateMcpForm,
  phaseOf, phaseKeyOf, transportKeyOf, sourceKeyOf, readOnlyKeyOf, toastKeyOf, serverSummary,
  summarizeMcpData,
} from '../../src/client/views/mcp.js'

const anyGlobal: any = globalThis

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
function render(type, props) {
  const out = []
  renderNode({ type: type, props: props || {}, children: [] }, 'root', out)
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
function text(nodes) { return textOf(nodes, []).join(' ') }
function isClass(node, name) {
  return node.props && String(node.props.className || '').split(/\s+/).indexOf(name) >= 0
}
function buttonWithText(nodes, label) {
  return nodes.filter(function (node) {
    return node.type === 'button' && textOf(node, []).join(' ').indexOf(label) >= 0
  })
}
const noop = function () {}
const t = function (key) { return key }
function seed(hooks?) {
  instances.clear()
  const instance = { hooks: hooks || [] }
  instances.set('root:', instance)
  return instance
}
function seedPage(options) {
  const opts = options || {}
  const hooks = []
  hooks[0] = { value: { loading: opts.loading === true, error: opts.error || '', data: opts.data === undefined ? listData : opts.data } }
  hooks[1] = { value: opts.expandedId || '' }
  hooks[2] = { value: opts.busyId || '' }
  hooks[3] = { value: opts.editor || null }
  hooks[4] = { current: 0 }
  return seed(hooks)
}

const profile = {
  name: 'desktop',
  patchPath: '/Users/x/.dsh/profiles/desktop/cordis.patch.yml',
}
const stdioServer = {
  id: 'db-metadata', serverName: 'db-metadata', transport: 'stdio', phase: 'active',
  error: '', enabled: true, command: 'node', args: ['/opt/mcp.js', '--flag'], cwd: '', url: '',
  env: { DB_METADATA_CONFIG: '/tmp/config.json', API_KEY: MCP_SECRET_MASK },
  headers: {}, failOnStartupError: false, toolCallTimeoutMs: 60000, toolCount: 12,
  source: 'profile', canEdit: true, canDelete: true, canToggle: true, readOnlyReason: '',
  config: { module: '@deepseek-ai/dsh-mcp-client', config: { command: 'node', args: ['/opt/mcp.js'] } },
}
const httpServer = {
  id: 'remote-mcp', serverName: 'remote-mcp', transport: 'streamable-http', phase: 'failed',
  error: 'connect ECONNREFUSED', enabled: true, command: '', args: [], cwd: '',
  url: 'https://example.com/mcp', env: {}, headers: { Authorization: MCP_SECRET_MASK },
  failOnStartupError: false, toolCallTimeoutMs: 30000, toolCount: null,
  source: 'bundle', canEdit: false, canDelete: false, canToggle: true, readOnlyReason: 'overlay',
  config: { url: 'https://example.com/mcp' },
}
const listData = {
  profile: profile,
  available: true,
  canWrite: true,
  hotReload: true,
  servers: [stdioServer, httpServer],
}
function formWith(patch) {
  return Object.assign(emptyMcpForm('create'), patch)
}

test('KEY=VALUE lines parse, format and round-trip', function () {
  const parsed = parseKeyValueLines('A=1\nB=x=y\n\nC = spaced \n')
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.value, { A: '1', B: 'x=y', C: 'spaced' })
  assert.equal(formatKeyValueLines(parsed.value), 'A=1\nB=x=y\nC=spaced')
  assert.equal(parseKeyValueLines('').ok, true)
  assert.deepEqual(parseKeyValueLines('').value, {})
  assert.equal(parseKeyValueLines('NOVALUE').ok, false)
  assert.equal(parseKeyValueLines('NOVALUE').error, 'mcp.error.keyValue')
  assert.equal(parseKeyValueLines('=value').ok, false)
})

test('argument lines parse one argument per line', function () {
  assert.deepEqual(parseArgsText('--one\n\n  /two  \n'), ['--one', '/two'])
  assert.equal(formatArgsText(['--one', '', '/two']), '--one\n/two')
  assert.equal(formatArgsText(null), '')
})

test('server records convert to form values and back, keeping masked secrets', function () {
  const form = serverToForm(stdioServer)
  assert.equal(form.mode, 'update')
  assert.equal(form.id, 'db-metadata')
  assert.equal(form.serverName, 'db-metadata')
  assert.equal(form.transport, 'stdio')
  assert.equal(form.command, 'node')
  assert.equal(form.argsText, '/opt/mcp.js\n--flag')
  assert.equal(form.toolCallTimeoutMs, '60000')
  assert.equal(form.envText, 'DB_METADATA_CONFIG=/tmp/config.json\nAPI_KEY=' + MCP_SECRET_MASK)
  const payload = buildSavePayload(form)
  assert.deepEqual(payload, {
    mode: 'update',
    id: 'db-metadata',
    server: {
      serverName: 'db-metadata',
      transport: 'stdio',
      command: 'node',
      args: ['/opt/mcp.js', '--flag'],
      cwd: '',
      env: { DB_METADATA_CONFIG: '/tmp/config.json', API_KEY: MCP_SECRET_MASK },
      url: '',
      headers: {},
      failOnStartupError: false,
      toolCallTimeoutMs: 60000,
    },
  })
  const httpForm = serverToForm(httpServer)
  assert.equal(httpForm.transport, 'streamable-http')
  const httpPayload = buildSavePayload(httpForm)
  assert.equal(httpPayload.server.url, 'https://example.com/mcp')
  assert.equal(httpPayload.server.headers.Authorization, MCP_SECRET_MASK)
  assert.deepEqual(httpPayload.server.args, [])
  assert.equal(httpPayload.server.command, '')
})

test('create payload omits the id and optional timeout', function () {
  const form = formWith({
    serverName: 'demo', command: 'node', argsText: '/demo.js', envText: 'LEVEL=1',
  })
  const payload = buildSavePayload(form)
  assert.equal(payload.mode, 'create')
  assert.equal('id' in payload, false)
  assert.equal(payload.server.toolCallTimeoutMs, undefined)
  assert.deepEqual(payload.server.args, ['/demo.js'])
  assert.deepEqual(payload.server.env, { LEVEL: '1' })
  assert.equal(formToServer(form).serverName, 'demo')
})

test('form validation covers name, command, url, key/value and timeout', function () {
  assert.equal(validateMcpForm(formWith({ serverName: '', command: 'node' })), 'mcp.error.name')
  assert.equal(validateMcpForm(formWith({ serverName: 'bad name', command: 'node' })), 'mcp.error.name')
  assert.equal(validateMcpForm(formWith({ serverName: 'a'.repeat(33), command: 'node' })), 'mcp.error.name')
  assert.equal(validateMcpForm(formWith({ serverName: 'ok-name_1', command: '' })), 'mcp.error.command')
  assert.equal(validateMcpForm(formWith({ serverName: 'ok-name', command: 'node' })), '')
  assert.equal(validateMcpForm(formWith({
    serverName: 'http-one', transport: 'streamable-http', url: '',
  })), 'mcp.error.url')
  assert.equal(validateMcpForm(formWith({
    serverName: 'http-one', transport: 'streamable-http', url: 'not a url',
  })), 'mcp.error.url')
  assert.equal(validateMcpForm(formWith({
    serverName: 'http-one', transport: 'streamable-http', url: 'ftp://example.com/mcp',
  })), 'mcp.error.url')
  assert.equal(validateMcpForm(formWith({
    serverName: 'http-one', transport: 'streamable-http', url: 'https://example.com/mcp',
  })), '')
  assert.equal(validateMcpForm(formWith({
    serverName: 'env-one', command: 'node', envText: 'BROKEN',
  })), 'mcp.error.env')
  // The hidden transport's map is not validated; the visible one still is.
  assert.equal(validateMcpForm(formWith({
    serverName: 'env-one', command: 'node', headersText: 'BROKEN',
  })), '')
  assert.equal(validateMcpForm(formWith({
    serverName: 'http-one', transport: 'streamable-http', url: 'https://example.com/mcp',
    headersText: 'BROKEN',
  })), 'mcp.error.headers')
  assert.equal(validateMcpForm(formWith({
    serverName: 'env-one', command: 'node', toolCallTimeoutMs: 'abc',
  })), 'mcp.error.timeout')
  assert.equal(validateMcpForm(formWith({
    serverName: 'env-one', command: 'node', toolCallTimeoutMs: '0',
  })), 'mcp.error.timeout')
  assert.equal(validateMcpForm(formWith({
    serverName: 'env-one', command: 'node', toolCallTimeoutMs: '60000',
  })), '')
  // Only the visible transport's map is validated: hidden stale lines are dropped.
  assert.equal(validateMcpForm(formWith({
    serverName: 'http-two', transport: 'streamable-http', url: 'https://example.com/mcp',
    envText: 'BROKEN',
  })), '')
  assert.equal(validateMcpForm(formWith({
    serverName: 'stdio-two', command: 'node', headersText: 'BROKEN',
  })), '')
  // Loader expression source is accepted as an opaque value.
  assert.equal(validateMcpForm(formWith({
    serverName: 'expr-one', command: '!!js process.env.CMD',
  })), '')
  assert.equal(validateMcpForm(formWith({
    serverName: 'expr-http', transport: 'streamable-http', url: '!!js process.env.MCP_URL',
  })), '')
})

test('phase, transport, read-only and toast labels map to dictionary keys', function () {
  assert.equal(phaseKeyOf('active'), 'mcp.phase.active')
  assert.equal(phaseKeyOf('disabled'), 'mcp.phase.disabled')
  assert.equal(phaseKeyOf('failed'), 'mcp.phase.failed')
  assert.equal(phaseKeyOf('pending'), 'mcp.phase.pending')
  assert.equal(phaseKeyOf('inactive'), 'mcp.phase.inactive')
  assert.equal(phaseKeyOf('something-else'), 'mcp.phase.unknown')
  assert.equal(phaseOf({ phase: 'failed', enabled: true }), 'failed')
  assert.equal(phaseOf({ enabled: true }), 'active')
  assert.equal(phaseOf({ enabled: false }), 'disabled')
  assert.equal(phaseOf(null), 'inactive')
  assert.equal(transportKeyOf('stdio'), 'mcp.transport.stdio')
  assert.equal(transportKeyOf('streamable-http'), 'mcp.transport.http')
  assert.equal(transportKeyOf(''), 'mcp.transport.unknown')
  assert.equal(sourceKeyOf('profile'), 'mcp.source.profile')
  assert.equal(sourceKeyOf('bundle'), 'mcp.source.bundle')
  assert.equal(sourceKeyOf('unknown'), 'mcp.source.unknown')
  assert.equal(readOnlyKeyOf('failed'), 'mcp.readOnly.failed')
  assert.equal(readOnlyKeyOf('pending'), 'mcp.readOnly.pending')
  assert.equal(readOnlyKeyOf('overlay'), 'mcp.readOnly.overlay')
  assert.equal(readOnlyKeyOf(''), '')
  assert.equal(readOnlyKeyOf('weird'), '')
  assert.equal(toastKeyOf('created'), 'mcp.toast.created')
  assert.equal(toastKeyOf('disabled'), 'mcp.toast.disabled')
  assert.equal(toastKeyOf('unknown'), 'mcp.toast.updated')
})

test('server summary and counters feed the row and home panel', function () {
  assert.equal(serverSummary(stdioServer), 'node /opt/mcp.js --flag')
  assert.equal(serverSummary(httpServer), 'https://example.com/mcp')
  assert.equal(serverSummary(null), '')
  const summary = summarizeMcpData(listData)
  assert.equal(summary.total, 2)
  assert.equal(summary.enabled, 2)
  assert.equal(summarizeMcpData(null).total, 0)
  assert.equal(summarizeMcpData({ servers: [{ enabled: false }, { enabled: true }] }).enabled, 1)
})

test('MCP i18n keys exist in both languages', function () {
  const prefixes = ['mcp.', 'home.mcp', 'breadcrumb.mcp']
  function collect(dict) {
    return Object.keys(dict).filter(function (key) {
      return prefixes.some(function (prefix) { return key.indexOf(prefix) === 0 })
    }).sort()
  }
  const zhKeys = collect(zh)
  const enKeys = collect(en)
  assert.deepEqual(zhKeys, enKeys)
  assert.equal(zhKeys.length >= 80, true)
  zhKeys.forEach(function (key) {
    assert.equal(typeof zh[key], 'string')
    assert.equal(zh[key].length > 0, true)
  })
  ;['mcp.title', 'mcp.add', 'mcp.unavailable', 'mcp.hotReloadOff', 'mcp.readonly',
    'mcp.form.save', 'mcp.detail.tools', 'mcp.disable.title', 'home.mcp',
    'home.mcp.manage', 'breadcrumb.mcp'].forEach(function (key) {
    assert.equal(zhKeys.indexOf(key) >= 0, true)
  })
})

test('MCP page renders the loading state first', function () {
  seed()
  const nodes = render(McpView, { t: t })
  const pageText = text(nodes)
  assert.equal(pageText.indexOf('mcp.title') >= 0, true)
  assert.equal(pageText.indexOf('mcp.loading') >= 0, true)
  assert.equal(buttonWithText(nodes, 'mcp.add').length, 0)
  assert.equal(buttonWithText(nodes, 'mcp.refresh').length, 1)
})

async function flushAsyncWork() {
  for (let round = 0; round < 32; round += 1) await Promise.resolve()
}

test('MCP page loads its data through the initial effect', async function () {
  const previousFetch = globalThis.fetch
  const calls = []
  anyGlobal.fetch = function (url) {
    calls.push(String(url))
    return Promise.resolve({
      json: function () { return Promise.resolve({ ok: true, value: listData }) },
    })
  }
  try {
    const instance = seedPage({ loading: true, data: null })
    const initial = render(McpView, { t: t, showToast: noop })
    assert.equal(text(initial).includes('mcp.loading'), true)
    assert.equal(typeof instance.hooks[5].fn, 'function')
    instance.hooks[5].fn()
    await flushAsyncWork()
    assert.equal(calls.some(function (url) { return url.indexOf('/mcp') >= 0 }), true)
    const loaded = render(McpView, { t: t, showToast: noop })
    assert.equal(loaded.some(function (node) { return isClass(node, 'devbench-mcp-row') }), true)
  } finally {
    anyGlobal.fetch = previousFetch
  }
})

test('MCP page lists servers with transport, phase and row actions', function () {
  seedPage({})
  const nodes = render(McpView, { t: t, showToast: noop })
  const pageText = text(nodes)
  ;['mcp.title', 'mcp.add', 'mcp.refresh', 'db-metadata', 'remote-mcp',
    'mcp.transport.stdio', 'mcp.transport.http', 'mcp.phase.active', 'mcp.phase.failed',
    'mcp.tools', 'mcp.action.view', 'mcp.action.edit'].forEach(function (label) {
    assert.equal(pageText.indexOf(label) >= 0, true, 'missing ' + label)
  })
  assert.equal(buttonWithText(nodes, 'mcp.action.delete').length, 1)
  const editButtons = buttonWithText(nodes, 'mcp.action.edit')
  assert.equal(editButtons.length, 2)
  const bundleEdit = editButtons.find(function (node) { return node.props.disabled === true })
  assert.equal(Boolean(bundleEdit), true)
  assert.equal(bundleEdit.props.title, 'mcp.readOnly.overlay')
  const disableOnly = nodes.find(function (node) {
    return node.props && node.props.title === 'mcp.action.disableOnlyHint'
  })
  assert.equal(Boolean(disableOnly), true)
  assert.equal(typeof disableOnly.props.onClick, 'function')
  assert.equal(nodes.some(function (node) { return isClass(node, 'devbench-mcp-row') }), true)
})

test('MCP page renders the expanded config detail', function () {
  seedPage({ expandedId: 'db-metadata' })
  const nodes = render(McpView, { t: t, showToast: noop })
  const pageText = text(nodes)
  ;['mcp.action.hide', 'mcp.detail.id', 'mcp.detail.source', 'mcp.detail.patch',
    'mcp.detail.tools', 'mcp.detail.config', 'mcp.source.profile', profile.patchPath].forEach(function (label) {
    assert.equal(pageText.indexOf(label) >= 0, true, 'missing ' + label)
  })
  assert.equal(nodes.some(function (node) { return isClass(node, 'devbench-mcp-config') }), true)
  const config = nodes.find(function (node) { return isClass(node, 'devbench-mcp-config') })
  assert.equal(text(config).indexOf('/opt/mcp.js') >= 0, true)
})

test('MCP page shows the unsupported-profile empty state without write actions', function () {
  seedPage({
    data: { profile: null, available: false, canWrite: false, hotReload: true, servers: [] },
  })
  const nodes = render(McpView, { t: t, showToast: noop })
  const pageText = text(nodes)
  assert.equal(pageText.indexOf('mcp.unavailable') >= 0, true)
  assert.equal(pageText.indexOf('mcp.readonly') >= 0, true)
  assert.equal(buttonWithText(nodes, 'mcp.add').length, 0)
})

test('MCP page surfaces a host patch error as a banner', function () {
  const data = Object.assign({}, listData, { patchError: 'unsupported patch format' })
  seedPage({ data: data })
  const nodes = render(McpView, { t: t, showToast: noop })
  assert.equal(text(nodes).indexOf('unsupported patch format') >= 0, true)
})

test('MCP editor renders the stdio form fields', function () {
  seedPage({ editor: serverToForm(stdioServer) })
  const nodes = render(McpView, { t: t, showToast: noop })
  const pageText = text(nodes)
  ;['mcp.form.editTitle', 'mcp.form.name', 'mcp.form.transport', 'mcp.form.command',
    'mcp.form.args', 'mcp.form.cwd', 'mcp.form.env', 'mcp.form.advanced',
    'mcp.form.failOnStartupError', 'mcp.form.timeout', 'mcp.form.save', 'mcp.form.cancel'].forEach(
    function (label) {
      assert.equal(pageText.indexOf(label) >= 0, true, 'missing ' + label)
    })
  const nameInput = nodes.find(function (node) {
    return node.type === 'input' && node.props.value === 'db-metadata'
  })
  assert.equal(Boolean(nameInput), true)
  const select = nodes.find(function (node) { return node.type === 'select' })
  assert.equal(select.props.value, 'stdio')
  const options = nodes.filter(function (node) { return node.type === 'option' })
  assert.deepEqual(options.map(function (node) { return node.props.value }), ['stdio', 'streamable-http'])
  const maskedEnv = nodes.find(function (node) {
    return node.type === 'textarea' && String(node.props.value).indexOf(MCP_SECRET_MASK) >= 0
  })
  assert.equal(Boolean(maskedEnv), true)
  assert.equal(buttonWithText(nodes, 'mcp.form.cancel').length, 1)
})

test('MCP editor renders the http form fields', function () {
  seedPage({ editor: serverToForm(httpServer) })
  const nodes = render(McpView, { t: t, showToast: noop })
  const pageText = text(nodes)
  ;['mcp.form.url', 'mcp.form.headers', 'mcp.form.headersHint'].forEach(function (label) {
    assert.equal(pageText.indexOf(label) >= 0, true, 'missing ' + label)
  })
  assert.equal(pageText.indexOf('mcp.form.command') >= 0, false)
  assert.equal(nodes.some(function (node) {
    return node.type === 'input' && node.props.value === 'https://example.com/mcp'
  }), true)
})

test('MCP editor renders the create title', function () {
  seedPage({ editor: emptyMcpForm('create') })
  const nodes = render(McpView, { t: t, showToast: noop })
  assert.equal(text(nodes).indexOf('mcp.form.createTitle') >= 0, true)
})

test('home MCP panel renders servers, summary and the manage action', function () {
  seed([{ value: { loading: false, error: '', data: listData } }])
  let opened = false
  const nodes = render(HomeMcpPanel, { t: t, onOpenMcp: function () { opened = true } })
  const panelText = text(nodes)
  ;['home.mcp', 'home.mcp.summary', 'db-metadata', 'remote-mcp',
    'mcp.transport.stdio', 'mcp.transport.http'].forEach(function (label) {
    assert.equal(panelText.indexOf(label) >= 0, true, 'missing ' + label)
  })
  const manage = buttonWithText(nodes, 'home.mcp.manage')
  assert.equal(manage.length, 1)
  manage[0].props.onClick()
  assert.equal(opened, true)
  assert.equal(nodes.filter(function (node) { return isClass(node, 'devbench-mcp-home-row') }).length, 2)
})

test('home MCP panel loads through its initial effect', async function () {
  const previousFetch = globalThis.fetch
  const calls = []
  anyGlobal.fetch = function (url) {
    calls.push(String(url))
    return Promise.resolve({
      json: function () { return Promise.resolve({ ok: true, value: listData }) },
    })
  }
  try {
    const instance = seed()
    const loading = render(HomeMcpPanel, { t: t })
    assert.equal(text(loading).indexOf('home.mcp.loading') >= 0, true)
    assert.equal(typeof instance.hooks[1].fn, 'function')
    instance.hooks[1].fn()
    await flushAsyncWork()
    assert.equal(calls.some(function (url) { return url.indexOf('/mcp') >= 0 }), true)
    const loaded = render(HomeMcpPanel, { t: t })
    assert.equal(text(loaded).indexOf('db-metadata') >= 0, true)
    assert.equal(loaded.filter(function (node) { return isClass(node, 'devbench-mcp-home-row') }).length, 2)
  } finally {
    anyGlobal.fetch = previousFetch
  }
})

test('home MCP panel shows the loading, error and empty states', function () {
  seed()
  assert.equal(text(render(HomeMcpPanel, { t: t })).indexOf('home.mcp.loading') >= 0, true)
  seed([{ value: { loading: false, error: 'boom', data: null } }])
  const errorNodes = render(HomeMcpPanel, { t: t })
  assert.equal(text(errorNodes).indexOf('home.mcp.error') >= 0, true)
  assert.equal(render(HomeMcpPanel, { t: t }).length > 0, true)
  seed([{ value: { loading: false, error: '', data: { available: true, servers: [] } } }])
  assert.equal(text(render(HomeMcpPanel, { t: t })).indexOf('home.mcp.empty') >= 0, true)
  seed([{ value: { loading: false, error: '', data: { available: false, servers: [] } } }])
  const unavailableText = text(render(HomeMcpPanel, { t: t }))
  assert.equal(unavailableText.indexOf('home.mcp.unavailable') >= 0, true)
  assert.equal(unavailableText.indexOf('home.mcp.summary') >= 0, false)
  // Without onOpenMcp (e.g. a view rendered outside the workbench) no button is rendered.
  seed([{ value: { loading: false, error: '', data: listData } }])
  const noAction = render(HomeMcpPanel, { t: t })
  assert.equal(buttonWithText(noAction, 'home.mcp.manage').length, 0)
})
