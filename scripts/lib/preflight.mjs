/**
 * Publish-readiness checks shared by `release:preflight`, `release:pack`, and
 * `release:publish`.
 *
 * The DSH plugin contract is spread across `package.json`, `cordis.patch.yml`,
 * and the built client bundle. This module is the single place that proves the
 * three agree and that the tarball actually contains every runtime file.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  ROOT,
  SEMVER,
  NPM_NAME,
  abs,
  exists,
  readText,
  readJson,
  loadPackage,
  run,
  git,
  tarballName,
} from './util.mjs'

const REQUIRED_PACK_FILES = [
  'package.json',
  'README.md',
  'LICENSE',
  'index.js',
  'dist/client.js',
  'cordis.patch.yml',
  'icon.svg',
  'locale/zh.json',
  'locale/en.json',
  'src/shared/protocol.js',
  'src/host/plugin.js',
  'src/host/constants.js',
  'src/host/messages/index.js',
  'src/host/services/state.js',
]

const FORBIDDEN_PACK_PREFIXES = [
  'node_modules/', 'test/', 'docs/', 'scripts/', '.github/', '.git/',
  'requirements/', '.ux-design/', '.dsh-reviews/', 'coverage/',
]

const FORBIDDEN_PACK_FILES = ['client.js', 'dist/release/manifest.json']

const RUNTIME_FILE_ENTRIES = [
  'index.js', 'dist/client.js', 'cordis.patch.yml', 'locale/*.json', 'icon.svg',
  'src/host', 'src/shared',
]

function newestMtime(relativeDir) {
  let newest = 0
  const walk = (relative) => {
    const directory = abs(relative)
    if (existsSync(directory) === false) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(relative, entry.name)
      if (entry.isDirectory()) walk(child)
      else newest = Math.max(newest, statSync(abs(child)).mtimeMs)
    }
  }
  walk(relativeDir)
  return newest
}

function resolveExport(pkg, key) {
  const value = pkg.exports && pkg.exports[key]
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    for (const field of ['default', 'import', 'node', 'browser']) {
      if (typeof value[field] === 'string') return value[field]
    }
  }
  return null
}

function insideRoot(relative) {
  if (path.isAbsolute(relative)) return false
  const resolved = path.resolve(ROOT, relative)
  return resolved === ROOT || resolved.startsWith(ROOT + path.sep)
}

function normalizePackPaths(entries) {
  return entries
    .map((entry) => String(entry).replace(/^package\//, ''))
    .filter((entry) => entry.length > 0)
}

function matchFileEntry(entries, entry) {
  if (entry.includes('*')) {
    const prefix = entry.slice(0, entry.indexOf('*'))
    const suffix = entry.slice(entry.indexOf('*') + 1)
    return entries.some((file) => file.startsWith(prefix) && file.endsWith(suffix))
  }
  return entries.some((file) => file === entry || file.startsWith(entry + '/'))
}

/**
 * Validate the file list of a packed tarball against the runtime contract.
 * Exported so `release:pack` can reuse it on the real tarball.
 */
export function validatePackEntries(entries, pkg) {
  const results = []
  const ok = (scope, message) => results.push({ level: 'pass', scope, message })
  const warn = (scope, message) => results.push({ level: 'warn', scope, message })
  const error = (scope, message) => results.push({ level: 'error', scope, message })
  const files = normalizePackPaths(entries || [])

  for (const required of REQUIRED_PACK_FILES) {
    if (!files.includes(required) && !matchFileEntry(files, required)) {
      error('tarball', 'missing runtime file: ' + required)
    }
  }
  const hostFiles = files.filter((file) => file.startsWith('src/host/'))
  if (hostFiles.length < 30) {
    error('tarball', 'only ' + hostFiles.length + ' host files packed; expected the whole src/host tree')
  }
  for (const forbidden of FORBIDDEN_PACK_PREFIXES) {
    const hit = files.find((file) => file.startsWith(forbidden))
    if (hit) error('tarball', 'should not ship ' + forbidden + ' (found ' + hit + ')')
  }
  for (const forbidden of FORBIDDEN_PACK_FILES) {
    if (files.includes(forbidden)) error('tarball', 'should not ship ' + forbidden)
  }
  if (files.some((file) => file.startsWith('src/client/'))) {
    warn('tarball', 'src/client is shipped even though only dist/client.js is needed at runtime')
  }
  if (pkg.files && pkg.files.some((entry) => entry.includes('docs'))) {
    warn('tarball', 'package.json files should not include docs/')
  }
  if (!pkg.files || RUNTIME_FILE_ENTRIES.some((entry) => matchFileEntry(pkg.files, entry) === false)) {
    error('package.json', 'files[] does not include every runtime entry: ' + RUNTIME_FILE_ENTRIES.join(', '))
  }
  if (files.length > 0) ok('tarball', files.length + ' files')
  return results
}

