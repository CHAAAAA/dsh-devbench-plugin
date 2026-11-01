import type { HostContext } from '../context.js'
import type { McpServerDto, McpServers, McpMutationResult, McpServerInput, McpPhase } from '../../shared/api-types.js'
/**
 * MCP server management for the active DSH profile (REQ-20261029-002).
 *
 * The plugin does not talk to MCP servers itself: it lists the profile's
 * `@deepseek-ai/dsh-mcp-client` Loader rows, edits existing rows through the
 * DSH Config Editor service and inserts/removes profile patch rows as text
 * (DSH exposes no YAML dependency to third-party plugins). Every write is
 * backed up next to `cordis.patch.yml` and applied through DSH HMR when that
 * service is available; otherwise the caller reports `restartRequired`.
 */
import { constants as fsConstants, promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  MCP_CLIENT_MODULE,
  MCP_MAX_ARGS,
  MCP_MAX_ARG_LENGTH,
  MCP_MAX_COMMAND_LENGTH,
  MCP_MAX_CWD_LENGTH,
  MCP_MAX_KV_ENTRIES,
  MCP_MAX_KV_KEY_LENGTH,
  MCP_MAX_KV_VALUE_LENGTH,
  MCP_MAX_TIMEOUT_MS,
  MCP_MAX_URL_LENGTH,
  MCP_PATCH_BACKUP_PREFIX,
  MCP_SECRET_MASK,
  MCP_SERVER_NAME_PATTERN,
} from '../constants.js'
import * as patchText from '../domain/profile-patch.js'
import { ApiError, apiError, errorMessage } from '../errors.js'
import { messages } from '../messages/index.js'
import { atomicWriteFile, withFileLock } from '../shared/atomic.js'
import { isPlainObject, lstatMaybe } from '../shared/path-safety.js'

/** Env/header keys whose values are rendered as a mask in the browser. */
const SECRET_KEY_PATTERN = /(secret|token|password|passwd|api[-_]?key|private[-_]?key|access[-_]?key|credential|authorization|cookie|session|^key$)/i
/** Reasons a row cannot be edited, shown localized by the client. */
const READ_ONLY_INACTIVE = 'inactive'
const READ_ONLY_OVERRIDE = 'overlay'
const READ_ONLY_UNSUPPORTED = 'unsupported'
const TRANSPORTS = ['stdio', 'streamable-http']
const FIBER_ACTIVE = 2
const FIBER_FAILED = 3

function service(ctx, name) {
  if (ctx === undefined || ctx === null || typeof ctx.get !== 'function') return undefined
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

function profileOf(ctx) {
  const profile = service(ctx, 'profileContext')
  if (profile === undefined || profile === null || typeof profile !== 'object') return null
  if (typeof profile.patchPath !== 'string' || path.isAbsolute(profile.patchPath) === false) return null
  return profile
}

function requireProfile(ctx) {
  const profile = profileOf(ctx)
  if (profile === null) throw apiError(409, 'mcp-unavailable', messages.mcpUnavailable)
  return profile
}

function requireLoader(ctx) {
  const loader = service(ctx, 'loader')
  if (loader === undefined || loader === null || typeof loader.entries !== 'function') {
    throw apiError(409, 'mcp-unavailable', messages.mcpUnavailable)
  }
  return loader
}

/** Profile rows of the MCP client, in composition order. */
function mcpEntries(loader) {
  const rows = []
  for (const entry of loader.entries()) {
    if (!entry || !entry.options) continue
    if (entry.options.name !== MCP_CLIENT_MODULE) continue
    if (typeof entry.options.id !== 'string' || entry.options.id.length === 0) continue
    rows.push(entry)
  }
  return rows
}

function rowConfig(entry) {
  const config = entry && entry.options ? entry.options.config : undefined
  return isPlainObject(config) ? config : {}
}

function serverNameOf(entry) {
  const config = rowConfig(entry)
  const effective = effectiveConfigOf(entry)
  return displayScalar(config.serverName, effective === null ? undefined : effective.serverName)
}

function entryDisabled(entry) {
  try {
    return entry.disabled === true
  } catch {
    return null
  }
}

/** Loader lifecycle phase plus a short failure message when the fiber rejected. */
function phaseOf(entry): { phase: McpPhase; error: string } {
  const disabled = entryDisabled(entry)
  if (disabled === null) return { phase: 'failed', error: messages.mcpOperationFailed }
  if (disabled) return { phase: 'disabled', error: '' }
  const fiber = entry.fiber
  if (fiber === undefined || fiber === null) return { phase: 'inactive', error: '' }
  if (fiber.state === FIBER_ACTIVE) return { phase: 'active', error: '' }
  if (fiber.state === FIBER_FAILED) return { phase: 'failed', error: fiberErrorText(fiber) }
  if (fiber.state === 0 || fiber.state === 1) return { phase: 'pending', error: '' }
  return { phase: 'inactive', error: '' }
}

function fiberErrorText(fiber) {
  const error = fiber ? fiber._error : undefined
  if (error === undefined || error === null) return ''
  const text = typeof error === 'string' ? error : (error.message || String(error))
  return shorten(text, 400)
}

function shorten(text, limit) {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  return value.length > limit ? value.slice(0, limit) + '…' : value
}

/** Split a form value that asks for a Loader `!!js` expression. */
const EXPRESSION_PREFIX = '!!js '

function expressionValueOf(value) {
  if (typeof value !== 'string' || value.startsWith(EXPRESSION_PREFIX) === false) return null
  const source = value.slice(EXPRESSION_PREFIX.length).trim()
  return source === '' ? null : { __jsExpr: source }
}

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(String(key))
}

