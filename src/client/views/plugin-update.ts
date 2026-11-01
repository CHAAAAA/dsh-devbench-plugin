/**
 * Plugin self-update UI (REQ-20261101-001): the page badge pinned to the plugin
 * page corner and the "about" panel on the workbench home page.
 */
import { h, useEffect, errorText, t as translate } from '../runtime.js'
import type { ReactElement } from 'react'
import type { Translate } from '../runtime.js'
import type { PluginUpgradeResult, PluginVersionInfo } from '../../shared/api-types.js'
import { PACKAGE_NAME, PROJECT_URL } from '../../shared/protocol.js'
import {
  prefetchPluginVersion, refreshPluginVersion, upgradePluginVersion, usePluginVersion,
} from '../core/plugin-version.js'
import { confirmDialog } from '../ui/dialogs.js'
import { showToast } from '../ui/toast.js'
import { Banner } from '../ui/common.js'
import { IconRefresh } from '../ui/icons.js'

export type PluginUpdateBadgeMode = '' | 'available' | 'blocked' | 'upgrading' | 'restart'

/** Which badge to show; `''` means the badge stays hidden. */
export function pluginUpdateBadgeMode(info: PluginVersionInfo | null, upgrading: boolean): PluginUpdateBadgeMode {
  if (upgrading === true || (info !== null && info.upgrading === true)) return 'upgrading'
  if (info === null || typeof info !== 'object') return ''
  if (info.restartRequired === true) return 'restart'
  if (info.updateAvailable !== true) return ''
  return info.canUpgrade === true ? 'available' : 'blocked'
}

function blockedReasonText(info: PluginVersionInfo, t: Translate): string {
  if (info.upgradeBlockedReason === 'link-install') return t('update.status.devHint')
  if (info.upgradeBlockedReason === 'checking') return t('update.blocked.checking')
  if (info.upgradeBlockedReason === 'environment-unavailable') return t('update.blocked.environment')
  return t('update.blocked.unavailable')
}

function versionText(value: string): string {
  return typeof value === 'string' && value !== '' ? 'v' + value : '—'
}

/**
 * Confirm, upgrade the profile and toast the result. Resolves with the upgrade
 * result (or null); API errors are toasted and never thrown to the click handler.
 */
function runUpgrade(info: PluginVersionInfo, t: Translate): Promise<PluginUpgradeResult | null> {
  return confirmDialog({
    title: t('update.confirm.title'),
    body: t('update.confirm.body', {
      packageName: PACKAGE_NAME,
      current: info.currentVersion || '?',
      latest: info.latestVersion || '?',
    }),
    detail: t('update.confirm.detail'),
    confirmText: t('update.confirm.ok'),
    cancelText: t('update.confirm.cancel'),
  }).then(function (confirmed) {
    if (confirmed !== true) return null
    return upgradePluginVersion().then(function (result) {
      const version = result.installedVersion !== '' ? result.installedVersion : result.targetVersion
      showToast('info', t('update.success', { version: version }), undefined)
      return result
    }, function (err) {
      showToast('error', errorText(err) || t('update.failed'), undefined)
      return null
    })
  })
}

/** Upgrade button pinned to the top-right corner of the plugin page. */
export function PluginUpdateBadge(props: { t?: Translate }): ReactElement | null {
  const t = props.t || translate
  const state = usePluginVersion()
  const info = state.info
  const mode = pluginUpdateBadgeMode(info, state.upgrading)
  if (mode === '' || info === null) return null
  const checkingTitle = state.loading ? t('update.badge.checking') : undefined
  let content: ReactElement
  if (mode === 'restart') {
    content = h('span', {
      className: 'devbench-plugin-update-hint',
      title: t('update.status.restart', { version: info.installedVersion || info.latestVersion || info.currentVersion }),
    }, t('update.badge.restart'))
  } else if (mode === 'upgrading') {
    content = h('button', {
      className: 'devbench-btn',
      type: 'button',
      disabled: true,
    }, t('update.badge.upgrading'))
  } else {
    const blocked = mode === 'blocked'
    content = h('button', {
      className: 'devbench-btn' + (blocked ? '' : ' primary'),
      type: 'button',
      disabled: blocked,
      title: blocked ? blockedReasonText(info, t) : checkingTitle,
      onClick() { runUpgrade(info, t).catch(function () {}) },
    }, t('update.badge.available', { version: info.latestVersion }))
  }
  return h('div', {
    className: 'devbench-plugin-update devbench-plugin-update-' + mode,
    title: checkingTitle,
  }, content)
}

