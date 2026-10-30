/**
 * MCP server management for the active DSH profile (REQ-20261029-002).
 *
 * The page lists the `@deepseek-ai/dsh-mcp-client` rows of the active profile's
 * cordis.patch.yml, groups them into editable rows, and edits them through the
 * `/mcp` HTTP endpoints. `HomeMcpPanel` reuses the same data on the workbench
 * home page as a compact overview.
 */
import {
  h, useState, useEffect, useRef, errorText, isAbortError, t as translate,
} from '../runtime.js'
import * as api from '../core/api.js'
import { MCP_CLIENT_MODULE, MCP_SECRET_MASK, MCP_SAVE_TIMEOUT_MS } from '../../shared/protocol.js'
import { Banner } from '../ui/common.js'
import { confirmDialog } from '../ui/dialogs.js'
import { IconPlus, IconRefresh } from '../ui/icons.js'

const TRANSPORT_STDIO = 'stdio'
const TRANSPORT_HTTP = 'streamable-http'
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const PHASE_KEYS = {
  active: 'mcp.phase.active',
  disabled: 'mcp.phase.disabled',
  failed: 'mcp.phase.failed',
  pending: 'mcp.phase.pending',
  inactive: 'mcp.phase.inactive',
}
const READ_ONLY_KEYS = {
  inactive: 'mcp.readOnly.inactive',
  failed: 'mcp.readOnly.failed',
  pending: 'mcp.readOnly.pending',
  unsupported: 'mcp.readOnly.unsupported',
  overlay: 'mcp.readOnly.overlay',
}
const ACTION_TOAST_KEYS = {
  created: 'mcp.toast.created',
  updated: 'mcp.toast.updated',
  deleted: 'mcp.toast.deleted',
  disabled: 'mcp.toast.disabled',
  enabled: 'mcp.toast.enabled',
}

function safeText(value) {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return String(value)
}

function phaseClassOf(phase) {
  return PHASE_KEYS[phase] === undefined ? 'inactive' : phase
}

/** Phase of a server row: explicit `phase`, else derived from `enabled`. */
export function phaseOf(server) {
  if (!server || typeof server !== 'object') return 'inactive'
  if (typeof server.phase === 'string' && server.phase !== '') return server.phase
  return server.enabled === true ? 'active' : 'disabled'
}

/** Translate a phase to its dictionary key (`mcp.phase.unknown` fallback). */
export function phaseKeyOf(phase) {
  return PHASE_KEYS[phase] === undefined ? 'mcp.phase.unknown' : PHASE_KEYS[phase]
}

/** Translate a transport value to its dictionary key. */
export function transportKeyOf(transport) {
  if (transport === TRANSPORT_STDIO) return 'mcp.transport.stdio'
  if (transport === TRANSPORT_HTTP) return 'mcp.transport.http'
  return 'mcp.transport.unknown'
}

/** Translate a server `source` to its dictionary key. */
export function sourceKeyOf(source) {
  if (source === 'profile') return 'mcp.source.profile'
  if (source === 'bundle') return 'mcp.source.bundle'
  return 'mcp.source.unknown'
}

/** Translate a server `readOnlyReason` to its dictionary key ('' when absent). */
export function readOnlyKeyOf(reason) {
  return READ_ONLY_KEYS[reason] === undefined ? '' : READ_ONLY_KEYS[reason]
}

/** Translate a save/delete/toggle response `action` to its toast key. */
export function toastKeyOf(action) {
  return ACTION_TOAST_KEYS[action] === undefined ? 'mcp.toast.updated' : ACTION_TOAST_KEYS[action]
}

/** One-line transport summary: stdio command + args, or the HTTP URL. */
export function serverSummary(server) {
  if (!server || typeof server !== 'object') return ''
  if (server.transport === TRANSPORT_HTTP) return safeText(server.url)
  const command = safeText(server.command)
  const args = Array.isArray(server.args)
    ? server.args.filter(function (item) { return typeof item === 'string' && item !== '' })
    : []
  if (command === '') return safeText(server.url)
  return [command].concat(args).join(' ')
}

