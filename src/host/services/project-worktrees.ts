/**
 * Project-level worktree management: list plugin worktrees, inspect changes,
 * AI-assisted commit preview/confirm, push, reveal and remove. Worktrees are
 * always the per-requirement `devbench/<requirement id>` worktrees created by
 * this plugin.
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { withKeyLock } from '../shared/atomic.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import { readConfig, requireRoot, resolveWorktreeRoot } from '../storage/config.js'
import { openInSystem, openProjectDirectory } from '../platform/open.js'
import { getRegisteredWorkspace, requireProject } from './projects.js'
import {
  buildCommitPrompt,
  startBackgroundTask,
} from './background-agent.js'
import {
  assertGitRoot,
  captureProjectSnapshot,
  commitProject,
  firstLine,
  gitInfo,
  parseStatusEntries,
  preferredRemote,
  resolveRemotes,
  runGit,
  sanitizeGitDetail,
  upstreamState,
} from '../integrations/git.js'
import {
  ACTIVE_TASK_STATUSES,
  createTask,
  findTaskRecord,
  readTasks,
  toTaskDto,
  updateTask,
  updateTaskIf,
  withProjectTaskLock,
} from '../storage/tasks.js'
import {
  getWorkspaceEntry,
  readMapping,
  resolveWorkspaceFolder,
} from '../storage/workspaces.js'
import { findRequirementInWorkspace, scanRequirements, toSummary, updateRequirement } from '../domain/requirements.js'
import {
  ensureRequirementWorktree,
  findPluginWorktree,
  pluginWorktreeEntries,
  worktreeBranchForRequirementId,
  worktreeTargetPathForRequirementId,
} from '../domain/worktrees.js'
import { previewDiffText, validateCommitMessage } from './project-service.js'
import { assertWorktreeNotInUse, hasRunningRequirementSession } from '../domain/worktree-usage.js'

const CHANGES_DIFF_LIMIT = 200000
const REVIEW_PREFIX = '.dsh-reviews/'

async function directoryExists(target) {
  try {
    const stat = await fsp.stat(target)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/** Requirement id -> { title, status } for the workspace documents that still exist. */
async function requirementIndex(ctx, config, workspaceId) {
  const index = new Map()
  const root = typeof config.rootDir === 'string' ? config.rootDir : ''
  if (root.length === 0) return index
  try {
    const mapping = await readMapping(root)
    const entry = getWorkspaceEntry(mapping, workspaceId)
    if (entry === null) return index
    const folder = await resolveWorkspaceFolder(root, entry.folder, { mustExist: false })
    const requirements = await scanRequirements(folder, workspaceId)
    for (const requirement of requirements) {
      index.set(requirement.id, {
        title: requirement.title,
        status: requirement.status,
        worktree: requirement.worktree === true,
      })
    }
  } catch (error) {
    ctx?.logger?.warn?.('devbench-manager: worktree requirement index: ' +
      String(error && error.message ? error.message : error))
  }
  return index
}

async function projectBaseBranch(projectRoot) {
  const result = await runGit(projectRoot, ['symbolic-ref', '--short', '-q', 'HEAD'])
  return result.code === 0 ? result.stdout.trim() : ''
}

async function lastCommitAt(worktreePath) {
  const result = await runGit(worktreePath,
    ['log', '-1', '--pretty=format:%H%x1f%h%x1f%s%x1f%aI'])
  if (result.code !== 0) return null
  const line = result.stdout.trim()
  if (line.length === 0) return null
  const values = line.split('\x1f')
  return {
    hash: values[0] || '',
    short: values[1] || '',
    subject: values[2] || '',
    date: values[3] || '',
  }
}

