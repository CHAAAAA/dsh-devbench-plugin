/**
 * Plugin self-update host tests (REQ-20261101-001).
 *
 * Every registry lookup goes through a mocked `globalThis.fetch`, and the
 * upgrade path runs a node script that stands in for pnpm against a temporary
 * profile directory. No real registry, DSH profile or package manager is used.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHarness, expectOk } from './helpers.js'
import {
  NPM_REGISTRY_URLS,
  PACKAGE_NAME,
  UPDATE_CHECK_TTL_MS,
} from '../../src/host/constants.js'
import { messages } from '../../src/host/messages/index.js'
import {
  checkPluginVersion,
  comSpecInvocation,
  compareVersions,
  isCheckStale,
  isValidVersion,
  parseVersion,
  upgradePluginVersion,
} from '../../src/host/services/plugin-version.js'

const manifest = JSON.parse(await fsp.readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const CURRENT_VERSION: string = manifest.version
/** Far above any real release so the mocked registry always offers an update. */
const LATEST_VERSION = '999.0.0'

// ---- fixtures --------------------------------------------------------------

function jsonResponse(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body } }
}

function mockFetch(handler: (url: string) => any) {
  const original = (globalThis as any).fetch
  const calls: { url: string; init: any }[] = []
  ;(globalThis as any).fetch = async function (url: any, init: any) {
    calls.push({ url: String(url), init })
    return handler(String(url))
  }
  return {
    calls,
    restore() {
      ;(globalThis as any).fetch = original
    },
  }
}

function deferred() {
  let resolve: (value: any) => void = function () {}
  let reject: (error: any) => void = function () {}
  const promise = new Promise<any>(function (resolvePromise, rejectPromise) {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function withTimeout(promise: Promise<any>, milliseconds: number): Promise<any> {
  return new Promise<any>(function (resolve, reject) {
    const timer = setTimeout(function () {
      reject(new Error('operation did not settle in ' + String(milliseconds) + 'ms'))
    }, milliseconds)
    promise.then(function (value) {
      clearTimeout(timer)
      resolve(value)
    }, function (error) {
      clearTimeout(timer)
      reject(error)
    })
  })
}

interface FakePnpmOptions {
  fail?: boolean
  writtenVersion?: string
  delayMs?: number
}

/** A node script standing in for `pnpm add <pkg> --save-exact`. */
async function writeFakePnpm(tempRoot: string, options: FakePnpmOptions = {}): Promise<string> {
  const file = path.join(tempRoot, 'fake-pnpm.mjs')
  const written = options.writtenVersion === undefined ? '' : options.writtenVersion
  const lines = [
    "import { mkdir, writeFile } from 'node:fs/promises'",
    "import path from 'node:path'",
    'const args = process.argv.slice(2)',
    'const prefix = ' + JSON.stringify(PACKAGE_NAME + '@'),
    'const spec = args.find(function (item) { return item.startsWith(prefix) })',
    "const version = spec === undefined ? '0.0.0' : spec.slice(prefix.length)",
    options.fail === true
      ? "console.error('ERR_PNPM_FETCH_404 simulated registry failure'); process.exit(1)"
      : '',
    (options.delayMs || 0) > 0
      ? 'await new Promise(function (resolve) { setTimeout(resolve, ' + String(options.delayMs) + ') })'
      : '',
    "const target = path.join(process.cwd(), 'node_modules', " + JSON.stringify(PACKAGE_NAME) + ')',
    'await mkdir(target, { recursive: true })',
    'const written = ' + JSON.stringify(written),
    "await writeFile(path.join(target, 'package.json'), JSON.stringify({ name: " +
      JSON.stringify(PACKAGE_NAME) + ", version: written === '' ? version : written }))",
  ].filter(function (line) { return line !== '' })
  await fsp.writeFile(file, lines.join('\n'))
  return file
}

interface ProfileOptions {
  kind?: 'package' | 'link'
  installedVersion?: string
  packageManager?: any
}

/** Profile facts plus a temporary `node_modules/<pkg>` the upgrade can target. */
async function makeProfileFacts(tempRoot: string, options: ProfileOptions = {}) {
  const dir = path.join(tempRoot, 'profile')
  const packageDir = path.join(dir, 'node_modules', PACKAGE_NAME)
  const installedVersion = options.installedVersion || CURRENT_VERSION
  await fsp.mkdir(path.join(dir, 'node_modules'), { recursive: true })
  if (options.kind === 'link') {
    const checkout = path.join(tempRoot, 'checkout')
    await fsp.mkdir(checkout, { recursive: true })
    await fsp.writeFile(path.join(checkout, 'package.json'),
      JSON.stringify({ name: PACKAGE_NAME, version: installedVersion }))
    await fsp.symlink(checkout, packageDir, 'dir')
  } else {
    await fsp.mkdir(packageDir, { recursive: true })
    await fsp.writeFile(path.join(packageDir, 'package.json'),
      JSON.stringify({ name: PACKAGE_NAME, version: installedVersion }))
  }
  const facts: any = {
    name: 'desktop',
    dir,
    patchPath: path.join(dir, 'cordis.patch.yml'),
  }
  if (options.packageManager !== undefined) facts.packageManager = options.packageManager
  return facts
}

/** A package-manager invocation that runs the fake pnpm through this node binary. */
async function fakePnpmInvocation(tempRoot: string, options: FakePnpmOptions = {}) {
  const script = await writeFakePnpm(tempRoot, options)
  return { command: process.execPath, args: [script] }
}

async function withVersionHost(
  setup: (tempRoot: string) => Promise<Record<string, any>>,
  run: (context: { harness: any; tempRoot: string }) => Promise<void>,
) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'devbench-version-'))
  let harness: any = null
  try {
    const services = await setup(tempRoot)
    harness = await createHarness([], { services })
    await run({ harness, tempRoot })
  } finally {
    if (harness !== null) await harness.close()
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
}

async function waitForVersionStatus(harness: any, wanted: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = expectOk(await harness.request('GET', '/version'))
    if (value.status === wanted) return value
    await new Promise(function (resolve) { setTimeout(resolve, 10) })
  }
  throw new Error('plugin version status did not reach ' + wanted)
}

