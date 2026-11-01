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
 *   --allow-existing-tag  accept the current release tag (CI tag builds)
 *   --provenance      include npm provenance (CI only)
 *   --allow-existing-version  resume when the registry already has this identical tarball
 *   --no-auth-check   skip the npm login check (for local verification)
 */
import type { ReleaseManifest } from '../lib/pack.js'
import { setTimeout as delay } from 'node:timers/promises'
import { printPreflight, runPreflight } from '../lib/preflight.js'
import {
  abs,
  defaultDistTag,
  git,
  loadPackage,
  parseArgs,
  readJson,
  run,
  sha256,
  sha512Base64,
  tarballName,
} from '../lib/util.js'

const { flags, values } = parseArgs()
const dryRun = flags.has('yes') === false
const pkg = loadPackage()
const tag = values.get('tag') || defaultDistTag(pkg.version)
const registry = values.get('registry')
const allowExistingVersion = flags.has('allow-existing-version')
const skipAuthCheck = flags.has('no-auth-check')

if (!/^[a-z0-9][a-z0-9.-]*$/i.test(tag)) {
  console.error('release-publish: invalid dist-tag: ' + tag)
  process.exit(1)
}
if (pkg.version.startsWith('0.0.0')) {
  console.error('release-publish: refuse to publish version 0.0.0')
  process.exit(1)
}

/**
 * Read the tarball integrity the registry has for this version.
 * `exists:false` also covers registry/network failures: callers must not treat
 * an unknown answer as proof that the version is missing.
 */
function lookupPublishedIntegrity(): { exists: boolean, integrity: string } {
  const args = ['view', pkg.name + '@' + pkg.version, 'dist.integrity', 'version', '--json', '--prefer-online']
  if (registry) args.push('--registry', registry)
  const result = run('npm', args)
  let info = null
  try {
    info = JSON.parse(String(result.stdout || '').trim())
  } catch {
    info = null
  }
  if (result.status !== 0 || info === null || typeof info !== 'object') {
    return { exists: false, integrity: '' }
  }
  const integrity = info['dist.integrity'] || (info.dist && info.dist.integrity)
  return { exists: true, integrity: typeof integrity === 'string' ? integrity : '' }
}

let manifest: ReleaseManifest
let alreadyPublished = false
try {
  manifest = readJson('dist/release/manifest.json')
  const expectedTarball = 'dist/release/' + tarballName(pkg)
  if (!manifest || manifest.name !== pkg.name || manifest.version !== pkg.version || manifest.tarball !== expectedTarball) {
    throw new Error('release manifest does not match package name/version/tarball; run `npm run release:pack`')
  }
  if (manifest.gitCommit !== git(['rev-parse', 'HEAD'])) {
    throw new Error('release manifest does not match HEAD; run `npm run release:pack`')
  }
  if (manifest.sha256 !== sha256(manifest.tarball) || manifest.sha512 !== sha512Base64(manifest.tarball)) {
    throw new Error('tarball checksum does not match the release manifest; run `npm run release:pack`')
  }
  if (dryRun === false) {
    const existing = lookupPublishedIntegrity()
    if (existing.exists) {
      if (allowExistingVersion === false) {
        throw new Error('version ' + pkg.version + ' is already published; bump the version before publishing')
      }
      if (existing.integrity !== 'sha512-' + manifest.sha512) {
        throw new Error('version ' + pkg.version + ' is already published with different contents; refusing to continue')
      }
      alreadyPublished = true
      console.log('release-publish: registry already has ' + pkg.name + '@' + pkg.version + ' with matching integrity; skipping publish')
    }
  }
  const report = runPreflight({
    publish: !dryRun,
    authCheck: !dryRun && skipAuthCheck === false,
    registryCheck: (flags.has('registry-check') || dryRun === false) && alreadyPublished === false,
    registry,
    skipPackCheck: true,
    allowExistingTag: flags.has('allow-existing-tag'),
  })
  if (printPreflight(report, pkg) > 0) throw new Error('release preflight failed')
} catch (failure) {
  console.error('release-publish: ' + failure.message)
  process.exit(1)
}

const publishArgs = ['publish', abs(manifest.tarball), '--access', 'public', '--tag', tag, '--ignore-scripts']
if (registry) publishArgs.push('--registry', registry)
if (flags.has('provenance')) publishArgs.push('--provenance')

if (dryRun) {
  console.log('release-publish: dry run (add --yes to publish)')
  console.log('  package : ' + pkg.name + '@' + pkg.version)
  console.log('  dist-tag: ' + tag)
  console.log('  command : npm ' + publishArgs.join(' '))
  if (flags.has('no-tag') === false) console.log('  git tag : v' + pkg.version)
  console.log('  catalog : npm run release:catalog')
  process.exit(0)
}

const expectedIntegrity = 'sha512-' + manifest.sha512
let publishFailed = false
if (alreadyPublished === false) {
  console.log('release-publish: publishing ' + pkg.name + '@' + pkg.version + ' (dist-tag: ' + tag + ')')
  const published = run('npm', publishArgs, { stdio: 'inherit' })
  publishFailed = published.status !== 0
  if (publishFailed) {
    console.error('release-publish: npm publish failed with exit code ' + published.status)
    // The registry may still have accepted the upload before the CLI reported a
    // failure; a resumed CI run can only continue when that copy is identical.
    const existing = allowExistingVersion ? lookupPublishedIntegrity() : { exists: false, integrity: '' }
    if (existing.exists === true && existing.integrity === expectedIntegrity) {
      console.warn('release-publish: the registry already has an identical tarball; continuing')
      publishFailed = false
    }
  }
}
if (publishFailed) {
  console.error('  - version already published? bump version and retry')
  console.error('  - not logged in? run `npm login`')
  console.error('  - scope/permission error? check the registry and package ownership')
  process.exit(1)
}

// ---- verify the registry copy matches the inspected tarball ------------------
const viewArgs = ['view', pkg.name + '@' + pkg.version, 'dist.integrity', 'version', '--json', '--prefer-online']
if (registry) viewArgs.push('--registry', registry)
for (let attempt = 1; attempt <= 5; attempt += 1) {
  const view = run('npm', viewArgs)
  let info = null
  if (view.status === 0) {
    try {
      info = JSON.parse(view.stdout)
    } catch {
      info = null
    }
  }
  const integrity = info && (info['dist.integrity'] || info.dist?.integrity)
  if (typeof integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) {
    if (integrity !== expectedIntegrity) {
      console.error('release-publish: registry integrity does not match the local tarball')
      console.error('  local : ' + expectedIntegrity)
      console.error('  remote: ' + integrity)
      console.error('  version is already published; do not publish again. Verify the registry before continuing.')
      process.exit(1)
    }
    console.log('release-publish: registry integrity verified')
    break
  }
  if (attempt === 5) {
    console.error('release-publish: version is already published, but registry integrity could not be verified after 5 attempts')
    console.error('  do not publish again. Verify the registry, then continue the remaining release steps.')
    process.exit(1)
  }
  console.warn('release-publish: registry integrity not ready; retrying in 10s (' + attempt + '/5)')
  await delay(10000)
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
console.log('    1. npm run release:catalog          # regenerate the plugin market index')
console.log('    2. create a GitHub/GitLab release and attach ' + manifest.tarball)
if (flags.has('no-tag') === false) {
  console.log('  do not push ' + tagName + ' after a local publish: the tag workflow would publish the same version again')
}