/** Worktree branch relative to the project base branch: right = ahead, left = behind. */
async function aheadBehind(projectRoot, base, branch) {
  const baseRef = base.length > 0 ? base : 'HEAD'
  const result = await runGit(projectRoot, ['rev-list', '--left-right', '--count',
    baseRef + '...' + branch])
  if (result.code !== 0) return { ahead: 0, behind: 0, known: false }
  const values = result.stdout.trim().split(/\s+/)
  // `--left-right` prints left (base-only = behind) first, right (branch-only = ahead) second.
  return { ahead: Number(values[1]) || 0, behind: Number(values[0]) || 0, known: true }
}

function baseWorktreeDto(entry, base, requirement, remote, remotes) {
  const found = requirement === undefined || requirement === null ? null : requirement
  return {
    requirementId: entry.requirementId,
    title: found === null ? entry.requirementId : found.title,
    status: found === null ? 'missing' : found.status,
    state: 'ready',
    created: true,
    exists: false,
    path: entry.path,
    branch: entry.branch,
    base,
    dirty: false,
    changesCount: 0,
    statusKnown: true,
    ahead: 0,
    behind: 0,
    aheadKnown: true,
    lastCommit: null,
    upstream: null,
    remote: remote || null,
    remotes: Array.isArray(remotes) ? remotes.slice() : [],
    canCreate: false,
    canPrune: false,
  }
}

async function worktreeDto(entry, base, requirement, remote, remotes, context: any = undefined) {
  const opts = context || {}
  const dto = baseWorktreeDto(entry, base, requirement, remote, remotes)
  dto.exists = await directoryExists(entry.path)
  dto.state = dto.exists ? 'ready' : 'missing'
  dto.canPrune = dto.exists === false
  let statusEntries = null
  if (Array.isArray(opts.statusEntries)) {
    statusEntries = opts.statusEntries
    dto.statusKnown = true
  } else if (dto.exists) {
    const status = await runGit(entry.path, ['status', '--porcelain=v1', '-z'])
    dto.statusKnown = status.code === 0
    if (status.code === 0) statusEntries = parseStatusEntries(status.stdout)
  }
  if (statusEntries !== null) {
    dto.changesCount = statusEntries.length
    dto.dirty = dto.changesCount > 0
  }
  const counts = await aheadBehind(entry.projectRoot, base, entry.branch)
  dto.ahead = counts.ahead
  dto.behind = counts.behind
  dto.aheadKnown = counts.known
  dto.lastCommit = dto.exists ? await lastCommitAt(entry.path) : null
  dto.upstream = dto.exists ? await upstreamState(entry.path) : null
  return dto
}

/** Row for a worktree-enabled requirement whose directory was never created. */
function absentWorktreeDto(config, workspace, requirementIdValue, requirement, base, remote, remotes) {
  const found = requirement === undefined || requirement === null ? null : requirement
  return {
    requirementId: requirementIdValue,
    title: found === null ? requirementIdValue : found.title,
    status: found === null ? 'missing' : found.status,
    state: 'absent',
    created: false,
    exists: false,
    path: worktreeTargetPathForRequirementId(config, workspace, requirementIdValue),
    branch: worktreeBranchForRequirementId(requirementIdValue),
    base,
    dirty: false,
    changesCount: 0,
    statusKnown: true,
    ahead: 0,
    behind: 0,
    aheadKnown: true,
    lastCommit: null,
    upstream: null,
    remote: remote || null,
    remotes: Array.isArray(remotes) ? remotes.slice() : [],
    canCreate: true,
    canPrune: false,
  }
}

async function requireProjectWorktree(config, workspace, requirementId) {
  if (typeof requirementId !== 'string' || requirementId.length === 0) {
    throw apiError(404, 'worktree-not-found', messages.worktreeNotFound)
  }
  const entries = await pluginWorktreeEntries(config, workspace)
  const entry = entries.find(function (item) { return item.requirementId === requirementId })
  if (entry === undefined || await directoryExists(entry.path) === false) {
    throw apiError(404, 'worktree-not-found', messages.worktreeNotFound)
  }
  return entry
}