/** Total/enabled counters for the home overview panel. */
export function summarizeMcpData(data) {
  const servers = data && Array.isArray(data.servers) ? data.servers : []
  let enabled = 0
  servers.forEach(function (server) {
    if (server && server.enabled === true) enabled += 1
  })
  return { total: servers.length, enabled: enabled, servers: servers }
}

/** Parse `KEY=VALUE` lines (first `=` splits; blank lines ignored). */
export function parseKeyValueLines(text) {
  const lines = safeText(text).split('\n')
  const value = {}
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line === '') continue
    const split = line.indexOf('=')
    if (split <= 0) return { ok: false, error: 'mcp.error.keyValue', value: {} }
    const key = line.slice(0, split).trim()
    if (key === '') return { ok: false, error: 'mcp.error.keyValue', value: {} }
    value[key] = line.slice(split + 1).trim()
  }
  return { ok: true, error: '', value: value }
}

/** Serialize a string map back to `KEY=VALUE` lines. */
export function formatKeyValueLines(value) {
  if (!value || typeof value !== 'object') return ''
  return Object.keys(value).map(function (key) {
    return key + '=' + safeText(value[key])
  }).join('\n')
}

/** Parse the args textarea (one argument per line). */
export function parseArgsText(text) {
  return safeText(text).split('\n').map(function (line) { return line.trim() })
    .filter(function (line) { return line !== '' })
}

/** Serialize args to the textarea format (one argument per line). */
export function formatArgsText(args) {
  if (!Array.isArray(args)) return ''
  return args.filter(function (item) { return typeof item === 'string' && item !== '' }).join('\n')
}

function parseTimeout(value) {
  const text = safeText(value).trim()
  if (text === '') return null
  const number = Number(text)
  if (Number.isFinite(number) === false || Math.floor(number) !== number || number <= 0) return null
  return number
}

/** Blank editor form. */
export function emptyMcpForm(mode) {
  return {
    mode: mode === 'update' ? 'update' : 'create',
    id: '',
    serverName: '',
    transport: TRANSPORT_STDIO,
    command: '',
    argsText: '',
    cwd: '',
    envText: '',
    url: '',
    headersText: '',
    failOnStartupError: false,
    toolCallTimeoutMs: '',
    saving: false,
    error: '',
  }
}

/** Server record → editable form values (masks stay untouched). */
export function serverToForm(server) {
  const form = emptyMcpForm('update')
  if (!server || typeof server !== 'object') return form
  form.id = safeText(server.id)
  form.serverName = safeText(server.serverName) || safeText(server.id)
  form.transport = server.transport === TRANSPORT_HTTP ? TRANSPORT_HTTP : TRANSPORT_STDIO
  form.command = safeText(server.command)
  form.argsText = formatArgsText(server.args)
  form.cwd = safeText(server.cwd)
  form.envText = formatKeyValueLines(server.env)
  form.url = safeText(server.url)
  form.headersText = formatKeyValueLines(server.headers)
  form.failOnStartupError = server.failOnStartupError === true
  const timeout = parseTimeout(server.toolCallTimeoutMs)
  form.toolCallTimeoutMs = timeout === null ? '' : String(timeout)
  return form
}

/** Form values → server payload (fields of the unused transport are dropped). */
export function formToServer(form) {
  const value = form && typeof form === 'object' ? form : {}
  const transport = value.transport === TRANSPORT_HTTP ? TRANSPORT_HTTP : TRANSPORT_STDIO
  const stdio = transport === TRANSPORT_STDIO
  const env = parseKeyValueLines(value.envText)
  const headers = parseKeyValueLines(value.headersText)
  const server = {
    serverName: safeText(value.serverName).trim(),
    transport: transport,
    command: stdio ? safeText(value.command).trim() : '',
    args: stdio ? parseArgsText(value.argsText) : [],
    cwd: stdio ? safeText(value.cwd).trim() : '',
    env: env.ok ? env.value : {},
    url: stdio ? '' : safeText(value.url).trim(),
    headers: headers.ok ? headers.value : {},
    failOnStartupError: value.failOnStartupError === true,
  }
  const timeout = parseTimeout(value.toolCallTimeoutMs)
  if (timeout !== null) server.toolCallTimeoutMs = timeout
  return server
}