/** True for the inert `{ __jsExpr }` value DSH keeps for a YAML `!!js` scalar. */
function isExpressionValue(value) {
  return value !== null && typeof value === 'object' && Array.isArray(value) === false &&
    typeof value.__jsExpr === 'string'
}

function expressionText(value) {
  return '!!js ' + value.__jsExpr
}

/** Validated, expression-evaluated config of an active row; null when unavailable. */
function effectiveConfigOf(entry) {
  const config = entry && entry.fiber ? entry.fiber.config : undefined
  return isPlainObject(config) ? config : null
}

/**
 * Scalar shown to the browser. A `!!js` expression is shown as its source
 * (`!!js ...`) rather than its evaluated value, so runtime secrets reached by an
 * expression never travel to the page; editing it unchanged keeps the expression.
 */
function displayScalar(raw, _fallback: any = undefined) {
  if (isExpressionValue(raw)) return expressionText(raw)
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  return ''
}

function displayArgs(raw) {
  if (Array.isArray(raw) === false) return []
  const args = []
  for (const item of raw) {
    const shown = displayScalar(item)
    if (shown !== '') args.push(shown)
  }
  return args
}

function displayMap(rawMap) {
  const out = {}
  if (isPlainObject(rawMap) === false) return out
  for (const [key, raw] of Object.entries(rawMap)) {
    out[key] = isSecretKey(key) ? MCP_SECRET_MASK : displayScalar(raw)
  }
  return out
}

function sanitizeConfigValue(value, masked) {
  if (masked) return MCP_SECRET_MASK
  if (isExpressionValue(value)) return expressionText(value)
  if (Array.isArray(value)) return value.map(function (item) { return sanitizeConfigValue(item, false) })
  if (isPlainObject(value)) {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = sanitizeConfigValue(item, masked || isSecretKey(key))
    return out
  }
  return value
}

/** Raw config for the read-only detail pane: secrets masked, expressions labelled. */
function displayConfig(config) {
  if (isPlainObject(config) === false) return {}
  return sanitizeConfigValue(config, false)
}

/** Server name → number of `mcp__<name>__*` tools currently visible to the model. */
function countMcpTools(ctx, entries) {
  const tools = service(ctx, 'tools')
  if (tools === undefined || tools === null || typeof tools.view !== 'function') return null
  let visible
  try {
    const view = tools.view(undefined)
    visible = view ? view.visible : null
  } catch {
    return null
  }
  if (visible === null || visible === undefined || typeof visible.keys !== 'function') return null
  const names = entries
    .map(function (entry) { return serverNameOf(entry) })
    .filter(function (name) { return name !== '' })
    .sort(function (left, right) { return right.length - left.length })
  if (names.length === 0) return null
  const counts = new Map()
  for (const name of names) counts.set(name, 0)
  try {
    for (const toolName of visible.keys()) {
      for (const name of names) {
        if (toolName.startsWith('mcp__' + name + '__')) {
          counts.set(name, counts.get(name) + 1)
          break
        }
      }
    }
  } catch {
    return null
  }
  return counts
}

/** Ids addressable by the Config Editor (top-level rows only, unique ids). */
function addressableIds(ctx) {
  const editor = service(ctx, 'configEditor')
  if (editor === undefined || editor === null || typeof editor.entries !== 'function') return null
  let entries
  try {
    entries = editor.entries()
  } catch {
    return null
  }
  if (Array.isArray(entries) === false) return null
  const ids = new Set()
  for (const entry of entries) {
    if (entry && entry.options && typeof entry.options.id === 'string') ids.add(entry.options.id)
  }
  return ids
}

