/** Requirement store. Atomic IDs, atomic document writes, and workspace-scoped lookup. */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile, atomicWriteJson, withFileLock, withWorkspaceLock } from '../shared/atomic.js'
import {
  DELETED_REQUIREMENTS_FILE,
  MAX_BODY_BYTES,
  META_DIR,
  REQUIREMENT_FILE,
  VALID_STATUS,
} from '../constants.js'
import { apiError } from '../errors.js'
import { defaultRequirementBody } from '../prompts/defaults.js'
import { messages } from '../messages/index.js'
import {
  deriveTitle,
  parseRequirementText,
  serializeRequirementText,
} from './requirement-document.js'
import { isSafeRequirementId, lstatMaybe } from '../shared/path-safety.js'
import {
  ensureMetaDirectory,
  getWorkspaceEntry,
  readMapping,
  resolveWorkspaceFolder,
} from '../storage/workspaces.js'

/** Upper bound on commit associations stored per requirement document. */
export const MAX_REQUIREMENT_COMMITS = 100

const deletedRequirementsCorrupt = function () {
  return apiError(500, 'deleted-requirements-corrupt', messages.deletedRequirementsCorrupt)
}

function isCommitHash(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{4,64}$/.test(value)
}

/** Normalize the `commits` extra field into a deduplicated, lowercase list. */
export function normalizeCommitList(value) {
  const list = Array.isArray(value) ? value : []
  const result = []
  for (const item of list) {
    if (isCommitHash(item) === false) continue
    const hash = item.toLowerCase()
    if (result.includes(hash)) continue
    result.push(hash)
    if (result.length >= MAX_REQUIREMENT_COMMITS) break
  }
  return result
}

export function requirementCommitList(meta) {
  return normalizeCommitList(meta && meta.extra && meta.extra.commits)
}

/** Prefix-tolerant comparison: documents store fully resolved hashes. */
export function commitMatches(stored, target) {
  if (isCommitHash(stored) === false || isCommitHash(target) === false) return false
  const left = stored.toLowerCase()
  const right = target.toLowerCase()
  return left === right || left.startsWith(right) || right.startsWith(left)
}

async function deletedRequirementsFile(workspaceFolder) {
  const meta = await ensureMetaDirectory(path.dirname(workspaceFolder))
  return path.join(meta, DELETED_REQUIREMENTS_FILE)
}

async function readDeletedRequirements(workspaceFolder) {
  const file = await deletedRequirementsFile(workspaceFolder)
  const stat = await lstatMaybe(file)
  if (stat === null) return { version: 1, workspaces: Object.create(null) }
  if (stat.isSymbolicLink() || stat.isFile() === false) throw deletedRequirementsCorrupt()
  let data
  try {
    data = JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    throw deletedRequirementsCorrupt()
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data) ||
      data.version !== 1 || data.workspaces === null ||
      typeof data.workspaces !== 'object' || Array.isArray(data.workspaces)) {
    throw deletedRequirementsCorrupt()
  }
  const workspaces = Object.create(null)
  for (const workspaceId of Object.keys(data.workspaces)) {
    const ids = data.workspaces[workspaceId]
    if (Array.isArray(ids) === false) throw deletedRequirementsCorrupt()
    const valid = []
    for (const id of ids) {
      if (isSafeRequirementId(id) === false) throw deletedRequirementsCorrupt()
      if (valid.includes(id) === false) valid.push(id)
    }
    workspaces[workspaceId] = valid
  }
  return { version: 1, workspaces }
}

async function readDeletedRequirementIds(workspaceFolder, workspaceId) {
  const state = await readDeletedRequirements(workspaceFolder)
  const ids = state.workspaces[workspaceId]
  return new Set(Array.isArray(ids) ? ids : [])
}