function statusTextOf(info: PluginVersionInfo | null, loading: boolean, t: Translate): string {
  if (info === null || typeof info !== 'object') {
    return loading === true ? t('update.status.checking') : t('update.status.unknown')
  }
  if (info.restartRequired === true) {
    return t('update.status.restart', { version: info.installedVersion || info.currentVersion })
  }
  if (info.status === 'checking') return t('update.status.checking')
  if (info.status === 'idle' && info.latestVersion === '') {
    return loading === true ? t('update.status.checking') : t('update.status.unknown')
  }
  if (info.status === 'error') return t('update.status.error')
  if (info.updateAvailable === true) {
    // A link install can find a newer release but cannot install it itself.
    return info.installKind === 'link'
      ? t('update.status.dev')
      : t('update.status.available', { version: info.latestVersion })
  }
  // The install type (npm package or dev link) is a separate row.
  return t('update.status.latest')
}

function aboutRow(label: string, value: ReactElement | string, key: string): ReactElement {
  return h('div', { className: 'devbench-plugin-about-row', key: key },
    h('span', { className: 'devbench-plugin-about-label' }, label),
    h('span', { className: 'devbench-plugin-about-value' }, value))
}

function installKindKey(info: PluginVersionInfo | null): string {
  if (info !== null && info.installKind === 'package') return 'update.about.kind.package'
  if (info !== null && info.installKind === 'link') return 'update.about.kind.link'
  return 'update.about.kind.unknown'
}

/** Workbench home panel: current/latest version, install type, project link and actions. */
export function PluginAboutPanel(props: { t?: Translate }): ReactElement {
  const t = props.t || translate
  const state = usePluginVersion()
  const info = state.info
  useEffect(function () {
    prefetchPluginVersion().catch(function () {})
  }, [])
  const error = state.error || (info !== null && info.status === 'error' ? info.error : '')
  const busy = state.loading || state.upgrading || (info !== null && info.status === 'checking')
  const statusText = error !== '' ? t('update.status.error') : statusTextOf(info, state.loading, t)
  const updateAvailable = info !== null && info.updateAvailable === true
  const canUpgrade = updateAvailable && info.canUpgrade === true && state.upgrading !== true
  const blockedHint = updateAvailable && info !== null && info.canUpgrade !== true
    ? blockedReasonText(info, t)
    : ''
  const showInstalled = info !== null && info.installedVersion !== '' &&
    info.installedVersion !== info.currentVersion
  const rows = [
    aboutRow(t('update.about.current'), versionText(info !== null ? info.currentVersion : ''), 'current'),
    aboutRow(t('update.about.latest'), versionText(info !== null ? info.latestVersion : ''), 'latest'),
  ]
  if (showInstalled) rows.push(aboutRow(t('update.about.installed'), versionText(info.installedVersion), 'installed'))
  rows.push(aboutRow(t('update.about.kind'), t(installKindKey(info)), 'kind'))
  rows.push(aboutRow(t('update.about.status'), h('span', {
    className: 'devbench-plugin-about-status' +
      (info !== null && info.restartRequired === true ? ' restart' : (updateAvailable ? ' available' : '')),
  }, statusText), 'status'))
  rows.push(aboutRow(t('update.about.repo'), h('a', {
    className: 'devbench-plugin-about-link',
    href: PROJECT_URL,
    target: '_blank',
    rel: 'noreferrer noopener',
    title: PROJECT_URL,
  }, PROJECT_URL), 'repo'))
  let upgradeAction: ReactElement | null = null
  if (state.upgrading) {
    upgradeAction = h('button', { className: 'devbench-btn', type: 'button', disabled: true },
      t('update.badge.upgrading'))
  } else if (canUpgrade && info !== null) {
    upgradeAction = h('button', {
      className: 'devbench-btn primary',
      type: 'button',
      onClick() { runUpgrade(info, t).catch(function () {}) },
    }, t('update.action.upgrade'))
  }
  return h('div', { className: 'devbench-panel devbench-plugin-about' },
    h('div', { className: 'devbench-panel-head' },
      h('span', { className: 'devbench-plugin-about-title' }, t('update.about.title')),
      h('button', {
        className: 'devbench-btn ghost devbench-plugin-about-check',
        type: 'button',
        disabled: busy,
        title: t('update.action.check'),
        onClick() { refreshPluginVersion(true).catch(function () {}) },
      }, h(IconRefresh, { size: 13 }), busy ? t('update.status.checking') : t('update.action.check'))),
    h('div', { className: 'devbench-panel-body' },
      h('div', { className: 'devbench-hint devbench-plugin-about-hint' }, t('update.about.hint')),
      error !== ''
        ? h('div', { className: 'devbench-plugin-about-error' },
          h(Banner, { kind: 'error' }, error),
          h('button', {
            className: 'devbench-btn',
            type: 'button',
            onClick() { refreshPluginVersion(true).catch(function () {}) },
          }, t('update.action.retry')))
        : null,
      h('div', { className: 'devbench-plugin-about-rows' }, rows),
      upgradeAction !== null
        ? h('div', { className: 'devbench-plugin-about-actions' }, upgradeAction)
        : null,
      blockedHint !== ''
        ? h('div', { className: 'devbench-hint devbench-plugin-about-blocked' }, blockedHint)
        : null))
}