/** Read `npm pack --dry-run --json` output into a flat path list. */
function packDryRunFiles() {
  const result = run('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'])
  if (result.error) throw new Error('npm pack failed to start: ' + result.error.message)
  if (result.status !== 0) {
    throw new Error('npm pack --dry-run failed: ' + String(result.stderr || result.stdout).trim())
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch (error) {
    throw new Error('cannot parse npm pack --json output: ' + error.message)
  }
  const record = Array.isArray(parsed) ? parsed[0] : parsed
  if (!record || Array.isArray(record.files) === false) {
    throw new Error('npm pack --json output has no files list')
  }
  return record.files.map((file) => (typeof file === 'string' ? file : file.path))
}

/**
 * Run every publish-readiness check.
 *
 * @param {object} options
 * @param {boolean} [options.publish] also require a clean git tree and no
 *   existing tag (used by `release:publish`).
 * @param {boolean} [options.authCheck] require `npm whoami` to succeed.
 * @param {boolean} [options.registryCheck] query npm for the version and refuse
 *   to overwrite an existing release.
 * @param {boolean} [options.skipPackCheck] skip `npm pack --dry-run` (used by
 *   the `prepack` lifecycle hook, which is itself already packing).
 * @param {boolean} [options.allowExistingTag] accept the release tag already
 *   existing locally (GitHub Actions runs on the pushed tag).
 * @returns {{ results: Array<{level: string, scope: string, message?: string}>, errors: Array<object>, warnings: Array<object> }}
 */