function expectVersionError(result: any, status: number, code: string) {
  assert.equal(result.status, status, result.raw)
  assert.equal(result.data.error.code, code)
  return result.data.error
}

// ---- semver ----------------------------------------------------------------

test('version parsing and ordering follow semver including prereleases', function () {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] })
  assert.deepEqual(parseVersion('1.2.3-rc.1').prerelease, ['rc', '1'])
  assert.equal(isValidVersion('1.2.3'), true)
  assert.equal(isValidVersion('1.2.3-beta.2'), true)
  assert.equal(isValidVersion('1.2.3+build.5'), true)
  assert.equal(isValidVersion('1.2'), false)
  assert.equal(isValidVersion('v1.2.3'), false)
  assert.equal(isValidVersion('01.2.3'), false)
  assert.equal(isValidVersion('not-a-version'), false)

  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
  assert.equal(compareVersions('1.2.4', '1.2.3'), 1)
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1)
  assert.equal(compareVersions('2.0.0', '10.0.0'), -1)
  // A release outranks any prerelease of the same core version.
  assert.equal(compareVersions('1.2.3', '1.2.3-beta.2'), 1)
  assert.equal(compareVersions('1.2.3-beta.2', '1.2.3'), -1)
  // Alphanumeric identifiers compare lexically, numeric ones by value.
  assert.equal(compareVersions('1.2.3-alpha', '1.2.3-beta'), -1)
  assert.equal(compareVersions('1.2.3-alpha.2', '1.2.3-alpha.10'), -1)
  // A longer identifier list is newer when the prefix matches.
  assert.equal(compareVersions('1.2.3-alpha.1', '1.2.3-alpha'), 1)
  // Build metadata is ignored.
  assert.equal(compareVersions('1.2.3+build.1', '1.2.3+build.2'), 0)
  assert.equal(Number.isNaN(compareVersions('x', '1.0.0')), true)
})

