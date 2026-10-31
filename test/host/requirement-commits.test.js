import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHarness, expectOk, configureRoot, initWorkspace, createRequirement, waitForTaskStatus } from './helpers.js'
import { createProjectAgentServices } from './fake-agents.js'
import { git, makeGitProject } from './project-helpers.js'
import { parseCommitDiffText } from '../../src/host/integrations/git.js'

function projectHarness(options) {
  let harness = null
  const fake = createProjectAgentServices(function () { return harness }, options || {})
  return createHarness([], { services: fake.services }).then(function (value) {
    harness = value
    value.agentFake = fake
    return value
  })
}

async function setupProjectWithRequirement(harness, requirementTitle) {
  const project = await makeGitProject(harness, { commits: 2, title: 'Commit Projects' })
  const rootDir = path.join(harness.tempRoot, 'requirements')
  await configureRoot(harness, rootDir)
  await initWorkspace(harness, project.workspaceId)
  const created = await createRequirement(harness, project.workspaceId,
    requirementTitle || 'Associate commits', '# Associate commits\n')
  return Object.assign({}, project, { requirementId: created.requirement.id })
}

function linkCommit(harness, project, commit) {
  return harness.request('POST', '/requirement/link-commit', {
    workspaceId: project.workspaceId,
    id: project.requirementId,
    commit: commit,
  })
}

function unlinkCommit(harness, project, commit) {
  return harness.request('POST', '/requirement/unlink-commit', {
    workspaceId: project.workspaceId,
    id: project.requirementId,
    commit: commit,
  })
}

test('requirement link-commit resolves short hashes, dedupes, and unlinks', async function () {
  const harness = await projectHarness()
  try {
    const project = await setupProjectWithRequirement(harness)
    const head = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    const short = head.slice(0, 7)

    const linked = expectOk(await linkCommit(harness, project, short))
    assert.deepEqual(linked.requirement.commits, [head])

    // Linking the same commit again must not duplicate it.
    const again = expectOk(await linkCommit(harness, project, head))
    assert.deepEqual(again.requirement.commits, [head])

    const detail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: project.workspaceId,
      id: project.requirementId,
    }))
    assert.deepEqual(detail.requirement.commits, [head])
    assert.equal(Object.prototype.hasOwnProperty.call(detail, 'gitLog'), false)

    // Editing the document body must preserve commit associations.
    expectOk(await harness.request('POST', '/requirement/save', {
      workspaceId: project.workspaceId,
      id: project.requirementId,
      body: '# Updated\n\nBody after commit link.\n',
    }))
    const afterSave = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: project.workspaceId,
      id: project.requirementId,
    }))
    assert.deepEqual(afterSave.requirement.commits, [head])

    const unlinked = expectOk(await unlinkCommit(harness, project, short))
    assert.deepEqual(unlinked.requirement.commits, [])

    // Unknown commits and malformed hashes are rejected.
    let response = await linkCommit(harness, project, 'f'.repeat(40))
    assert.equal(response.status, 404)
    assert.equal(response.data.error.code, 'commit-not-found')
    response = await linkCommit(harness, project, 'not-a-hash')
    assert.equal(response.status, 404)
    assert.equal(response.data.error.code, 'commit-not-found')
    response = await unlinkCommit(harness, project, 'zzzz')
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'bad-commit')
  } finally {
    await harness.close()
  }
})

