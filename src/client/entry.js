/** DSH ModuleLoader entry bundled by scripts/build-client.mjs. */
import { initRuntime } from './runtime.js'
import { createPlugin } from './plugin.js'
window.__ModuleLoader__.load({
  id: __PLUGIN_ID__,
  factory(require) {
    initRuntime(require)
    return createPlugin()
  },
})