function serverRecord(entry, context): McpServerDto {
  const config = rowConfig(entry)
  const effective = effectiveConfigOf(entry) || {}
  const transport = TRANSPORTS.includes(config.transport) ? config.transport : ''
  const phase = phaseOf(entry)
  const id = entry.options.id
  const inserted = context.patchDoc === null ? null : patchText.findInsertedRow(context.patchDoc, id)
  const source = context.patchDoc === null ? 'unknown' : (inserted !== null ? 'profile' : 'bundle')
  const addressable = context.addressable !== null && context.addressable.has(id)
  const canEdit = context.configEditorAvailable && addressable && phase.phase === 'active'
  const canDelete = context.patchDoc !== null && inserted !== null
  const canToggle = context.patchDoc !== null
  let readOnlyReason: McpServerDto['readOnlyReason'] = ''
  if (canEdit === false) {
    if (context.configEditorAvailable === false) readOnlyReason = READ_ONLY_UNSUPPORTED
    else if (phase.phase === 'failed') readOnlyReason = 'failed'
    else if (phase.phase === 'pending') readOnlyReason = 'pending'
    else if (phase.phase !== 'active') readOnlyReason = READ_ONLY_INACTIVE
    else if (addressable === false) readOnlyReason = READ_ONLY_OVERRIDE
  }
  const serverName = serverNameOf(entry)
  return {
    id,
    serverName,
    transport,
    phase: phase.phase,
    error: phase.error,
    enabled: phase.phase !== 'disabled',
    command: displayScalar(config.command),
    args: displayArgs(config.args),
    cwd: displayScalar(config.cwd),
    url: displayScalar(config.url),
    env: displayMap(config.env),
    headers: displayMap(config.headers),
    failOnStartupError: typeof effective.failOnStartupError === 'boolean'
      ? effective.failOnStartupError === true
      : config.failOnStartupError === true,
    toolCallTimeoutMs: Number.isFinite(effective.toolCallTimeoutMs)
      ? effective.toolCallTimeoutMs
      : (Number.isFinite(config.toolCallTimeoutMs) ? config.toolCallTimeoutMs : 0),
    toolCount: context.toolCounts === null || serverName === '' ? null : (context.toolCounts.get(serverName) || 0),
    source,
    canEdit,
    canDelete,
    canToggle,
    readOnlyReason,
    config: displayConfig(config),
  }
}

/** Empty list result when the running DSH host exposes no profile composition. */
function unavailableResult(ctx, profile): McpServers {
  return {
    profile: profile === null
      ? null
      : { name: String(profile.name === undefined ? '' : profile.name), patchPath: profile.patchPath },
    available: false,
    canWrite: false,
    hotReload: Boolean(service(ctx, 'hmr')),
    patchError: '',
    servers: [],
  }
}

/** Read the profile patch text; a missing file is treated as an empty patch list. */
async function readPatchFile(file) {
  const stat = await lstatMaybe(file)
  if (stat === null) return { text: '[]\n', mode: 0o600, exists: false }
  if (stat.isFile() === false || stat.isSymbolicLink()) {
    throw apiError(500, 'mcp-patch-read-failed', messages.mcpPatchReadFailed)
  }
  let text
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch {
    throw apiError(500, 'mcp-patch-read-failed', messages.mcpPatchReadFailed)
  }
  return { text, mode: stat.mode & 0o777, exists: true }
}