function changesDiffText(snapshot) {
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
  const text = sections.join('\n\n')
  if (text.length <= CHANGES_DIFF_LIMIT) return { diffText: text, truncated: false }
  return {
    diffText: text.slice(0, CHANGES_DIFF_LIMIT) + '\n[truncated]\n',
    truncated: true,
  }
}

async function failedTaskError(taskId, error) {
  await updateTaskIf(taskId, ['awaiting_confirmation'], function () {
    return { status: 'failed', error }
  })
}

/**
 * Refuse worktree commits while the requirement is executing (active requirement
 * task, `running` status, or a live session backed by a running agent). Checked
 * on preview and re-checked on confirm so starting execution between the two
 * steps cannot slip a half-finished worktree into a commit.
 */
async function assertRequirementWorktreeIdle(ctx, config, workspace, requirementId) {
  const tasks = await readTasks()
  const activeTask = tasks.find(function (task) {
    if (task.kind !== 'requirement') return false
    if (task.workspaceId !== workspace.id) return false
    if (task.requirementId !== requirementId) return false
    return ACTIVE_TASK_STATUSES.includes(task.status)
  })
  if (activeTask !== undefined) {
    throw apiError(409, 'worktree-requirement-running', messages.worktreeRequirementRunning)
  }
  const root = typeof config.rootDir === 'string' ? config.rootDir : ''
  if (root.length === 0) return
  const requirement = await findRequirementInWorkspace(root, workspace.id, requirementId)
    .catch(function () { return null })
  if (requirement === null || !requirement.meta) return
  if (requirement.meta.status === 'running') {
    throw apiError(409, 'worktree-requirement-running', messages.worktreeRequirementRunning)
  }
  const sessionIds = Array.isArray(requirement.meta.sessions) ? requirement.meta.sessions : []
  if (hasRunningRequirementSession(ctx, sessionIds)) {
    throw apiError(409, 'worktree-requirement-running', messages.worktreeRequirementRunning)
  }
}

/** List the plugin worktrees of a project with requirement and git metadata. */
export async function listProjectWorktrees(ctx, workspaceId) {
  const workspace = getRegisteredWorkspace(ctx, workspaceId)
  const current = await requireProject(ctx, workspaceId)
  const config = await readConfig()
  const defaultRoot = path.resolve(resolveWorktreeRoot(config))
  const git = await gitInfo(current.canonicalPath)
  if (git.initialized === false) {
    return { git, defaultRoot, remote: null, remotes: [], worktrees: [] }
  }
  const entries = await pluginWorktreeEntries(config, workspace)
  const requirements = await requirementIndex(ctx, config, workspaceId)
  const projectRoot = (await assertGitRoot(current.canonicalPath)).root
  const remotes = await resolveRemotes(projectRoot)
  const remote = preferredRemote(remotes)
  const base = await projectBaseBranch(projectRoot)
  const worktrees = await Promise.all(entries.map(function (entry) {
    return worktreeDto(entry, base, requirements.get(entry.requirementId), remote, remotes)
  }))
  // Worktree-enabled requirements without a directory stay visible and can be
  // created from the tab instead of forcing a requirement-detail + execute trip.
  const covered = new Set(entries.map(function (entry) { return entry.requirementId }))
  for (const [id, requirement] of requirements) {
    if (requirement.worktree !== true || covered.has(id)) continue
    worktrees.push(absentWorktreeDto(config, workspace, id, requirement, base, remote, remotes))
  }
  worktrees.sort(function (left, right) {
    return right.requirementId.localeCompare(left.requirementId)
  })
  return { git, defaultRoot, remote, remotes, worktrees }
}

