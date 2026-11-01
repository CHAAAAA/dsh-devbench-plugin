/**
 * Ambient declarations for globals injected by the DSH client module loader
 * and by the esbuild bundle (`scripts/build-client.ts` `define`).
 */
declare const __PLUGIN_ID__: string

interface Window {
  __ModuleLoader__: {
    load(definition: {
      id: string
      factory(require: (id: string) => unknown): unknown
    }): void
  }
}
