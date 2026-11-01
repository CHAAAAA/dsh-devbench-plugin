import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHarness, expectOk, configureRoot, initWorkspace, createRequirement } from './helpers.js'
import { addProject, git, initProject, makeGitProject } from './project-helpers.js'

test('project add creates once and de-duplicates by canonical path', async function () {
  const harness = await createHarness([])
  try {
    const projectPath = path.join(harness.tempRoot, 'alpha')
    await fsp.mkdir(projectPath)
    let value = await addProject(harness, projectPath, 'Alpha')
    assert.equal(value.created, true)
    assert.equal(value.project.title, 'Alpha')
    assert.equal(value.project.missingPath, false)
    assert.equal(path.isAbsolute(value.project.canonicalPath), true)
    const workspaceId = value.project.workspaceId

    value = await addProject(harness, projectPath, 'Ignored')
    assert.equal(value.created, false)
    assert.equal(value.project.workspaceId, workspaceId)

    const alias = path.join(harness.tempRoot, 'alpha-alias')
    await fsp.symlink(projectPath, alias, 'dir')
    value = await addProject(harness, alias, 'Alias')
    assert.equal(value.created, false)
    assert.equal(value.project.workspaceId, workspaceId)

    const missing = await harness.request('POST', '/project/add', {
      path: path.join(harness.tempRoot, 'missing'),
    })
    assert.equal(missing.status, 400)
  } finally {
    await harness.close()
  }
})

test('project overview returns current branch state and ten recent commits', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 15, title: 'History' })
    const head = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    const value = expectOk(await harness.request('GET',
      '/project/overview?workspaceId=' + encodeURIComponent(project.workspaceId)))
    assert.equal(value.project.workspaceId, project.workspaceId)
    assert.equal(value.project.requirementsCount, 0)
    assert.equal(value.git.initialized, true)
    assert.equal(value.git.available, true)
    assert.equal(value.git.head, head)
    assert.equal(value.git.branch.length > 0, true)
    assert.equal(Array.isArray(value.git.changes), true)
    assert.equal(value.commits.length, 10)
    assert.equal(value.commits[0].subject, 'commit 15')
    assert.equal(value.commits[9].subject, 'commit 6')
    assert.equal(value.commits[0].hash, head)
    assert.equal(value.commits[0].reviewed, false)
    assert.equal(value.commits[0].reviewName, null)
    assert.equal(Array.isArray(value.commits[0].parents), true)
    assert.equal(value.commits[0].authorName, 'Test User')
    assert.equal(value.commits[0].authorEmail, 'test@example.com')
    assert.deepEqual(value.reviews, [])
    assert.deepEqual(value.tasks, [])
  } finally {
    await harness.close()
  }
})

test('overview reports an uninitialized repository without failing', async function () {
  const harness = await createHarness([])
  try {
    const projectPath = path.join(harness.tempRoot, 'plain')
    await fsp.mkdir(projectPath)
    const added = await addProject(harness, projectPath, 'Plain')
    const value = expectOk(await harness.request('GET',
      '/project/overview?workspaceId=' + encodeURIComponent(added.project.workspaceId)))
    assert.equal(value.git.initialized, false)
    assert.equal(value.git.branch, '')
    assert.equal(value.git.head, '')
    assert.deepEqual(value.git.changes, [])
    assert.deepEqual(value.commits, [])
    assert.deepEqual(value.reviews, [])
  } finally {
    await harness.close()
  }
})

test('project git init creates a nested repository only at the project root', async function () {
  const harness = await createHarness([])
  try {
    const parent = path.join(harness.tempRoot, 'parent-repo')
    const projectPath = path.join(parent, 'requirements-project')
    await fsp.mkdir(projectPath, { recursive: true })
    await git(parent, ['init'])
    await git(parent, ['config', 'user.name', 'Parent User'])
    await git(parent, ['config', 'user.email', 'parent@example.com'])
    await fsp.writeFile(path.join(parent, 'parent.txt'), 'parent\n')
    await git(parent, ['add', '-A'])
    await git(parent, ['commit', '-m', 'parent baseline'])
    const parentHead = (await git(parent, ['rev-parse', 'HEAD'])).stdout.trim()
    const added = await addProject(harness, projectPath, 'Nested Project')
    const initialized = await initProject(harness, added.project.workspaceId)
    assert.equal(initialized.initialized, true)
    await fsp.access(path.join(projectPath, '.git'))
    const top = (await git(projectPath, ['rev-parse', '--show-toplevel'])).stdout.trim()
    assert.equal(await fsp.realpath(top), await fsp.realpath(projectPath))
    assert.equal((await git(parent, ['rev-parse', 'HEAD'])).stdout.trim(), parentHead)
  } finally {
    await harness.close()
  }
})

test('overview includes the workspace requirement count', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Counted Project' })
    await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
    await initWorkspace(harness, project.workspaceId)
    await createRequirement(harness, project.workspaceId, 'One', '# One\n')
    await createRequirement(harness, project.workspaceId, 'Two', '# Two\n')
    const value = expectOk(await harness.request('GET',
      '/project/overview?workspaceId=' + encodeURIComponent(project.workspaceId)))
    assert.equal(value.project.requirementsCount, 2)
  } finally {
    await harness.close()
  }
})
