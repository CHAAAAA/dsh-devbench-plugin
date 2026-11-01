/**
 * Build the host half of the plugin into `dist/`.
 *
 * `tsc -p tsconfig.build.json` compiles `src/index.ts`, `src/host/**` and
 * `src/shared/**` to `dist/index.js`, `dist/host/**` and `dist/shared/**`.
 * The compiled output is generated and git-ignored, so the previous host
 * artifacts are removed before compiling: files deleted or renamed in `src/`
 * must not linger in `dist/` and end up in the published package.
 *
 * The exit code of `tsc` is passed through, so type errors fail `npm run build`.
 */
import { existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

for (const target of ['dist/index.js', 'dist/host', 'dist/shared']) {
  rmSync(path.join(root, target), { recursive: true, force: true })
}

const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (existsSync(tsc) === false) {
  console.error('build-host: TypeScript is not installed; run `npm ci` first')
  process.exit(1)
}

const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit',
})
if (result.error) {
  console.error('build-host: failed to start tsc: ' + result.error.message)
  process.exit(1)
}
if (result.status === null) {
  console.error('build-host: tsc terminated by signal ' + String(result.signal))
  process.exit(1)
}
process.exit(result.status)
