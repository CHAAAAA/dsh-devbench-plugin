/** Per-requirement git worktrees: predictable targets, creation, inspection, and removal. */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { withKeyLock } from '../shared/atomic.js'
import { LEGACY_WORKTREE_BRANCH_PREFIX, WORKTREE_BRANCH_PREFIX } from '../constants.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import {
  isPathInside,
  isSafeRequirementId,
  lstatMaybe,
  safeSlug,
} from '../shared/path-safety.js'
import { openInSystem } from '../platform/open.js'
import { resolveWorktreeRoot } from '../storage/config.js'
import { assertGitRoot, runGit } from '../integrations/git.js'

function requirementId(requirement) {
  return requirement && requirement.meta && typeof requirement.meta.id === 'string'
    ? requirement.meta.id
    : ''
}

/** Branch name for a requirement id: `devbench/<requirement id>`. */
export function worktreeBranchForRequirementId(requirementIdValue) {
  if (isSafeRequirementId(requirementIdValue) === false) {
    throw apiError(400, 'worktree-branch-invalid', messages.worktreeBranchInvalid)
  }
  return WORKTREE_BRANCH_PREFIX + requirementIdValue
}

function worktreeBranchFor(requirement) {
  const id = requirementId(requirement)
  return worktreeBranchForRequirementId(id)
}

/** Folder name is `<workspace slug>-<workspace id prefix>-<requirement id>`. */
function worktreeFolderName(workspace, requirementIdValue) {
  const title = workspace && typeof workspace.title === 'string' ? workspace.title : ''
  const projectPath = workspace && typeof workspace.path === 'string' ? workspace.path : ''
  const label = safeSlug(title.length > 0 ? title : path.basename(projectPath) || 'workspace')
  const workspaceId = workspace && typeof workspace.id === 'string' ? workspace.id : 'workspace'
  const prefix = safeSlug(workspaceId).slice(0, 8) || 'workspace'
  return label + '-' + prefix + '-' + requirementIdValue
}

/** Predictable absolute target path for a requirement id, existing or not. */
export function worktreeTargetPathForRequirementId(config, workspace, requirementIdValue) {
  const root = path.resolve(resolveWorktreeRoot(config))
  const target = path.join(root, worktreeFolderName(workspace, requirementIdValue))
  if (isPathInside(root, target, false) === false) {
    throw apiError(400, 'bad-worktree-root', messages.worktreeRootInvalid)
  }
  return target
}

/** Predictable absolute target path, independent of whether the directory exists yet. */
export function worktreeTargetPath(config, workspace, requirement) {
  return worktreeTargetPathForRequirementId(config, workspace, requirementId(requirement))
}

async function resolvedWorktreeRoot(config) {
  const root = resolveWorktreeRoot(config)
  if (path.isAbsolute(root) === false) {
    throw apiError(400, 'bad-worktree-root', messages.worktreeRootInvalid)
  }
  let real
  try {
    await fsp.mkdir(root, { recursive: true })
    real = await fsp.realpath(root)
    const stat = await fsp.stat(real)
    if (stat.isDirectory() === false) throw new Error('not a directory')
  } catch {
    throw apiError(400, 'bad-worktree-root', messages.worktreeRootInvalid)
  }
  return real
}

function errorSummary(result) {
  const text = String((result && (result.stderr || result.stdout)) || '').trim()
  if (text.length === 0) return ''
  const lines = text.split(/\r?\n/)
    .map(function (line) { return line.trim() })
    .filter(function (line) { return line.length > 0 })
  return (lines[0] || '').slice(0, 300)
}

/** Parse `git worktree list --porcelain` into { path, branch } entries. */
async function gitWorktreeEntries(projectRoot) {
  const result = await runGit(projectRoot, ['worktree', 'list', '--porcelain'])
  if (result.code !== 0) return null
  const entries = []
  let current = null
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length).trim(), branch: '' }
      entries.push(current)
    } else if (current !== null && line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim()
      current.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
    }
  }
  return entries
}

async function samePath(left, right) {
  if (typeof left !== 'string' || left.length === 0) return false
  if (path.resolve(left) === path.resolve(right)) return true
  try {
    const values = await Promise.all([fsp.realpath(left), fsp.realpath(right)])
    return values[0] === values[1]
  } catch {
    return false
  }
}

async function findRegisteredWorktree(projectRoot, target) {
  const entries = await gitWorktreeEntries(projectRoot)
  if (entries === null) return null
  for (const entry of entries) {
    if (await samePath(entry.path, target)) return entry
  }
  return null
}