export function runPreflight(options) {
  const settings = options || {}
  const results = []
  const ok = (scope, message) => results.push({ level: 'pass', scope, message })
  const warn = (scope, message) => results.push({ level: 'warn', scope, message })
  const error = (scope, message) => results.push({ level: 'error', scope, message })

  let pkg
  try {
    pkg = loadPackage()
  } catch (failure) {
    error('package.json', 'cannot read package.json: ' + failure.message)
    return finish(results)
  }

  // ---- identity ------------------------------------------------------------
  const name = typeof pkg.name === 'string' ? pkg.name : ''
  const version = typeof pkg.version === 'string' ? pkg.version : ''
  if (pkg.private === true) error('package.json', 'private:true blocks publishing')
  if (name.length === 0) error('package.json', 'name is missing')
  else {
    if (NPM_NAME.test(name) === false || name.length > 214) {
      error('package.json', 'name is not a valid npm package name: ' + name)
    }
    if (name.startsWith('@local/')) error('package.json', 'name still uses the local-only @local scope')
    ok('package.json', 'name ' + name)
  }
  if (SEMVER.test(version) === false) error('package.json', 'version is not valid SemVer: ' + version)
  else ok('package.json', 'version ' + version)
  for (const field of ['description', 'license']) {
    if (typeof pkg[field] !== 'string' || pkg[field].trim() === '') {
      error('package.json', field + ' must not be empty')
    }
  }
  if (Array.isArray(pkg.keywords) === false || pkg.keywords.includes('dsh') === false) {
    warn('package.json', 'keywords should include "dsh" for npm/plugin discovery')
  }
  if (typeof pkg.author !== 'string' && !(pkg.author && typeof pkg.author === 'object')) {
    warn('package.json', 'author is empty; npm shows no maintainer on the package page')
  }
  if (pkg.repository) {
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url
    if (typeof url !== 'string' || /^(git\+)?https?:\/\//.test(url) === false) {
      warn('package.json', 'repository.url is not an http(s) git URL: ' + String(url))
    }
    if (typeof url === 'string' && /\.tgz$/i.test(url)) warn('package.json', 'repository.url must not point at a tarball')
  } else {
    warn('package.json', 'repository is missing; add the public repo URL before announcing the release')
  }
  if (pkg.homepage && /^https?:\/\//.test(pkg.homepage) === false) {
    warn('package.json', 'homepage is not an http(s) URL: ' + pkg.homepage)
  }
  if (pkg.bugs && typeof pkg.bugs === 'object' && pkg.bugs.url && /^https?:\/\//.test(pkg.bugs.url) === false) {
    warn('package.json', 'bugs.url is not an http(s) URL: ' + pkg.bugs.url)
  }
  if (!pkg.license) warn('package.json', 'license is missing')

  // ---- engines -------------------------------------------------------------
  if (!pkg.engines || typeof pkg.engines.dsh !== 'string' || /[0-9]/.test(pkg.engines.dsh) === false) {
    error('engines.dsh', 'declare the verified DSH version range, e.g. ">=0.2.1-rc.3 <0.3.0-0"')
  } else {
    ok('engines.dsh', pkg.engines.dsh)
  }
  if (!pkg.engines || typeof pkg.engines.node !== 'string') {
    warn('engines.node', 'missing Node.js requirement')
  }

  // ---- DSH bundle manifest --------------------------------------------------
  if (!pkg.dsh || typeof pkg.dsh !== 'object') {
    error('dsh manifest', 'package.json has no dsh field')
    return finish(results)
  }
  if (pkg.dsh.manifestVersion !== 1) error('dsh.manifestVersion', 'must be 1')
  const patches = Array.isArray(pkg.dsh.bundle?.patch) ? pkg.dsh.bundle.patch : [pkg.dsh.bundle?.patch]
  const patchFiles = patches.filter((file) => typeof file === 'string' && file.length > 0)
  if (patchFiles.length === 0) error('dsh.bundle.patch', 'no patch file declared')
  let patchText = ''
  for (const file of patchFiles) {
    if (insideRoot(file) === false) error('dsh.bundle.patch', 'patch path escapes the package root: ' + file)
    else if (exists(file) === false) error('dsh.bundle.patch', 'patch file is missing: ' + file)
    else {
      patchText += '\n' + readText(file)
      const trimmed = readText(file).trim()
      if (trimmed.length === 0) error('dsh.bundle.patch', file + ' is empty; use [] when there is no patch')
      else if (trimmed.startsWith('[') === false && trimmed.startsWith('-') === false) {
        error('dsh.bundle.patch', file + ' must be a YAML array')
      }
    }
  }
  const patchNames = Array.from(patchText.matchAll(/^\s*name:\s*['"]?([^'"\s#]+)['"]?\s*$/gm), (match) => match[1])
  if (patchNames.includes(name) === false) {
    error('cordis.patch.yml', 'no insert row names the package itself (' + name + ')')
  }
  for (const patchName of patchNames) {
    if (patchName !== name) warn('cordis.patch.yml', 'patch also inserts another package: ' + patchName)
  }
  if (patchText.includes('devbench-manager') === false) {
    warn('cordis.patch.yml', 'the stable loader id devbench-manager is missing')
  }

  // ---- browser manifest ------------------------------------------------------
  if (!pkg.dsh.client || pkg.dsh.client.platform !== 'web') {
    error('dsh.client.platform', 'must be "web"')
  } else {
    ok('dsh.client', 'platform web')
  }
  if (pkg.dsh.client && pkg.dsh.client.immediately !== undefined && typeof pkg.dsh.client.immediately !== 'boolean') {
    error('dsh.client.immediately', 'must be a boolean when present')
  }
  const inject = pkg.dsh.client?.inject
  if (Array.isArray(inject) === false || inject.length === 0) {
    warn('dsh.client.inject', 'no client packages injected; the bundle may load before its host services')
  } else if (inject.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    error('dsh.client.inject', 'every entry must be a non-empty package name')
  }
  if (pkg.dsh.client?.external !== undefined && Array.isArray(pkg.dsh.client.external) === false) {
    error('dsh.client.external', 'must be an array when present')
  }

  // ---- exports & runtime files ----------------------------------------------
  if (!pkg.exports || typeof pkg.exports !== 'object') {
    error('exports', 'package.json has no exports map')
  } else {
    for (const key of ['.', './client', './package.json', './cordis.patch.yml', './icon', './locale/*.json']) {
      if (pkg.exports[key] === undefined) error('exports', 'missing export ' + key)
    }
    const main = resolveExport(pkg, '.')
    if (!main || exists(main) === false) error('exports', '"./" does not resolve to an existing file')
    const client = resolveExport(pkg, './client')
    if (!client || exists(client) === false) error('exports', '"./client" does not resolve to a built bundle')
    if (client && /\.(ts|tsx|mts|cts)$/.test(client)) error('exports', '"./client" points at source, not a build')
    if (client && insideRoot(client) === false) error('exports', '"./client" escapes the package root')
  }
  if (exists('index.js') === false) error('index.js', 'missing host entry')
  else {
    const index = readText('index.js')
    if (index.includes('./src/host/plugin.js') === false) warn('index.js', 'host entry no longer re-exports src/host/plugin.js')
  }
  if (exists('src/host/plugin.js') === false) error('src/host/plugin.js', 'missing host plugin entry')
  else {
    const plugin = readText('src/host/plugin.js')
    if (plugin.includes('export const inject') === false || plugin.includes('export function apply') === false) {
      error('src/host/plugin.js', 'must export inject and apply')
    }
  }
  if (exists('src/shared/protocol.js') === false) error('src/shared/protocol.js', 'missing shared protocol module')
  if (!exists('cordis.patch.yml')) error('cordis.patch.yml', 'missing bundle patch file')
  if (!exists('icon.svg')) error('icon.svg', 'missing plugin icon')
  else if (readText('icon.svg').trim().startsWith('<svg') === false) error('icon.svg', 'is not an SVG document')

  // ---- client bundle ---------------------------------------------------------
  const clientExport = pkg.exports && resolveExport(pkg, './client')
  if (clientExport && exists(clientExport)) {
    const code = readText(clientExport)
    const idNeedles = [
      'id: ' + JSON.stringify(name),
      'id: "' + name + '"',
      "id: '" + name + "'",
    ]
    const checks = [
      ['__ModuleLoader__ registration', code.includes('window.__ModuleLoader__.load')],
      ['module id equals package name', idNeedles.some((needle) => code.includes(needle))],
      ['factory(require) contract', code.includes('factory(require)')],
      ['react externalized', code.includes('require("react")')],
      ['no ESM statements', code.includes('import ') === false],
    ]
    for (const [label, passed] of checks) {
      if (passed) ok('client bundle', label)
      else error('client bundle', label)
    }
    const size = statSync(abs(clientExport)).size
    if (size < 50 * 1024) warn('client bundle', 'suspiciously small: ' + size + ' bytes')
    if (size > 2 * 1024 * 1024) warn('client bundle', 'large bundle: ' + size + ' bytes')
    if (code.includes(ROOT)) error('client bundle', 'contains the local absolute checkout path')
    const bundleMtime = statSync(abs(clientExport)).mtimeMs
    const sourceMtime = Math.max(
      newestMtime('src/client'),
      newestMtime('src/shared'),
      statSync(abs('scripts/build-client.mjs')).mtimeMs,
    )
    if (sourceMtime > bundleMtime) {
      error('client bundle', 'stale: run `npm run build` before packing/publishing')
    } else {
      ok('client bundle', 'fresh build (' + size + ' bytes)')
    }
    const tracked = run('git', ['ls-files', '--error-unmatch', clientExport])
    if (tracked.status === 0) warn('client bundle', 'build artifact is tracked by git; keep dist/ ignored')
  }

  // ---- locale & icon metadata ------------------------------------------------
  for (const locale of ['zh', 'en']) {
    const file = 'locale/' + locale + '.json'
    if (exists(file) === false) {
      error('locale', 'missing ' + file)
      continue
    }
    try {
      const value = readJson(file)
      const meta = value && value.meta ? value.meta : {}
      if (typeof meta.title !== 'string' || meta.title.trim() === '') error('locale', file + ' meta.title is empty')
      if (typeof meta.description !== 'string' || meta.description.trim() === '') {
        error('locale', file + ' meta.description is empty')
      }
    } catch (failure) {
      error('locale', file + ' is not valid JSON: ' + failure.message)
    }
  }

  // ---- npm dependencies must stay registry-only -----------------------------
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const section = pkg[group]
    if (!section) continue
    for (const [dependency, range] of Object.entries(section)) {
      if (typeof range === 'string' && /^(?:file:|link:|workspace:|\/|\.{1,2}\/)/.test(range)) {
        error(group, dependency + ' uses a local spec that cannot be published: ' + range)
      }
    }
  }

  // ---- lockfile identity -----------------------------------------------------
  if (exists('package-lock.json')) {
    try {
      const lock = readJson('package-lock.json')
      if (lock.name !== pkg.name || lock.version !== pkg.version) {
        warn('package-lock.json', 'name/version differ from package.json; run npm install --package-lock-only')
      }
    } catch (failure) {
      warn('package-lock.json', 'cannot parse: ' + failure.message)
    }
  }

  // ---- tarball contents -------------------------------------------------------
  if (settings.skipPackCheck !== true) {
    try {
      const files = packDryRunFiles()
      const packResults = validatePackEntries(files, pkg)
      results.push(...packResults)
      const filename = Array.isArray(pkg.files) || pkg.files ? tarballName(pkg) : ''
      if (filename.length > 0) ok('tarball', 'expected filename ' + filename)
    } catch (failure) {
      error('tarball', failure.message)
    }
  }

  // ---- publish-only checks ---------------------------------------------------
  if (settings.publish === true) {
    const inside = run('git', ['rev-parse', '--is-inside-work-tree'])
    if (inside.status !== 0) {
      error('git', 'not a git repository')
    } else {
      const status = git(['status', '--porcelain'])
      if (status.length > 0) {
        error('git', 'working tree is dirty; commit or stash before publishing:\n' + status.split('\n').slice(0, 8).join('\n'))
      } else {
        ok('git', 'working tree is clean')
      }
      const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
      if (['main', 'master'].includes(branch) === false) warn('git', 'publishing from branch ' + branch)
      const tag = 'v' + version
      const tags = git(['tag', '--list', tag])
      if (tags.length > 0 && settings.allowExistingTag !== true) {
        error('git', 'tag ' + tag + ' already exists; bump the version first')
      } else if (tags.length > 0) {
        ok('git', 'tag ' + tag + ' already exists (CI release mode)')
      }
    }
    if (settings.authCheck === true) {
      const whoami = run('npm', ['whoami'])
      if (whoami.status !== 0) {
        error('npm auth', 'not logged in; run `npm login` and retry')
      } else ok('npm auth', String(whoami.stdout).trim())
    }
  }

  // ---- registry collision -----------------------------------------------------
  if (settings.registryCheck === true && name.length > 0 && version.length > 0) {
    const args = ['view', name + '@' + version, 'version', '--json']
    if (settings.registry) args.push('--registry', settings.registry)
    const result = run('npm', args)
    const output = String(result.stdout || '').trim()
    const stderr = String(result.stderr || '')
    if (result.status === 0 && output.includes(version)) {
      error('registry', name + '@' + version + ' already exists and cannot be overwritten')
    } else if (/E404|404 Not Found|not found/i.test(output + stderr)) {
      ok('registry', name + '@' + version + ' is available')
    } else {
      warn('registry', 'could not confirm availability: ' + (stderr || output).split('\n')[0])
    }
  }

  return finish(results)
}

function finish(results) {
  return {
    results,
    errors: results.filter((item) => item.level === 'error'),
    warnings: results.filter((item) => item.level === 'warn'),
  }
}

/** Print a preflight result set; returns the number of blocking errors. */
export function printPreflight(report, pkg) {
  const header = pkg ? pkg.name + '@' + pkg.version : 'unknown package'
  console.log('release-preflight: ' + header)
  for (const item of report.results) {
    const mark = item.level === 'error' ? '✖' : item.level === 'warn' ? '!' : '✓'
    const scope = item.scope ? item.scope + ': ' : ''
    console.log('  ' + mark + ' ' + scope + (item.message || ''))
  }
  if (report.errors.length > 0) {
    console.error('release-preflight: ' + report.errors.length + ' blocking problem(s)')
  } else {
    console.log('release-preflight: OK' +
      (report.warnings.length > 0 ? ' (' + report.warnings.length + ' warning(s))' : ''))
  }
  return report.errors.length
}