/** Mode/id + server for POST /mcp/save; masked secrets are passed through. */
export function buildSavePayload(form) {
  const value = form && typeof form === 'object' ? form : {}
  const mode = value.mode === 'update' ? 'update' : 'create'
  const payload = { mode: mode, server: formToServer(value) }
  if (mode === 'update') payload.id = safeText(value.id)
  return payload
}

/** True for Loader expression source (`!!js ...`), which the host stores verbatim. */
export function isExpressionText(value) {
  return safeText(value).trim().startsWith('!!js ')
}

/** Client-side validation: returns the first dictionary key, or '' when valid. */
export function validateMcpForm(form) {
  const value = form && typeof form === 'object' ? form : {}
  if (NAME_PATTERN.test(safeText(value.serverName).trim()) === false) return 'mcp.error.name'
  // Only the visible transport is validated: the hidden group's text is dropped
  // by formToServer, so stale invalid lines there must not block saving.
  if (value.transport === TRANSPORT_HTTP) {
    const url = safeText(value.url).trim()
    if (isExpressionText(url) === false) {
      if (url === '') return 'mcp.error.url'
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'mcp.error.url'
      } catch (err) {
        return 'mcp.error.url'
      }
    }
    if (parseKeyValueLines(value.headersText).ok === false) return 'mcp.error.headers'
  } else if (isExpressionText(value.command) === false && safeText(value.command).trim() === '') {
    return 'mcp.error.command'
  } else if (parseKeyValueLines(value.envText).ok === false) {
    return 'mcp.error.env'
  }
  if (parseTimeout(value.toolCallTimeoutMs) === null && safeText(value.toolCallTimeoutMs).trim() !== '') {
    return 'mcp.error.timeout'
  }
  return ''
}

/** Labelled form row (no hooks, so it is safe inside the editor card). */
function McpField(props) {
  return h('label', { className: 'devbench-mcp-field' },
    h('span', { className: 'devbench-mcp-field-label' }, props.label),
    props.children,
    props.hint ? h('span', { className: 'devbench-hint' }, props.hint) : null)
}

function detailRow(key, label, value) {
  return h('div', { className: 'devbench-mcp-detail-row', key: key },
    h('span', { className: 'devbench-mcp-detail-label' }, label),
    h('span', { className: 'devbench-mcp-detail-value' }, value))
}

function configTextOf(server) {
  if (!server || server.config === undefined || server.config === null) return ''
  try {
    return JSON.stringify(server.config, null, 2)
  } catch (err) {
    return ''
  }
}

/**
 * MCP management page. Hook order (seeded by test/client/mcp.test.mjs):
 * 0 state, 1 expandedId, 2 busyId, 3 editor, 4 load seq ref, 5 initial load.
 */