test('commit detail exposes every changed file, its diff and linked requirements', async function () {
  const harness = await projectHarness()
  try {
    const project = await setupProjectWithRequirement(harness)
    await git(project.projectPath,
      ['commit', '--amend', '-m', 'commit 2', '-m', 'Detailed body\nsecond line'])
    const head = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    expectOk(await linkCommit(harness, project, head))

    const detail = expectOk(await harness.request('GET',
      '/project/commit/detail?workspaceId=' + encodeURIComponent(project.workspaceId) +
      '&commit=' + encodeURIComponent(head)))
    assert.equal(detail.commit.hash, head)
    assert.equal(detail.commit.subject, 'commit 2')
    assert.equal(detail.commit.message, 'commit 2\n\nDetailed body\nsecond line')
    assert.equal(detail.files.length, 1)
    const file = detail.files[0]
    assert.equal(file.path, 'file.txt')
    assert.equal(file.status, 'M')
    assert.equal(file.additions, 1)
    assert.equal(file.deletions, 1)
    assert.equal(file.diff.includes('-version 1'), true)
    assert.equal(file.diff.includes('+version 2'), true)
    assert.equal(detail.requirements.length, 1)
    assert.equal(detail.requirements[0].id, project.requirementId)
    assert.equal(detail.review, null)

    const missing = await harness.request('GET',
      '/project/commit/detail?workspaceId=' + encodeURIComponent(project.workspaceId) +
      '&commit=' + encodeURIComponent('f'.repeat(40)))
    assert.equal(missing.status, 404)
    assert.equal(missing.data.error.code, 'commit-not-found')
  } finally {
    await harness.close()
  }
})

test('reviewing a requirement-linked commit links the review session to the requirement', async function () {
  const harness = await projectHarness()
  try {
    const project = await setupProjectWithRequirement(harness)
    const head = (await git(project.projectPath, ['rev-parse', 'HEAD'])).stdout.trim()
    expectOk(await linkCommit(harness, project, head))

    const started = expectOk(await harness.request('POST', '/project/review/start', {
      workspaceId: project.workspaceId,
      commit: head,
    }))
    const done = await waitForTaskStatus(harness, project.workspaceId, started.task.id, ['succeeded'])
    assert.equal(done.sessionId.length > 0, true)

    const detail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: project.workspaceId,
      id: project.requirementId,
    }))
    assert.equal(detail.requirement.sessions.includes(done.sessionId), true)

    // Linking a commit after its review exists must attach the existing session too.
    expectOk(await unlinkCommit(harness, project, head))
    const relinked = expectOk(await linkCommit(harness, project, head))
    assert.equal(relinked.requirement.sessions.includes(done.sessionId), true)
  } finally {
    await harness.close()
  }
})

test('commit diff parser classifies add/delete/rename and ignores hunk markers', function () {
  const files = parseCommitDiffText([
    'diff --git a/old.txt b/new.txt',
    'similarity index 90%',
    'rename from old.txt',
    'rename to new.txt',
    '--- a/old.txt',
    '+++ b/new.txt',
    '@@ -1 +1 @@',
    '-old line',
    '+new line',
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
    'diff --git a/added.txt b/added.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/added.txt',
    '@@ -0,0 +1 @@',
    '+added',
  ].join('\n'))
  assert.deepEqual(files.map(function (file) { return [file.path, file.status] }).sort(), [
    ['added.txt', 'A'],
    ['gone.txt', 'D'],
    ['new.txt', 'R'],
  ])
  const renamed = files.find(function (file) { return file.path === 'new.txt' })
  assert.equal(renamed.oldPath, 'old.txt')
  assert.equal(renamed.additions, 1)
  assert.equal(renamed.deletions, 1)
})

test('project open target detection and validation are bounded', async function () {
  const harness = await createHarness([])
  try {
    const projectPath = path.join(harness.tempRoot, 'open-project')
    await fsp.mkdir(projectPath, { recursive: true })
    const added = expectOk(await harness.request('POST', '/project/add', {
      path: projectPath,
      title: 'Open Project',
    }))
    const targets = expectOk(await harness.request('GET', '/project/open-targets'))
    assert.equal(Array.isArray(targets.targets), true)
    targets.targets.forEach(function (target) {
      assert.equal(['vscode', 'system', 'iterm'].includes(target), true)
    })
    const bad = await harness.request('POST', '/project/open', {
      workspaceId: added.project.workspaceId,
      target: 'browser',
    })
    assert.equal(bad.status, 400)
    assert.equal(bad.data.error.code, 'bad-open-target')
    const missing = await harness.request('POST', '/project/open', {
      workspaceId: 'workspace-missing',
      target: 'system',
    })
    assert.equal(missing.status, 404)
    assert.equal(missing.data.error.code, 'workspace-not-found')
  } finally {
    await harness.close()
  }
})
