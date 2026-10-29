import { withKeyLock } from '../shared/atomic.js'
import { DEFAULT_COMMIT_PAGE_SIZE, MAX_COMMIT_PAGE_SIZE } from '../constants.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import {
  getRegisteredWorkspace,
  requireProject,
  workspaceProjectDto,
} from './projects.js'
import {
  buildCommitPrompt,
  buildReviewPrompt,
  buildUncommittedReviewPrompt,
  cancelBackgroundTask,
  startBackgroundTask,
} from './background-agent.js'
import {
  captureProjectSnapshot,
  commitProject,
  gitInit,
  MAX_COMMIT_OFFSET,
  projectGitOverview,
  recentProjectCommits,
  resolveProjectCommit,
  showProjectCommitDetail,
} from '../integrations/git.js'
import {
  ensureReviewExclude,
  ensureReviewsDirectory,
  listReviews,
} from '../domain/reviews.js'
import { findRequirementsForCommit } from '../domain/requirements.js'
import { readConfig } from '../storage/config.js'
import {
  createTask,
  findTaskRecord,
  listTaskDtos,
  readTasks,
  readTasksForApi,
  toTaskDto,
  updateTask,
  updateTaskIf,
  withProjectTaskLock,
} from '../storage/tasks.js'
import {
  deriveRequirementTaskRecords,
  listWorkspaceRequirementSummaries,
} from './requirement-tasks.js'

async function projectRequirementSummaries(workspaceId) {
  const config = await readConfig()
  return listWorkspaceRequirementSummaries(config, workspaceId)
}

function mergeRequirementTasks(ctx, workspace, requirements, tasks) {
  if (requirements.length === 0) return tasks
  return tasks.concat(deriveRequirementTaskRecords(ctx, {
    workspaceId: workspace.id,
    title: workspace.title,
    path: workspace.path,
  }, requirements, tasks))
}

export function previewDiffText(snapshot) {
  const sections = []
  if (snapshot.stagedDiff.length > 0) {
    sections.push('STAGED DIFF:\n' + snapshot.stagedDiff)
  }
  if (snapshot.diff.length > 0) {
    sections.push('UNSTAGED DIFF:\n' + snapshot.diff)
  }
  if (snapshot.untracked.length > 0) {
    sections.push('UNTRACKED FILES:\n' + snapshot.untracked.map(function (item) {
      return item.path
    }).join('\n'))
  }
  const text = sections.length > 0 ? sections.join('\n\n') : '(no diff content)'
  const limit = 100000
  if (text.length <= limit) return text
  return text.slice(0, limit) + '\n[truncated]\n'
}

/** Marks each commit as reviewed when a matching review file exists. */
function withReviewStatus(commits, reviews) {
  return commits.map(function (commit) {
    const review = reviews.find(function (item) {
      const value = String(item.commit || '')
      return value === commit.hash ||
        (value.length > 0 && commit.hash.startsWith(value)) ||
        (value.length > 0 && value.startsWith(commit.hash))
    })
    const name = review === undefined ? null : review.name
    return { ...commit, reviewed: name !== null, reviewName: name }
  })
}

function commitPageOption(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback
  const text = typeof value === 'number' ? String(value) : String(value).trim()
  if (/^\d+$/.test(text) === false) {
    throw apiError(400, 'project-commit-page-invalid', messages.projectCommitPageInvalid)
  }
  const number = Number(text)
  if (number < min || number > max) {
    throw apiError(400, 'project-commit-page-invalid', messages.projectCommitPageInvalid)
  }
  return number
}

export async function projectOverview(ctx, workspaceId) {
  const workspace = getRegisteredWorkspace(ctx, workspaceId)
  const project = await workspaceProjectDto(workspace)
  const git = await projectGitOverview(workspace.path || '')
  let reviews = []
  let commits = []
  if (project.missingPath === false) {
    reviews = await listReviews(project.canonicalPath)
    if (git.initialized && git.branch.length > 0) {
      commits = await recentProjectCommits(project.canonicalPath, 10)
    }
  }
  commits = withReviewStatus(commits, reviews)
  const requirements = await projectRequirementSummaries(workspaceId)
  const tasks = listTaskDtos(
    mergeRequirementTasks(ctx, workspace, requirements, await readTasksForApi()),
    workspaceId,
  )
  project.requirementsCount = requirements.length
  return { project, git, commits, reviews, tasks }
}

