/**
 * `npm run release:preflight` — prove the package is ready to pack/publish.
 *
 * Flags:
 *   --publish         also require a clean git tree and no existing tag
 *   --registry-check  ask npm whether the version is still available
 *   --skip-pack-check skip `npm pack --dry-run` (used by the prepack hook)
 *   --no-auth-check   do not require `npm whoami` in --publish mode
 *   --allow-existing-tag  accept an existing v<version> tag (CI tag builds)
 *
 * Exit code 1 means at least one blocking problem; warnings do not block.
 */
import { loadPackage, parseArgs } from '../lib/util.js'
import { printPreflight, runPreflight } from '../lib/preflight.js'

const { flags, values } = parseArgs()
let pkg = null
try {
  pkg = loadPackage()
} catch {
  // printPreflight reports the unreadable manifest itself.
}

const report = runPreflight({
  publish: flags.has('publish'),
  authCheck: flags.has('publish') && flags.has('no-auth-check') === false,
  registryCheck: flags.has('registry-check'),
  registry: values.get('registry'),
  skipPackCheck: flags.has('skip-pack-check'),
  allowExistingTag: flags.has('allow-existing-tag'),
})
process.exit(printPreflight(report, pkg) > 0 ? 1 : 0)
