/**
 * `npm run release:publish -- --yes` — publish the packed tarball to npm and
 * tag the release.
 *
 * Safety model:
 *   - dry run by default; the registry is only touched with --yes
 *   - preflight requires a clean git tree and an unused version
 *   - the exact tarball produced by release:pack is published (`--ignore-scripts`),
 *     so the artifact you inspected is the artifact users download
 *   - after publish the registry integrity is compared with the local sha512
 *   - a local annotated git tag is created (not pushed automatically)
 *
 * Flags:
 *   --yes             actually publish (without it: print the plan)
 *   --tag <name>      dist-tag, defaults to latest (next for prereleases)
 *   --registry <url>  publish to a non-default registry
 *   --no-tag          skip creating the local git tag
 *   --registry-check  extra pre-publish collision check
 *   --skip-build      reuse the existing dist/client.js
 */
import { createRelease } from '../lib/pack.js'
import {
  abs,
  defaultDistTag,
  loadPackage,
  parseArgs,
  run,
  sha512Base64,
} from '../lib/util.js'

const { flags, values } = parseArgs()
const dryRun = flags.has('yes') === false
const pkg = loadPackage()
const tag = values.get('tag') || defaultDistTag(pkg.version)
const registry = values.get('registry')

if (!/^[a-z0-9][a-z0-9.-]*$/i.test(tag)) {
  console.error('release-publish: invalid dist-tag: ' + tag)
  process.exit(1)
}
if (pkg.version.startsWith('0.0.0')) {
  console.error('release-publish: refuse to publish version 0.0.0')
  process.exit(1)
}

let manifest
try {
  manifest = createRelease({
    skipBuild: flags.has('skip-build'),
    registryCheck: flags.has('registry-check') || dryRun === false,
    registry,
  })
} catch (failure) {
  console.error('release-publish: ' + failure.message)
  process.exit(1)
}

const publishArgs = ['publish', abs(manifest.tarball), '--access', 'public', '--tag', tag, '--ignore-scripts']
if (registry) publishArgs.push('--registry', registry)

if (dryRun) {
  console.log('release-publish: dry run (add --yes to publish)')
  console.log('  package : ' + pkg.name + '@' + pkg.version)
  console.log('  dist-tag: ' + tag)
  console.log('  command : npm ' + publishArgs.join(' '))
  if (flags.has('no-tag') === false) console.log('  git tag : v' + pkg.version)
  console.log('  catalog : npm run release:catalog')
  process.exit(0)
}

console.log('release-publish: publishing ' + pkg.name + '@' + pkg.version + ' (dist-tag: ' + tag + ')')
const published = run('npm', publishArgs, { stdio: 'inherit' })
if (published.status !== 0) {
  console.error('release-publish: npm publish failed with exit code ' + published.status)
  console.error('  - version already published? bump version and retry')
  console.error('  - not logged in? run `npm login`')
  console.error('  - scope/permission error? check the registry and package ownership')
  process.exit(1)
}

// ---- verify the registry copy matches the inspected tarball ------------------
const expectedIntegrity = 'sha512-' + sha512Base64(manifest.tarball)
const viewArgs = ['view', pkg.name + '@' + pkg.version, 'dist.integrity', 'version', '--json']
if (registry) viewArgs.push('--registry', registry)
const view = run('npm', viewArgs)
if (view.status !== 0) {
  console.warn('release-publish: published, but could not verify the registry copy: ' +
    String(view.stderr || view.stdout).trim())
} else {
  let info = null
  try {
    info = JSON.parse(view.stdout)
  } catch {
    info = null
  }
  const integrity = info && (info['dist.integrity'] || info.dist?.integrity)
  if (integrity && integrity !== expectedIntegrity) {
    console.error('release-publish: registry integrity does not match the local tarball')
    console.error('  local : ' + expectedIntegrity)
    console.error('  remote: ' + integrity)
    process.exit(1)
  }
  console.log('release-publish: registry integrity verified')
}

// ---- local git tag ----------------------------------------------------------
const tagName = 'v' + pkg.version
if (flags.has('no-tag') === false) {
  const result = run('git', ['tag', '-a', tagName, '-m', 'release: ' + pkg.name + '@' + pkg.version])
  if (result.status === 0) console.log('release-publish: created git tag ' + tagName)
  else console.warn('release-publish: could not create tag ' + tagName + ': ' + String(result.stderr).trim())
}

console.log('release-publish: done')
console.log('  next steps:')
console.log('    1. git push origin ' + tagName + '   # and push the release commit')
console.log('    2. npm run release:catalog          # regenerate the plugin market index')
console.log('    3. create a GitHub/GitLab release and attach ' + manifest.tarball)
console.log('    4. smoke-test a fresh install: npm run release:smoke')