/** Changes (files, diff text, head and branch) of a single plugin worktree. */
export async function readProjectWorktreeChanges(ctx, workspaceId, requirementId) {
  const workspace = getRegisteredWorkspace(ctx, workspaceId)
  await requireProject(ctx, workspaceId)
  const config = await readConfig()
  const entry = await requireProjectWorktree(config, workspace, requirementId)
  const requirements = await requirementIndex(ctx, config, workspaceId)
  const remotes = await resolveRemotes(entry.projectRoot)
  const remote = preferredRemote(remotes)
  const base = await projectBaseBranch(entry.projectRoot)
  const snapshot = await captureProjectSnapshot(entry.path)
  const worktree = await worktreeDto(entry, base, requirements.get(requirementId), remote, remotes, {
    statusEntries: snapshot.statusEntries,
  })
  const diff = snapshot.hasChanges
    ? changesDiffText(snapshot)
    : { diffText: '', truncated: false }
  const files = snapshot.statusEntries.filter(function (item) {
    return item.path.startsWith(REVIEW_PREFIX) === false
  })
  return {
    worktree,
    hasChanges: snapshot.hasChanges,
    changedFiles: snapshot.changedFiles,
    files,
    diffText: diff.diffText,
    truncated: diff.truncated,
    head: snapshot.head,
    branch: snapshot.branch,
  }
}

/**
 * Create the requirement worktree on demand (idempotent) and enable the
 * requirement's worktree switch so later executions run inside it.
 */
export function createProjectWorktree(ctx, workspaceId, requirementId) {
  const scope = typeof requirementId === 'string' ? requirementId : ''
  return withKeyLock('project-worktree-create:' + workspaceId + ':' + scope, async function () {
    const workspace = getRegisteredWorkspace(ctx, workspaceId)
    await requireProject(ctx, workspaceId)
    const config = await readConfig()
    const root = requireRoot(config)
    const requirement = await findRequirementInWorkspace(root, workspaceId, scope)
    if (requirement === null) {
      throw apiError(404, 'requirement-not-found', messages.requirementNotFound)
    }
    const worktree = await ensureRequirementWorktree(config, workspace, requirement)
    let summary = toSummary(requirement.meta, requirement.folderPath, workspaceId)
    if (summary.worktree !== true) {
      const saved = await updateRequirement(requirement, function (latest) {
        const extra = Object.assign({}, latest.meta.extra)
        extra.worktree = true
        return { meta: { extra } }
      })
      summary = toSummary(saved.meta, saved.folderPath, workspaceId)
    }
    return { worktree, requirement: summary }
  })
}

/**
 * Drop stale worktree registrations whose directories are gone, keeping the
 * `devbench/<id>` branches. Without an id every missing worktree is pruned.
 */
export function pruneProjectWorktrees(ctx, workspaceId, requirementId) {
  const scope = typeof requirementId === 'string' ? requirementId : ''
  return withKeyLock('project-worktree-prune:' + workspaceId + ':' + scope, async function () {
    const workspace = getRegisteredWorkspace(ctx, workspaceId)
    const current = await requireProject(ctx, workspaceId)
    const config = await readConfig()
    const entries = await pluginWorktreeEntries(config, workspace)
    if (scope.length > 0 && entries.some(function (entry) {
      return entry.requirementId === scope
    }) === false) {
      throw apiError(404, 'worktree-not-found', messages.worktreeNotFound)
    }
    const candidates = []
    for (const entry of entries) {
      if (scope.length > 0 && entry.requirementId !== scope) continue
      if (await directoryExists(entry.path)) continue
      candidates.push(entry)
    }
    const pruned = []
    const failed = []
    if (candidates.length > 0) {
      const projectRoot = (await assertGitRoot(current.canonicalPath)).root
      for (const entry of candidates) {
        // Scope the cleanup to this entry: `git worktree remove <path>` also
        // drops registrations whose directory is gone, without touching other
        // stale or live worktrees.
        const result = await runGit(projectRoot, ['worktree', 'remove', entry.path])
        if (result.code !== 0) {
          failed.push({
            requirementId: entry.requirementId,
            message: firstLine(result.stderr) || firstLine(result.stdout) || messages.worktreePruneFailed,
          })
          continue
        }
        pruned.push({ requirementId: entry.requirementId, path: entry.path, branch: entry.branch })
      }
      if (failed.length > 0) {
        throw apiError(500, 'worktree-prune-failed',
          messages.worktreePruneFailed + ': ' + failed[0].message)
      }
      const left = new Set((await pluginWorktreeEntries(config, workspace)).map(function (entry) {
        return entry.requirementId
      }))
      for (const entry of pruned) {
        if (left.has(entry.requirementId)) {
          throw apiError(500, 'worktree-prune-failed', messages.worktreePruneFailed)
        }
      }
    }
    return { pruned }
  })
}

