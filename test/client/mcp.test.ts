/**
 * MCP management page and home overview panel (REQ-20261029-002).
 *
 * Uses React DOM and API fixtures to cover page behavior and pure form/value helpers.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { render, nodes, cleanup, textOf, findButton, mockApi, flushAsyncWork } from './helpers.js'
import { MCP_SECRET_MASK } from '../../src/shared/protocol.js'
import { zh, en } from '../../src/client/i18n/index.js'
import {
  McpView, HomeMcpPanel, emptyMcpForm, serverToForm, formToServer, buildSavePayload,
  parseKeyValueLines, formatKeyValueLines, parseArgsText, formatArgsText, validateMcpForm,
  phaseOf, phaseKeyOf, transportKeyOf, sourceKeyOf, readOnlyKeyOf, toastKeyOf, serverSummary,
  summarizeMcpData,
} from '../../src/client/views/mcp.js'

function text(values) { return textOf(values, []).join(' ') }
function isClass(node, name) {
  return String(node.props.className || '').split(/\s+/).includes(name)
}
function buttonWithText(values, label) {
  return values.filter(node => node.type === 'button' && text(node).includes(label))
}
const noop = function () {}
const t = function (key) { return key }
async function loadPage(data: unknown = listData, component = McpView, props = {}) {
  cleanup()
  mockApi(() => data)
  return render({ type: component, props: { t, showToast: noop, ...props } })
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

test('MCP page renders the loading state first', async function () {
  let finish
  mockApi(() => new Promise(resolve => { finish = resolve }))
  const initial = await render({ type: McpView, props: { t } })
  assert.ok(text(initial).includes('mcp.title'))
  assert.ok(text(initial).includes('mcp.loading'))
  assert.equal(buttonWithText(initial, 'mcp.add').length, 0)
  assert.equal(buttonWithText(initial, 'mcp.refresh').length, 1)
  finish(listData)
  await flushAsyncWork()
})

test('MCP page loads its data through the initial effect', async function () {
  const calls = []
  let finish
  mockApi(url => {
    calls.push(url.pathname)
    return new Promise(resolve => { finish = resolve })
  })
  const initial = await render({ type: McpView, props: { t, showToast: noop } })
  assert.ok(text(initial).includes('mcp.loading'))
  assert.deepEqual(calls, ['/dsh-devbench/api/mcp'])
  finish(listData)
  await flushAsyncWork()
  assert.ok(nodes().some(node => isClass(node, 'devbench-mcp-row')))
})

test('MCP page lists servers with transport, phase and row actions', async function () {
  const values = await loadPage()
  const pageText = text(values)
  for (const label of ['mcp.title', 'mcp.add', 'mcp.refresh', 'db-metadata', 'remote-mcp',
    'mcp.transport.stdio', 'mcp.transport.http', 'mcp.phase.active', 'mcp.phase.failed',
    'mcp.tools', 'mcp.action.view', 'mcp.action.edit']) assert.ok(pageText.includes(label), label)
  assert.equal(buttonWithText(values, 'mcp.action.delete').length, 1)
  const edits = buttonWithText(values, 'mcp.action.edit')
  assert.equal(edits.length, 2)
  assert.equal(edits.find(node => node.props.disabled).props.title, 'mcp.readOnly.overlay')
  const disableOnly = values.find(node => node.props.title === 'mcp.action.disableOnlyHint')
  assert.ok(disableOnly)
  assert.equal(typeof disableOnly.props.onClick, 'function')
  assert.ok(values.some(node => isClass(node, 'devbench-mcp-row')))
})

test('MCP page renders the expanded config detail', async function () {
  const values = await loadPage()
  await buttonWithText(values, 'mcp.action.view')[0].props.onClick()
  for (const label of ['mcp.action.hide', 'mcp.detail.id', 'mcp.detail.source', 'mcp.detail.patch',
    'mcp.detail.tools', 'mcp.detail.config', 'mcp.source.profile', profile.patchPath]) {
    assert.ok(text(nodes()).includes(label), label)
  }
  const config = nodes().find(node => isClass(node, 'devbench-mcp-config'))
  assert.ok(config)
  assert.ok(text(config).includes('/opt/mcp.js'))
})

test('MCP page shows the unsupported-profile empty state without write actions', async function () {
  const values = await loadPage({ profile: null, available: false, canWrite: false, hotReload: true, servers: [] })
  assert.ok(text(values).includes('mcp.unavailable'))
  assert.ok(text(values).includes('mcp.readonly'))
  assert.equal(buttonWithText(values, 'mcp.add').length, 0)
})

test('MCP page surfaces a host patch error as a banner', async function () {
  const values = await loadPage({ ...listData, patchError: 'unsupported patch format' })
  assert.ok(text(values).includes('unsupported patch format'))
})

test('MCP editor renders the stdio form fields', async function () {
  const values = await loadPage()
  await buttonWithText(values, 'mcp.action.edit')[0].props.onClick()
  for (const label of ['mcp.form.editTitle', 'mcp.form.name', 'mcp.form.transport', 'mcp.form.command',
    'mcp.form.args', 'mcp.form.cwd', 'mcp.form.env', 'mcp.form.advanced',
    'mcp.form.failOnStartupError', 'mcp.form.timeout', 'mcp.form.save', 'mcp.form.cancel']) {
    assert.ok(text(nodes()).includes(label), label)
  }
  assert.ok(nodes().some(node => node.type === 'input' && node.props.value === 'db-metadata'))
  assert.equal(nodes().find(node => node.type === 'select').props.value, 'stdio')
  assert.deepEqual(nodes().filter(node => node.type === 'option').map(node => node.props.value), ['stdio', 'streamable-http'])
  assert.ok(nodes().some(node => node.type === 'textarea' && String(node.props.value).includes(MCP_SECRET_MASK)))
  assert.equal(buttonWithText(nodes(), 'mcp.form.cancel').length, 1)
})

test('MCP editor renders the http form fields', async function () {
  const data = { ...listData, servers: [{ ...httpServer, canEdit: true }] }
  const values = await loadPage(data)
  await findButton(values, 'mcp.action.edit').props.onClick()
  for (const label of ['mcp.form.url', 'mcp.form.headers', 'mcp.form.headersHint']) assert.ok(text(nodes()).includes(label), label)
  assert.equal(text(nodes()).includes('mcp.form.command'), false)
  assert.ok(nodes().some(node => node.type === 'input' && node.props.value === 'https://example.com/mcp'))
})

test('MCP editor renders the create title', async function () {
  const values = await loadPage()
  await findButton(values, 'mcp.add').props.onClick()
  assert.ok(text(nodes()).includes('mcp.form.createTitle'))
})

test('home MCP panel renders servers, summary and the manage action', async function () {
  let opened = false
  const values = await loadPage(listData, HomeMcpPanel, { onOpenMcp() { opened = true } })
  for (const label of ['home.mcp', 'home.mcp.summary', 'db-metadata', 'remote-mcp', 'mcp.transport.stdio', 'mcp.transport.http']) {
    assert.ok(text(values).includes(label), label)
  }
  await findButton(values, 'home.mcp.manage').props.onClick()
  assert.equal(opened, true)
  assert.equal(values.filter(node => isClass(node, 'devbench-mcp-home-row')).length, 2)
})

test('home MCP panel loads through its initial effect', async function () {
  const calls = []
  let finish
  mockApi(url => {
    calls.push(url.pathname)
    return new Promise(resolve => { finish = resolve })
  })
  const initial = await render({ type: HomeMcpPanel, props: { t } })
  assert.ok(text(initial).includes('home.mcp.loading'))
  assert.deepEqual(calls, ['/dsh-devbench/api/mcp'])
  finish(listData)
  await flushAsyncWork()
  assert.ok(text(nodes()).includes('db-metadata'))
  assert.equal(nodes().filter(node => isClass(node, 'devbench-mcp-home-row')).length, 2)
})

test('home MCP panel shows the loading, error and empty states', async function () {
  let finish
  mockApi(() => new Promise(resolve => { finish = resolve }))
  const loading = await render({ type: HomeMcpPanel, props: { t } })
  assert.ok(text(loading).includes('home.mcp.loading'))
  finish(null)
  await flushAsyncWork()
  cleanup()
  mockApi(() => { throw new Error('boom') })
  const failed = await render({ type: HomeMcpPanel, props: { t } })
  assert.ok(text(failed).includes('home.mcp.error'))
  assert.ok(failed.length > 0)
  assert.ok(text(await loadPage({ available: true, servers: [] }, HomeMcpPanel)).includes('home.mcp.empty'))
  const unavailable = await loadPage({ available: false, servers: [] }, HomeMcpPanel)
  assert.ok(text(unavailable).includes('home.mcp.unavailable'))
  assert.equal(text(unavailable).includes('home.mcp.summary'), false)
  const noAction = await loadPage(listData, HomeMcpPanel)
  assert.equal(buttonWithText(noAction, 'home.mcp.manage').length, 0)
})
