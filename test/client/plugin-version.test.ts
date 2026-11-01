/**
 * Client tests for the plugin update badge, the home "about" panel and the
 * one-click upgrade flow (REQ-20261101-001).
 */
import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { act } from 'react'
import type { ReactElement } from 'react'
import { getFragment, h, setRuntimeContext } from '../../src/client/runtime.js'
import type { ClientContext } from '../../src/client/runtime.js'
import {
  render, cleanup, nodes, findButton, textOf, mockApi, flushAsyncWork, waitFor,
} from './helpers.js'
import { PACKAGE_NAME, PROJECT_URL } from '../../src/shared/protocol.js'
import type { PluginUpgradeResponse, PluginVersionInfo } from '../../src/shared/api-types.js'
import {
  PluginAboutPanel, PluginUpdateBadge, pluginUpdateBadgeMode,
} from '../../src/client/views/plugin-update.js'
import { DialogHost } from '../../src/client/ui/dialogs.js'
import { ToastHost } from '../../src/client/ui/toast.js'
import {
  prefetchPluginVersion, resetPluginVersionState,
} from '../../src/client/core/plugin-version.js'
import { HomeView } from '../../src/client/views/home.js'
import { RequirementsPage } from '../../src/client/views/requirements-page.js'
import { uiStore, resetUiStore } from '../../src/client/core/ui-store.js'
import { createPlugin } from '../../src/client/plugin.js'
import { zh, en } from '../../src/client/i18n/index.js'

const noop = function () {}
/** Test dictionary: keys stay readable and placeholders stay visible. */
function t(key: string, params?: Record<string, string | number>): string {
  if (params === undefined) return key
  return key + ' ' + Object.keys(params).map(function (name) {
    return name + '=' + String(params[name])
  }).join(' ')
}
function readText(): string {
  return textOf(nodes(), []).join(' ')
}
function versionInfo(overrides: Partial<PluginVersionInfo> = {}): PluginVersionInfo {
  return Object.assign({
    packageName: PACKAGE_NAME,
    repositoryUrl: PROJECT_URL,
    currentVersion: '1.0.5',
    installedVersion: '1.0.5',
    latestVersion: '1.2.0',
    status: 'ready',
    updateAvailable: true,
    restartRequired: false,
    installKind: 'package',
    canUpgrade: true,
    upgradeBlockedReason: '',
    upgrading: false,
    checkedAt: '2026-01-01T00:00:00.000Z',
    error: '',
  }, overrides)
}
function upgradeResponse(): PluginUpgradeResponse {
  return {
    upgrade: {
      beforeVersion: '1.0.5', targetVersion: '1.2.0',
      installedVersion: '1.2.0', restartRequired: true,
    },
    info: versionInfo({
      installedVersion: '1.2.0', updateAvailable: false, canUpgrade: false, restartRequired: true,
    }),
  }
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve: (value: T) => void = noop
  let reject: (reason: unknown) => void = noop
  const promise = new Promise<T>(function (done, fail) { resolve = done; reject = fail })
  return { promise: promise, resolve: resolve, reject: reject }
}
function mockVersionInfo(info: PluginVersionInfo): void {
  mockApi(function (url) {
    if (url.pathname.endsWith('/version/check') || url.pathname.endsWith('/version')) return info
    throw new Error('unexpected request ' + url.pathname)
  })
}
/** Badge harness with the dialog and toast hosts the real workbench mounts. */
function BadgeHarness(): ReactElement {
  return h(getFragment(), null,
    h(PluginUpdateBadge, { t: t }),
    h(DialogHost, { t: t }),
    h(ToastHost, null))
}
async function dismissToasts(): Promise<void> {
  const closers = nodes().filter(function (node) {
    return node.type === 'button' && node.props.className === 'devbench-toast-close'
  })
  for (const closer of closers) await closer.props.onClick()
}
const stateData = {
  rootDir: '/tmp/root', configured: true,
  git: { initialized: true, available: true },
  config: {},
  workspaces: [],
}
const dashboardData = {
  totals: { projects: 0, requirements: 0, activeTasks: 0, runningRequirements: 0, tasksThisWeek: 0 },
  week: {},
  recentTasks: [], activeTasks: [], runningRequirements: [],
}

beforeEach(function () {
  resetPluginVersionState()
  resetUiStore()
  setRuntimeContext(null)
})
afterEach(function () {
  cleanup()
  resetPluginVersionState()
  resetUiStore()
  setRuntimeContext(null)
})

