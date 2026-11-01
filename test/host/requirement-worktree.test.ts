import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  configureRoot,
  createHarness,
  expectOk,
  initWorkspace,
  makeWorkspace,
} from './helpers.js'
import { git, makeGitProject } from './project-helpers.js'

async function setupGitProject(options: any = {}) {
  const harness = await createHarness([])
  const project = await makeGitProject(harness, {
    commits: options.commits === undefined ? 1 : options.commits,
    title: options.title || 'Worktree Project',
  })
  await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
  await initWorkspace(harness, project.workspaceId)
  return { harness, project }
}

function worktreeRootDir(harness) {
  return path.join(harness.configDir, 'worktrees')
}

async function createIsolatedRequirement(harness, workspaceId, title) {
  const created = expectOk(await harness.request('POST', '/requirement/create', {
    workspaceId,
    title,
    body: '# ' + title + '\n',
    worktree: true,
  }))
  return created.requirement
}

async function worktreeListPaths(projectPath) {
  const result = await git(projectPath, ['worktree', 'list', '--porcelain'])
  return result.stdout.split('\n')
    .filter(function (line) { return line.startsWith('worktree ') })
    .map(function (line) { return line.slice('worktree '.length).trim() })
}

async function canonical(value) {
  try {
    return await fsp.realpath(value)
  } catch {
    return path.resolve(value)
  }
}

test('worktree flag is persisted and exposes a predictable target path', async function () {
  const { harness, project } = await setupGitProject({ title: 'Target Project' })
  try {
    const created = await createIsolatedRequirement(harness, project.workspaceId, 'Isolated Task')
    assert.equal(created.worktree, true)
    assert.match(created.id, /^REQ-\d{8}-\d{3,}$/)

    const detail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: project.workspaceId,
      id: created.id,
    }))
    assert.equal(detail.requirement.worktree, true)
    assert.equal(detail.worktree.enabled, true)
    assert.equal(detail.worktree.exists, false)
    assert.equal(detail.worktree.branch, 'devbench/' + created.id)
    assert.equal(path.isAbsolute(detail.worktree.path), true)
    assert.equal(detail.worktree.path.startsWith(worktreeRootDir(harness) + path.sep), true)
    const branch = (await git(project.projectPath, ['symbolic-ref', '--short', 'HEAD']))
      .stdout.trim()
    assert.equal(detail.worktree.base, branch)

    const text = await fsp.readFile(detail.requirement.path, 'utf8')
    assert.match(text, /^worktree: true$/m)

    const plain = expectOk(await harness.request('POST', '/requirement/create', {
      workspaceId: project.workspaceId,
      title: 'Plain Task',
      body: '# Plain Task\n',
    }))
    assert.equal(plain.requirement.worktree, false)
    const plainDetail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: project.workspaceId,
      id: plain.requirement.id,
    }))
    assert.equal(plainDetail.worktree.enabled, false)
    assert.equal(plainDetail.worktree.exists, false)
    assert.equal(/^worktree:/m.test(await fsp.readFile(plainDetail.requirement.path, 'utf8')), false)

    const invalid = await harness.request('POST', '/requirement/create', {
      workspaceId: project.workspaceId,
      title: 'Bad Flag',
      worktree: 'yes',
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.data.error.code, 'bad-field')

    const customRoot = path.join(harness.tempRoot, 'custom-worktrees')
    expectOk(await harness.request('POST', '/config', { worktreeRoot: customRoot }))
    const customDetail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: project.workspaceId,
      id: created.id,
    }))
    const customReal = await canonical(customRoot)
    assert.equal(customDetail.worktree.path.startsWith(customReal + path.sep), true)
  } finally {
    await harness.close()
  }
})