/**
 * Match a registration by its deterministic plugin branch instead of a path.
 * The matched directory must still live inside the configured worktree root,
 * otherwise a branch checked out elsewhere would bypass the root guard.
 */
async function findRegisteredWorktreeByBranch(config, projectRoot, branch) {
  if (typeof branch !== 'string' || branch.length === 0) return null
  const entries = await gitWorktreeEntries(projectRoot)
  if (entries === null) return null
  const rootReal = await existingWorktreeRoot(config)
  if (rootReal === null) return null
  for (const entry of entries) {
    if (entry.branch !== branch) continue
    let real
    try {
      real = await fsp.realpath(entry.path)
    } catch {
      real = path.resolve(entry.path)
    }
    if (isPathInside(rootReal, real, false) === false) continue
    return entry
  }
  return null
}

/** Real path of the configured worktree root, or null when it is not a usable directory. */
async function existingWorktreeRoot(config) {
  const root = resolveWorktreeRoot(config)
  if (path.isAbsolute(root) === false) return null
  try {
    const real = await fsp.realpath(root)
    const stat = await fsp.stat(real)
    return stat.isDirectory() ? real : null
  } catch {
    return null
  }
}

/**
 * Registered git worktrees that this plugin created for the workspace's repository:
 * current `devbench/` branches or legacy `dsh-req/` branches, a safe requirement
 * id, and a real path inside the configured worktree root. Non-git or unreadable
 * projects yield an empty list.
 */
export async function pluginWorktreeEntries(config, workspace) {
  const projectPath = workspace && typeof workspace.path === 'string' ? workspace.path : ''
  let gitRoot
  try {
    gitRoot = await assertGitRoot(projectPath)
  } catch {
    return []
  }
  const entries = await gitWorktreeEntries(gitRoot.root)
  if (entries === null) return []
  const rootReal = await existingWorktreeRoot(config)
  if (rootReal === null) return []
  const result = []
  for (const entry of entries) {
    const branch = entry.branch || ''
    const prefix = branch.startsWith(WORKTREE_BRANCH_PREFIX)
      ? WORKTREE_BRANCH_PREFIX
      : (branch.startsWith(LEGACY_WORKTREE_BRANCH_PREFIX) ? LEGACY_WORKTREE_BRANCH_PREFIX : '')
    if (prefix.length === 0) continue
    const requirementId = branch.slice(prefix.length)
    if (isSafeRequirementId(requirementId) === false) continue
    let real
    try {
      real = await fsp.realpath(entry.path)
    } catch {
      real = path.resolve(entry.path)
    }
    if (isPathInside(rootReal, real, false) === false) continue
    result.push({
      path: real,
      branch,
      requirementId,
      projectRoot: gitRoot.root,
    })
  }
  return result
}

/** Match a task project path against the plugin-managed worktrees of one workspace. */
export async function findPluginWorktree(config, workspace, targetPath) {
  if (typeof targetPath !== 'string' || targetPath.length === 0) return null
  let target
  try {
    target = await fsp.realpath(targetPath)
  } catch {
    return null
  }
  const entries = await pluginWorktreeEntries(config, workspace)
  const hit = entries.find(function (entry) { return entry.path === target })
  if (hit === undefined) return null
  return { path: hit.path, branch: hit.branch, requirementId: hit.requirementId }
}

async function existingProjectRoot(workspace) {
  const value = workspace && typeof workspace.path === 'string' ? workspace.path : ''
  if (value.length === 0) return null
  try {
    const real = await fsp.realpath(value)
    const stat = await fsp.stat(real)
    return stat.isDirectory() ? real : null
  } catch {
    return null
  }
}