/** Paginated commit history for a managed project. */
export async function listProjectCommits(ctx, workspaceId, options = {}) {
  const current = await requireProject(ctx, workspaceId)
  const query = options || {}
  const offset = commitPageOption(query.offset, 0, 0, MAX_COMMIT_OFFSET)
  const limit = commitPageOption(query.limit, DEFAULT_COMMIT_PAGE_SIZE, 1, MAX_COMMIT_PAGE_SIZE)
  const root = current.canonicalPath
  const git = await projectGitOverview(root)
  if (git.initialized === false) {
    return { commits: [], hasMore: false, offset, limit, git }
  }
  const reviews = await listReviews(root)
  const rows = await recentProjectCommits(root, limit + 1, offset)
  const hasMore = rows.length > limit
  return {
    commits: withReviewStatus(rows.slice(0, limit), reviews),
    hasMore,
    offset,
    limit,
  }
}

function reviewMatchesCommit(review, hash) {
  const value = String(review && review.commit || '')
  if (value === '' || hash === '') return false
  return value === hash || hash.startsWith(value) || value.startsWith(hash)
}

/**
 * Commit detail for the project commits tab: metadata, every changed file with
 * its diff, the review file (if any), and requirements associated with the commit.
 */
export async function projectCommitDetail(ctx, workspaceId, commitValue) {
  const current = await requireProject(ctx, workspaceId)
  const detail = await showProjectCommitDetail(current.canonicalPath, commitValue)
  if (detail === null) throw apiError(404, 'commit-not-found', messages.projectCommitNotFound)
  const reviews = await listReviews(current.canonicalPath)
  const review = reviews.find(function (item) {
    return reviewMatchesCommit(item, detail.commit.hash)
  }) || null
  const config = await readConfig()
  const requirements = typeof config.rootDir === 'string' && config.rootDir.length > 0
    ? await findRequirementsForCommit(config.rootDir, workspaceId, detail.commit.hash)
    : []
  return {
    commit: detail.commit,
    files: detail.files,
    truncated: detail.truncated,
    review: review,
    requirements: requirements.map(function (item) {
      return {
        workspaceId: workspaceId,
        id: item.id,
        title: item.title,
        status: item.status,
      }
    }),
  }
}

export async function initializeProjectGit(ctx, workspaceId) {
  const current = await requireProject(ctx, workspaceId)
  const result = await gitInit(current.canonicalPath)
  await ensureReviewsDirectory(current.canonicalPath)
  await ensureReviewExclude(current.canonicalPath)
  return {
    initialized: result.initialized,
    project: await workspaceProjectDto(current.workspace),
    git: await projectGitOverview(current.canonicalPath),
  }
}

export function previewProjectCommit(ctx, workspaceId) {
  return withKeyLock('project-preview:' + workspaceId, async function () {
    const current = await requireProject(ctx, workspaceId)
    const config = await readConfig()
    const tasks = await readTasks()
    const active = tasks.find(function (task) {
      if (task.workspaceId !== workspaceId || task.kind !== 'commit') return false
      return task.status === 'queued' || task.status === 'running' ||
        task.status === 'awaiting_confirmation'
    })
    if (active !== undefined) {
      throw apiError(409, 'project-task-active', messages.projectCommitTaskActive)
    }
    const root = current.canonicalPath
    await ensureReviewExclude(root)
    const snapshot = await captureProjectSnapshot(root)
    if (snapshot.hasChanges === false) {
      throw apiError(400, 'no-changes', messages.projectNoChanges)
    }
    await ensureReviewsDirectory(root)
    let task = await createTask({
      kind: 'commit',
      status: 'queued',
      workspaceId,
      projectPath: root,
      projectTitle: current.project.title,
      prompt: '',
      diffText: previewDiffText(snapshot),
      baseHead: snapshot.head,
      fingerprint: snapshot.fingerprint,
      changedFiles: snapshot.changedFiles,
    })
    task = await updateTask(task.id, workspaceId, function () {
      return { prompt: buildCommitPrompt(task, config.commitPromptTemplate) }
    })
    startBackgroundTask(ctx, task.id)
    return { task: toTaskDto(task) }
  })
}

