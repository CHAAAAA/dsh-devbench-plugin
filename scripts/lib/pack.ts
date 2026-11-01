/**
 * Assemble a release: build the client, run preflight, pack, validate the
 * tarball, and write a checksum manifest next to it.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  RELEASE_DIR,
  abs,
  capture,
  fileSize,
  formatBytes,
  git,
  loadPackage,
  run,
  sha256,
  sha512Base64,
  tarballName,
} from './util.js'
import { printPreflight, runPreflight, validatePackEntries } from './preflight.js'

/** Remove stale tarballs so a publish step can never pick up an old version. */
function prepareReleaseDir() {
  rmSync(RELEASE_DIR, { recursive: true, force: true })
  mkdirSync(RELEASE_DIR, { recursive: true })
}

function parsePackOutput(stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch (failure) {
    throw new Error('cannot parse npm pack --json output: ' + failure.message)
  }
  const record = Array.isArray(parsed) ? parsed[0] : parsed
  if (!record || typeof record.filename !== 'string' || Array.isArray(record.files) === false) {
    throw new Error('npm pack --json output is missing filename/files')
  }
  return {
    filename: record.filename,
    files: record.files.map((file) => (typeof file === 'string' ? file : file.path)),
  }
}

/**
 * Build, validate, and pack the current package version.
 *
 * @param {object} [options]
 * @param {boolean} [options.skipBuild] reuse the existing dist/client.js
 * @param {boolean} [options.registryCheck] confirm the version is not published yet
 * @returns {object} release manifest
 */
export function createRelease(options) {
  const settings = options || {}
  const pkg = loadPackage()

  if (settings.skipBuild !== true) {
    console.log('release-pack: building client bundle')
    const build = run('npm', ['run', 'build'], { stdio: 'inherit' })
    if (build.status !== 0) throw new Error('npm run build failed')
  }

  const report = runPreflight({
    skipPackCheck: true,
    registryCheck: settings.registryCheck === true,
    registry: settings.registry,
  })
  const errors = printPreflight(report, pkg)
  if (errors > 0) throw new Error('preflight reported ' + errors + ' blocking problem(s)')

  prepareReleaseDir()
  console.log('release-pack: packing tarball')
  const packed = run('npm', ['pack', '--ignore-scripts', '--pack-destination', RELEASE_DIR, '--json'])
  if (packed.error) throw new Error('npm pack failed to start: ' + packed.error.message)
  if (packed.status !== 0) {
    throw new Error('npm pack failed: ' + String(packed.stderr || packed.stdout).trim())
  }
  const { filename, files } = parsePackOutput(packed.stdout)
  const expected = tarballName(pkg)
  if (filename !== expected) {
    throw new Error('unexpected tarball name ' + filename + ' (expected ' + expected + ')')
  }

  const packResults = validatePackEntries(files, pkg)
  const packErrors = packResults.filter((item) => item.level === 'error')
  for (const item of packResults.filter((entry) => entry.level !== 'pass')) {
    const mark = item.level === 'error' ? '✖' : '!'
    console.log('  ' + mark + ' ' + item.scope + ': ' + (item.message || ''))
  }
  if (packErrors.length > 0) {
    throw new Error('tarball validation failed with ' + packErrors.length + ' problem(s)')
  }

  const tarball = path.join('dist', 'release', filename)
  const manifest = {
    tool: 'dsh-devbench-plugin release pipeline',
    name: pkg.name,
    version: pkg.version,
    dshRange: pkg.engines && pkg.engines.dsh,
    nodeRange: pkg.engines && pkg.engines.node,
    tarball,
    sizeBytes: fileSize(tarball),
    fileCount: files.length,
    sha256: sha256(tarball),
    sha512: sha512Base64(tarball),
    gitCommit: git(['rev-parse', 'HEAD']),
    gitBranch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    builtAt: new Date().toISOString(),
    node: process.version,
    npm: capture('npm', ['--version']),
  }
  const manifestPath = path.join(RELEASE_DIR, 'manifest.json')
  writeFileSync(
    manifestPath,
    JSON.stringify(Object.assign({ files }, manifest), null, 2) + '\n',
  )

  console.log('release-pack: OK')
  console.log('  tarball : ' + tarball)
  console.log('  sha256  : ' + manifest.sha256)
  console.log('  size    : ' + formatBytes(manifest.sizeBytes) + ' (' + manifest.fileCount + ' files)')
  console.log('  commit  : ' + manifest.gitCommit.slice(0, 12) + ' on ' + manifest.gitBranch)
  console.log('  install : dsh plugin --profile <profile> add ' + abs(tarball))
  console.log('  manifest: ' + path.join('dist', 'release', 'manifest.json'))
  return manifest
}

