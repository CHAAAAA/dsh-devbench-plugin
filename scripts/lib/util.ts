/**
 * Shared helpers for the release scripts.
 *
 * Every release script is plain Node.js (no runtime dependencies) so it can run
 * in CI and on a maintainer machine without installing anything extra.
 */
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const RELEASE_DIR = path.join(ROOT, 'dist', 'release')
export const CATALOG_DIR = path.join(ROOT, 'dist', 'catalog')

/** Flags that take a value when written as `--flag value`. */
const VALUE_FLAGS = new Set([
  'tag', 'registry', 'tarball', 'cli', 'out', 'version', 'index-url',
  'catalog-name', 'icon-base', 'title-en', 'title-zh', 'description-en', 'description-zh',
  'author', 'homepage', 'profile',
])

export function abs(relative) {
  return path.resolve(ROOT, relative)
}

export function exists(relative) {
  return existsSync(abs(relative))
}

export function readText(relative) {
  return readFileSync(abs(relative), 'utf8')
}

export function readJson(relative) {
  return JSON.parse(readText(relative))
}

export function loadPackage() {
  return readJson('package.json')
}

/** Parse `--flag`, `--flag=value`, and `--flag value` arguments. */
export function parseArgs(argv?: string[]): { flags: Set<string>, values: Map<string, string> } {
  const flags = new Set<string>()
  const values = new Map<string, string>()
  const list = argv || process.argv.slice(2)
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index]
    if (item.startsWith('--') === false) continue
    const equal = item.indexOf('=')
    if (equal !== -1) {
      values.set(item.slice(2, equal), item.slice(equal + 1))
      continue
    }
    const name = item.slice(2)
    const next = list[index + 1]
    if (VALUE_FLAGS.has(name) && next !== undefined && next.startsWith('--') === false) {
      values.set(name, next)
      index += 1
      continue
    }
    flags.add(name)
  }
  return { flags, values }
}

let npmFallbackCache = null

/**
 * npm needs a writable cache even for `npm pack --dry-run`. In sandboxed agent
 * environments (and some CI images) `~/.npm` is read-only, so fall back to a
 * per-user cache under the system temp directory instead of failing the check.
 */
function npmCacheEnv() {
  if (npmFallbackCache !== null) return npmFallbackCache
  let writable = false
  try {
    accessSync(path.join(os.homedir(), '.npm'), constants.W_OK)
    writable = true
  } catch {
    writable = false
  }
  npmFallbackCache = writable
    ? {}
    : { npm_config_cache: path.join(os.tmpdir(), 'dsh-devbench-npm-cache') }
  return npmFallbackCache
}

/** Run a command and capture stdout/stderr; never throws on non-zero exit. */
export function run(command, args: string[], options?) {
  const settings = options || {}
  const env = Object.assign({}, process.env, settings.env || {})
  if (command === 'npm' || command === 'npx') Object.assign(env, npmCacheEnv(), settings.env || {})
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...settings,
    env,
  })
}

/** Run a command and return trimmed stdout, throwing a readable error on failure. */
export function capture(command, args: string[], options?) {
  const result = run(command, args, options)
  if (result.error) throw new Error(command + ' failed to start: ' + result.error.message)
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(command + ' ' + args.join(' ') + ' exited ' + result.status + (detail ? ': ' + detail : ''))
  }
  return String(result.stdout || '').trim()
}

export function git(args) {
  return capture('git', args)
}

export function sha256(relative) {
  return createHash('sha256').update(readText(relative)).digest('hex')
}

export function sha512Base64(relative) {
  return createHash('sha512').update(readText(relative)).digest('base64')
}

export function fileSize(relative) {
  return statSync(abs(relative)).size
}

export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MiB'
}

/** Regex helpers shared by validation code. */
export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
export const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

/** Compare two SemVer strings by precedence; returns a negative/positive number. */
export function compareSemver(a, b) {
  const main = (value) => value.split('-')[0].split('+')[0].split('.').map(Number)
  const [aMain, bMain] = [main(a), main(b)]
  for (let index = 0; index < 3; index += 1) {
    const diff = (aMain[index] || 0) - (bMain[index] || 0)
    if (diff !== 0) return diff
  }
  const aPre = a.includes('-') ? a.slice(a.indexOf('-') + 1) : ''
  const bPre = b.includes('-') ? b.slice(b.indexOf('-') + 1) : ''
  if (aPre === '' && bPre !== '') return 1
  if (aPre !== '' && bPre === '') return -1
  if (aPre === bPre) return 0
  const aParts = aPre.split('.')
  const bParts = bPre.split('.')
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const left = aParts[index]
    const right = bParts[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNumber = /^\d+$/.test(left)
    const rightNumber = /^\d+$/.test(right)
    if (leftNumber && rightNumber && Number(left) !== Number(right)) return Number(left) - Number(right)
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

/** Print a PASS/WARN/FAIL line. */
export function report(level, scope, message) {
  const mark = level === 'error' ? '✖' : level === 'warn' ? '!' : '✓'
  const stream = level === 'error' ? console.error : console.log
  stream('  ' + mark + ' ' + scope + (message ? ': ' + message : ''))
}

export function isPrerelease(version) {
  return version.includes('-')
}

/** The dist-tag a version should be published under unless overridden. */
export function defaultDistTag(version) {
  return isPrerelease(version) ? 'next' : 'latest'
}

/** `@scope/name` → `scope-name` for tarball filenames. */
export function tarballName(pkg) {
  return pkg.name.replace(/^@/, '').replace('/', '-') + '-' + pkg.version + '.tgz'
}

/** Cross-platform DSH CLI candidate list, most specific first. */
export function dshCliCandidates() {
  const candidates = []
  if (process.env.DSH_CLI) candidates.push(process.env.DSH_CLI)
  if (process.platform === 'darwin') {
    candidates.push('/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh')
  }
  candidates.push('dsh')
  return candidates
}

/** Resolve a working DSH CLI and return `{ path, version }` or null. */
export function findDshCli(override) {
  if (override) {
    try {
      const version = capture(override, ['--version'])
      return { path: override, version }
    } catch {
      return null
    }
  }
  for (const candidate of dshCliCandidates()) {
    try {
      const version = execFileSync(candidate, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim()
      if (version.length > 0) return { path: candidate, version }
    } catch {
      // Try the next candidate.
    }
  }
  return null
}