async function markRequirementDeleted(workspaceFolder, workspaceId, requirementId) {
  const file = await deletedRequirementsFile(workspaceFolder)
  return withFileLock(file, async function () {
    const state = await readDeletedRequirements(workspaceFolder)
    const ids = new Set(Array.isArray(state.workspaces[workspaceId]) ? state.workspaces[workspaceId] : [])
    ids.add(requirementId)
    state.workspaces[workspaceId] = Array.from(ids).sort()
    await atomicWriteJson(file, state)
  })
}

export async function readRequirement(folderPath, workspaceId) {
  const folderStat = await lstatMaybe(folderPath)
  if (folderStat === null) return null
  if (folderStat.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  }
  if (folderStat.isDirectory() === false) return null
  const folderReal = await fsp.realpath(folderPath)
  const file = path.join(folderReal, REQUIREMENT_FILE)
  const fileStat = await lstatMaybe(file)
  if (fileStat === null) return null
  if (fileStat.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  }
  if (fileStat.isFile() === false) return null
  if (fileStat.size > MAX_BODY_BYTES) {
    throw apiError(413, 'body-too-large', messages.bodyTooLarge)
  }
  const text = await fsp.readFile(file, 'utf8')
  const parsed = parseRequirementText(text)
  const meta = parsed.meta
  meta.id = meta.id || path.basename(folderReal)
  meta.workspace = meta.workspace || workspaceId || ''
  if (meta.title.length === 0) meta.title = deriveTitle(parsed.body, meta.id)
  if (meta.createdAt.length === 0) meta.createdAt = fileStat.birthtime.toISOString()
  if (meta.updatedAt.length === 0) meta.updatedAt = fileStat.mtime.toISOString()
  if (VALID_STATUS.includes(meta.status) === false) meta.status = 'new'
  return { meta, body: parsed.body, file, folderPath: folderReal, workspaceId: workspaceId || meta.workspace }
}

export function toSummary(meta, folderPath, workspaceId) {
  return {
    id: meta.id,
    title: meta.title,
    status: meta.status,
    workspaceId,
    folder: folderPath,
    path: path.join(folderPath, REQUIREMENT_FILE),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    sessions: meta.sessions.slice(),
    commits: requirementCommitList(meta),
    worktree: Boolean(meta.extra && meta.extra.worktree === true),
    favorite: Boolean(meta.extra && meta.extra.favorite === true),
  }
}

/**
 * 读取一个工作区需求目录下的全部可见需求文档，返回 `{ summary, body }` 列表，
 * 按 updatedAt 倒序。
 *
 * 删除标记、点目录与元数据目录的过滤规则与 scanRequirements 完全一致；
 * 需要正文的调用方（全文检索片段、提示词渲染）复用这里的单次读盘结果。
 */
