/** DSH client registration only. UI behavior lives in components. */
import { NS, PANEL_ID, setRuntimeContext, t } from './runtime.js'
import type { ClientContext } from './runtime.js'
import { zh, en } from './i18n/index.js'
import { DevbenchIcon } from './ui/icons.js'
import { RequirementsPage } from './views/requirements-page.js'
import { SessionRequirementAction } from './views/project/session-action.js'
import { registerSidebarRight } from './views/project/sidebar-panel.js'
import { prefetchPluginVersion } from './core/plugin-version.js'
import { refreshPreferences } from './core/preferences.js'
const inject = [
  'slots', 'locale', 'layout', 'uiWorkspace', 'sessions', 'remote', 'remote.session',
]
export function createPlugin(): { inject: string[]; apply(ctx: ClientContext): void } {
  return {
    inject: inject,
    apply(ctx: ClientContext): void {
      setRuntimeContext(ctx)
      // Startup update check: fire-and-forget so a slow registry never blocks the panel.
      prefetchPluginVersion().catch(function () {})
      // Auto-open preference for the session right sidebar: one light read at boot, then
      // refreshed on focus so a settings change applies without a page reload.
      refreshPreferences().catch(function () {})
      ctx.effect(function () {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
          return function () {}
        }
        function onFocus(): void { refreshPreferences().catch(function () {}) }
        window.addEventListener('focus', onFocus)
        return function () { window.removeEventListener('focus', onFocus) }
      }, 'devbench: preferences')
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      }, 'devbench: dictionaries')
      ctx.slots.inject('main', function () {
        return ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
        }, RequirementsPage)
      })
      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 20,
          locale: NS,
          label() { return t('panel.title') },
        }, DevbenchIcon)
      })
      // One merged session header entry (REQ-20261103-002): the main button opens the
      // session's requirement, the caret menu organizes it or opens the DevBench sidebar.
      ctx.slots.inject('conversation.session.header.actions', function () {
        return ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'devbench-link',
          order: 20,
          locale: NS,
          inject(sessionId) { return { linkedSessionId: sessionId } },
        }, SessionRequirementAction)
      })
      // Session right sidebar (DSH >= 0.2.1-rc.5): tab type and body. Older hosts never
      // provide these services and keep the global panel entry above.
      ctx.effect(function () {
        return registerSidebarRight(ctx)
      }, 'devbench: sidebar right')
    },
  }
}