test('update badge stays hidden until an update is known', async function () {
  mockVersionInfo(versionInfo())
  const before = await render({ type: BadgeHarness })
  assert.equal(before.some(function (node) {
    return String(node.props.className || '').indexOf('devbench-plugin-update') >= 0
  }), false, 'no badge before the version snapshot arrives')
  await act(async function () { await prefetchPluginVersion() })
  const button = findButton(nodes(), 'update.badge.available')
  assert.ok(button, 'an available update renders the upgrade button')
  assert.equal(textOf(button, []).join(' ').indexOf('1.2.0') >= 0, true)
  assert.equal(button.props.disabled, false)
})

test('badge mode follows availability, link install and restart state', function () {
  assert.equal(pluginUpdateBadgeMode(null, false), '')
  assert.equal(pluginUpdateBadgeMode(null, true), 'upgrading')
  assert.equal(pluginUpdateBadgeMode(versionInfo(), false), 'available')
  assert.equal(pluginUpdateBadgeMode(versionInfo({ canUpgrade: false, upgradeBlockedReason: 'link-install' }), false), 'blocked')
  assert.equal(pluginUpdateBadgeMode(versionInfo({ restartRequired: true }), false), 'restart')
  assert.equal(pluginUpdateBadgeMode(versionInfo({ updateAvailable: false, canUpgrade: false }), false), '')
  assert.equal(pluginUpdateBadgeMode(versionInfo({ upgrading: true }), false), 'upgrading')
})

test('upgrade asks for confirmation and posts /version/upgrade', async function () {
  const requests: Array<{ method: string; path: string; header: string; body: string }> = []
  const response = upgradeResponse()
  mockApi(function (url, init) {
    const path = url.pathname.replace('/dsh-devbench/api', '')
    if (path === '/version') return versionInfo()
    assert.equal(path, '/version/upgrade')
    const headers = (init.headers || {}) as Record<string, string>
    requests.push({
      method: String(init.method || 'GET'), path: path,
      header: headers['x-dsh-devbench'], body: String(init.body || ''),
    })
    return response
  })
  await prefetchPluginVersion()
  await render({ type: BadgeHarness })
  const upgradeButton = findButton(nodes(), 'update.badge.available')
  assert.ok(upgradeButton, 'upgrade button is rendered')
  await upgradeButton.props.onClick()
  const confirmButton = findButton(nodes(), 'update.confirm.ok')
  assert.ok(confirmButton, 'clicking upgrade opens the confirmation dialog')
  const dialogText = readText()
  assert.equal(dialogText.indexOf('update.confirm.title') >= 0, true)
  assert.equal(dialogText.indexOf(PACKAGE_NAME) >= 0, true, 'dialog names the package')
  assert.equal(dialogText.indexOf('1.0.5') >= 0, true, 'dialog shows the current version')
  assert.equal(dialogText.indexOf('1.2.0') >= 0, true, 'dialog shows the target version')
  assert.equal(requests.length, 0, 'nothing is installed before confirmation')
  await confirmButton.props.onClick()
  await waitFor(function () { return requests.length === 1 }, 'confirmation triggers the upgrade request')
  assert.deepEqual(requests[0].method, 'POST')
  assert.deepEqual(requests[0].path, '/version/upgrade')
  assert.deepEqual(requests[0].header, '1')
  assert.deepEqual(requests[0].body, '{}')
  await waitFor(function () {
    return readText().indexOf('update.success version=1.2.0') >= 0
  }, 'success toast reports the installed version')
  assert.equal(readText().indexOf('update.badge.restart') >= 0, true, 'badge asks for a restart instead of reloading')
  await dismissToasts()
})

test('upgrading disables the badge and the panel action, then reports the restart', async function () {
  const gate = deferred<PluginUpgradeResponse>()
  mockApi(function (url) {
    if (url.pathname.endsWith('/version/upgrade')) return gate.promise
    return versionInfo()
  })
  await prefetchPluginVersion()
  await render({ type: BadgeHarness })
  await findButton(nodes(), 'update.badge.available').props.onClick()
  await findButton(nodes(), 'update.confirm.ok').props.onClick()
  await flushAsyncWork()
  const upgrading = findButton(nodes(), 'update.badge.upgrading')
  assert.ok(upgrading, 'the badge switches to the upgrading label')
  assert.equal(upgrading.props.disabled, true, 'the upgrading badge cannot be clicked again')
  await act(async function () { gate.resolve(upgradeResponse()) })
  await waitFor(function () {
    return readText().indexOf('update.badge.restart') >= 0
  }, 'restart hint replaces the upgrading badge')
  assert.equal(findButton(nodes(), 'update.badge.available'), undefined)
  await dismissToasts()
})