test('check results are reused only inside the TTL window', function () {
  const now = Date.now()
  assert.equal(isCheckStale(0, now), true)
  assert.equal(isCheckStale(now, now), false)
  assert.equal(isCheckStale(now - UPDATE_CHECK_TTL_MS, now), false)
  assert.equal(isCheckStale(now - UPDATE_CHECK_TTL_MS - 1, now), true)
})

// ---- check flow ------------------------------------------------------------

test('apply() starts no lookup and GET /version answers before the background check settles', async function () {
  const gate = deferred()
  const fetchMock = mockFetch(function () { return gate.promise })
  try {
    await withVersionHost(async function (tempRoot) {
      return {
        profileContext: await makeProfileFacts(tempRoot, {
          packageManager: await fakePnpmInvocation(tempRoot),
        }),
      }
    }, async function ({ harness }) {
      // Importing the plugin and applying it must not touch the network.
      assert.equal(fetchMock.calls.length, 0)
      const value = expectOk(await withTimeout(harness.request('GET', '/version'), 2000))
      assert.equal(value.status, 'checking')
      assert.equal(value.packageName, PACKAGE_NAME)
      assert.equal(value.currentVersion, CURRENT_VERSION)
      assert.equal(value.installedVersion, CURRENT_VERSION)
      assert.equal(value.installKind, 'package')
      assert.equal(fetchMock.calls.length, 1)
      assert.ok(fetchMock.calls[0].url.startsWith(NPM_REGISTRY_URLS[0]))
      assert.ok(fetchMock.calls[0].init.signal instanceof AbortSignal)

      gate.resolve(jsonResponse({ version: LATEST_VERSION }))
      const checked = await waitForVersionStatus(harness, 'ready')
      assert.equal(checked.latestVersion, LATEST_VERSION)
      assert.equal(checked.updateAvailable, true)
      assert.equal(checked.canUpgrade, true)
      assert.equal(checked.upgradeBlockedReason, '')
      assert.notEqual(checked.checkedAt, '')
    })
  } finally {
    fetchMock.restore()
  }
})

test('POST /version/check waits for a forced check and falls back across registries', async function () {
  const fetchMock = mockFetch(function (url) {
    if (url.startsWith(NPM_REGISTRY_URLS[0])) return jsonResponse({ error: 'unavailable' }, 503)
    return jsonResponse({ version: LATEST_VERSION })
  })
  try {
    await withVersionHost(async function (tempRoot) {
      return { profileContext: await makeProfileFacts(tempRoot) }
    }, async function ({ harness }) {
      const value = expectOk(await harness.request('POST', '/version/check'))
      assert.equal(value.status, 'ready')
      assert.equal(value.latestVersion, LATEST_VERSION)
      assert.equal(value.updateAvailable, true)
      assert.equal(fetchMock.calls.length, 2)
      assert.ok(fetchMock.calls[0].url.startsWith(NPM_REGISTRY_URLS[0]))
      assert.ok(fetchMock.calls[1].url.startsWith(NPM_REGISTRY_URLS[1]))
    })
  } finally {
    fetchMock.restore()
  }
})

test('a check fails over every registry and reports an error snapshot', async function () {
  const fetchMock = mockFetch(function (url) {
    if (url.startsWith(NPM_REGISTRY_URLS[0])) throw new Error('registry down')
    return jsonResponse({ version: 'not-a-version' })
  })
  try {
    await withVersionHost(async function (tempRoot) {
      return { profileContext: await makeProfileFacts(tempRoot) }
    }, async function ({ harness }) {
      const value = expectOk(await harness.request('POST', '/version/check'))
      assert.equal(value.status, 'error')
      assert.equal(value.latestVersion, '')
      assert.equal(value.updateAvailable, false)
      assert.equal(value.canUpgrade, false)
      assert.equal(value.upgradeBlockedReason, 'update-unavailable')
      assert.ok(value.error.startsWith(messages.updateCheckFailed))
      assert.notEqual(value.checkedAt, '')
      assert.equal(fetchMock.calls.length, 2)
    })
  } finally {
    fetchMock.restore()
  }
})

