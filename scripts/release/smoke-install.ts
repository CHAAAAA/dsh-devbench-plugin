/**
 * `npm run release:smoke` — install the packed tarball into a throwaway DSH
 * home, verify the bundle patch is applied, then uninstall and verify cleanup.
 *
 * It never touches the real `~/.dsh` profile and can run while DSH is open.
 *
 * Flags:
 *   --tarball <path>  tarball to install (default: newest in dist/release)
 *   --cli <path>      DSH CLI (default: desktop CLI, then `dsh` on PATH)
 *   --keep            keep the temporary DSH_HOME for inspection
 *   --profile <name>  throwaway profile name (default smoke)
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  abs,
  exists,
  findDshCli,
  formatBytes,
  loadPackage,
  parseArgs,
  run,
} from '../lib/util.js'

const { flags, values } = parseArgs()
const pkg = loadPackage()
const profile = values.get('profile') || 'smoke'
const cli = findDshCli(values.get('cli'))

function newestTarball() {
  if (exists('dist/release') === false) return null
  const candidates = readdirSync(abs('dist/release'))
    .filter((entry) => entry.endsWith('.tgz'))
    .map((entry) => ({
      path: path.join('dist', 'release', entry),
      mtime: statSync(abs(path.join('dist', 'release', entry))).mtimeMs,
    }))
    .sort((left, right) => right.mtime - left.mtime)
  return candidates.length > 0 ? candidates[0].path : null
}

const tarball = values.get('tarball') || newestTarball()
let dryHome = null
let failed = false

function step(label, args, env) {
  console.log('  → ' + label)
  const result = run(cli.path, args, {
    env: Object.assign({}, process.env, env || {}),
    timeout: 300000,
  })
  const output = String(result.stdout || '') + String(result.stderr || '')
  if (result.error) {
    console.error('  ✖ ' + label + ': ' + result.error.message)
    failed = true
    return { ok: false, output }
  }
  if (result.status !== 0) {
    console.error('  ✖ ' + label + ': exit ' + result.status)
    console.error(indent(output))
    failed = true
    return { ok: false, output }
  }
  console.log('  ✓ ' + label)
  return { ok: true, output }
}

function indent(text) {
  return String(text || '')
    .trim()
    .split('\n')
    .slice(-20)
    .map((line) => '    ' + line)
    .join('\n')
}

function readProfileManifest(home) {
  const file = path.join(home, 'profiles', profile, 'package.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function verifyProfile(home: string, expected?: string) {
  const manifest = readProfileManifest(home)
  if (!manifest) {
    console.error('  ✖ profile manifest is missing: ' + path.join(home, 'profiles', profile, 'package.json'))
    failed = true
    return
  }
  const dependency = manifest.dependencies && manifest.dependencies[pkg.name]
  const selected = (manifest.dsh?.profile?.bundles || []).includes(pkg.name)
  if (expected === 'removed') {
    if (dependency) {
      console.error('  ✖ dependency ' + pkg.name + ' is still present after uninstall')
      failed = true
    } else console.log('  ✓ dependency removed')
    if (selected) {
      console.error('  ✖ bundle selection ' + pkg.name + ' is still present after uninstall')
      failed = true
    } else console.log('  ✓ bundle selection removed')
    return
  }
  if (dependency) console.log('  ✓ dependency recorded: ' + pkg.name + ' -> ' + dependency)
  else {
    console.error('  ✖ dependency ' + pkg.name + ' is missing from the profile manifest')
    failed = true
  }
  if (selected) console.log('  ✓ bundle selection recorded: ' + pkg.name)
  else {
    console.error('  ✖ bundle selection ' + pkg.name + ' is missing from dsh.profile.bundles')
    failed = true
  }
}

console.log('release-smoke: ' + pkg.name + '@' + pkg.version)
if (!cli) {
  console.error('  ✖ no working DSH CLI found')
  console.error('    set DSH_CLI=/path/to/dsh or pass --cli <path>')
  process.exit(1)
}
console.log('  CLI: ' + cli.path + ' (' + cli.version + ')')
if (!tarball || exists(tarball) === false) {
  console.error('  ✖ tarball not found; run `npm run release:pack` first or pass --tarball <path>`')
  process.exit(1)
}
console.log('  tarball: ' + tarball + ' (' + formatBytes(statSync(abs(tarball)).size) + ')')

dryHome = mkdtempSync(path.join(os.tmpdir(), 'devbench-smoke-'))
const env = { DSH_HOME: dryHome }
console.log('  DSH_HOME: ' + dryHome)

try {
  const added = step('install tarball into a throwaway profile',
    ['plugin', '--profile', profile, 'add', abs(tarball)], env)
  if (added.ok) {
    verifyProfile(dryHome)
    const dump = step('render profile config', ['--profile', profile, '--dump-config'], env)
    if (dump.ok) {
      const text = dump.output
      if (text.includes('devbench-manager') && text.includes(pkg.name)) {
        console.log('  ✓ bundle patch applied (devbench-manager → ' + pkg.name + ')')
      } else {
        console.error('  ✖ missing devbench-manager / package name in --dump-config output')
        failed = true
      }
    }
    step('list profile plugins', ['plugin', '--profile', profile, 'list'], env)
  }
  if (failed === false) {
    const removed = step('uninstall', ['plugin', '--profile', profile, 'remove', pkg.name], env)
    if (removed.ok) verifyProfile(dryHome, 'removed')
  }
} finally {
  if (failed || flags.has('keep')) {
    console.log('release-smoke: kept ' + dryHome + ' for inspection')
  } else {
    rmSync(dryHome, { recursive: true, force: true })
  }
}

if (failed) {
  console.error('release-smoke: FAILED')
  process.exit(1)
}
console.log('release-smoke: OK — tarball installs, applies its bundle patch, and uninstalls cleanly')