async function patchWritable(file) {
  try {
    await fsp.access(file, fsConstants.W_OK)
    return true
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      try {
        await fsp.access(path.dirname(file), fsConstants.W_OK)
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

function scanPatchOrThrow(text) {
  try {
    return patchText.scanPatch(text)
  } catch (error) {
    if (error && error.name === 'PatchFormatError') {
      throw apiError(409, 'mcp-unsupported-format', messages.mcpUnsupportedPatch)
    }
    throw error
  }
}

async function writePatchFile(file, text, mode) {
  try {
    await atomicWriteFile(file, text, { mode: typeof mode === 'number' ? mode : 0o600 })
  } catch {
    throw apiError(500, 'mcp-patch-write-failed', messages.mcpPatchWriteFailed)
  }
}

/**
 * Save a timestamped copy of the current patch text before a write.
 * @returns The backup path, or '' when the patch file does not exist yet.
 */
async function backupPatchFile(file, text, mode) {
  const base = file + MCP_PATCH_BACKUP_PREFIX + String(Date.now())
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const target = attempt === 0 ? base : base + '-' + String(attempt)
    const existing = await lstatMaybe(target)
    if (existing !== null) continue
    try {
      await atomicWriteFile(target, text, { mode: typeof mode === 'number' ? mode : 0o600 })
      return target
    } catch {
      throw apiError(500, 'mcp-patch-write-failed', messages.mcpPatchWriteFailed)
    }
  }
  throw apiError(500, 'mcp-patch-write-failed', messages.mcpPatchWriteFailed)
}

function hmrOf(ctx) {
  const hmr = service(ctx, 'hmr')
  if (hmr === undefined || hmr === null) return null
  if (typeof hmr.runExclusive !== 'function' || typeof hmr.reconcileProfile !== 'function') return null
  return hmr
}

/**
 * Put the previous patch text back and reload it.
 * @returns true when the file and the runtime were both restored.
 */
async function rollbackPatch(ctx, hmr, file, text, mode) {
  await writePatchFile(file, text, mode)
  if (hmr === null) return true
  try {
    await hmr.reconcileProfile([])
    return true
  } catch (error) {
    ctx.logger?.warn?.('devbench-manager: MCP patch rollback reload failed: ' + shorten(errorMessage(error), 300))
    return false
  }
}

/** Roll back after a failed save; a failed rollback is surfaced, never hidden. */
async function rollbackOrThrow(ctx, hmr, file, text, mode, originalError) {
  let restored = false
  try {
    restored = await rollbackPatch(ctx, hmr, file, text, mode)
  } catch (error) {
    ctx.logger?.warn?.('devbench-manager: MCP patch rollback write failed: ' + shorten(errorMessage(error), 300))
  }
  if (restored === false) {
    throw apiError(500, 'mcp-rollback-failed', messages.mcpRollbackFailed)
  }
  throw originalError
}

function applyError(error) {
  const detail = shorten(errorMessage(error), 500)
  const suffix = detail === '' ? '' : ': ' + detail
  return apiError(409, 'mcp-apply-failed', messages.mcpApplyFailed + suffix)
}

/** Sort server names longest-first so overlapping prefixes cannot steal a tool count. */
function uniqueRowId(doc, entries, serverName) {
  const used = new Set()
  for (const entry of entries) if (entry && entry.options && typeof entry.options.id === 'string') used.add(entry.options.id)
  for (const item of doc.items) {
    if (typeof item.id === 'string') used.add(item.id)
    for (const inserted of item.inserted) if (typeof inserted.id === 'string') used.add(inserted.id)
  }
  const base = 'mcp-' + serverName
  let candidate = base
  let suffix = 2
  while (used.has(candidate) || patchText.hasRowId(doc, candidate)) {
    candidate = base + '-' + String(suffix)
    suffix += 1
  }
  return candidate
}

/** List the MCP client rows of the active profile. */
export async function listMcpServers(ctx: HostContext): Promise<McpServers> {
  const profile = profileOf(ctx)
  const loader = (function () {
    try {
      return requireLoader(ctx)
    } catch {
      return null
    }
  })()
  if (profile === null || loader === null) return unavailableResult(ctx, profile)
  const hmr = hmrOf(ctx)
  const editor = service(ctx, 'configEditor')
  const configEditorAvailable = editor !== undefined && editor !== null && typeof editor.edit === 'function'
  let text = ''
  let patchDoc = null
  let patchError = ''
  try {
    const read = await readPatchFile(profile.patchPath)
    text = read.text
    patchDoc = patchText.scanPatch(text)
    if (Array.isArray(patchDoc.unsupported) && patchDoc.unsupported.length > 0) {
      patchError = messages.mcpUnsupportedPatch
      patchDoc = null
    }
  } catch (error) {
    if (error && error.name === 'PatchFormatError') {
      patchDoc = null
      patchError = messages.mcpUnsupportedPatch
    } else if (error && error.code === 'mcp-patch-read-failed') {
      patchError = messages.mcpPatchReadFailed
    } else {
      throw error
    }
  }
  const canWrite = patchDoc !== null && (await patchWritable(profile.patchPath))
  const entries = mcpEntries(loader)
  const context = {
    patchDoc,
    patchError,
    addressable: addressableIds(ctx),
    configEditorAvailable,
    toolCounts: countMcpTools(ctx, entries),
  }
  return {
    profile: { name: String(profile.name === undefined ? '' : profile.name), patchPath: profile.patchPath },
    available: true,
    canWrite,
    hotReload: hmr !== null,
    patchError,
    servers: entries.map(function (entry) { return serverRecord(entry, context) }),
  }
}

function requireEditablePatch(ctx) {
  const profile = requireProfile(ctx)
  const loader = requireLoader(ctx)
  return { profile, loader }
}

/**
 * Apply one text mutation to the profile patch and reload the profile.
 * @param ctx Host plugin context.
 * @param plan Mutation factory: receives the freshly read patch text and returns
 *   `{ text, requiredIds?, action, verify?, verifyCode? }`. `verify` runs against
 *   the reloaded server list and returns a localized problem message or ''.
 */
async function applyPatchPlan(ctx, plan) {
  const state = requireEditablePatch(ctx)
  const file = state.profile.patchPath
  const hmr = hmrOf(ctx)
  // The mutation, its reload and any rollback reload run inside one HMR
  // transaction when HMR is present, so concurrent profile edits cannot
  // interleave with the patch text we just read.
  const transaction = async function () {
    const read = await readPatchFile(file)
    const doc = scanPatchOrThrow(read.text)
    if (Array.isArray(doc.unsupported) && doc.unsupported.length > 0) {
      throw apiError(409, 'mcp-unsupported-format', messages.mcpUnsupportedPatch)
    }
    let planned
    try {
      planned = plan({ text: read.text, doc, profile: state.profile, loader: state.loader })
    } catch (error) {
      if (error && error.name === 'PatchFormatError') {
        throw apiError(409, 'mcp-unsupported-format', messages.mcpUnsupportedPatch)
      }
      throw error
    }
    if (planned === undefined || planned === null || typeof planned.text !== 'string' || planned.text === read.text) {
      throw apiError(409, 'mcp-no-change', messages.mcpOperationFailed)
    }
    // Never persist a patch file the DSH loader could not read back.
    let nextDoc
    try {
      nextDoc = patchText.scanPatch(planned.text)
    } catch (error) {
      if (error && error.name === 'PatchFormatError') {
        throw apiError(409, 'mcp-unsupported-format', messages.mcpUnsupportedPatch)
      }
      throw error
    }
    if (Array.isArray(nextDoc.unsupported) && nextDoc.unsupported.length > 0) {
      throw apiError(409, 'mcp-unsupported-format', messages.mcpUnsupportedPatch)
    }
    const backupPath = read.exists
      ? await backupPatchFile(file, read.text, read.mode)
      : ''
    await writePatchFile(file, planned.text, read.mode)
    const hotReload = hmr !== null
    let reconciled = null
    if (hotReload) {
      try {
        reconciled = await hmr.reconcileProfile(planned.requiredIds || [])
      } catch (error) {
        await rollbackOrThrow(ctx, hmr, file, read.text, read.mode, applyError(error))
      }
    }
    let listed
    let verifyProblem = ''
    try {
      listed = await listMcpServers(ctx)
      if (hotReload && typeof planned.verify === 'function') {
        verifyProblem = planned.verify(listed.servers) || ''
      }
    } catch (error) {
      if (hotReload) {
        await rollbackOrThrow(ctx, hmr, file, read.text, read.mode, applyError(error))
      }
      throw applyError(error)
    }
    if (verifyProblem !== '') {
      await rollbackOrThrow(ctx, hmr, file, read.text, read.mode,
        apiError(409, planned.verifyCode || 'mcp-overridden', verifyProblem))
    }
    const restartReason = reconciled !== null && typeof reconciled === 'object' && reconciled.restartReason !== undefined
    return Object.assign({}, listed, {
      action: planned.action,
      restartRequired: hotReload === false || restartReason,
      backupPath,
    })
  }
  if (hmr !== null) {
    return withFileLock(file, function () {
      return hmr.runExclusive(transaction)
    })
  }
  return withFileLock(file, transaction)
}

/** Validate an optional timeout: 0/absent means "use the MCP client default". */
function readTimeout(value) {
  if (value === undefined || value === null || value === '' || value === 0) return 0
  const number = typeof value === 'string' ? Number(value) : value
  if (typeof number !== 'number' || Number.isInteger(number) === false ||
    number < 1 || number > MCP_MAX_TIMEOUT_MS) {
    throw apiError(400, 'mcp-bad-timeout', messages.mcpBadTimeout)
  }
  return number
}

/**
 * Normalize one `KEY=VALUE` map submitted by the browser. A value still holding
 * the secret mask keeps the stored raw value (`!!js` expression or literal); a
 * value equal to the evaluated display of a `!!js` expression keeps the
 * expression instead of freezing its current result into the patch.
 */
function normalizeMap(value, currentRawMap, allowExpressions, badMessage) {
  if (value === undefined || value === null) return {}
  if (isPlainObject(value) === false) throw apiError(400, 'mcp-bad-field', badMessage)
  const entries = Object.entries(value)
  if (entries.length > MCP_MAX_KV_ENTRIES) throw apiError(400, 'mcp-bad-field', badMessage)
  const out = {}
  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey).trim()
    if (key.length === 0 || key.length > MCP_MAX_KV_KEY_LENGTH) throw apiError(400, 'mcp-bad-field', badMessage)
    if (typeof rawValue !== 'string') throw apiError(400, 'mcp-bad-field', badMessage)
    const raw = isPlainObject(currentRawMap) ? currentRawMap[key] : undefined
    let resolved: any = rawValue
    if (resolved === MCP_SECRET_MASK) {
      if (raw === undefined) throw apiError(400, 'mcp-secret-missing', messages.mcpSecretMissing)
      resolved = raw
    } else if (isExpressionValue(raw) && resolved === expressionText(raw)) {
      resolved = raw
    } else if (resolved.startsWith(EXPRESSION_PREFIX)) {
      const expression = expressionValueOf(resolved)
      if (expression === null || allowExpressions !== true) {
        throw apiError(400, 'mcp-bad-expression', messages.mcpBadExpression)
      }
      resolved = expression
    }
    if (typeof resolved === 'string' && resolved.length > MCP_MAX_KV_VALUE_LENGTH) {
      throw apiError(400, 'mcp-bad-field', badMessage)
    }
    out[key] = resolved
  }
  return out
}

