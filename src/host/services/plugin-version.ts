/**
 * Plugin self-update: registry version check and one-click upgrade (REQ-20261101-001).
 *
 * The host code that is running cannot change while the process lives, so the
 * version read when this module (and therefore the plugin) starts stays the
 * "current" version. The version installed on disk comes from the active DSH
 * profile, which is also where an upgrade runs the profile's own package
 * manager. Nothing here schedules a lookup on its own: only the version routes
 * call these functions, so applying the plugin never touches the network.
 */
import { execFile } from 'node:child_process'
import { promises as fsp, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  NPM_REGISTRY_URLS,
  PACKAGE_NAME,
  PROJECT_URL,
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_CHECK_TTL_MS,
  UPDATE_INSTALL_TIMEOUT_MS,
} from '../constants.js'
import { apiError, errorMessage } from '../errors.js'
import { messages } from '../messages/index.js'
import { isPlainObject, lstatMaybe } from '../shared/path-safety.js'
import type { HostContext } from '../context.js'
import type {
  PluginInstallKind,
  PluginUpgradeBlockedReason,
  PluginUpgradeResponse,
  PluginUpgradeResult,
  PluginVersionInfo,
  PluginVersionStatus,
} from '../../shared/api-types.js'

const execFileAsync = promisify(execFile)

/**
 * Install kind when the profile cannot tell: a module resolved from a
 * `node_modules/` directory is a package install; a checkout is a dev link.
 */
const FALLBACK_INSTALL_KIND: PluginInstallKind = fileURLToPath(import.meta.url)
  .includes(path.sep + 'node_modules' + path.sep) ? 'package' : 'link'

/** How much package-manager output is echoed back after a failed upgrade. */
const MAX_INSTALL_DETAIL = 300

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

interface PackageManagerInvocation {
  command: string
  args: string[]
  env: Record<string, string>
}

interface InstallEnvironment {
  /** True only when the profile directory can be used as the install target. */
  available: boolean
  dir: string
  kind: PluginInstallKind
  packageManager: PackageManagerInvocation
  installedVersion: string
}

interface RegistryResult {
  version: string
  error: string
}

interface VersionState {
  status: PluginVersionStatus
  latestVersion: string
  error: string
  checkedAt: number
  checking: Promise<void> | null
  upgrading: boolean
}

/** Per-host-context state, so a reloaded plugin starts with an empty snapshot. */
const states = new WeakMap<object, VersionState>()

// ---- semver ----------------------------------------------------------------

const VERSION_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function numericIdentifier(value: string): number | null {
  if (/^\d+$/.test(value) === false) return null
  // Semver forbids leading zeros in numeric identifiers (build metadata aside).
  if (value.length > 1 && value.startsWith('0')) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

/**
 * Parse one strict semver string (`1.2.3`, `1.2.3-rc.1`, `1.2.3+build`).
 * @returns The parsed version, or null when the value is not valid semver.
 */
export function parseVersion(value: string): ParsedVersion | null {
  if (typeof value !== 'string') return null
  const match = VERSION_PATTERN.exec(value)
  if (match === null) return null
  const major = numericIdentifier(match[1])
  const minor = numericIdentifier(match[2])
  const patch = numericIdentifier(match[3])
  if (major === null || minor === null || patch === null) return null
  const prerelease = match[4] === undefined ? [] : match[4].split('.')
  for (const identifier of prerelease) {
    if (/^\d+$/.test(identifier) && numericIdentifier(identifier) === null) return null
  }
  return { major, minor, patch, prerelease }
}

/** True for a strict semver release or prerelease (build metadata allowed). */
export function isValidVersion(value: string): boolean {
  return parseVersion(value) !== null
}

function compareNumericIdentifier(left: string, right: string): number {
  const leftValue = Number(left)
  const rightValue = Number(right)
  if (leftValue === rightValue) return 0
  return leftValue < rightValue ? -1 : 1
}

/** Semver §11 identifier order: numeric < alphanumeric, numbers by value. */
function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return compareNumericIdentifier(left, right)
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * Compare two semver versions (build metadata ignored, prerelease order per
 * semver §11).
 * @returns -1 when left is older, 0 when equal, 1 when newer; NaN when either
 *   value is not valid semver.
 */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) return Number.NaN
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const shared = Math.min(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < shared; index += 1) {
    const comparison = compareIdentifier(a.prerelease[index], b.prerelease[index])
    if (comparison !== 0) return comparison
  }
  if (a.prerelease.length === b.prerelease.length) return 0
  return a.prerelease.length < b.prerelease.length ? -1 : 1
}