test('link install keeps the upgrade disabled with the development-mode hint', async function () {
  mockVersionInfo(versionInfo({
    installKind: 'link', canUpgrade: false, upgradeBlockedReason: 'link-install',
  }))
  await prefetchPluginVersion()
  await render({ type: BadgeHarness })
  const blocked = findButton(nodes(), 'update.badge.available')
  assert.ok(blocked, 'the disabled upgrade button is still shown')
  assert.equal(blocked.props.disabled, true)
  assert.equal(blocked.props.title, 'update.status.devHint')
  assert.equal(readText().indexOf(PROJECT_URL), -1, 'badge itself never shows the project link')
})

test('about panel lists current and latest versions and links the project page', async function () {
  mockVersionInfo(versionInfo())
  await prefetchPluginVersion()
  await render({ type: PluginAboutPanel, props: { t: t } })
  const text = readText()
  assert.equal(text.indexOf('update.about.title') >= 0, true)
  assert.equal(text.indexOf('update.about.current') >= 0, true)
  assert.equal(text.indexOf('1.0.5') >= 0, true)
  assert.equal(text.indexOf('update.about.latest') >= 0, true)
  assert.equal(text.indexOf('1.2.0') >= 0, true)
  assert.equal(text.indexOf('update.about.kind.package') >= 0, true)
  assert.equal(text.indexOf('update.status.available version=1.2.0') >= 0, true)
  const link = nodes().find(function (node) { return node.type === 'a' && node.props.href === PROJECT_URL })
  assert.ok(link, 'the project page is linked')
  assert.equal(link.props.target, '_blank')
  assert.equal(link.props.rel, 'noreferrer noopener')
  assert.ok(findButton(nodes(), 'update.action.check'), 'a manual check action is offered')
  assert.ok(findButton(nodes(), 'update.action.upgrade'), 'an upgrade action is offered')
})

test('about panel shows installation mode and the restart-required status', async function () {
  mockVersionInfo(versionInfo({
    installKind: 'link', canUpgrade: false, upgradeBlockedReason: 'link-install',
  }))
  await prefetchPluginVersion()
  await render({ type: PluginAboutPanel, props: { t: t } })
  assert.equal(readText().indexOf('update.about.kind.link') >= 0, true)
  assert.equal(readText().indexOf('update.status.dev') >= 0, true)
  assert.equal(findButton(nodes(), 'update.action.upgrade'), undefined, 'link install renders no upgrade action')

  cleanup()
  resetPluginVersionState()
  const restart = versionInfo({
    installedVersion: '1.2.0', latestVersion: '1.2.0', restartRequired: true,
    updateAvailable: false, canUpgrade: false,
  })
  mockVersionInfo(restart)
  await prefetchPluginVersion()
  await render({ type: PluginAboutPanel, props: { t: t } })
  const text = readText()
  assert.equal(text.indexOf('update.about.installed') >= 0, true)
  assert.equal(text.indexOf('update.status.restart version=1.2.0') >= 0, true)
})

test('failed check shows the host error and retry loads the result again', async function () {
  let checked = false
  mockApi(function (url) {
    if (url.pathname.endsWith('/version/check')) {
      checked = true
      return versionInfo()
    }
    assert.equal(url.pathname.endsWith('/version'), true)
    return new Response(JSON.stringify({
      ok: false, error: { code: 'update-check-failed', message: '检查更新失败' },
    }), { status: 502, headers: { 'content-type': 'application/json' } })
  })
  await render({ type: PluginAboutPanel, props: { t: t } })
  await waitFor(function () { return readText().indexOf('检查更新失败') >= 0 }, 'host error message is displayed')
  assert.equal(readText().indexOf('update.status.error') >= 0, true)
  const retry = findButton(nodes(), 'update.action.retry')
  assert.ok(retry, 'the failed panel offers a retry')
  await retry.props.onClick()
  await waitFor(function () { return checked === true }, 'retry forces a registry check')
  await waitFor(function () { return readText().indexOf('1.2.0') >= 0 }, 'the retried check updates the panel')
  assert.equal(readText().indexOf('检查更新失败'), -1, 'the old error is cleared')
})

test('a host check still running keeps the panel in the checking state', async function () {
  mockVersionInfo(versionInfo({
    status: 'checking', latestVersion: '', updateAvailable: false, canUpgrade: false,
  }))
  await render({ type: PluginAboutPanel, props: { t: t } })
  await waitFor(function () {
    return readText().indexOf('update.status.checking') >= 0
  }, 'the panel shows the deferred check state')
  assert.equal(findButton(nodes(), 'update.action.upgrade'), undefined, 'no upgrade action before the check settles')
})