function normalizeArgs(value, allowExpressions) {
  if (value === undefined || value === null) return []
  if (Array.isArray(value) === false) throw apiError(400, 'mcp-bad-field', messages.invalidField)
  if (value.length > MCP_MAX_ARGS) throw apiError(400, 'mcp-bad-field', messages.invalidField)
  const args = []
  for (const raw of value) {
    if (typeof raw !== 'string') throw apiError(400, 'mcp-bad-field', messages.invalidField)
    const text = raw.trim()
    if (text === '') continue
    if (text.startsWith(EXPRESSION_PREFIX)) {
      const expression = expressionValueOf(text)
      if (expression === null || allowExpressions !== true) {
        throw apiError(400, 'mcp-bad-expression', messages.mcpBadExpression)
      }
      args.push(expression)
      continue
    }
    if (text.length > MCP_MAX_ARG_LENGTH) throw apiError(400, 'mcp-bad-field', messages.invalidField)
    args.push(text)
  }
  return args
}

/** Normalize one scalar field that may be a Loader expression on edits. */
function normalizeScalar(value, allowExpressions) {
  const text = value.trim()
  if (text.startsWith(EXPRESSION_PREFIX)) {
    const expression = expressionValueOf(text)
    if (expression === null || allowExpressions !== true) {
      throw apiError(400, 'mcp-bad-expression', messages.mcpBadExpression)
    }
    return expression
  }
  return text
}