export function McpView(props) {
  const t = props.t || translate
  const showToast = typeof props.showToast === 'function' ? props.showToast : function () {}
  const [state, setState] = useState({ loading: true, error: '', data: null })
  const [expandedId, setExpandedId] = useState('')
  const [busyId, setBusyId] = useState('')
  const [editor, setEditor] = useState(null)
  const loadSeqRef = useRef(0)

  const data = state.data && typeof state.data === 'object' ? state.data : null
  const canWrite = data === null || data.canWrite !== false
  const servers = data && Array.isArray(data.servers) ? data.servers : []

  function load() {
    const seq = ++loadSeqRef.current
    setState(function (prev) {
      return { loading: prev.data === null, error: '', data: prev.data }
    })
    return api.getMcpServers().then(function (value) {
      if (loadSeqRef.current !== seq) return null
      setState({ loading: false, error: '', data: value || null })
      return value
    }, function (err) {
      if (loadSeqRef.current !== seq || isAbortError(err)) return null
      setState(function (prev) {
        return { loading: false, error: errorText(err), data: prev.data }
      })
      return null
    })
  }
  function refresh() {
    load().catch(function () {})
  }
  useEffect(function () {
    load().catch(function () {})
  }, [])
  function updateEditor(patch) {
    setEditor(function (prev) {
      if (prev === null) return prev
      return Object.assign({}, prev, patch)
    })
  }
  function openCreate() {
    if (canWrite === false) return
    setEditor(emptyMcpForm('create'))
  }
  function beginEdit(server) {
    if (canWrite === false || server.canEdit === false) return
    setExpandedId('')
    setEditor(serverToForm(server))
  }
  function cancelEditor() {
    setEditor(function (prev) {
      return prev !== null && prev.saving === true ? prev : null
    })
  }
  /** Apply a save/delete/toggle response (full listing + action) and toast once. */
  function applyResult(result, action) {
    const next = result && typeof result === 'object' ? result : null
    if (next !== null) setState({ loading: false, error: '', data: next })
    const restart = next !== null && next.restartRequired === true
    let message = t(toastKeyOf(action))
    if (restart) message = message + ' · ' + t('mcp.restartHint')
    showToast('info', message)
  }
  function saveEditor() {
    if (editor === null || editor.saving === true) return
    const errorKey = validateMcpForm(editor)
    if (errorKey !== '') {
      updateEditor({ error: t(errorKey) })
      return
    }
    const payload = buildSavePayload(editor)
    setEditor(Object.assign({}, editor, { saving: true, error: '' }))
    api.saveMcpServer(payload, { timeoutMs: MCP_SAVE_TIMEOUT_MS }).then(function (result) {
      setEditor(null)
      if (result && typeof result === 'object') applyResult(result, result.action)
      else refresh()
    }, function (err) {
      setEditor(function (prev) {
        if (prev === null) return prev
        return Object.assign({}, prev, { saving: false, error: errorText(err) || t('mcp.error.save') })
      })
    })
  }
  function runToggle(server) {
    if (busyId !== '' || canWrite === false) return
    const id = safeText(server.id)
    setBusyId(id)
    api.toggleMcpServer({
      id: id,
      enabled: server.enabled !== true,
    }, { timeoutMs: MCP_SAVE_TIMEOUT_MS }).then(function (result) {
      setBusyId('')
      if (result && typeof result === 'object') applyResult(result, result.action)
      else refresh()
    }, function (err) {
      setBusyId('')
      showToast('error', errorText(err) || t('mcp.error.toggle'))
    })
  }
  function requestDelete(server) {
    if (busyId !== '' || canWrite === false) return
    const name = safeText(server.serverName) || safeText(server.id)
    const patchPath = data && data.profile ? safeText(data.profile.patchPath) : ''
    const bundle = server.source === 'bundle'
    const body = bundle
      ? t('mcp.delete.bodyBundle', { name: name })
      : t('mcp.delete.bodyProfile', { name: name, path: patchPath })
    confirmDialog({
      title: t('mcp.delete.title'),
      body: body,
      confirmText: t('mcp.action.delete'),
      tone: 'danger',
    }).then(function (confirmed) {
      if (confirmed !== true) return
      runDelete(server)
    }).catch(function () {})
  }
  function requestDisableBundle(server) {
    if (busyId !== '' || canWrite === false) return
    const name = safeText(server.serverName) || safeText(server.id)
    const body = server.source === 'bundle'
      ? t('mcp.delete.bodyBundle', { name: name })
      : t('mcp.disable.body', { name: name })
    confirmDialog({
      title: t('mcp.disable.title'),
      body: body,
      confirmText: t('mcp.action.disable'),
      tone: 'danger',
    }).then(function (confirmed) {
      if (confirmed !== true) return
      runToggle(server)
    }).catch(function () {})
  }
  function runDelete(server) {
    if (busyId !== '') return
    const id = safeText(server.id)
    setBusyId(id)
    api.deleteMcpServer({ id: id }, { timeoutMs: MCP_SAVE_TIMEOUT_MS }).then(function (result) {
      setBusyId('')
      if (result && typeof result === 'object') applyResult(result, result.action)
      else refresh()
    }, function (err) {
      setBusyId('')
      showToast('error', errorText(err) || t('mcp.error.delete'))
    })
  }
  function capabilityTitle(can, reason) {
    if (can !== false) return undefined
    if (canWrite === false) return t('mcp.readonly')
    const key = readOnlyKeyOf(reason)
    return key !== '' ? t(key) : t('mcp.action.disabledHint')
  }
  function renderDetail(server) {
    const rows = []
    rows.push(detailRow('id', t('mcp.detail.id'), safeText(server.id)))
    rows.push(detailRow('source', t('mcp.detail.source'), t(sourceKeyOf(server.source))))
    if (data && data.profile && safeText(data.profile.patchPath) !== '') {
      rows.push(detailRow('patch', t('mcp.detail.patch'), safeText(data.profile.patchPath)))
    }
    if (server.readOnlyReason) {
      const key = readOnlyKeyOf(server.readOnlyReason)
      if (key !== '') rows.push(detailRow('readonly', t('mcp.detail.readOnly'), t(key)))
    }
    if (server.error) rows.push(detailRow('error', t('mcp.detail.error'), safeText(server.error)))
    if (server.toolCount !== null && server.toolCount !== undefined) {
      rows.push(detailRow('tools', t('mcp.detail.tools'),
        t('mcp.tools', { count: Number(server.toolCount) || 0 })))
    }
    const configText = configTextOf(server)
    return h('div', { className: 'devbench-mcp-detail' },
      rows,
      configText !== ''
        ? h('div', { className: 'devbench-mcp-detail-config' },
          h('div', { className: 'devbench-mcp-detail-label' }, t('mcp.detail.config')),
          h('pre', { className: 'devbench-mcp-config devbench-mono' }, configText))
        : null)
  }
  function renderServer(server, index) {
    const id = safeText(server.id) || safeText(server.serverName) || 'server-' + String(index)
    const expanded = expandedId !== '' && expandedId === id
    const phase = phaseOf(server)
    const enabled = server.enabled === true
    const busy = busyId !== '' && busyId === id
    const summary = serverSummary(server)
    const tools = server.toolCount
    const ops = []
    ops.push(h('button', {
      key: 'view',
      className: 'devbench-btn ghost devbench-mcp-op',
      onClick() { setExpandedId(expanded ? '' : id) },
    }, expanded ? t('mcp.action.hide') : t('mcp.action.view')))
    ops.push(h('button', {
      key: 'edit',
      className: 'devbench-btn ghost devbench-mcp-op',
      disabled: busy || canWrite === false || server.canEdit === false,
      title: capabilityTitle(server.canEdit, server.readOnlyReason),
      onClick() { beginEdit(server) },
    }, t('mcp.action.edit')))
    const toggleDisabled = busy || canWrite === false || server.canToggle === false
    if (server.canDelete === false) {
      // A bundle-provided row cannot be removed from the profile patch; the
      // delete slot becomes a disable/enable action with an explanatory title.
      ops.push(h('button', {
        key: 'delete',
        className: 'devbench-btn ghost danger devbench-mcp-op',
        disabled: toggleDisabled,
        title: toggleDisabled ? capabilityTitle(server.canToggle, server.readOnlyReason) : t('mcp.action.disableOnlyHint'),
        onClick() {
          if (enabled) requestDisableBundle(server)
          else runToggle(server)
        },
      }, enabled ? t('mcp.action.disable') : t('mcp.action.enable')))
    } else {
      ops.push(h('button', {
        key: 'toggle',
        className: 'devbench-btn ghost devbench-mcp-op',
        disabled: toggleDisabled,
        title: capabilityTitle(server.canToggle, server.readOnlyReason),
        onClick() { runToggle(server) },
      }, enabled ? t('mcp.action.disable') : t('mcp.action.enable')))
      ops.push(h('button', {
        key: 'delete',
        className: 'devbench-btn ghost danger devbench-mcp-op',
        disabled: busy || canWrite === false || server.canDelete === false,
        title: capabilityTitle(server.canDelete, server.readOnlyReason),
        onClick() { requestDelete(server) },
      }, t('mcp.action.delete')))
    }
    const summaryTitle = safeText(server.error) !== '' ? safeText(server.error) : summary
    return h('div', { className: 'devbench-mcp-row', key: id },
      h('div', { className: 'devbench-mcp-row-head' },
        h('span', {
          className: 'devbench-mcp-dot ' + phaseClassOf(phase),
          title: t(phaseKeyOf(phase)),
          role: 'img',
          'aria-label': t(phaseKeyOf(phase)),
        }),
        h('span', { className: 'devbench-mcp-name', title: safeText(server.serverName) }, safeText(server.serverName) || id),
        h('span', { className: 'devbench-pill' }, t(transportKeyOf(server.transport))),
        h('span', { className: 'devbench-mcp-state ' + phaseClassOf(phase) }, t(phaseKeyOf(phase))),
        tools !== null && tools !== undefined
          ? h('span', { className: 'devbench-mcp-tools' }, t('mcp.tools', { count: Number(tools) || 0 }))
          : null,
        h('span', { className: 'devbench-mcp-ops' }, ops)),
      summary !== ''
        ? h('div', { className: 'devbench-mcp-summary', title: summaryTitle }, summary)
        : null,
      expanded ? renderDetail(server) : null)
  }
  function renderField(key, label, control, hint) {
    return h(McpField, { key: key, label: label, hint: hint }, control)
  }
  function renderEditor() {
    if (editor === null) return null
    const createMode = editor.mode !== 'update'
    const stdio = editor.transport !== TRANSPORT_HTTP
    const fields = []
    fields.push(renderField('name', t('mcp.form.name'),
      h('input', {
        className: 'devbench-input devbench-mono',
        value: editor.serverName,
        disabled: editor.saving,
        placeholder: 'my-mcp-server',
        onChange(event) { updateEditor({ serverName: event.target.value }) },
      }),
      t('mcp.form.nameHint')))
    fields.push(renderField('transport', t('mcp.form.transport'),
      h('select', {
        className: 'devbench-input',
        value: editor.transport,
        disabled: editor.saving,
        onChange(event) { updateEditor({ transport: event.target.value }) },
      },
      h('option', { value: TRANSPORT_STDIO }, t('mcp.transport.stdio')),
      h('option', { value: TRANSPORT_HTTP }, t('mcp.transport.http')))))
    if (stdio) {
      fields.push(renderField('command', t('mcp.form.command'),
        h('input', {
          className: 'devbench-input devbench-mono',
          value: editor.command,
          disabled: editor.saving,
          placeholder: 'node',
          onChange(event) { updateEditor({ command: event.target.value }) },
        })))
      fields.push(renderField('args', t('mcp.form.args'),
        h('textarea', {
          className: 'devbench-textarea devbench-mono',
          rows: 3,
          value: editor.argsText,
          disabled: editor.saving,
          placeholder: '/path/to/server.js',
          onChange(event) { updateEditor({ argsText: event.target.value }) },
        }),
        t('mcp.form.argsHint')))
      fields.push(renderField('cwd', t('mcp.form.cwd'),
        h('input', {
          className: 'devbench-input devbench-mono',
          value: editor.cwd,
          disabled: editor.saving,
          placeholder: t('mcp.form.cwdPlaceholder'),
          onChange(event) { updateEditor({ cwd: event.target.value }) },
        })))
      fields.push(renderField('env', t('mcp.form.env'),
        h('textarea', {
          className: 'devbench-textarea devbench-mono',
          rows: 3,
          value: editor.envText,
          disabled: editor.saving,
          placeholder: 'API_KEY=...',
          onChange(event) { updateEditor({ envText: event.target.value }) },
        }),
        t('mcp.form.envHint', { mask: MCP_SECRET_MASK })))
    } else {
      fields.push(renderField('url', t('mcp.form.url'),
        h('input', {
          className: 'devbench-input devbench-mono',
          value: editor.url,
          disabled: editor.saving,
          placeholder: 'https://example.com/mcp',
          onChange(event) { updateEditor({ url: event.target.value }) },
        }),
        t('mcp.form.urlHint')))
      fields.push(renderField('headers', t('mcp.form.headers'),
        h('textarea', {
          className: 'devbench-textarea devbench-mono',
          rows: 3,
          value: editor.headersText,
          disabled: editor.saving,
          placeholder: 'Authorization=Bearer ...',
          onChange(event) { updateEditor({ headersText: event.target.value }) },
        }),
        t('mcp.form.headersHint', { mask: MCP_SECRET_MASK })))
    }
    const advanced = h('div', { className: 'devbench-mcp-field', key: 'advanced' },
      h('span', { className: 'devbench-mcp-field-label' }, t('mcp.form.advanced')),
      h('label', { className: 'devbench-check' },
        h('input', {
          type: 'checkbox',
          checked: editor.failOnStartupError,
          disabled: editor.saving,
          onChange(event) { updateEditor({ failOnStartupError: event.target.checked }) },
        }),
        t('mcp.form.failOnStartupError')),
      h('div', { className: 'devbench-mcp-inline devbench-mcp-timeout' },
        h('span', { className: 'devbench-mcp-field-label' }, t('mcp.form.timeout')),
        h('input', {
          className: 'devbench-input devbench-mono',
          style: { maxWidth: '160px' },
          value: editor.toolCallTimeoutMs,
          disabled: editor.saving,
          placeholder: '60000',
          inputMode: 'numeric',
          onChange(event) { updateEditor({ toolCallTimeoutMs: event.target.value }) },
        })),
      h('span', { className: 'devbench-hint' }, t('mcp.form.timeoutHint')),
      h('span', { className: 'devbench-hint' }, t('mcp.form.expressionHint')))
    return h('div', { className: 'devbench-mcp-form', key: 'editor' },
      h('div', { className: 'devbench-mcp-form-title', key: 'title' },
        createMode ? t('mcp.form.createTitle') : t('mcp.form.editTitle'),
        createMode
          ? null
          : h('span', {
            className: 'devbench-mcp-form-id devbench-mono',
            title: safeText(editor.id),
          }, t('mcp.form.id', { id: safeText(editor.id) }))),
      editor.error ? h(Banner, { kind: 'error' }, editor.error) : null,
      h('div', { className: 'devbench-mcp-fields', key: 'fields' }, fields),
      advanced,
      h('div', { className: 'devbench-mcp-form-actions', key: 'actions' },
        h('button', {
          className: 'devbench-btn ghost',
          disabled: editor.saving,
          onClick: cancelEditor,
        }, t('mcp.form.cancel')),
        h('button', {
          className: 'devbench-btn primary',
          disabled: editor.saving || canWrite === false,
          onClick: saveEditor,
        }, editor.saving ? t('mcp.form.saving') : t('mcp.form.save'))))
  }

  const profile = data && data.profile && typeof data.profile === 'object' ? data.profile : null
  const patchPath = profile ? safeText(profile.patchPath) : ''
  const header = h('div', { className: 'devbench-mcp-head' },
    h('div', { className: 'devbench-mcp-head-main' },
      h('div', { className: 'devbench-mcp-title' }, t('mcp.title')),
      h('div', { className: 'devbench-mcp-subtitle' },
        t('mcp.subtitle', { module: MCP_CLIENT_MODULE })),
      profile !== null
        ? h('div', {
          className: 'devbench-mcp-subtitle devbench-mono',
          title: patchPath,
        }, t('mcp.profile', { name: safeText(profile.name) || '-' }) +
          (patchPath !== '' ? ' · ' + patchPath : ''))
        : null),
    h('div', { className: 'devbench-inline' },
      h('button', {
        className: 'devbench-btn',
        disabled: state.loading,
        onClick: refresh,
      }, h(IconRefresh, { size: 15 }), t('mcp.refresh')),
      data !== null && data.available !== false && canWrite
        ? h('button', {
          className: 'devbench-btn primary',
          disabled: editor !== null,
          onClick: openCreate,
        }, h(IconPlus, { size: 14 }), t('mcp.add'))
        : null))
  let body
  if (data === null && state.loading) {
    body = h('div', { className: 'devbench-inline-loading' }, t('mcp.loading'))
  } else if (data === null) {
    body = h('div', null,
      h(Banner, { kind: 'error' }, state.error || t('mcp.loadFailed')),
      h('button', { className: 'devbench-btn', onClick: refresh }, t('mcp.retry')))
  } else if (data.available === false) {
    body = h('div', { className: 'devbench-empty-panel' }, t('mcp.unavailable'))
  } else if (servers.length === 0) {
    body = h('div', { className: 'devbench-empty-panel' }, t('mcp.empty'))
  } else {
    body = h('div', { className: 'devbench-mcp-list' }, servers.map(renderServer))
  }
  return h('div', { className: 'devbench-mcp' },
    header,
    data !== null && data.hotReload === false
      ? h(Banner, { kind: 'info' }, t('mcp.hotReloadOff'))
      : null,
    data !== null && data.canWrite === false
      ? h(Banner, { kind: 'info' }, t('mcp.readonly'))
      : null,
    data !== null && data.patchError
      ? h(Banner, { kind: 'error' }, safeText(data.patchError))
      : null,
    data !== null && state.error
      ? h(Banner, { kind: 'error' }, state.error)
      : null,
    editor !== null ? renderEditor() : null,
    body)
}