/**
 * True when a stored check result is older than the reuse window.
 * @param checkedAt Epoch milliseconds of the last finished lookup (0 = never).
 * @param now Current epoch milliseconds.
 */
export function isCheckStale(checkedAt: number, now: number): boolean {
  if (Number.isFinite(checkedAt) === false || Number.isFinite(now) === false) return true
  return checkedAt <= 0 || now - checkedAt > UPDATE_CHECK_TTL_MS
}

// ---- profile install facts -------------------------------------------------

/**
 * Running host-code version. Declared after the semver helpers because the
 * version pattern is a module constant that `readRunningVersion` needs.
 */
const RUNNING_VERSION = readRunningVersion()

function readRunningVersion(): string {
  try {
    const file = fileURLToPath(new URL('../../../package.json', import.meta.url))
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return isPlainObject(data) && typeof data.version === 'string' && isValidVersion(data.version)
      ? data.version
      : ''
  } catch {
    return ''
  }
}

function contextService(ctx: HostContext, name: string): unknown {
  if (ctx === undefined || ctx === null || typeof ctx.get !== 'function') return undefined
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

function profileFacts(ctx: HostContext): Record<string, unknown> | null {
  const profile = contextService(ctx, 'profileContext')
  return isPlainObject(profile) ? profile as Record<string, unknown> : null
}

/**
 * Package-manager invocation of the active profile. DSH packaged applications
 * supply their own runtime (command plus prefix arguments and environment);
 * otherwise the PATH `pnpm` binary is the fallback.
 */
function packageManagerOf(profile: Record<string, unknown> | null): PackageManagerInvocation {
  const raw: Record<string, unknown> = profile !== null && isPlainObject(profile.packageManager)
    ? profile.packageManager as Record<string, unknown>
    : {}
  const command = typeof raw.command === 'string' && raw.command.trim() !== ''
    ? raw.command.trim()
    : 'pnpm'
  const args = Array.isArray(raw.args)
    ? raw.args.filter(function (value: unknown) { return typeof value === 'string' && value !== '' })
    : []
  const env: Record<string, string> = {}
  if (isPlainObject(raw.env)) {
    for (const [key, value] of Object.entries(raw.env)) {
      if (typeof value === 'string') env[key] = value
    }
  }
  return { command, args, env }
}

async function readPackageVersion(file: string): Promise<string> {
  try {
    const data = JSON.parse(await fsp.readFile(file, 'utf8'))
    return isPlainObject(data) && typeof data.version === 'string' && isValidVersion(data.version)
      ? data.version
      : ''
  } catch {
    return ''
  }
}

async function statMaybe(target: string) {
  try {
    return await fsp.stat(target)
  } catch {
    return null
  }
}

/** Link (checkout symlink) versus package (real directory) install of the bundle. */
async function detectInstallKind(dir: string): Promise<PluginInstallKind> {
  let stat = null
  try {
    stat = await lstatMaybe(path.join(dir, 'node_modules', PACKAGE_NAME))
  } catch {
    stat = null
  }
  if (stat === null) return FALLBACK_INSTALL_KIND
  if (stat.isSymbolicLink()) return 'link'
  if (stat.isDirectory()) return 'package'
  return FALLBACK_INSTALL_KIND
}

/**
 * Where the plugin is installed and whether an upgrade can run there.
 * `installedVersion` falls back to the running version when the profile's
 * package.json cannot be read (for example a source checkout).
 */
async function installEnvironment(ctx: HostContext): Promise<InstallEnvironment> {
  const profile = profileFacts(ctx)
  const candidate = profile !== null && typeof profile.dir === 'string' && path.isAbsolute(profile.dir)
    ? profile.dir
    : ''
  const dirStat = candidate === '' ? null : await statMaybe(candidate)
  const usable = dirStat !== null && dirStat.isDirectory()
  if (usable === false) {
    return {
      available: false,
      dir: '',
      kind: FALLBACK_INSTALL_KIND,
      packageManager: packageManagerOf(profile),
      installedVersion: RUNNING_VERSION,
    }
  }
  const packageJson = path.join(candidate, 'node_modules', PACKAGE_NAME, 'package.json')
  const installedVersion = await readPackageVersion(packageJson)
  return {
    available: true,
    dir: candidate,
    kind: await detectInstallKind(candidate),
    packageManager: packageManagerOf(profile),
    installedVersion: installedVersion === '' ? RUNNING_VERSION : installedVersion,
  }
}

function isUpdateAvailable(latest: string, installed: string): boolean {
  if (isValidVersion(latest) === false) return false
  const current = isValidVersion(installed) ? installed : RUNNING_VERSION
  const comparison = compareVersions(latest, current)
  return Number.isNaN(comparison) === false && comparison > 0
}

// ---- registry lookup -------------------------------------------------------

function shorten(value: string, limit: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > limit ? text.slice(0, limit) + '…' : text
}

/** Strip home paths and credential remnants from package-manager output. */
function sanitizeDetail(value: unknown, limit: number): string {
  let text = ''
  if (typeof value === 'string') text = value
  else if (Buffer.isBuffer(value)) text = value.toString('utf8')
  else if (value !== undefined && value !== null) text = String(value)
  text = text.replace(/\s+/g, ' ').trim()
  const home = os.homedir()
  if (home.length > 0) text = text.split(home).join('~')
  // `//user:token@host` credentials in registry URLs and `_authToken=...` pairs.
  text = text.replace(/\/\/[^/\s@]+:[^/\s@]+@/g, '//***@')
  text = text.replace(/(_authToken|_auth|authToken|password|token)\s*[=:]\s*\S+/gi, '$1=***')
  return shorten(text, limit)
}

function registryUrl(registry: unknown): string {
  return String(registry).replace(/\/+$/, '') + '/' + PACKAGE_NAME + '/latest'
}

/**
 * Latest published version, asking every configured registry in order. A slow,
 * failing or malformed answer falls through to the next registry; the last
 * error is reported when all of them fail.
 */
async function lookupLatestVersion(): Promise<RegistryResult> {
  let lastError = ''
  for (const registry of NPM_REGISTRY_URLS) {
    const url = registryUrl(registry)
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
      })
      if (response.ok !== true) {
        lastError = 'HTTP ' + String(response.status)
        continue
      }
      const body: any = await response.json()
      const version = body !== null && typeof body === 'object' && typeof body.version === 'string'
        ? body.version
        : ''
      if (isValidVersion(version) === false) {
        lastError = 'invalid version'
        continue
      }
      return { version, error: '' }
    } catch (error) {
      lastError = shorten(errorMessage(error), 200)
    }
  }
  return { version: '', error: lastError }
}