function validateUrl(text) {
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    throw apiError(400, 'mcp-bad-url', messages.mcpBadUrl)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw apiError(400, 'mcp-bad-url', messages.mcpBadUrl)
  }
  return text
}

/**
 * Normalize the browser form payload into a complete server definition.
 * Masked env/header values keep their stored raw value; form values starting
 * with `!!js ` become Loader expressions on edits (rejected on create).
 */
function normalizeServerInput(input, currentConfig, allowExpressions) {
  if (isPlainObject(input) === false) throw apiError(400, 'mcp-bad-field', messages.invalidField)
  const serverName = typeof input.serverName === 'string' ? input.serverName.trim() : ''
  if (MCP_SERVER_NAME_PATTERN.test(serverName) === false) {
    throw apiError(400, 'mcp-bad-name', messages.mcpBadServerName)
  }
  const transport = typeof input.transport === 'string' ? input.transport : ''
  if (TRANSPORTS.includes(transport) === false) {
    throw apiError(400, 'mcp-bad-transport', messages.mcpBadTransport)
  }
  const current = isPlainObject(currentConfig) ? currentConfig : {}
  const common = {
    serverName,
    transport,
    failOnStartupError: input.failOnStartupError === true,
    toolCallTimeoutMs: readTimeout(input.toolCallTimeoutMs),
  }
  if (transport === 'stdio') {
    const commandText = typeof input.command === 'string' ? input.command.trim() : ''
    const command = normalizeScalar(commandText, allowExpressions)
    if (isExpressionValue(command) === false) {
      if (command.length === 0) throw apiError(400, 'mcp-missing-command', messages.mcpMissingCommand)
      if (command.length > MCP_MAX_COMMAND_LENGTH) throw apiError(400, 'mcp-bad-field', messages.invalidField)
    }
    const cwdValue = typeof input.cwd === 'string' ? input.cwd.trim() : ''
    const cwd = cwdValue === '' ? '' : normalizeScalar(cwdValue, allowExpressions)
    if (isExpressionValue(cwd) === false && cwd.length > MCP_MAX_CWD_LENGTH) {
      throw apiError(400, 'mcp-bad-field', messages.invalidField)
    }
    return Object.assign(common, {
      command,
      args: normalizeArgs(input.args, allowExpressions),
      cwd,
      env: normalizeMap(input.env, current.env, allowExpressions, messages.mcpBadEnv),
    })
  }
  const urlText = typeof input.url === 'string' ? input.url.trim() : ''
  const url = normalizeScalar(urlText, allowExpressions)
  if (isExpressionValue(url) === false) {
    if (url.length === 0) throw apiError(400, 'mcp-missing-url', messages.mcpMissingUrl)
    if (url.length > MCP_MAX_URL_LENGTH) throw apiError(400, 'mcp-bad-url', messages.mcpBadUrl)
    validateUrl(url)
  }
  return Object.assign(common, {
    url,
    headers: normalizeMap(input.headers, current.headers, allowExpressions, messages.mcpBadHeaders),
  })
}

/** Keep a raw `!!js` expression when the edit left the same expression in place. */
function preserveExpression(raw, submitted) {
  if (isExpressionValue(raw) && isExpressionValue(submitted) && submitted.__jsExpr === raw.__jsExpr) return raw
  return submitted
}