export async function scanRequirementRecords(folderPath, workspaceId) {
  const folderStat = await lstatMaybe(folderPath)
  if (folderStat === null) return []
  if (folderStat.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  }
  if (folderStat.isDirectory() === false) return []
  const folderReal = await fsp.realpath(folderPath)
  let entries
  try {
    entries = await fsp.readdir(folderReal, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  const deletedIds = await readDeletedRequirementIds(folderReal, workspaceId)
  const result = []
  for (const entry of entries) {
    if (entry.isDirectory() === false) continue
    if (entry.name === META_DIR || entry.name.startsWith('.')) continue
    if (deletedIds.has(entry.name)) continue
    const requirement = await readRequirement(path.join(folderReal, entry.name), workspaceId)
    if (requirement !== null && deletedIds.has(requirement.meta.id) === false) {
      result.push({
        summary: toSummary(requirement.meta, requirement.folderPath, workspaceId),
        body: requirement.body,
      })
    }
  }
  result.sort(function (left, right) {
    return String(right.summary.updatedAt).localeCompare(String(left.summary.updatedAt))
  })
  return result
}

export async function scanRequirements(folderPath, workspaceId) {
  const records = await scanRequirementRecords(folderPath, workspaceId)
  return records.map(function (record) { return record.summary })
}

export async function findRequirementInWorkspace(root, workspaceId, requirementId, mapping: any = undefined) {
  if (isSafeRequirementId(requirementId) === false) return null
  const current = mapping === null || mapping === undefined ? await readMapping(root) : mapping
  const entry = getWorkspaceEntry(current, workspaceId)
  if (entry === null) return null
  const folderPath = await resolveWorkspaceFolder(root, entry.folder, { mustExist: false })
  const deletedIds = await readDeletedRequirementIds(folderPath, workspaceId)
  if (deletedIds.has(requirementId)) return null
  const direct = await readRequirement(path.join(folderPath, requirementId), workspaceId)
  if (direct !== null && direct.meta.id === requirementId) {
    direct.workspaceId = workspaceId
    return direct
  }
  const summaries = await scanRequirements(folderPath, workspaceId)
  const hit = summaries.find(function (item) { return item.id === requirementId })
  if (hit) {
    const found = await readRequirement(hit.folder, workspaceId)
    if (found !== null) {
      found.workspaceId = workspaceId
      return found
    }
  }
  return null
}

export async function findRequirementCandidates(root, requirementId) {
  if (isSafeRequirementId(requirementId) === false) return []
  const mapping = await readMapping(root)
  const result = []
  for (const workspaceId of Object.keys(mapping)) {
    const found = await findRequirementInWorkspace(root, workspaceId, requirementId, mapping)
    if (found !== null) result.push(found)
  }
  return result
}

export async function findRequirementAnywhere(root, requirementId, workspaceId) {
  if (typeof workspaceId === 'string' && workspaceId.length > 0) {
    return findRequirementInWorkspace(root, workspaceId, requirementId)
  }
  const candidates = await findRequirementCandidates(root, requirementId)
  if (candidates.length === 0) return null
  if (candidates.length > 1) {
    throw apiError(409, 'ambiguous-requirement', messages.ambiguousRequirement || 'ambiguous requirement id')
  }
  return candidates[0]
}

/**
 * Persist a requirement patch.
 *
 * `options.touch !== false` refreshes `updatedAt`; favorite toggles pass
 * `touch: false` so bookmarking a requirement does not reorder it by "last
 * modified".
 */
async function persistRequirement(requirement, patch, options: any = {}) {
  const meta = Object.assign({}, requirement.meta, patch.meta || {})
  const body = patch.body === undefined ? requirement.body : String(patch.body)
  if (options.touch !== false) meta.updatedAt = new Date().toISOString()
  const text = serializeRequirementText(meta, body)
  await atomicWriteFile(requirement.file, text)
  return {
    meta,
    body,
    file: requirement.file,
    folderPath: requirement.folderPath,
    workspaceId: requirement.workspaceId,
  }
}

export function updateRequirement(requirement, updater, options: any = {}) {
  const file = requirement.file
  return withFileLock(file, async function () {
    const latest = await readRequirement(requirement.folderPath, requirement.workspaceId)
    if (latest === null) {
      throw apiError(404, 'requirement-not-found', messages.requirementNotFound)
    }
    const deletedIds = await readDeletedRequirementIds(path.dirname(latest.folderPath), requirement.workspaceId)
    if (deletedIds.has(latest.meta.id)) {
      throw apiError(404, 'requirement-not-found', messages.requirementNotFound)
    }
    const expectedUpdatedAt = options && typeof options.expectedUpdatedAt === 'string'
      ? options.expectedUpdatedAt
      : ''
    if (expectedUpdatedAt.length > 0 && options.force !== true &&
        latest.meta.updatedAt !== expectedUpdatedAt) {
      throw apiError(409, 'requirement-conflict', messages.requirementConflict)
    }
    const patch = await updater(latest)
    return persistRequirement(latest, patch, { touch: options.touch !== false })
  })
}

export async function saveRequirement(requirement, patch) {
  return updateRequirement(requirement, function () { return patch })
}

/**
 * Toggle the requirement bookmark (`extra.favorite`) without touching
 * `updatedAt`, so favorites do not reorder the list by "last modified".
 */
export function setRequirementFavorite(requirement, favorite) {
  if (typeof favorite !== 'boolean') {
    throw apiError(400, 'bad-field', messages.invalidField + ': favorite')
  }
  return updateRequirement(requirement, function (latest) {
    const extra = Object.assign({}, latest.meta.extra)
    if (favorite === true) extra.favorite = true
    else delete extra.favorite
    return { meta: { extra } }
  }, { touch: false })
}

export function createRequirement(root, workspace, folderInfo, title, body, options: any = {}) {
  const folderPath = folderInfo.folderPath
  return withWorkspaceLock(folderPath, async function () {
    const folderReal = await resolveWorkspaceFolder(root, folderInfo.folder, { mustExist: true })
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const datePart = String(year) + month + day
    let entries = []
    try {
      entries = await fsp.readdir(folderReal)
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error
    }
    const pattern = new RegExp('^REQ-' + datePart + '-(\\d+)$')
    let sequence = 0
    for (const name of entries) {
      const match = pattern.exec(name)
      if (match !== null) sequence = Math.max(sequence, Number(match[1]))
    }
    while (true) {
      sequence += 1
      const id = 'REQ-' + datePart + '-' + String(sequence).padStart(3, '0')
      const requirementFolder = path.join(folderReal, id)
      try {
        await fsp.mkdir(requirementFolder)
      } catch (error) {
        if (error && error.code === 'EEXIST') continue
        throw error
      }
      try {
        const text = typeof body === 'string' && body.trim().length > 0
          ? body
          : defaultRequirementBody(title)
        const meta = {
          id,
          title,
          status: 'new',
          workspace: workspace.id,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          sessions: [],
          extra: options.worktree === true ? { worktree: true } : {},
        }
        const requirement = {
          meta,
          body: text,
          file: path.join(requirementFolder, REQUIREMENT_FILE),
          folderPath: requirementFolder,
          workspaceId: workspace.id,
        }
        const saved = await persistRequirement(requirement, { body: text })
        return { requirement: saved, body: saved.body }
      } catch (error) {
        await fsp.rm(requirementFolder, { recursive: true, force: true }).catch(function () {})
        throw error
      }
    }
  })
}

export async function deleteRequirement(root, requirement, mappingInput) {
  const mapping = mappingInput === undefined ? await readMapping(root) : mappingInput
  const entry = getWorkspaceEntry(mapping, requirement.workspaceId)
  if (entry === null) {
    throw apiError(400, 'unsafe-delete', messages.unsafeWorkspaceParent)
  }
  const workspaceFolder = await resolveWorkspaceFolder(root, entry.folder, { mustExist: true })
  return withFileLock(requirement.file, async function () {
    const latest = await readRequirement(requirement.folderPath, requirement.workspaceId)
    if (latest === null) {
      throw apiError(404, 'requirement-not-found', messages.requirementNotFound)
    }
    if (latest.meta.status === 'running') {
      throw apiError(409, 'requirement-running', messages.requirementRunning)
    }
    const deletedIds = await readDeletedRequirementIds(workspaceFolder, latest.workspaceId)
    if (deletedIds.has(latest.meta.id)) {
      throw apiError(404, 'requirement-not-found', messages.requirementNotFound)
    }
    const folderStat = await lstatMaybe(latest.folderPath)
    if (folderStat === null || folderStat.isSymbolicLink() || folderStat.isDirectory() === false) {
      throw apiError(400, 'unsafe-delete', messages.unsafeWorkspaceParent)
    }
    const folderReal = await fsp.realpath(latest.folderPath)
    if (path.dirname(folderReal) !== workspaceFolder) {
      throw apiError(400, 'unsafe-delete', messages.unsafeWorkspaceParent)
    }
    const document = path.join(folderReal, REQUIREMENT_FILE)
    const documentStat = await lstatMaybe(document)
    if (documentStat === null || documentStat.isSymbolicLink() || documentStat.isFile() === false) {
      throw apiError(400, 'unsafe-delete', messages.unsafeMissingDocument)
    }
    await markRequirementDeleted(workspaceFolder, latest.workspaceId, latest.meta.id)
    return {
      deleted: true,
      filesPreserved: true,
      id: latest.meta.id,
      folder: folderReal,
    }
  })
}

/** Requirement summaries in one workspace whose `commits` list matches the hash. */
export async function findRequirementsForCommit(root, workspaceId, commitHash, mappingInput: any = undefined) {
  if (typeof root !== 'string' || root.length === 0) return []
  if (isCommitHash(commitHash) === false) return []
  const mapping = mappingInput === undefined ? await readMapping(root) : mappingInput
  const entry = getWorkspaceEntry(mapping, workspaceId)
  if (entry === null) return []
  const folderPath = await resolveWorkspaceFolder(root, entry.folder, { mustExist: false })
  const summaries = await scanRequirements(folderPath, workspaceId)
  return summaries.filter(function (item) {
    return (item.commits || []).some(function (stored) { return commitMatches(stored, commitHash) })
  })
}

function setCommitList(meta, commits) {
  const extra = Object.assign({}, meta.extra)
  if (commits.length > 0) extra.commits = commits
  else delete extra.commits
  return extra
}

/** Add one resolved commit hash to a requirement document. */
export function addRequirementCommit(requirement, commitHash) {
  if (isCommitHash(commitHash) === false) {
    throw apiError(400, 'bad-commit', messages.projectCommitNotFound)
  }
  const hash = commitHash.toLowerCase()
  return updateRequirement(requirement, function (latest) {
    const commits = normalizeCommitList(requirementCommitList(latest.meta).concat([hash]))
    return { meta: { extra: setCommitList(latest.meta, commits) } }
  })
}

/** Remove a stored commit association by full hash or unique prefix. */
export function removeRequirementCommit(requirement, commitValue) {
  if (isCommitHash(commitValue) === false) {
    throw apiError(400, 'bad-commit', messages.projectCommitNotFound)
  }
  return updateRequirement(requirement, function (latest) {
    const commits = requirementCommitList(latest.meta).filter(function (stored) {
      return commitMatches(stored, commitValue) === false
    })
    return { meta: { extra: setCommitList(latest.meta, commits) } }
  })
}

/** Append one review session to every requirement associated with a commit. */
export async function linkSessionToCommitRequirements(root, workspaceId, commitHash, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return []
  const summaries = await findRequirementsForCommit(root, workspaceId, commitHash)
  if (summaries.length === 0) return []
  const mapping = await readMapping(root)
  const linked = []
  for (const summary of summaries) {
    const found = await findRequirementInWorkspace(root, workspaceId, summary.id, mapping)
    if (found === null) continue
    if (found.meta.sessions.includes(sessionId) === false) {
      await updateRequirement(found, function (latest) {
        const sessions = latest.meta.sessions.includes(sessionId)
          ? latest.meta.sessions
          : latest.meta.sessions.concat([sessionId])
        return { meta: { sessions: sessions } }
      })
    }
    linked.push(summary.id)
  }
  return linked
}

export async function findLinkedRequirement(root, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null
  const mapping = await readMapping(root)
  for (const workspaceId of Object.keys(mapping)) {
    const entry = getWorkspaceEntry(mapping, workspaceId)
    if (entry === null) continue
    const folderPath = await resolveWorkspaceFolder(root, entry.folder, { mustExist: false })
    const summaries = await scanRequirements(folderPath, workspaceId)
    const hit = summaries.find(function (item) { return item.sessions.includes(sessionId) })
    if (hit) return findRequirementInWorkspace(root, workspaceId, hit.id, mapping)
  }
  return null
}