test('a finished check is cached until the TTL expires and POST check forces a new lookup', async function () {
  const fetchMock = mockFetch(function () { return jsonResponse({ version: LATEST_VERSION }) })
  try {
    await withVersionHost(async function (tempRoot) {
      return { profileContext: await makeProfileFacts(tempRoot) }
    }, async function ({ harness }) {
      expectOk(await harness.request('POST', '/version/check'))
      assert.equal(fetchMock.calls.length, 1)
      const cached = expectOk(await harness.request('GET', '/version'))
      assert.equal(cached.status, 'ready')
      assert.equal(cached.latestVersion, LATEST_VERSION)
      assert.equal(fetchMock.calls.length, 1)
      expectOk(await harness.request('POST', '/version/check'))
      assert.equal(fetchMock.calls.length, 2)
    })
  } finally {
    fetchMock.restore()
  }
})

// ---- upgrade flow ----------------------------------------------------------

test('POST /version/upgrade installs the latest version and reports restartRequired', async function () {
  const fetchMock = mockFetch(function () { return jsonResponse({ version: LATEST_VERSION }) })
  try {
    await withVersionHost(async function (tempRoot) {
      return {
        profileContext: await makeProfileFacts(tempRoot, {
          packageManager: await fakePnpmInvocation(tempRoot),
        }),
      }
    }, async function ({ harness, tempRoot }) {
      expectOk(await harness.request('POST', '/version/check'))
      const value = expectOk(await harness.request('POST', '/version/upgrade'))
      assert.equal(value.upgrade.beforeVersion, CURRENT_VERSION)
      assert.equal(value.upgrade.targetVersion, LATEST_VERSION)
      assert.equal(value.upgrade.installedVersion, LATEST_VERSION)
      assert.equal(value.upgrade.restartRequired, true)
      assert.equal(value.info.installedVersion, LATEST_VERSION)
      assert.equal(value.info.currentVersion, CURRENT_VERSION)
      assert.equal(value.info.restartRequired, true)
      assert.equal(value.info.upgrading, false)
      assert.equal(value.info.updateAvailable, false)
      assert.equal(value.info.canUpgrade, false)
      const installed = JSON.parse(await fsp.readFile(
        path.join(tempRoot, 'profile', 'node_modules', PACKAGE_NAME, 'package.json'), 'utf8'))
      assert.equal(installed.version, LATEST_VERSION)
    })
  } finally {
    fetchMock.restore()
  }
})

test('a failing package manager is reported as update-install-failed', async function () {
  const fetchMock = mockFetch(function () { return jsonResponse({ version: LATEST_VERSION }) })
  try {
    await withVersionHost(async function (tempRoot) {
      return {
        profileContext: await makeProfileFacts(tempRoot, {
          packageManager: await fakePnpmInvocation(tempRoot, { fail: true }),
        }),
      }
    }, async function ({ harness }) {
      expectOk(await harness.request('POST', '/version/check'))
      const error = expectVersionError(
        await harness.request('POST', '/version/upgrade'), 502, 'update-install-failed')
      assert.ok(error.message.startsWith(messages.updateInstallFailed))
      assert.ok(error.message.includes('ERR_PNPM_FETCH_404'))
      // The failed upgrade is over; a retry is possible again.
      const info = expectOk(await harness.request('GET', '/version'))
      assert.equal(info.upgrading, false)
    })
  } finally {
    fetchMock.restore()
  }
})