function preserveArgs(rawArgs, submitted) {
  if (Array.isArray(rawArgs) === false) return submitted
  return submitted.map(function (item, index) {
    const raw = rawArgs[index]
    if (isExpressionValue(raw) && isExpressionValue(item) && item.__jsExpr === raw.__jsExpr) return raw
    return item
  })
}

function preserveBoolean(raw, submitted, effective) {
  if (isExpressionValue(raw) && submitted === (effective === true)) return raw
  return submitted
}

function preserveNumber(raw, submitted, effective) {
  if (isExpressionValue(raw) && submitted === effective) return raw
  return submitted
}

/**
 * Build the next raw MCP client config. Unknown fields from the current config
 * (reconnect policy, maxInstructionBytes, ...) and unchanged `!!js` expressions
 * survive an edit; only re-typed values become literals (or new expressions).
 */
function buildNextConfig(server, currentConfig, currentEffective) {
  const current = isPlainObject(currentConfig) ? currentConfig : {}
  const effective = isPlainObject(currentEffective) ? currentEffective : {}
  const base = Object.assign({}, current)
  delete base.serverName
  delete base.transport
  delete base.command
  delete base.args
  delete base.cwd
  delete base.env
  delete base.url
  delete base.headers
  base.serverName = server.serverName
  base.transport = server.transport
  if (server.transport === 'stdio') {
    base.command = preserveExpression(current.command, server.command)
    const args = preserveArgs(current.args, server.args)
    if (args.length > 0) base.args = args
    if (isExpressionValue(server.cwd)) base.cwd = server.cwd
    else if (server.cwd !== '') base.cwd = server.cwd
    if (Object.keys(server.env).length > 0) base.env = server.env
  } else {
    base.url = preserveExpression(current.url, server.url)
    if (Object.keys(server.headers).length > 0) base.headers = server.headers
  }
  base.failOnStartupError = preserveBoolean(current.failOnStartupError, server.failOnStartupError, effective.failOnStartupError)
  if (server.toolCallTimeoutMs > 0) {
    base.toolCallTimeoutMs = preserveNumber(current.toolCallTimeoutMs, server.toolCallTimeoutMs, effective.toolCallTimeoutMs)
  } else {
    delete base.toolCallTimeoutMs
  }
  return base
}

function assertUniqueServerName(entries, serverName, ignoreId) {
  for (const entry of entries) {
    if (entry.options.id === ignoreId) continue
    if (serverNameOf(entry) !== serverName) continue
    if (phaseOf(entry).phase === 'disabled') continue
    throw apiError(409, 'mcp-duplicate-name', messages.mcpDuplicateName + ': ' + serverName)
  }
}

/** Create a new MCP client row in the profile patch. */
export async function createMcpServer(ctx: HostContext, input: { server: McpServerInput }): Promise<McpMutationResult> {
  const state = requireEditablePatch(ctx)
  const payload = isPlainObject(input) ? input.server : undefined
  const server = normalizeServerInput(payload, undefined, false)
  const entries = mcpEntries(state.loader)
  assertUniqueServerName(entries, server.serverName, '')
  return applyPatchPlan(ctx, function (context) {
    const id = uniqueRowId(context.doc, entries, server.serverName)
    const config = buildNextConfig(server, {}, {})
    return {
      text: patchText.appendInsertRow(context.text, { id, name: MCP_CLIENT_MODULE, config }),
      requiredIds: [id],
      action: 'created',
      verify(servers) {
        return servers.some(function (item) { return item.id === id }) ? '' : messages.mcpApplyFailed
      },
    }
  })
}

/** Update one MCP client row through the DSH Config Editor. */
export async function updateMcpServer(ctx: HostContext, input: { id: string; server: McpServerInput }): Promise<McpMutationResult> {
  const profile = requireProfile(ctx)
  const editor = service(ctx, 'configEditor')
  if (editor === undefined || editor === null || typeof editor.edit !== 'function') {
    throw apiError(409, 'mcp-unavailable', messages.mcpUnavailable)
  }
  const id = isPlainObject(input) && typeof input.id === 'string' ? input.id : ''
  if (id === '') throw apiError(400, 'mcp-bad-field', messages.mcpServerNotFound)
  const loader = requireLoader(ctx)
  // Everything from reading the current row to building the next config runs
  // under the file lock; ConfigEditor re-reads the raw config itself and hands
  // it back to our callback, so a concurrent edit cannot be overwritten by a
  // stale snapshot.
  return withFileLock(profile.patchPath, function () {
    return runUpdate(ctx, profile, editor, loader, id, input)
  })
}