test('executing a worktree requirement creates and reuses the worktree', async function () {
  const { harness, project } = await setupGitProject({ title: 'Execute Project' })
  try {
    const requirement = await createIsolatedRequirement(harness, project.workspaceId, 'Worktree Execution')
    const first = expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      markRunning: false,
    }))
    assert.equal(first.worktree.enabled, true)
    assert.equal(first.worktree.exists, true)
    assert.equal(first.worktree.branch, 'devbench/' + requirement.id)
    assert.equal(first.cwd, first.worktree.path)
    const stat = await fsp.stat(first.cwd)
    assert.equal(stat.isDirectory(), true)
    const listed = await Promise.all((await worktreeListPaths(project.projectPath)).map(canonical))
    assert.equal(listed.includes(await canonical(first.cwd)), true)
    const branch = await git(project.projectPath,
      ['rev-parse', '--verify', 'refs/heads/devbench/' + requirement.id])
    assert.equal(branch.stdout.trim().length > 0, true)

    const second = expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      markRunning: false,
    }))
    assert.equal(second.cwd, first.cwd)
    assert.equal(second.worktree.exists, true)
    assert.equal((await worktreeListPaths(project.projectPath)).length, 2)

    const plain = expectOk(await harness.request('POST', '/requirement/create', {
      workspaceId: project.workspaceId,
      title: 'Legacy Task',
      body: '# Legacy Task\n',
    }))
    const legacy = expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: project.workspaceId,
      id: plain.requirement.id,
    }))
    assert.equal(legacy.worktree, null)
    assert.equal(Object.prototype.hasOwnProperty.call(legacy, 'cwd'), false)
  } finally {
    await harness.close()
  }
})

test('dirty worktrees are protected and clean removal keeps the branch', async function () {
  const { harness, project } = await setupGitProject({ title: 'Removal Project' })
  try {
    const requirement = await createIsolatedRequirement(harness, project.workspaceId, 'Removable Task')
    const executed = expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    const worktreePath = executed.cwd
    await fsp.writeFile(path.join(worktreePath, 'pending.txt'), 'pending\n')

    const dirty = await harness.request('POST', '/requirement/worktree/remove', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(dirty.status, 409)
    assert.equal(dirty.data.error.code, 'worktree-dirty')

    await fsp.rm(path.join(worktreePath, 'pending.txt'))
    const removed = expectOk(await harness.request('POST', '/requirement/worktree/remove', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(removed.removed, true)
    assert.equal(removed.branch, 'devbench/' + requirement.id)
    assert.equal(removed.worktree.enabled, true)
    assert.equal(removed.worktree.exists, false)
    assert.equal(removed.worktree.path, worktreePath)
    await assert.rejects(fsp.access(worktreePath))
    assert.equal((await worktreeListPaths(project.projectPath)).length, 1)
    const branch = await git(project.projectPath,
      ['rev-parse', '--verify', 'refs/heads/devbench/' + requirement.id])
    assert.equal(branch.stdout.trim().length > 0, true)

    const missing = await harness.request('POST', '/requirement/worktree/remove', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(missing.status, 404)
    assert.equal(missing.data.error.code, 'worktree-not-found')

    const reveal = await harness.request('POST', '/requirement/worktree/reveal', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(reveal.status, 404)
    assert.equal(reveal.data.error.code, 'worktree-not-found')
  } finally {
    await harness.close()
  }
})

test('worktree flag can be toggled only while no worktree exists', async function () {
  const { harness, project } = await setupGitProject({ title: 'Toggle Project' })
  try {
    const requirement = await createIsolatedRequirement(harness, project.workspaceId, 'Toggle Task')

    const missingFlag = await harness.request('POST', '/requirement/worktree', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(missingFlag.status, 400)
    assert.equal(missingFlag.data.error.code, 'bad-field')
    const invalidFlag = await harness.request('POST', '/requirement/worktree', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      enabled: 'true',
    })
    assert.equal(invalidFlag.status, 400)
    assert.equal(invalidFlag.data.error.code, 'bad-field')

    const disabled = expectOk(await harness.request('POST', '/requirement/worktree', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      enabled: false,
    }))
    assert.equal(disabled.requirement.worktree, false)
    assert.equal(disabled.worktree.enabled, false)
    assert.equal(disabled.worktree.exists, false)
    assert.equal(/^worktree:/m.test(await fsp.readFile(disabled.requirement.path, 'utf8')), false)

    const enabled = expectOk(await harness.request('POST', '/requirement/worktree', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      enabled: true,
    }))
    assert.equal(enabled.requirement.worktree, true)
    assert.equal(enabled.worktree.enabled, true)
    assert.equal(enabled.worktree.exists, false)

    expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    const blocked = await harness.request('POST', '/requirement/worktree', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      enabled: false,
    })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.data.error.code, 'worktree-exists-cannot-disable')

    expectOk(await harness.request('POST', '/requirement/worktree/remove', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    const cleared = expectOk(await harness.request('POST', '/requirement/worktree', {
      workspaceId: project.workspaceId,
      id: requirement.id,
      enabled: false,
    }))
    assert.equal(cleared.requirement.worktree, false)
    assert.equal(cleared.worktree.enabled, false)
    assert.equal(cleared.worktree.exists, false)
    assert.equal(/^worktree:/m.test(await fsp.readFile(cleared.requirement.path, 'utf8')), false)
  } finally {
    await harness.close()
  }
})

test('execute rejects non-git and commit-less projects', async function () {
  const harness = await createHarness([])
  try {
    const plain = await makeWorkspace(harness.tempRoot, 'w1', 'Plain Workspace')
    harness.addWorkspace(plain)
    await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
    await initWorkspace(harness, 'w1')
    const created = expectOk(await harness.request('POST', '/requirement/create', {
      workspaceId: 'w1',
      title: 'Plain Task',
      body: '# Plain Task\n',
      worktree: true,
    }))
    const notGit = await harness.request('POST', '/requirement/execute', {
      workspaceId: 'w1',
      id: created.requirement.id,
    })
    assert.equal(notGit.status, 400)
    assert.equal(notGit.data.error.code, 'worktree-not-git')
    const failedDetail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: 'w1',
      id: created.requirement.id,
    }))
    assert.equal(failedDetail.requirement.status, 'new')

    const empty = await makeGitProject(harness, { commits: 0, title: 'Empty Repo' })
    await initWorkspace(harness, empty.workspaceId)
    const pending = expectOk(await harness.request('POST', '/requirement/create', {
      workspaceId: empty.workspaceId,
      title: 'No Commit Task',
      body: '# No Commit Task\n',
      worktree: true,
    }))
    const noCommit = await harness.request('POST', '/requirement/execute', {
      workspaceId: empty.workspaceId,
      id: pending.requirement.id,
    })
    assert.equal(noCommit.status, 400)
    assert.equal(noCommit.data.error.code, 'worktree-no-commit')
  } finally {
    await harness.close()
  }
})

