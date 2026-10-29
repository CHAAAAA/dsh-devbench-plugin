import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  configureRoot,
  createHarness,
  initWorkspace,
  makeWorkspace,
} from './helpers.js'

const execFileAsync = promisify(execFile)

test('legacy config directory is moved completely before first use', async function () {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'devbench-home-'))
  const projectRoot = path.join(home, 'requirements-root')
  const legacyDir = path.join(home, '.dsh-requirements')
  const nextDir = path.join(home, '.dsh-devbench')
  try {
    await fsp.mkdir(path.join(legacyDir, 'worktrees', 'sample'), { recursive: true })
    await fsp.writeFile(path.join(legacyDir, 'config.json'), JSON.stringify({
      version: 1,
      rootDir: projectRoot,
    }))
    await fsp.writeFile(path.join(legacyDir, 'worktrees', 'sample', 'marker.txt'), 'moved\n')

    const moduleUrl = pathToFileURL(path.resolve('src/host/storage/config.js')).href
    const script = [
      'import { configDirectory, readConfig } from ' + JSON.stringify(moduleUrl),
      'const config = await readConfig()',
      'console.log(JSON.stringify({ directory: configDirectory(), rootDir: config.rootDir }))',
    ].join('\n')
    const env = Object.assign({}, process.env, {
      HOME: home,
      DSH_DEVBENCH_CONFIG_DIR: '',
      DSH_REQUIREMENTS_CONFIG_DIR: '',
    })
    const result = await execFileAsync(process.execPath,
      ['--input-type=module', '-e', script], { cwd: process.cwd(), env: env })
    const lines = String(result.stdout).trim().split(/\r?\n/)
    const payload = JSON.parse(lines[lines.length - 1])
    assert.equal(payload.directory, nextDir)
    assert.equal(payload.rootDir, projectRoot)
    assert.equal(await fsp.readFile(path.join(nextDir, 'config.json'), 'utf8'),
      JSON.stringify({ version: 1, rootDir: projectRoot }))
    assert.equal(await fsp.readFile(path.join(nextDir, 'worktrees', 'sample', 'marker.txt'), 'utf8'),
      'moved\n')
    try {
      const legacyStat = await fsp.lstat(legacyDir)
      assert.equal(legacyStat.isSymbolicLink(), true)
      assert.equal(await fsp.realpath(legacyDir), await fsp.realpath(nextDir))
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error
    }
  } finally {
    await fsp.rm(home, { recursive: true, force: true })
  }
})

test('legacy config-directory environment variable remains a compatibility alias', async function () {
  const legacyOverride = path.join(os.tmpdir(), 'devbench-legacy-env')
  const moduleUrl = pathToFileURL(path.resolve('src/host/storage/config.js')).href
  const script = [
    'import { configDirectory } from ' + JSON.stringify(moduleUrl),
    'console.log(configDirectory())',
  ].join('\n')
  const env = Object.assign({}, process.env, {
    DSH_DEVBENCH_CONFIG_DIR: '',
    DSH_REQUIREMENTS_CONFIG_DIR: legacyOverride,
  })
  const result = await execFileAsync(process.execPath,
    ['--input-type=module', '-e', script], { cwd: process.cwd(), env: env })
  assert.equal(String(result.stdout).trim(), legacyOverride)
})

test('legacy project metadata directory is migrated and gitignore is updated', async function () {
  const harness = await createHarness([])
  try {
    const rootDir = path.join(harness.tempRoot, 'requirements-root')
    const legacyMeta = path.join(rootDir, '.dsh-requirements')
    const nextMeta = path.join(rootDir, '.dsh-devbench')
    await fsp.mkdir(legacyMeta, { recursive: true })
    await fsp.writeFile(path.join(legacyMeta, 'workspaces.json'),
      JSON.stringify({ version: 1, workspaces: {} }))
    await fsp.writeFile(path.join(legacyMeta, 'legacy-marker.txt'), 'moved\n')
    await fsp.writeFile(path.join(rootDir, '.gitignore'), '.dsh-requirements/\nkeep.txt\n')

    const workspace = await makeWorkspace(harness.tempRoot, 'legacy-meta', 'Legacy Meta')
    harness.addWorkspace(workspace)
    await configureRoot(harness, rootDir)
    await initWorkspace(harness, workspace.id)

    await assert.rejects(fsp.access(legacyMeta), { code: 'ENOENT' })
    assert.equal(await fsp.readFile(path.join(nextMeta, 'legacy-marker.txt'), 'utf8'), 'moved\n')
    const mapping = JSON.parse(await fsp.readFile(path.join(nextMeta, 'workspaces.json'), 'utf8'))
    assert.equal(typeof mapping.workspaces[workspace.id], 'object')
    const gitignore = await fsp.readFile(path.join(rootDir, '.gitignore'), 'utf8')
    assert.equal(gitignore.includes('.dsh-devbench/'), true)
    assert.equal(gitignore.includes('.dsh-requirements/'), false)
    assert.equal(gitignore.includes('keep.txt'), true)
  } finally {
    await harness.close()
  }
})