test('home page renders the about panel with the version snapshot', async function () {
  const info = versionInfo()
  mockApi(function (url) {
    const path = url.pathname.replace('/dsh-devbench/api', '')
    if (path === '/version') return info
    if (path === '/dashboard') return dashboardData
    if (path === '/mcp') return { available: true, servers: [] }
    return {}
  })
  await prefetchPluginVersion()
  await render({
    type: HomeView,
    props: {
      t: t, stateData: stateData, showToast: noop,
      onOpenProject: noop, onOpenSession: noop, onOpenSettings: noop,
    },
  })
  await waitFor(function () {
    return nodes().some(function (node) {
      return String(node.props.className || '').indexOf('devbench-plugin-about') >= 0
    })
  }, 'home renders the about panel')
  const panel = nodes().find(function (node) {
    return String(node.props.className || '').indexOf('devbench-plugin-about') >= 0 &&
      String(node.props.className || '').indexOf('devbench-panel') >= 0
  })
  const panelText = textOf(panel, []).join(' ')
  assert.equal(panelText.indexOf('update.about.title') >= 0, true)
  assert.equal(panelText.indexOf('1.0.5') >= 0, true)
  assert.equal(panelText.indexOf('1.2.0') >= 0, true)
  assert.equal(panelText.indexOf(PROJECT_URL) >= 0, true)
})

test('workbench pins the badge on the home and settings sub pages', async function () {
  const info = versionInfo()
  mockApi(function (url) {
    const path = url.pathname.replace('/dsh-devbench/api', '')
    if (path === '/version') return info
    if (path === '/state') return stateData
    if (path === '/project/open-targets') return { targets: [] }
    if (path === '/dashboard') return dashboardData
    if (path === '/mcp') return { available: true, servers: [] }
    return {}
  })
  await prefetchPluginVersion()
  act(function () { uiStore.set({ view: 'settings' }) })
  await render({ type: RequirementsPage, props: { t: t, useSessions: undefined } })
  await waitFor(function () {
    return nodes().some(function (node) {
      return String(node.props.className || '') === 'devbench-main-wrap has-plugin-update'
    })
  }, 'settings page reserves the badge slot')
  assert.equal(nodes().some(function (node) {
    return String(node.props.className || '').indexOf('devbench-plugin-update-available') >= 0
  }), true)
  cleanup()
  act(function () { uiStore.set({ view: 'home' }) })
  await render({ type: RequirementsPage, props: { t: t, useSessions: undefined } })
  await waitFor(function () {
    return nodes().some(function (node) {
      return String(node.props.className || '') === 'devbench-main-wrap has-plugin-update'
    })
  }, 'home page keeps the pinned badge')
})

test('plugin apply triggers the startup version check without unhandled rejections', async function () {
  let versionCalls = 0
  mockApi(function (url) {
    if (url.pathname.endsWith('/version')) {
      versionCalls += 1
      return versionInfo()
    }
    return {}
  })
  const registered: Array<{ config: Record<string, unknown> }> = []
  const ctx: ClientContext = {
    effect(callback) { callback() },
    locale: { bind: () => t, register: () => noop },
    slots: {
      inject(name: string, callback: () => void) { callback() },
      register(config: Record<string, unknown>) { registered.push({ config: config }); return noop },
    },
    layout: { selectPanel: noop },
    uiWorkspace: { async pickDirectory() { return null }, openSession: noop },
    sessions: { async create() { return 'session-1' } },
    remote: { session: {
      async prompt() { return { ok: true, value: undefined } },
      async rename() { return { ok: true, value: undefined } },
    } },
  }
  createPlugin().apply(ctx)
  await waitFor(function () { return versionCalls === 1 }, 'apply starts exactly one version check')
  assert.equal(registered.length, 3, 'slot registration is unchanged')
  await flushAsyncWork()
  assert.equal(versionCalls, 1)
})

test('i18n keeps the update keys aligned between Chinese and English', function () {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.equal(zh['update.about.title'], '关于插件')
  assert.equal(en['update.about.title'], 'About plugin')
  assert.equal(zh['update.badge.restart'], '重启 DSH 生效')
  assert.equal(en['update.badge.restart'], 'Restart DSH to apply')
  assert.equal(zh['update.badge.available'].indexOf('{version}') >= 0, true)
  assert.equal(en['update.badge.available'].indexOf('{version}') >= 0, true)
  assert.equal(zh['update.status.restart'].indexOf('{version}') >= 0, true)
  assert.equal(en['update.status.available'].indexOf('{version}') >= 0, true)
  assert.equal(zh['update.confirm.body'].indexOf('{packageName}') >= 0, true)
  assert.equal(zh['update.confirm.body'].indexOf('{current}') >= 0, true)
  assert.equal(en['update.confirm.body'].indexOf('{latest}') >= 0, true)
  assert.equal(zh['update.status.devHint'].indexOf('link') >= 0, true)
  assert.equal(en['update.status.devHint'].length > 0, true)
})