test('worktree description survives a missing project path', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w1', 'Gone Workspace')
    harness.addWorkspace(workspace)
    await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
    await initWorkspace(harness, 'w1')
    const created = expectOk(await harness.request('POST', '/requirement/create', {
      workspaceId: 'w1',
      title: 'Gone Task',
      body: '# Gone Task\n',
      worktree: true,
    }))
    await fsp.rm(workspace.path, { recursive: true, force: true })
    const detail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: 'w1',
      id: created.requirement.id,
    }))
    assert.equal(detail.worktree.enabled, true)
    assert.equal(detail.worktree.exists, false)
    assert.equal(path.isAbsolute(detail.worktree.path), true)
  } finally {
    await harness.close()
  }
})

test('removing a worktree whose directory is gone prunes the registration', async function () {
  const { harness, project } = await setupGitProject({ title: 'Gone Directory Project' })
  try {
    const requirement = await createIsolatedRequirement(harness, project.workspaceId, 'Gone Task')
    const executed = expectOk(await harness.request('POST', '/requirement/execute', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    const worktreePath = executed.cwd
    await fsp.rm(worktreePath, { recursive: true, force: true })

    const removed = expectOk(await harness.request('POST', '/requirement/worktree/remove', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    }))
    assert.equal(removed.removed, true)
    assert.equal(removed.pruned, true)
    assert.equal(removed.branch, 'devbench/' + requirement.id)
    assert.equal(removed.worktree.enabled, true)
    assert.equal(removed.worktree.exists, false)
    assert.equal((await worktreeListPaths(project.projectPath)).length, 1)
    const branch = await git(project.projectPath,
      ['rev-parse', '--verify', 'refs/heads/devbench/' + requirement.id])
    assert.equal(branch.stdout.trim().length > 0, true)

    const again = await harness.request('POST', '/requirement/worktree/remove', {
      workspaceId: project.workspaceId,
      id: requirement.id,
    })
    assert.equal(again.status, 404)
    assert.equal(again.data.error.code, 'worktree-not-found')
  } finally {
    await harness.close()
  }
})