export function validateCommitMessage(value, requireChinese = true) {
  if (typeof value !== 'string') throw apiError(400, 'bad-commit-message', messages.badCommitMessage)
  const text = value.trim()
  const hasChinese = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text)
  if (text.length === 0 || text.length > 2000 || (requireChinese === true && hasChinese === false)) {
    throw apiError(400, 'bad-commit-message', messages.badCommitMessage)
  }
  return text
}

export function confirmProjectCommit(ctx, workspaceId, taskId, messageInput) {
  return withProjectTaskLock(taskId, async function () {
    const task = await findTaskRecord(taskId, workspaceId)
    if (task === null) throw apiError(404, 'task-not-found', messages.projectTaskNotFound)
    if (task.kind !== 'commit' || task.status !== 'awaiting_confirmation') {
      throw apiError(409, 'invalid-task-state', messages.projectTaskInvalidState)
    }
    const current = await requireProject(ctx, workspaceId)
    const root = current.canonicalPath
    const message = messageInput === undefined || messageInput === null
      ? validateCommitMessage(task.proposedMessage)
      : validateCommitMessage(messageInput)
    const pathChanged = task.projectPath !== root
    let snapshot = null
    if (pathChanged === false) {
      try {
        await ensureReviewExclude(root)
        snapshot = await captureProjectSnapshot(root, { fileHashes: true })
      } catch (error) {
        await updateTaskIf(taskId, ['awaiting_confirmation'], function () {
          return { status: 'failed', error: error.message }
        })
        throw error
      }
    }
    const stale = pathChanged || snapshot === null || snapshot.hasChanges === false ||
      snapshot.head !== task.baseHead || snapshot.fingerprint !== task.fingerprint
    if (stale) {
      await updateTaskIf(taskId, ['awaiting_confirmation'], function () {
        return { status: 'failed', error: messages.projectStalePreview }
      })
      throw apiError(409, 'stale-preview', messages.projectStalePreview)
    }
    let commit
    try {
      commit = await commitProject(root, message, {
        expected: {
          head: task.baseHead,
          fingerprint: task.fingerprint,
          changedFiles: Array.isArray(task.changedFiles) && task.changedFiles.length > 0
            ? task.changedFiles
            : snapshot.changedFiles,
          untrackedPaths: snapshot.untracked.map(function (item) { return item.path }),
          fileHashes: snapshot.fileHashes,
        },
      })
    } catch (error) {
      await updateTaskIf(taskId, ['awaiting_confirmation'], function () {
        return { status: 'failed', error: error.message }
      })
      throw error
    }
    const updated = await updateTaskIf(taskId, ['awaiting_confirmation'], function () {
      return {
        status: 'succeeded',
        proposedMessage: message,
        commitHash: commit.hash,
        commitShort: commit.short,
        commitSubject: commit.subject,
        error: '',
      }
    })
    return {
      task: toTaskDto(updated),
      commit: { hash: commit.hash, short: commit.short, subject: commit.subject },
    }
  })
}

