/** Plugin version routes: snapshot, forced check and one-click upgrade (REQ-20261101-001). */
import {
  checkPluginVersion,
  pluginVersionInfo,
  upgradePluginVersion,
} from '../../services/plugin-version.js'

export const versionRoutes = [
  {
    method: 'GET',
    path: '/version',
    async handle(context) {
      return pluginVersionInfo(context.ctx)
    },
  },
  {
    method: 'POST',
    path: '/version/check',
    async handle(context) {
      // Drain the (empty) body so the connection is reusable.
      await context.readBody()
      return checkPluginVersion(context.ctx)
    },
  },
  {
    method: 'POST',
    path: '/version/upgrade',
    async handle(context) {
      await context.readBody()
      return upgradePluginVersion(context.ctx)
    },
  },
]
