import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHarness, expectOk } from './helpers.js'
import { addProject, git, makeGitProject } from './project-helpers.js'
import { writeReview } from '../../src/host/domain/reviews.js'

function commitsUrl(workspaceId, query) {
  const params = new URLSearchParams({ workspaceId: workspaceId })
  for (const key of Object.keys(query || {})) params.set(key, String(query[key]))
  return '/project/commits?' + params.toString()
}

test('project commits paginate with offset and limit', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 25, title: 'Paged Project' })

    let value = expectOk(await harness.request('GET',
      commitsUrl(project.workspaceId, { offset: 0, limit: 10 })))
    assert.equal(value.offset, 0)
    assert.equal(value.limit, 10)
    assert.equal(value.hasMore, true)
    assert.equal(value.commits.length, 10)
    assert.deepEqual(value.commits.map(function (commit) { return commit.subject }), [
      'commit 25', 'commit 24', 'commit 23', 'commit 22', 'commit 21',
      'commit 20', 'commit 19', 'commit 18', 'commit 17', 'commit 16',
    ])
    assert.equal(value.commits[0].hash.length, 40)
    assert.equal(value.commits[0].short.length > 0, true)
    assert.equal(value.commits[0].authorName, 'Test User')
    assert.equal(value.commits[0].authorEmail, 'test@example.com')
    assert.equal(value.commits[0].date.length > 0, true)
    assert.equal(Array.isArray(value.commits[0].parents), true)
    assert.equal(value.commits[0].reviewed, false)
    assert.equal(value.commits[0].reviewName, null)

    value = expectOk(await harness.request('GET',
      commitsUrl(project.workspaceId, { offset: 10, limit: 10 })))
    assert.equal(value.offset, 10)
    assert.equal(value.limit, 10)
    assert.equal(value.hasMore, true)
    assert.equal(value.commits.length, 10)
    assert.deepEqual(value.commits.map(function (commit) { return commit.subject }), [
      'commit 15', 'commit 14', 'commit 13', 'commit 12', 'commit 11',
      'commit 10', 'commit 9', 'commit 8', 'commit 7', 'commit 6',
    ])

    value = expectOk(await harness.request('GET',
      commitsUrl(project.workspaceId, { offset: 20 })))
    assert.equal(value.offset, 20)
    assert.equal(value.limit, 10)
    assert.equal(value.hasMore, false)
    assert.equal(value.commits.length, 5)
    assert.deepEqual(value.commits.map(function (commit) { return commit.subject }), [
      'commit 5', 'commit 4', 'commit 3', 'commit 2', 'commit 1',
    ])

    value = expectOk(await harness.request('GET',
      commitsUrl(project.workspaceId, {})))
    assert.equal(value.offset, 0)
    assert.equal(value.limit, 10)
    assert.equal(value.commits.length, 10)
    assert.equal(value.hasMore, true)
  } finally {
    await harness.close()
  }
})

test('project commits default to not reviewed and link review files', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 2, title: 'Reviewed Project' })
    const head = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    let value = expectOk(await harness.request('GET',
      commitsUrl(project.workspaceId, { offset: 0, limit: 10 })))
    assert.equal(value.commits.length, 2)
    assert.deepEqual(value.commits.map(function (commit) { return commit.reviewed }), [false, false])

    const review = await writeReview(project.project.canonicalPath, {
      id: 'TASK-20261026-001',
      kind: 'review',
      workspaceId: project.workspaceId,
      projectTitle: 'Reviewed Project',
      projectPath: project.project.canonicalPath,
      commitHash: head,
      commitSubject: 'commit 2',
    }, 'review summary', '# Review\n\nLooks good.\n')

    value = expectOk(await harness.request('GET',
      commitsUrl(project.workspaceId, { offset: 0, limit: 10 })))
    assert.equal(value.commits[0].hash, head)
    assert.equal(value.commits[0].reviewed, true)
    assert.equal(value.commits[0].reviewName, review.name)
    assert.equal(value.commits[1].reviewed, false)
    assert.equal(value.commits[1].reviewName, null)
  } finally {
    await harness.close()
  }
})

test('project commits return an empty page for an uninitialized repository', async function () {
  const harness = await createHarness([])
  try {
    const projectPath = path.join(harness.tempRoot, 'plain-project')
    await fsp.mkdir(projectPath)
    const added = await addProject(harness, projectPath, 'Plain Project')
    const value = expectOk(await harness.request('GET',
      commitsUrl(added.project.workspaceId, { offset: 0, limit: 10 })))
    assert.deepEqual(value.commits, [])
    assert.equal(value.hasMore, false)
    assert.equal(value.offset, 0)
    assert.equal(value.limit, 10)
    assert.equal(value.git.initialized, false)
  } finally {
    await harness.close()
  }
})

test('project commits reject invalid page parameters', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 3, title: 'Invalid Page' })
    const cases = [
      { limit: 500 },
      { limit: 101 },
      { limit: 'abc' },
      { offset: -1 },
      { offset: 'abc' },
      { offset: 10001 },
    ]
    for (const query of cases) {
      const response = await harness.request('GET', commitsUrl(project.workspaceId, query))
      assert.equal(response.status, 400, JSON.stringify(query))
      assert.equal(response.data.error.code, 'project-commit-page-invalid', JSON.stringify(query))
    }
  } finally {
    await harness.close()
  }
})

test('project commits keep requireProject errors for unknown or missing projects', async function () {
  const harness = await createHarness([])
  try {
    let response = await harness.request('GET', '/project/commits')
    assert.equal(response.status, 404)
    assert.equal(response.data.error.code, 'workspace-not-found')

    response = await harness.request('GET',
      '/project/commits?workspaceId=' + encodeURIComponent('workspace-missing'))
    assert.equal(response.status, 404)
    assert.equal(response.data.error.code, 'workspace-not-found')

    const projectPath = path.join(harness.tempRoot, 'gone-project')
    await fsp.mkdir(projectPath)
    const added = await addProject(harness, projectPath, 'Gone Project')
    await fsp.rm(projectPath, { recursive: true, force: true })
    response = await harness.request('GET', commitsUrl(added.project.workspaceId, {}))
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'project-path-missing')
  } finally {
    await harness.close()
  }
})