// ---- snapshot state --------------------------------------------------------

function stateOf(ctx: HostContext): VersionState {
  const key = ctx as unknown as object
  let state = states.get(key)
  if (state === undefined) {
    state = {
      status: 'idle',
      latestVersion: '',
      error: '',
      checkedAt: 0,
      checking: null,
      upgrading: false,
    }
    states.set(key, state)
  }
  return state
}

/** Start (or join) one registry lookup; the returned promise never rejects. */
function triggerCheck(ctx: HostContext): Promise<void> {
  const state = stateOf(ctx)
  if (state.checking !== null) return state.checking
  const run = (async function () {
    state.status = 'checking'
    state.error = ''
    const result = await lookupLatestVersion()
    if (result.version === '') {
      state.status = 'error'
      state.latestVersion = ''
      state.error = messages.updateCheckFailed + (result.error === '' ? '' : ': ' + result.error)
    } else {
      state.status = 'ready'
      state.latestVersion = result.version
      state.error = ''
    }
    state.checkedAt = Date.now()
  })()
  state.checking = run
  const clear = function () {
    if (state.checking === run) state.checking = null
  }
  void run.then(clear, clear)
  return run
}

function upgradeBlock(
  state: VersionState,
  env: InstallEnvironment,
): { canUpgrade: boolean; upgradeBlockedReason: PluginUpgradeBlockedReason } {
  if (env.available === false) return { canUpgrade: false, upgradeBlockedReason: 'environment-unavailable' }
  if (env.kind === 'link') return { canUpgrade: false, upgradeBlockedReason: 'link-install' }
  if (state.status !== 'ready') {
    const reason: PluginUpgradeBlockedReason = state.status === 'checking' || state.status === 'idle'
      ? 'checking'
      : 'update-unavailable'
    return { canUpgrade: false, upgradeBlockedReason: reason }
  }
  if (isUpdateAvailable(state.latestVersion, env.installedVersion) === false) {
    return { canUpgrade: false, upgradeBlockedReason: 'update-unavailable' }
  }
  return { canUpgrade: true, upgradeBlockedReason: '' }
}