async function runUpdate(ctx, profile, editor, loader, id, input) {
  const entries = mcpEntries(loader)
  const entry = entries.find(function (item) { return item.options.id === id })
  if (entry === undefined) throw apiError(404, 'mcp-not-found', messages.mcpServerNotFound)
  const phase = phaseOf(entry)
  if (phase.phase !== 'active') throw apiError(409, 'mcp-inactive', messages.mcpInactive)
  const read = await readPatchFile(profile.patchPath)
  if (read.exists) await backupPatchFile(profile.patchPath, read.text, read.mode)
  try {
    await editor.edit(entry, function (current) {
      const currentConfig = isPlainObject(current) ? current : rowConfig(entry)
      const effective = effectiveConfigOf(entry) || {}
      const server = normalizeServerInput(input.server, currentConfig, true)
      assertUniqueServerName(mcpEntries(loader), server.serverName, id)
      return buildNextConfig(server, currentConfig, effective)
    })
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw applyError(error)
  }
  // The DSH Config Editor always writes mode 0600; keep the profile file's
  // previous permissions so a shared profile keeps its access rules.
  if (read.exists) {
    const wanted = read.mode & 0o777
    try {
      const stat = await fsp.stat(profile.patchPath)
      if ((stat.mode & 0o777) !== wanted) await fsp.chmod(profile.patchPath, wanted)
    } catch (error) {
      ctx.logger?.warn?.('devbench-manager: cannot restore patch file mode: ' + shorten(errorMessage(error), 200))
    }
  }
  const listed = await listMcpServers(ctx)
  return Object.assign({}, listed, { action: 'updated', restartRequired: false })
}

/**
 * Delete a profile patch row, or disable a bundle-provided row when it cannot
 * be removed from the profile patch.
 */
export async function deleteMcpServer(ctx: HostContext, input: { id: string }): Promise<McpMutationResult> {
  const id = isPlainObject(input) && typeof input.id === 'string' ? input.id : ''
  if (id === '') throw apiError(400, 'mcp-bad-field', messages.mcpServerNotFound)
  const state = requireEditablePatch(ctx)
  const entries = mcpEntries(state.loader)
  const entry = entries.find(function (item) { return item.options.id === id })
  if (entry === undefined) throw apiError(404, 'mcp-not-found', messages.mcpServerNotFound)
  return applyPatchPlan(ctx, function (context) {
    const inserted = patchText.findInsertedRow(context.doc, id)
    if (inserted !== null) {
      let removed
      try {
        removed = patchText.removeRowsById(context.text, id)
      } catch (error) {
        if (error && error.name === 'PatchFormatError') {
          throw apiError(409, 'mcp-unsupported-format', messages.mcpUnsupportedPatch)
        }
        throw error
      }
      if (removed.removed !== true) throw apiError(409, 'mcp-unsupported-format', messages.mcpUnsupportedPatch)
      return {
        text: removed.text,
        requiredIds: [],
        action: 'deleted',
        verify(servers) {
          return servers.some(function (item) { return item.id === id }) ? messages.mcpEntryStillPresent : ''
        },
      }
    }
    return {
      text: patchText.appendPatchRow(context.text, { id, name: MCP_CLIENT_MODULE, disabled: true }),
      requiredIds: [],
      action: 'disabled',
      verify(servers) {
        const found = servers.find(function (item) { return item.id === id })
        if (found === undefined) return ''
        return found.phase === 'disabled' ? '' : messages.mcpStillEnabled
      },
    }
  })
}

/** Enable or disable one MCP client row by appending a profile patch override. */
export async function toggleMcpServer(ctx: HostContext, input: { id: string; enabled: boolean }): Promise<McpMutationResult> {
  const id = isPlainObject(input) && typeof input.id === 'string' ? input.id : ''
  if (id === '') throw apiError(400, 'mcp-bad-field', messages.mcpServerNotFound)
  if (input.enabled !== true && input.enabled !== false) {
    throw apiError(400, 'mcp-bad-field', messages.invalidField)
  }
  const enabled = input.enabled === true
  const state = requireEditablePatch(ctx)
  const entries = mcpEntries(state.loader)
  const entry = entries.find(function (item) { return item.options.id === id })
  if (entry === undefined) throw apiError(404, 'mcp-not-found', messages.mcpServerNotFound)
  return applyPatchPlan(ctx, function (context) {
    return {
      text: patchText.appendPatchRow(context.text, { id, name: MCP_CLIENT_MODULE, disabled: enabled === false }),
      requiredIds: enabled ? [id] : [],
      action: enabled ? 'enabled' : 'disabled',
      verify(servers) {
        const found = servers.find(function (item) { return item.id === id })
        if (found === undefined) return messages.mcpOverridden
        if (enabled) return found.phase === 'disabled' ? messages.mcpStillDisabled : ''
        return found.phase === 'disabled' ? '' : messages.mcpStillEnabled
      },
    }
  })
}