export function startProjectReview(ctx, workspaceId, commitValue) {
  return withKeyLock('project-review:' + workspaceId, async function () {
  const current = await requireProject(ctx, workspaceId)
  const root = current.canonicalPath
  const info = await resolveProjectCommit(root, commitValue)
  if (info === null) throw apiError(404, 'commit-not-found', messages.projectCommitNotFound)
  const tasks = await readTasks()
  const same = tasks.filter(function (task) {
    return task.workspaceId === workspaceId && task.kind === 'review' && task.commitHash === info.hash
  })
  const reviews = await listReviews(root)
  const existing = reviews.find(function (review) {
    const value = String(review.commit || '')
    return value === info.hash ||
      (value.length > 0 && info.hash.startsWith(value)) ||
      (value.length > 0 && value.startsWith(info.hash))
  })
  if (existing !== undefined) {
    const recorded = same.find(function (task) { return task.reviewFile === existing.name })
    const task = recorded || {
      id: existing.task || 'review-file',
      kind: 'review',
      status: 'succeeded',
      workspaceId,
      projectPath: root,
      projectTitle: current.project.title,
      commitHash: info.hash,
      commitShort: info.short,
      commitSubject: info.subject,
      reviewFile: existing.name,
      createdAt: existing.createdAt,
      updatedAt: existing.modifiedAt,
    }
    return { task: toTaskDto(task), alreadyReviewed: true }
  }
  const active = same.find(function (task) {
    return task.status === 'queued' || task.status === 'running'
  })
  if (active !== undefined) {
    throw apiError(409, 'review-in-progress', messages.projectReviewInProgress)
  }
  await ensureReviewExclude(root)
  await ensureReviewsDirectory(root)
  const config = await readConfig()
  let task = await createTask({
    kind: 'review',
    status: 'queued',
    workspaceId,
    projectPath: root,
    projectTitle: current.project.title,
    prompt: '',
    baseHead: info.hash,
    commitHash: info.hash,
    commitShort: info.short,
    commitSubject: info.subject,
  })
  task = await updateTask(task.id, workspaceId, function () {
    return { prompt: buildReviewPrompt(task, config.reviewPromptTemplate) }
  })
  startBackgroundTask(ctx, task.id)
  return { task: toTaskDto(task) }
  })
}

/** 同一工作区同时只允许一个进行中的未提交评审；excludeTaskId 供重试自身使用。 */
async function assertNoActiveUncommittedReview(workspaceId, excludeTaskId) {
  const tasks = await readTasks()
  const active = tasks.find(function (task) {
    if (excludeTaskId !== undefined && task.id === excludeTaskId) return false
    if (task.workspaceId !== workspaceId || task.kind !== 'review') return false
    if (task.reviewTarget !== 'uncommitted') return false
    return task.status === 'queued' || task.status === 'running'
  })
  if (active !== undefined) {
    throw apiError(409, 'uncommitted-review-in-progress',
      messages.projectUncommittedReviewInProgress)
  }
}

/**
 * 发起未提交变更评审：快照当前工作区（暂存 + 未暂存 + 未跟踪文件），
 * 创建 reviewTarget='uncommitted' 的评审任务。该任务没有提交哈希，
 * 同一工作区同时只允许一个进行中的未提交评审。
 */
export function startUncommittedReview(ctx, workspaceId) {
  return withKeyLock('project-review:' + workspaceId, async function () {
    const current = await requireProject(ctx, workspaceId)
    const root = current.canonicalPath
    await ensureReviewExclude(root)
    await ensureReviewsDirectory(root)
    // detached HEAD 也允许评审未提交变更：此时没有可引用的提交，只需工作区内容。
    const snapshot = await captureProjectSnapshot(root, { allowDetached: true })
    if (snapshot.hasChanges === false) {
      throw apiError(400, 'no-uncommitted-changes', messages.projectNoUncommittedChanges)
    }
    await assertNoActiveUncommittedReview(workspaceId)
    const config = await readConfig()
    let task = await createTask({
      kind: 'review',
      status: 'queued',
      workspaceId,
      projectPath: root,
      projectTitle: current.project.title,
      prompt: '',
      reviewTarget: 'uncommitted',
      baseHead: snapshot.head,
      changedFiles: snapshot.changedFiles,
    })
    task = await updateTask(task.id, workspaceId, function () {
      return { prompt: buildUncommittedReviewPrompt(task, config.reviewPromptTemplate) }
    })
    startBackgroundTask(ctx, task.id)
    return { task: toTaskDto(task) }
  })
}

export async function listProjectTasks(ctx, workspaceId) {
  const workspace = getRegisteredWorkspace(ctx, workspaceId)
  const tasks = await readTasksForApi()
  const requirements = await projectRequirementSummaries(workspaceId)
  return {
    tasks: listTaskDtos(mergeRequirementTasks(ctx, workspace, requirements, tasks), workspaceId),
  }
}