async function directoryExists(target) {
  try {
    const stat = await fsp.stat(target)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/**
 * Drop one stale `git worktree` registration whose directory is gone.
 * `git worktree remove <path>` removes only that registration (it also works
 * when the directory is missing), so other stale entries are left untouched;
 * the requirement branch is never deleted.
 */
async function dropMissingWorktree(gitRoot, entry, targetPath) {
  const removed = await runGit(gitRoot.root, ['worktree', 'remove', entry.path])
  if (removed.code !== 0) {
    const detail = errorSummary(removed)
    throw apiError(500, 'worktree-remove-failed',
      messages.worktreeRemoveFailed + (detail.length > 0 ? ': ' + detail : ''))
  }
  if (await findRegisteredWorktree(gitRoot.root, targetPath) !== null ||
      await directoryExists(entry.path)) {
    throw apiError(500, 'worktree-remove-failed', messages.worktreeRemoveFailed)
  }
  return {
    removed: true,
    pruned: true,
    branch: entry.branch,
    path: targetPath,
  }
}

async function requireGitProject(workspace) {
  const value = workspace && typeof workspace.path === 'string' ? workspace.path : ''
  try {
    return await assertGitRoot(value)
  } catch {
    throw apiError(400, 'worktree-not-git', messages.worktreeNotGit)
  }
}

async function currentBranch(projectRoot) {
  const result = await runGit(projectRoot, ['symbolic-ref', '--short', '-q', 'HEAD'])
  return result.code === 0 ? result.stdout.trim() : ''
}

function worktreeEnabled(requirement) {
  return Boolean(requirement && requirement.meta && requirement.meta.extra &&
    requirement.meta.extra.worktree === true)
}

/**
 * Describe the requirement worktree without changing anything. A non-git or
 * missing project never throws: it reports `exists: false` instead.
 */
export async function describeRequirementWorktree(config, workspace, requirement) {
  const targetPath = worktreeTargetPath(config, workspace, requirement)
  const description = {
    enabled: worktreeEnabled(requirement),
    exists: false,
    path: targetPath,
    targetPath,
    branch: worktreeBranchFor(requirement),
    base: '',
  }
  const projectRoot = await existingProjectRoot(workspace)
  if (projectRoot === null) return description
  let gitRoot
  try {
    gitRoot = await assertGitRoot(projectRoot)
  } catch {
    return description
  }
  description.base = await currentBranch(gitRoot.root)
  let entry = await findRegisteredWorktree(gitRoot.root, targetPath)
  if (entry === null) entry = await findRegisteredWorktreeByBranch(config, gitRoot.root, description.branch)
  description.registered = entry !== null
  if (entry !== null) {
    description.exists = await directoryExists(entry.path)
    // Workspace metadata (title) feeds the derived folder name; when it drifted
    // the registration is the source of truth for the directory users open.
    if (await samePath(entry.path, targetPath) === false) description.path = entry.path
  }
  return description
}

/** Create the worktree when needed, reusing an already registered one. */
export async function ensureRequirementWorktree(config, workspace, requirement) {
  const targetPath = worktreeTargetPath(config, workspace, requirement)
  const branch = worktreeBranchFor(requirement)
  return withKeyLock('requirement-worktree:' + targetPath, async function () {
    const gitRoot = await requireGitProject(workspace)
    const head = await runGit(gitRoot.root, ['rev-parse', '--verify', 'HEAD'])
    if (head.code !== 0) {
      throw apiError(400, 'worktree-no-commit', messages.worktreeNoCommit)
    }
    const byPath = await findRegisteredWorktree(gitRoot.root, targetPath)
    if (byPath !== null) {
      if (await directoryExists(byPath.path)) return describeRequirementWorktree(config, workspace, requirement)
      // Stale registration for a deleted directory: drop it, then recreate below.
      await dropMissingWorktree(gitRoot, byPath, targetPath)
      if (await findRegisteredWorktree(gitRoot.root, targetPath) !== null) {
        throw apiError(400, 'worktree-path-occupied', messages.worktreePathOccupied)
      }
    } else {
      const byBranch = await findRegisteredWorktreeByBranch(config, gitRoot.root, branch)
      if (byBranch !== null) {
        if (await directoryExists(byBranch.path)) {
          // Reuse an existing worktree even when workspace metadata changed the
          // derived folder name (the branch is the stable identity).
          return {
            enabled: true,
            exists: true,
            registered: true,
            path: byBranch.path,
            branch: byBranch.branch || branch,
            base: await currentBranch(gitRoot.root),
          }
        }
        await dropMissingWorktree(gitRoot, byBranch, byBranch.path)
        if (await findRegisteredWorktreeByBranch(config, gitRoot.root, branch) !== null) {
          throw apiError(400, 'worktree-path-occupied', messages.worktreePathOccupied)
        }
      }
    }
    const rawEntries = await gitWorktreeEntries(gitRoot.root)
    const outside = rawEntries === null ? null : (rawEntries.find(function (entry) {
      return entry.branch === branch
    }) || null)
    if (outside !== null) {
      throw apiError(400, 'worktree-outside-root',
        messages.worktreeOutsideRoot + ': ' + outside.path)
    }
    const rootReal = await resolvedWorktreeRoot(config)
    const target = path.join(rootReal, path.basename(targetPath))
    if (isPathInside(rootReal, target, false) === false) {
      throw apiError(400, 'bad-worktree-root', messages.worktreeRootInvalid)
    }
    if (await lstatMaybe(target) !== null) {
      throw apiError(400, 'worktree-path-occupied', messages.worktreePathOccupied)
    }
    const base = await currentBranch(gitRoot.root)
    const existingBranch = await runGit(gitRoot.root,
      ['rev-parse', '--verify', 'refs/heads/' + branch])
    const added = existingBranch.code === 0
      ? await runGit(gitRoot.root, ['worktree', 'add', target, branch])
      : await runGit(gitRoot.root, ['worktree', 'add', '-b', branch, target, 'HEAD'])
    if (added.code !== 0) {
      const detail = errorSummary(added)
      throw apiError(500, 'worktree-create-failed',
        messages.worktreeCreateFailed + (detail.length > 0 ? ': ' + detail : ''))
    }
    const entry = await findRegisteredWorktree(gitRoot.root, target)
    if (entry === null) {
      throw apiError(500, 'worktree-create-failed', messages.worktreeCreateFailed)
    }
    return {
      enabled: true,
      exists: true,
      path: targetPath,
      branch: entry.branch || branch,
      base,
    }
  })
}

/** Remove the worktree, keeping its branch. Refuses when the worktree is dirty. */
export async function removeRequirementWorktree(config, workspace, requirement) {
  const targetPath = worktreeTargetPath(config, workspace, requirement)
  const branch = worktreeBranchFor(requirement)
  return withKeyLock('requirement-worktree:' + targetPath, async function () {
    let gitRoot
    try {
      gitRoot = await assertGitRoot(workspace && typeof workspace.path === 'string'
        ? workspace.path
        : '')
    } catch {
      throw apiError(404, 'worktree-not-found', messages.worktreeNotFound)
    }
    const entry = await findRegisteredWorktree(gitRoot.root, targetPath) ||
      await findRegisteredWorktreeByBranch(config, gitRoot.root, branch)
    if (entry === null) {
      throw apiError(404, 'worktree-not-found', messages.worktreeNotFound)
    }
    const actualPath = await samePath(entry.path, targetPath) ? targetPath : entry.path
    if (await directoryExists(entry.path) === false) {
      return Object.assign(
        await dropMissingWorktree(gitRoot, entry, targetPath),
        { path: actualPath }
      )
    }
    const status = await runGit(entry.path, ['status', '--porcelain'])
    if (status.code !== 0) {
      // The directory may have vanished between the checks; prune the stale
      // registration instead of leaving an unusable entry behind.
      if (await directoryExists(entry.path) === false) {
        return Object.assign(
          await dropMissingWorktree(gitRoot, entry, targetPath),
          { path: actualPath }
        )
      }
      throw apiError(404, 'worktree-not-found', messages.worktreeNotFound)
    }
    if (status.stdout.trim().length > 0) {
      throw apiError(409, 'worktree-dirty', messages.worktreeDirty)
    }
    const removed = await runGit(gitRoot.root, ['worktree', 'remove', entry.path])
    if (removed.code !== 0) {
      const detail = errorSummary(removed)
      throw apiError(500, 'worktree-remove-failed',
        messages.worktreeRemoveFailed + (detail.length > 0 ? ': ' + detail : ''))
    }
    return { removed: true, pruned: false, branch: entry.branch || branch, path: actualPath }
  })
}

/** All plugin-created worktrees across registered workspaces (guards worktreeRoot changes). */
export async function listExistingPluginWorktrees(ctx, config) {
  const workspaces = ctx && ctx.workspaceRegistry && typeof ctx.workspaceRegistry.list === 'function'
    ? ctx.workspaceRegistry.list()
    : []
  const result = []
  for (const workspace of workspaces) {
    try {
      const entries = await pluginWorktreeEntries(config, workspace)
      for (const entry of entries) result.push(entry)
    } catch {
      // Unreadable or non-git workspaces cannot own plugin worktrees.
    }
  }
  return result
}

/** Open the worktree directory in the OS file manager. */
export async function revealRequirementWorktree(config, workspace, requirement) {
  const description = await describeRequirementWorktree(config, workspace, requirement)
  if (description.exists === false) {
    throw apiError(404, 'worktree-not-found', messages.worktreeNotFound)
  }
  try {
    await fsp.access(description.path)
  } catch {
    throw apiError(404, 'worktree-not-found', messages.worktreeNotFound)
  }
  try {
    await openInSystem(description.path, false)
  } catch {
    throw apiError(500, 'worktree-reveal-failed', messages.worktreeRevealFailed)
  }
  return { opened: true, path: description.path }
}