/**
 * Home page overview of the profile's MCP servers. Loads independently so a
 * failure cannot affect the rest of the dashboard. Hook order: 0 state, 1 load.
 */
export function HomeMcpPanel(props) {
  const t = props.t || translate
  const [state, setState] = useState({ loading: true, error: '', data: null })
  useEffect(function () {
    let cancelled = false
    api.getMcpServers().then(function (value) {
      if (cancelled) return
      setState({ loading: false, error: '', data: value || null })
    }, function (err) {
      if (cancelled || isAbortError(err)) return
      setState({ loading: false, error: errorText(err), data: null })
    })
    return function () { cancelled = true }
  }, [])
  const data = state.data && typeof state.data === 'object' ? state.data : null
  const summary = summarizeMcpData(data)
  const rows = summary.servers.slice(0, 3).map(function (server, index) {
    const id = safeText(server.id) || safeText(server.serverName) || 'mcp-' + String(index)
    const phase = phaseOf(server)
    return h('div', { className: 'devbench-mcp-home-row', key: id },
      h('span', {
        className: 'devbench-mcp-dot ' + phaseClassOf(phase),
        title: t(phaseKeyOf(phase)),
        role: 'img',
        'aria-label': t(phaseKeyOf(phase)),
      }),
      h('span', { className: 'devbench-mcp-home-name', title: safeText(server.serverName) },
        safeText(server.serverName) || id),
      h('span', { className: 'devbench-mcp-home-transport' }, t(transportKeyOf(server.transport))))
  })
  let body
  if (state.loading && data === null) {
    body = h('div', { className: 'devbench-inline-loading' }, t('home.mcp.loading'))
  } else if (state.error) {
    body = h('div', { className: 'devbench-hint' }, t('home.mcp.error'))
  } else if (data !== null && data.available === false) {
    body = h('div', { className: 'devbench-hint' }, t('home.mcp.unavailable'))
  } else if (summary.total === 0) {
    body = h('div', { className: 'devbench-hint' }, t('home.mcp.empty'))
  } else {
    body = h('div', null, rows)
  }
  return h('div', { className: 'devbench-panel devbench-mcp-home' },
    h('div', { className: 'devbench-panel-head' },
      t('home.mcp'),
      data !== null && state.error === '' && data.available !== false
        ? h('span', { className: 'devbench-mcp-home-summary' },
          t('home.mcp.summary', { enabled: summary.enabled, total: summary.total }))
        : null),
    h('div', { className: 'devbench-panel-body' },
      body,
      typeof props.onOpenMcp === 'function'
        ? h('button', {
          className: 'devbench-btn ghost devbench-mcp-home-manage',
          onClick: props.onOpenMcp,
        }, t('home.mcp.manage'))
        : null))
}