test('an install that lands on another version is reported as update-version-mismatch', async function () {
  const fetchMock = mockFetch(function () { return jsonResponse({ version: LATEST_VERSION }) })
  try {
    await withVersionHost(async function (tempRoot) {
      return {
        profileContext: await makeProfileFacts(tempRoot, {
          packageManager: await fakePnpmInvocation(tempRoot, { writtenVersion: '0.0.1' }),
        }),
      }
    }, async function ({ harness }) {
      expectOk(await harness.request('POST', '/version/check'))
      const error = expectVersionError(
        await harness.request('POST', '/version/upgrade'), 502, 'update-version-mismatch')
      assert.equal(error.message, messages.updateVersionMismatch)
    })
  } finally {
    fetchMock.restore()
  }
})

test('a link install cannot be upgraded and reports the blocked reason', async function () {
  const fetchMock = mockFetch(function () { return jsonResponse({ version: LATEST_VERSION }) })
  try {
    await withVersionHost(async function (tempRoot) {
      return { profileContext: await makeProfileFacts(tempRoot, { kind: 'link' }) }
    }, async function ({ harness }) {
      const info = expectOk(await harness.request('POST', '/version/check'))
      assert.equal(info.installKind, 'link')
      assert.equal(info.updateAvailable, true)
      assert.equal(info.canUpgrade, false)
      assert.equal(info.upgradeBlockedReason, 'link-install')
      expectVersionError(await harness.request('POST', '/version/upgrade'), 409, 'update-link-install')
    })
  } finally {
    fetchMock.restore()
  }
})

test('a host without profile facts refuses to upgrade', async function () {
  const fetchMock = mockFetch(function () { return jsonResponse({ version: LATEST_VERSION }) })
  try {
    await withVersionHost(async function () {
      return {}
    }, async function ({ harness }) {
      const info = expectOk(await harness.request('POST', '/version/check'))
      assert.equal(info.updateAvailable, true)
      assert.equal(info.canUpgrade, false)
      assert.equal(info.upgradeBlockedReason, 'environment-unavailable')
      expectVersionError(
        await harness.request('POST', '/version/upgrade'), 409, 'update-environment-unavailable')
    })
  } finally {
    fetchMock.restore()
  }
})

test('a concurrent upgrade request is refused with update-in-progress', async function () {
  const fetchMock = mockFetch(function () { return jsonResponse({ version: LATEST_VERSION }) })
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'devbench-version-race-'))
  try {
    const profile = await makeProfileFacts(tempRoot, {
      packageManager: await fakePnpmInvocation(tempRoot, { delayMs: 120 }),
    })
    const services: any = { profileContext: profile }
    const ctx: any = { get(name: string) { return services[name] } }
    const ready = await checkPluginVersion(ctx)
    assert.equal(ready.status, 'ready')
    const first = upgradePluginVersion(ctx)
    const second = upgradePluginVersion(ctx)
    await assert.rejects(second, function (error: any) {
      return error !== null && error.status === 409 && error.code === 'update-in-progress'
    })
    const value = await first
    assert.equal(value.upgrade.installedVersion, LATEST_VERSION)
  } finally {
    fetchMock.restore()
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
})

// ---- windows fallback ------------------------------------------------------

test('the ComSpec fallback quotes a .cmd package manager and refuses expandable tokens', function () {
  const invocation = comSpecInvocation('C:\\Program Files\\pnpm.cmd',
    ['add', PACKAGE_NAME + '@1.2.3', '--save-exact'])
  assert.equal(invocation.args.slice(0, 3).join(' '), '/d /s /c')
  assert.equal(invocation.args[3],
    '""C:\\Program Files\\pnpm.cmd" add ' + PACKAGE_NAME + '@1.2.3 --save-exact"')
  assert.throws(function () {
    comSpecInvocation('pnpm.cmd', ['add', PACKAGE_NAME + '@1.2.3', '%PATH%'])
  }, function (error: any) {
    return error !== null && error.status === 409 && error.code === 'update-environment-unavailable'
  })
})