/** Create a commit task for a worktree; conflicts with project commit previews. */
export function previewProjectWorktreeCommit(ctx, workspaceId, requirementId) {
  return withKeyLock('project-preview:' + workspaceId, async function () {
    const workspace = getRegisteredWorkspace(ctx, workspaceId)
    const current = await requireProject(ctx, workspaceId)
    const config = await readConfig()
    const entry = await requireProjectWorktree(config, workspace, requirementId)
    const tasks = await readTasks()
    const active = tasks.find(function (task) {
      if (task.workspaceId !== workspaceId || task.kind !== 'commit') return false
      return ACTIVE_TASK_STATUSES.includes(task.status)
    })
    if (active !== undefined) {
      throw apiError(409, 'project-task-active', messages.projectCommitTaskActive)
    }
    await assertRequirementWorktreeIdle(ctx, config, workspace, entry.requirementId)
    const snapshot = await captureProjectSnapshot(entry.path)
    if (snapshot.hasChanges === false) {
      throw apiError(400, 'no-changes', messages.projectNoChanges)
    }
    let task = await createTask({
      kind: 'commit',
      status: 'queued',
      workspaceId,
      projectPath: entry.path,
      projectTitle: current.project.title,
      prompt: '',
      diffText: previewDiffText(snapshot),
      baseHead: snapshot.head,
      fingerprint: snapshot.fingerprint,
      changedFiles: snapshot.changedFiles,
      worktreePath: entry.path,
      worktreeBranch: entry.branch,
      requirementId: entry.requirementId,
    })
    task = await updateTask(task.id, workspaceId, function () {
      return { prompt: buildCommitPrompt(task, config.commitPromptTemplate) }
    })
    startBackgroundTask(ctx, task.id)
    return { task: toTaskDto(task) }
  })
}

