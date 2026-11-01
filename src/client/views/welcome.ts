/** Unconfigured and empty landing view with root and Git actions. */
import { h, useState, useRef, errorText } from '../runtime.js'
import { openRoot, gitInit } from '../core/api.js'
import { IconExternal } from '../ui/icons.js'
export function WelcomeView(props) {
  const t = props.t
  const data = props.data
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  if (!data) return null
  function revealRoot() {
    openRoot().catch(function (err) { props.showToast('error', errorText(err)) })
  }
  function initGit() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    gitInit().then(function () {
      props.showToast('info', t('settings.saved'))
      props.reload().catch(function () { props.showToast('error', t('common.refreshFailed')) })
    }, function (err) {
      props.showToast('error', errorText(err))
    }).finally(function () {
      busyRef.current = false
      setBusy(false)
    })
  }
  const rootSection = h('div', { className: 'devbench-section' },
    h('div', { className: 'devbench-section-title' }, t('panel.configured')),
    h('div', { className: 'devbench-mono', style: { color: 'var(--dsw-alias-label-secondary)' } }, data.rootDir),
    h('div', { className: 'devbench-inline', style: { marginTop: '8px' } },
      h('button', { className: 'devbench-btn', onClick: revealRoot },
        h(IconExternal, { size: 13 }), t('settings.root.open'))))
  const gitSection = h('div', { className: 'devbench-section' },
    h('div', { className: 'devbench-section-title' }, t('settings.git')),
    data.git.initialized
      ? h('div', { className: 'devbench-hint' }, t('settings.git.initialized'))
      : h('div', null,
        h('div', { className: 'devbench-hint' }, t('settings.git.notInitialized')),
        h('button', {
          className: 'devbench-btn', style: { marginTop: '8px' },
          disabled: busy || data.git.available === false,
          onClick: initGit,
        }, t('settings.git.init'))))
  const content = data.configured
    ? h('div', null, rootSection, gitSection)
    : h('div', { className: 'devbench-empty' },
      h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, t('panel.unconfigured.title')),
      h('div', null, t('panel.unconfigured.body')),
      h('button', {
        className: 'devbench-btn primary', style: { marginTop: '12px' }, onClick: props.onPickRoot,
      }, t('panel.unconfigured.action')))
  return h('div', { className: 'devbench-main-body' },
    h('div', { className: 'devbench-section' },
      h('h2', { style: { fontSize: '18px', margin: '0 0 8px' } }, t('panel.welcome.title')),
      h('div', { className: 'devbench-hint' }, t('panel.welcome.body'))),
    content)
}
