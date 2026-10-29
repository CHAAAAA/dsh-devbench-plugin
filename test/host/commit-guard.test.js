/**
 * TOCTOU guard for project/worktree commits: the confirmed preview snapshot must
 * still describe the staged index at commit time. A write landing between the
 * confirmation snapshot and `git add -A` aborts the commit and restores the
 * previous index instead of committing content the user never saw.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { git } from './project-helpers.js'
import {
  captureProjectSnapshot,
  commitProject,
} from '../../src/host/integrations/git.js'

async function headOf(root) {
  return (await git(root, ['rev-parse', 'HEAD'])).stdout.trim()
}

async function stagedNames(root) {
  return (await git(root, ['diff', '--cached', '--name-only'])).stdout.trim()
}

async function statusText(root) {
  return (await git(root, ['status', '--porcelain'])).stdout
}

async function makeRepo() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'devbench-commit-guard-'))
  await git(root, ['init'])
  await git(root, ['config', 'user.name', 'Guard User'])
  await git(root, ['config', 'user.email', 'guard@example.com'])
  await fsp.writeFile(path.join(root, 'a.txt'), 'one\n')
  await git(root, ['add', '-A'])
  await git(root, ['commit', '-m', 'base commit'])
  return root
}

async function expectedFromSnapshot(root) {
  const snapshot = await captureProjectSnapshot(root, { fileHashes: true })
  return {
    snapshot,
    expected: {
      head: snapshot.head,
      fingerprint: snapshot.fingerprint,
      changedFiles: snapshot.changedFiles,
      untrackedPaths: snapshot.untracked.map(function (item) { return item.path }),
      fileHashes: snapshot.fileHashes,
    },
  }
}

test('snapshot records blob hashes for changed and untracked files', async function () {
  const root = await makeRepo()
  try {
    await fsp.writeFile(path.join(root, 'a.txt'), 'two\n')
    await fsp.writeFile(path.join(root, 'new.txt'), 'brand new\n')
    const { snapshot } = await expectedFromSnapshot(root)
    assert.deepEqual(snapshot.changedFiles.slice().sort(), ['a.txt', 'new.txt'].sort())
    const byPath = new Map(snapshot.fileHashes.map(function (item) {
      return [item.path, item.hash]
    }))
    assert.match(byPath.get('a.txt'), /^[0-9a-f]{40,64}$/)
    assert.match(byPath.get('new.txt'), /^[0-9a-f]{40,64}$/)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

test('commit aborts and restores the index when content changes after the snapshot', async function () {
  const root = await makeRepo()
  try {
    const before = await headOf(root)
    await fsp.writeFile(path.join(root, 'a.txt'), 'previewed\n')
    const { expected } = await expectedFromSnapshot(root)
    await assert.rejects(commitProject(root, 'should not commit', {
      expected,
      beforeStage: async function () {
        await fsp.writeFile(path.join(root, 'a.txt'), 'changed after snapshot\n')
      },
    }), function (error) {
      assert.equal(error.code, 'stale-preview')
      return true
    })
    assert.equal(await headOf(root), before)
    assert.equal(await stagedNames(root), '')
    const status = await statusText(root)
    assert.equal(status.includes('a.txt'), true)
    assert.equal((await fsp.readFile(path.join(root, 'a.txt'), 'utf8')), 'changed after snapshot\n')
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

test('commit aborts when an extra path appears between staging and commit', async function () {
  const root = await makeRepo()
  try {
    const before = await headOf(root)
    await fsp.writeFile(path.join(root, 'a.txt'), 'previewed\n')
    const { expected } = await expectedFromSnapshot(root)
    await assert.rejects(commitProject(root, 'should not commit', {
      expected,
      afterStage: async function () {
        await fsp.writeFile(path.join(root, 'sneaked.txt'), 'sneaked\n')
      },
    }), function (error) {
      assert.equal(error.code, 'stale-preview')
      return true
    })
    assert.equal(await headOf(root), before)
    assert.equal(await stagedNames(root), '')
    assert.equal((await statusText(root)).includes('sneaked.txt'), true)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

test('commit succeeds when the staged index still matches the previewed snapshot', async function () {
  const root = await makeRepo()
  try {
    const before = await headOf(root)
    await fsp.writeFile(path.join(root, 'a.txt'), 'previewed\n')
    await fsp.writeFile(path.join(root, 'new.txt'), 'new file\n')
    const { expected } = await expectedFromSnapshot(root)
    const result = await commitProject(root, 'guard commit', { expected })
    assert.match(result.hash, /^[0-9a-f]{40,64}$/)
    assert.notEqual(await headOf(root), before)
    assert.equal(await stagedNames(root), '')
    assert.equal((await statusText(root)).trim(), '')
    const committed = (await git(root, ['show', '--pretty=format:', '--name-only', 'HEAD'])).stdout
    assert.equal(committed.includes('a.txt'), true)
    assert.equal(committed.includes('new.txt'), true)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

test('commit handles deleted previewed files and legacy callers without a snapshot', async function () {
  const root = await makeRepo()
  try {
    await fsp.writeFile(path.join(root, 'b.txt'), 'to delete\n')
    await git(root, ['add', '-A'])
    await git(root, ['commit', '-m', 'add b'])
    await fsp.rm(path.join(root, 'b.txt'))
    const { expected } = await expectedFromSnapshot(root)
    assert.equal(expected.changedFiles.includes('b.txt'), true)
    const deletedEntry = expected.fileHashes.find(function (item) { return item.path === 'b.txt' })
    assert.equal(deletedEntry.hash, null)
    assert.equal(deletedEntry.deleted, true)
    const result = await commitProject(root, 'delete b', { expected })
    assert.match(result.hash, /^[0-9a-f]{40,64}$/)
    const names = (await git(root, ['show', '--pretty=format:', '--name-status', 'HEAD'])).stdout
    assert.equal(names.includes('D\tb.txt'), true)

    // Legacy callers (no expected snapshot) keep the original staging behaviour.
    await fsp.writeFile(path.join(root, 'a.txt'), 'legacy\n')
    const legacy = await commitProject(root, 'legacy commit')
    assert.match(legacy.hash, /^[0-9a-f]{40,64}$/)
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})
