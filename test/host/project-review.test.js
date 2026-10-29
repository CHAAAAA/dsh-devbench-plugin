import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHarness, expectOk } from './helpers.js'
import { addProject, git, makeGitProject } from './project-helpers.js'
import { sanitizeReviewSummary, writeReview } from '../../src/host/domain/reviews.js'

test('review files use sanitized unique names and safe content reads', async function () {
  const harness = await createHarness([])
  try {
    const project = await makeGitProject(harness, { commits: 1, title: 'Review Project' })
    const commit = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    const task = {
      id: 'TASK-20261026-001',
      projectTitle: project.project.title,
      projectPath: project.projectPath,
      workspaceId: project.workspaceId,
      commitHash: commit,
      commitSubject: 'review target',
    }
    const first = await writeReview(project.projectPath, task, 'Fix / login: user', '# First\n')
    const second = await writeReview(project.projectPath, task, 'Fix / login: user', '# Second\n')
    assert.match(first.name, /^\d{8}-Fix-login-user\.md$/)
    assert.match(second.name, /^\d{8}-Fix-login-user-2\.md$/)
    assert.equal(sanitizeReviewSummary('\u0000 a/b\\c   d '), 'a-b-c-d')
    assert.equal(sanitizeReviewSummary('x'.repeat(80)).length, 48)
    const reviewText = await fsp.readFile(
      path.join(project.projectPath, '.dsh-reviews', first.name), 'utf8')
    assert.equal(reviewText.includes('summary: ' + JSON.stringify('Fix / login: user')), true)
    assert.equal(reviewText.includes('# First'), true)

    const contentUrl = '/project/review/content?workspaceId=' +
      encodeURIComponent(project.workspaceId) + '&name=' + encodeURIComponent(first.name)
    const content = expectOk(await harness.request('GET', contentUrl))
    assert.equal(content.content.includes('# First'), true)
    assert.equal(content.commit, commit)
    assert.equal(content.commitSubject, 'review target')
    assert.equal(content.modifiedAt.length > 0, true)
    assert.equal(content.size > 0, true)
    assert.equal(content.summary, 'Fix / login: user')
    let response = await harness.request('GET',
      '/project/review/content?workspaceId=' + encodeURIComponent(project.workspaceId) +
      '&name=' + encodeURIComponent('../' + first.name))
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'bad-review-name')

    const outside = path.join(harness.tempRoot, 'outside-review.md')
    await fsp.writeFile(outside, '# outside secret\n')
    await fsp.symlink(outside, path.join(project.projectPath, '.dsh-reviews', 'leak.md'), 'file')
    response = await harness.request('GET',
      '/project/review/content?workspaceId=' + encodeURIComponent(project.workspaceId) +
      '&name=leak.md')
    assert.equal(response.status, 404)
    assert.equal(response.raw.includes('outside secret'), false)

    const exclude = await fsp.readFile(path.join(project.projectPath, '.git', 'info', 'exclude'), 'utf8')
    assert.equal(exclude.split(/\r?\n/).includes('.dsh-reviews/'), true)
  } finally {
    await harness.close()
  }
})

test('review directory cannot be a symlink', async function () {
  const harness = await createHarness([])
  try {
    const projectPath = path.join(harness.tempRoot, 'review-symlink')
    const outside = path.join(harness.tempRoot, 'outside-reviews')
    await fsp.mkdir(projectPath)
    await fsp.mkdir(outside)
    const added = await addProject(harness, projectPath, 'Symlink Project')
    await fsp.symlink(outside, path.join(projectPath, '.dsh-reviews'), 'dir')
    await assert.rejects(
      writeReview(projectPath, {
        id: 'TASK-X',
        projectTitle: 'Symlink Project',
        workspaceId: added.project.workspaceId,
        commitHash: 'a'.repeat(40),
        commitSubject: 'subject',
      }, 'summary', '# content\n'),
      function (error) { return error.code === 'symlink-not-allowed' },
    )
    assert.deepEqual(await fsp.readdir(outside), [])
    const response = await harness.request('GET',
      '/project/overview?workspaceId=' + encodeURIComponent(added.project.workspaceId))
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'symlink-not-allowed')
  } finally {
    await harness.close()
  }
})