async function buildInfo(ctx: HostContext, state: VersionState): Promise<PluginVersionInfo> {
  const env = await installEnvironment(ctx)
  const blocked = upgradeBlock(state, env)
  const restartRequired = env.installedVersion !== '' && RUNNING_VERSION !== '' &&
    env.installedVersion !== RUNNING_VERSION
  return {
    packageName: PACKAGE_NAME,
    repositoryUrl: PROJECT_URL,
    currentVersion: RUNNING_VERSION,
    installedVersion: env.installedVersion,
    latestVersion: state.latestVersion,
    status: state.status,
    updateAvailable: state.status === 'ready' && isUpdateAvailable(state.latestVersion, env.installedVersion),
    restartRequired,
    installKind: env.kind,
    canUpgrade: blocked.canUpgrade,
    upgradeBlockedReason: blocked.upgradeBlockedReason,
    upgrading: state.upgrading,
    checkedAt: state.checkedAt > 0 ? new Date(state.checkedAt).toISOString() : '',
    error: state.error,
  }
}

// ---- package-manager execution ---------------------------------------------

/** Tokens `cmd.exe` accepts without quotes. */
const COMSPEC_SAFE_TOKEN = /^[A-Za-z0-9@._:/\\+=~,-]+$/
/** Characters that stay dangerous (or break quoting) even inside double quotes. */
const COMSPEC_UNQUOTABLE = /[\r\n"!%]/

function unsafePackageManager() {
  return apiError(409, 'update-environment-unavailable', messages.updateEnvironmentUnavailable)
}

/**
 * Run a Windows `.cmd`/`.bat` package manager through `ComSpec`, quoting every
 * token and refusing characters cmd.exe would expand. Arguments come from
 * constants, the validated target version and the profile facts, so the built
 * command line cannot be influenced by request data. Exported for focused tests.
 */
export function comSpecInvocation(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  const tokens = [command].concat(args)
  const quoted = tokens.map(function (token: string) {
    if (typeof token !== 'string' || token.length === 0 || token.trim() !== token) {
      throw unsafePackageManager()
    }
    if (COMSPEC_SAFE_TOKEN.test(token)) return token
    if (COMSPEC_UNQUOTABLE.test(token)) throw unsafePackageManager()
    return '"' + token + '"'
  })
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', '"' + quoted.join(' ') + '"'],
  }
}

function installFailure(error: unknown) {
  const failed = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {}
  if (failed.killed === true) {
    return apiError(504, 'update-timeout',
      messages.updateInstallFailed + ': timeout after ' +
      String(Math.round(UPDATE_INSTALL_TIMEOUT_MS / 1000)) + 's')
  }
  const parts: string[] = []
  for (const value of [failed.stderr, failed.stdout]) {
    const text = sanitizeDetail(value, MAX_INSTALL_DETAIL)
    if (text !== '') parts.push(text)
  }
  const detail = parts.length > 0 ? parts.join(' ') : sanitizeDetail(errorMessage(error), MAX_INSTALL_DETAIL)
  return apiError(502, 'update-install-failed',
    messages.updateInstallFailed + (detail === '' ? '' : ': ' + detail))
}