export function cancelProjectTask(ctx, workspaceId, taskId) {
  return withProjectTaskLock(taskId, async function () {
    const task = await findTaskRecord(taskId, workspaceId)
    if (task === null) throw apiError(404, 'task-not-found', messages.projectTaskNotFound)
    if (task.kind !== 'commit' && task.kind !== 'review') {
      throw apiError(409, 'task-kind-mismatch', messages.projectTaskKindMismatch)
    }
    const allowed = ['queued', 'running', 'awaiting_confirmation']
    if (allowed.includes(task.status) === false) {
      throw apiError(409, 'invalid-task-state', messages.projectTaskInvalidState)
    }
    const updated = await updateTaskIf(taskId, allowed, function () {
      return { status: 'cancelled', error: '' }
    })
    if (updated === null) {
      throw apiError(409, 'invalid-task-state', messages.projectTaskInvalidState)
    }
    await cancelBackgroundTask(taskId)
    return { task: toTaskDto(updated) }
  })
}

/**
 * 重试未提交评审：与 start 共用 workspace 级锁和「单活」约束，并重新快照
 * 当前工作区、重建 prompt（重试时变更文件可能与首次发起时不同；工作区
 * 已无未提交变更则返回 no-uncommitted-changes，避免评审空变更）。
 */
function retryUncommittedReviewTask(ctx, workspaceId, taskId) {
  return withKeyLock('project-review:' + workspaceId, async function () {
    const current = await findTaskRecord(taskId, workspaceId)
    if (current === null) throw apiError(404, 'task-not-found', messages.projectTaskNotFound)
    if (current.kind !== 'review' || current.reviewTarget !== 'uncommitted') {
      throw apiError(409, 'task-kind-mismatch', messages.projectTaskKindMismatch)
    }
    if (current.status !== 'failed' && current.status !== 'cancelled') {
      throw apiError(409, 'invalid-task-state', messages.projectTaskInvalidState)
    }
    await assertNoActiveUncommittedReview(workspaceId, taskId)
    const project = await requireProject(ctx, workspaceId)
    const root = project.canonicalPath
    await ensureReviewExclude(root)
    await ensureReviewsDirectory(root)
    const snapshot = await captureProjectSnapshot(root, { allowDetached: true })
    if (snapshot.hasChanges === false) {
      throw apiError(400, 'no-uncommitted-changes', messages.projectNoUncommittedChanges)
    }
    const config = await readConfig()
    const updated = await updateTaskIf(taskId, ['failed', 'cancelled'], function (before) {
      const next = {
        ...before,
        status: 'queued',
        sessionId: '',
        proposedMessage: '',
        reviewFile: '',
        error: '',
        projectPath: root,
        projectTitle: project.project.title,
        baseHead: snapshot.head,
        changedFiles: snapshot.changedFiles,
      }
      return {
        ...next,
        prompt: buildUncommittedReviewPrompt(next, config.reviewPromptTemplate),
      }
    })
    if (updated === null) {
      throw apiError(409, 'invalid-task-state', messages.projectTaskInvalidState)
    }
    startBackgroundTask(ctx, taskId)
    return { task: toTaskDto(updated) }
  })
}

export function retryProjectTask(ctx, workspaceId, taskId) {
  return withProjectTaskLock(taskId, async function () {
    const task = await findTaskRecord(taskId, workspaceId)
    if (task === null) throw apiError(404, 'task-not-found', messages.projectTaskNotFound)
    if (task.kind !== 'commit' && task.kind !== 'review') {
      throw apiError(409, 'task-kind-mismatch', messages.projectTaskKindMismatch)
    }
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw apiError(409, 'invalid-task-state', messages.projectTaskInvalidState)
    }
    // 未提交评审重试需要重新快照工作区并遵守单活约束，走独立分支。
    if (task.kind === 'review' && task.reviewTarget === 'uncommitted') {
      return retryUncommittedReviewTask(ctx, workspaceId, taskId)
    }
    const updated = await updateTaskIf(taskId, ['failed', 'cancelled'], function () {
      return {
        status: 'queued',
        sessionId: '',
        proposedMessage: '',
        reviewFile: '',
        error: '',
      }
    })
    if (updated === null) {
      throw apiError(409, 'invalid-task-state', messages.projectTaskInvalidState)
    }
    startBackgroundTask(ctx, taskId)
    return { task: toTaskDto(updated) }
  })
}
