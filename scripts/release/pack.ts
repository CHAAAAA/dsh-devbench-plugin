/**
 * `npm run release:pack` — build, validate, pack, and checksum a release
 * tarball under `dist/release/`.
 *
 * Flags:
 *   --registry-check  confirm the version is not published yet
 *   --skip-build      reuse the existing dist/client.js (not recommended)
 */
import { createRelease } from '../lib/pack.js'
import { parseArgs } from '../lib/util.js'

const { flags } = parseArgs()
try {
  createRelease({
    skipBuild: flags.has('skip-build'),
    registryCheck: flags.has('registry-check'),
  })
} catch (failure) {
  console.error('release-pack: ' + failure.message)
  process.exit(1)
}