/** Confirm a pending worktree commit after re-validating the preview snapshot. */
export function confirmProjectWorktreeCommit(ctx, workspaceId, taskId, messageInput) {
  return withProjectTaskLock(taskId, async function () {
    const task = await findTaskRecord(taskId, workspaceId)
    if (task === null || task.kind !== 'commit' ||
        typeof task.worktreePath !== 'string' || task.worktreePath.length === 0) {
      throw apiError(404, 'task-not-found', messages.projectTaskNotFound)
    }
    if (task.status !== 'awaiting_confirmation') {
      throw apiError(409, 'invalid-task-state', messages.projectTaskInvalidState)
    }
    let workspace
    let config
    let found
    try {
      workspace = getRegisteredWorkspace(ctx, workspaceId)
      await requireProject(ctx, workspaceId)
      config = await readConfig()
      found = await findPluginWorktree(config, workspace, task.worktreePath)
    } catch (error) {
      // Resolution failures must end the pending task, otherwise it stays in
      // awaiting_confirmation forever and blocks every later commit preview.
      await failedTaskError(taskId, error && error.message ? error.message : messages.worktreeGone)
      throw error
    }
    if (found === null) {
      // The worktree vanished while the task was waiting for confirmation: fail the
      // task first so it cannot stay in awaiting_confirmation forever.
      await failedTaskError(taskId, messages.worktreeGone)
      throw apiError(404, 'worktree-gone', messages.worktreeGone)
    }
    // Re-check the execution guard on confirm: the requirement may have started
    // executing after the preview was created. Keep awaiting_confirmation so the
    // user can confirm again once the execution finished.
    await assertRequirementWorktreeIdle(ctx, config, workspace, task.requirementId)
    const message = messageInput === undefined || messageInput === null
      ? validateCommitMessage(task.proposedMessage)
      : validateCommitMessage(messageInput)
    let snapshot
    try {
      snapshot = await captureProjectSnapshot(found.path, { fileHashes: true })
    } catch (error) {
      await failedTaskError(taskId, error.message)
      throw error
    }
    if (snapshot.hasChanges === false) {
      await failedTaskError(taskId, messages.projectNoChanges)
      throw apiError(400, 'no-changes', messages.projectNoChanges)
    }
    const stale = snapshot.head !== task.baseHead || snapshot.fingerprint !== task.fingerprint
    if (stale) {
      await failedTaskError(taskId, messages.projectStalePreview)
      throw apiError(409, 'stale-preview', messages.projectStalePreview)
    }
    let commit
    try {
      commit = await commitProject(found.path, message, {
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
      await failedTaskError(taskId, error.message)
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
    if (updated === null) {
      throw apiError(409, 'invalid-task-state', messages.projectTaskInvalidState)
    }
    return {
      task: toTaskDto(updated),
      commit: { hash: commit.hash, short: commit.short, subject: commit.subject },
      pushed: false,
      warning: '',
    }
  })
}

/**
 * Push the worktree branch to origin or the only configured remote. The git
 * process never prompts for credentials (fails fast instead of hanging) and
 * remote output is sanitized before being returned.
 */
export function pushProjectWorktree(ctx, workspaceId, requirementId) {
  return withKeyLock('project-worktree-push:' + workspaceId + ':' + requirementId,
    async function () {
      const workspace = getRegisteredWorkspace(ctx, workspaceId)
      await requireProject(ctx, workspaceId)
      const config = await readConfig()
      const entry = await requireProjectWorktree(config, workspace, requirementId)
      const remotes = await resolveRemotes(entry.projectRoot)
      const remote = preferredRemote(remotes)
      if (remote === null) {
        if (remotes.length > 1) {
          throw apiError(400, 'push-remote-ambiguous', messages.worktreePushRemoteAmbiguous)
        }
        throw apiError(400, 'push-no-remote', messages.worktreePushNoRemote)
      }
      const before = await upstreamState(entry.path)
      const result = await runGit(entry.path, ['push', '-u', remote, entry.branch], {
        timeout: 60000,
        env: { GIT_TERMINAL_PROMPT: '0' },
      })
      if (result.code !== 0) {
        const detail = sanitizeGitDetail(firstLine(result.stderr) || firstLine(result.stdout))
        throw apiError(400, 'push-failed',
          messages.worktreePushFailed + (detail.length > 0 ? ': ' + detail : ''))
      }
      const detail = sanitizeGitDetail(firstLine(result.stdout) || firstLine(result.stderr))
      const upstream = await upstreamState(entry.path) ||
        { remote, branch: entry.branch, ahead: 0, behind: 0 }
      const alreadyUpToDate = before !== null &&
        safeCount(before.ahead) === 0 && safeCount(before.behind) === 0
      return {
        pushed: true,
        remote,
        branch: entry.branch,
        upstream,
        alreadyUpToDate,
        detail,
      }
    })
}

function safeCount(value) {
  const number = Number(value)
  if (Number.isFinite(number) === false || number < 0) return 0
  return number
}

/**
 * Open the worktree directory in the OS file manager or a supported launcher
 * (available launchers are reported by `GET /project/open-targets`).
 */
export async function revealProjectWorktree(ctx, workspaceId, requirementId, launcher) {
  const workspace = getRegisteredWorkspace(ctx, workspaceId)
  await requireProject(ctx, workspaceId)
  const config = await readConfig()
  const entry = await requireProjectWorktree(config, workspace, requirementId)
  const target = typeof launcher === 'string' && launcher.length > 0 ? launcher : 'system'
  try {
    if (target === 'system') await openInSystem(entry.path, false)
    else await openProjectDirectory(entry.path, target)
  } catch (error) {
    if (error && error.code && error.status) throw error
    throw apiError(500, 'worktree-reveal-failed', messages.worktreeRevealFailed)
  }
  return { opened: true, path: entry.path, target }
}

/**
 * Remove a plugin-created worktree directory, keeping its `devbench/<id>` branch
 * so committed content is never lost. Refuses when the worktree is dirty; the
 * requirement document's worktree switch is left untouched, so the next
 * execution recreates the directory.
 */
export function removeProjectWorktree(ctx, workspaceId, requirementId) {
  return withKeyLock('project-worktree-remove:' + workspaceId + ':' + requirementId,
    async function () {
      const workspace = getRegisteredWorkspace(ctx, workspaceId)
      await requireProject(ctx, workspaceId)
      const config = await readConfig()
      const entries = await pluginWorktreeEntries(config, workspace)
      const entry = entries.find(function (item) {
        return item.requirementId === requirementId
      })
      if (entry === undefined) {
        throw apiError(404, 'worktree-not-found', messages.worktreeNotFound)
      }
      const tasks = await readTasks()
      let sessionIds = []
      const rootDir = typeof config.rootDir === 'string' ? config.rootDir : ''
      if (rootDir.length > 0) {
        const requirement = await findRequirementInWorkspace(rootDir, workspaceId, entry.requirementId)
          .catch(function () { return null })
        if (requirement !== null && requirement.meta && Array.isArray(requirement.meta.sessions)) {
          sessionIds = requirement.meta.sessions
        }
      }
      assertWorktreeNotInUse({
        ctx,
        tasks,
        workspaceId,
        requirementId: entry.requirementId,
        worktreePath: entry.path,
        sessionIds,
      })
      if (await directoryExists(entry.path) === false) {
        // The directory was deleted outside the plugin: drop the stale
        // registration instead of refusing to clean it up.
        const pruned = await runGit(entry.projectRoot, ['worktree', 'remove', entry.path])
        if (pruned.code !== 0) {
          const detail = firstLine(pruned.stderr) || firstLine(pruned.stdout)
          throw apiError(500, 'worktree-remove-failed',
            messages.worktreeRemoveFailed + (detail.length > 0 ? ': ' + detail : ''))
        }
        const left = (await pluginWorktreeEntries(config, workspace)).some(function (item) {
          return item.requirementId === entry.requirementId
        })
        if (left) {
          throw apiError(500, 'worktree-remove-failed', messages.worktreeRemoveFailed)
        }
        return {
          removed: true,
          pruned: true,
          branch: entry.branch,
          path: entry.path,
          requirementId: entry.requirementId,
        }
      }
      const status = await runGit(entry.path, ['status', '--porcelain'])
      if (status.code !== 0) {
        throw apiError(404, 'worktree-not-found', messages.worktreeNotFound)
      }
      if (status.stdout.trim().length > 0) {
        throw apiError(409, 'worktree-dirty', messages.worktreeDirty)
      }
      const removed = await runGit(entry.projectRoot, ['worktree', 'remove', entry.path])
      if (removed.code !== 0) {
        const detail = firstLine(removed.stderr) || firstLine(removed.stdout)
        throw apiError(500, 'worktree-remove-failed',
          messages.worktreeRemoveFailed + (detail.length > 0 ? ': ' + detail : ''))
      }
      if (await directoryExists(entry.path)) {
        throw apiError(500, 'worktree-remove-failed', messages.worktreeRemoveFailed)
      }
      return {
        removed: true,
        pruned: false,
        branch: entry.branch,
        path: entry.path,
        requirementId: entry.requirementId,
      }
    })
}