/**
 * Install one exact package version in the profile directory through the
 * profile's package manager. `execFile` is used without a shell; only Windows
 * `.cmd`/`.bat` shims get the `ComSpec` fallback.
 */
async function installPackageVersion(env: InstallEnvironment, target: string): Promise<void> {
  const spec = PACKAGE_NAME + '@' + target
  const invocation = env.packageManager
  const baseArgs = invocation.args.concat(['add', spec, '--save-exact'])
  let command = invocation.command
  let args = baseArgs
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    const wrapped = comSpecInvocation(command, baseArgs)
    command = wrapped.command
    args = wrapped.args
  }
  try {
    await execFileAsync(command, args, {
      cwd: env.dir,
      env: Object.assign({}, process.env, invocation.env),
      timeout: UPDATE_INSTALL_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (error) {
    throw installFailure(error)
  }
}

async function runUpgrade(ctx: HostContext, state: VersionState): Promise<PluginUpgradeResult> {
  const env = await installEnvironment(ctx)
  if (env.available === false) {
    throw apiError(409, 'update-environment-unavailable', messages.updateEnvironmentUnavailable)
  }
  if (env.kind === 'link') throw apiError(409, 'update-link-install', messages.updateLinkInstall)
  const target = state.latestVersion
  if (state.status !== 'ready' || isValidVersion(target) === false ||
    isUpdateAvailable(target, env.installedVersion) === false) {
    throw apiError(409, 'update-not-available', messages.updateNotAvailable)
  }
  await installPackageVersion(env, target)
  // Trust the disk, not the command's exit code: a registry cache or a failed
  // partial install must not be reported as a successful upgrade.
  const installedVersion = await readPackageVersion(
    path.join(env.dir, 'node_modules', PACKAGE_NAME, 'package.json'))
  if (installedVersion !== target) {
    throw apiError(502, 'update-version-mismatch', messages.updateVersionMismatch)
  }
  state.status = 'ready'
  state.latestVersion = target
  state.error = ''
  state.checkedAt = Date.now()
  return {
    beforeVersion: RUNNING_VERSION,
    targetVersion: target,
    installedVersion,
    restartRequired: installedVersion !== RUNNING_VERSION,
  }
}

// ---- public API ------------------------------------------------------------

/**
 * Current version snapshot. Starts a registry lookup in the background when no
 * check has finished yet or the cached result is stale, and returns without
 * waiting for it, so opening the page never blocks on the network.
 */
export async function pluginVersionInfo(ctx: HostContext): Promise<PluginVersionInfo> {
  const state = stateOf(ctx)
  if (state.checking === null && (state.status === 'idle' || isCheckStale(state.checkedAt, Date.now()))) {
    void triggerCheck(ctx).catch(function () {})
  }
  return buildInfo(ctx, state)
}

/** Force a registry lookup (ignoring the TTL) and wait for its result. */
export async function checkPluginVersion(ctx: HostContext): Promise<PluginVersionInfo> {
  const state = stateOf(ctx)
  try {
    await triggerCheck(ctx)
  } catch (error) {
    // A programming error must surface as a failed check, not a 500 response.
    state.status = 'error'
    state.latestVersion = ''
    state.error = messages.updateCheckFailed + ': ' + sanitizeDetail(errorMessage(error), 200)
    state.checkedAt = Date.now()
  }
  return buildInfo(ctx, state)
}

/**
 * Install the latest version through the profile package manager.
 * @throws ApiError 409 for every unavailable scenario (link install, missing
 *   profile facts, no update, upgrade already running) and 502/504 when the
 *   package manager itself fails.
 */
export async function upgradePluginVersion(ctx: HostContext): Promise<PluginUpgradeResponse> {
  const state = stateOf(ctx)
  // The flag is raised before the first await, so a second request is refused
  // even when it arrives in the same tick.
  if (state.upgrading) throw apiError(409, 'update-in-progress', messages.updateInProgress)
  state.upgrading = true
  let upgrade: PluginUpgradeResult
  try {
    upgrade = await runUpgrade(ctx, state)
  } finally {
    state.upgrading = false
  }
  return { upgrade, info: await buildInfo(ctx, state) }
}
