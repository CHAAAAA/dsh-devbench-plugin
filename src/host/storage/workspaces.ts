/** Workspace mapping persistence and safe workspace folder resolution. */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile, atomicWriteJson, mkdirIfMissing, withRootLock } from '../shared/atomic.js'
import { LEGACY_DIR_NAME, MAPPING_FILE, META_DIR } from '../constants.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import {
  isPathInside,
  isPlainObject,
  isSafeFolderName,
  lstatMaybe,
  safeSlug,
} from '../shared/path-safety.js'

export function metaDir(root) {
  return path.join(root, META_DIR)
}

export function mappingPath(root) {
  return path.join(metaDir(root), MAPPING_FILE)
}

async function resolveMetaDirectory(root, create) {
  let rootReal
  try {
    rootReal = await fsp.realpath(root)
  } catch (error) {
    if (error && error.code === 'ENOENT' && create === false) return null
    if (error && error.code === 'ENOENT' && create === true) {
      await fsp.mkdir(root, { recursive: true })
      rootReal = await fsp.realpath(root)
    } else {
      throw error
    }
  }
  const meta = path.join(rootReal, META_DIR)
  let stat = await lstatMaybe(meta)
  if (stat === null) {
    const legacy = path.join(rootReal, LEGACY_DIR_NAME)
    const legacyStat = await lstatMaybe(legacy)
    if (legacyStat !== null) {
      if (legacyStat.isSymbolicLink() || legacyStat.isDirectory() === false) {
        throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
      }
      const legacyReal = await fsp.realpath(legacy)
      if (isPathInside(rootReal, legacyReal, false) === false) {
        throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
      }
      try {
        await fsp.rename(legacy, meta)
      } catch {
        throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
      }
      stat = await fsp.lstat(meta)
    }
  }
  if (stat === null && create === true) {
    await mkdirIfMissing(meta)
    stat = await fsp.lstat(meta)
  }
  if (stat === null) return null
  if (stat.isSymbolicLink() || stat.isDirectory() === false) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  const real = await fsp.realpath(meta)
  if (isPathInside(rootReal, real, false) === false) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  return real
}

export async function ensureMetaDirectory(root) {
  return resolveMetaDirectory(root, true)
}

function validateWorkspaces(value: Record<string, any>) {
  if (isPlainObject(value) === false) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  const seen = new Set()
  for (const [workspaceId, entry] of Object.entries(value)) {
    if (typeof workspaceId !== 'string' || isPlainObject(entry) === false) {
      throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
    }
    if (isSafeFolderName(entry.folder) === false) {
      throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
    }
    if (seen.has(entry.folder)) {
      throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
    }
    seen.add(entry.folder)
  }
  return value
}

export async function readMapping(root) {
  const meta = await resolveMetaDirectory(root, false)
  if (meta === null) return Object.create(null)
  const file = path.join(meta, MAPPING_FILE)
  const stat = await lstatMaybe(file)
  if (stat === null) return Object.create(null)
  if (stat.isSymbolicLink() || stat.isFile() === false) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  const text = await fsp.readFile(file, 'utf8')
  let data
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  if (isPlainObject(data) === false || isPlainObject(data.workspaces) === false) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  return Object.assign(Object.create(null), validateWorkspaces(data.workspaces))
}

export async function ensureGitignore(root) {
  const file = path.join(root, '.gitignore')
  const existing = await lstatMaybe(file)
  if (existing !== null && existing.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  }
  if (existing !== null && existing.isFile() === false) {
    throw apiError(400, 'bad-path', messages.badPath)
  }
  let text = ''
  if (existing !== null) text = await fsp.readFile(file, 'utf8')
  const marker = META_DIR + '/'
  const legacyMarker = LEGACY_DIR_NAME + '/'
  const lines = text.split(/\r?\n/)
  let migrated = false
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === legacyMarker) {
      lines[index] = marker
      migrated = true
    }
  }
  const merged = lines.join('\n')
  if (lines.includes(marker)) {
    if (migrated) await atomicWriteFile(file, merged + (text.endsWith('\n') ? '\n' : ''))
    return
  }
  const trimmed = merged.replace(/\s*$/, '')
  const prefix = trimmed.length > 0 ? trimmed + '\n' : ''
  await atomicWriteFile(file, prefix + marker + '\n')
}

export async function writeMapping(root, workspaces) {
  validateWorkspaces(workspaces)
  const meta = await resolveMetaDirectory(root, true)
  await atomicWriteJson(path.join(meta, MAPPING_FILE), { version: 1, workspaces })
  await ensureGitignore(root)
  return workspaces
}

function chooseFolder(mapping: Record<string, any>, workspace) {
  const title = workspace.title || path.basename(String(workspace.path || 'workspace'))
  const base = safeSlug(title)
  const suffix = safeSlug(String(workspace.id || 'workspace')).slice(0, 8)
  const first = base + '-' + suffix
  const used = new Set(Object.values(mapping).map(function (entry) { return entry.folder }))
  if (used.has(first) === false) return first
  let counter = 2
  while (used.has(first + '-' + counter)) counter += 1
  return first + '-' + counter
}

export async function resolveWorkspaceFolder(root, folder, options: any = {}) {
  if (isSafeFolderName(folder) === false) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  const rootReal = await fsp.realpath(root)
  const target = path.resolve(rootReal, folder)
  if (isPathInside(rootReal, target, false) === false) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  const stat = await lstatMaybe(target)
  if (stat === null) {
    if (options.mustExist) throw apiError(404, 'workspace-not-found', messages.workspaceNotFound)
    return target
  }
  if (stat.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  }
  if (stat.isDirectory() === false) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  const real = await fsp.realpath(target)
  if (isPathInside(rootReal, real, false) === false) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  return real
}

export async function ensureRootDirectory(root) {
  try {
    await fsp.mkdir(root, { recursive: true })
  } catch (error) {
    if (error && error.code === 'EEXIST') throw apiError(400, 'bad-root', messages.badRoot)
    throw error
  }
  const real = await fsp.realpath(root)
  const stat = await fsp.stat(real)
  if (stat.isDirectory() === false) throw apiError(400, 'bad-root', messages.badRoot)
  return real
}

async function ensureDirectory(rootReal, target) {
  let stat = await lstatMaybe(target)
  if (stat === null) {
    try {
      await fsp.mkdir(target)
    } catch (error) {
      if (error && error.code !== 'EEXIST') throw error
    }
    stat = await fsp.lstat(target)
  }
  if (stat.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  }
  if (stat.isDirectory() === false) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  const real = await fsp.realpath(target)
  if (isPathInside(rootReal, real, false) === false) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  return real
}

export async function ensureWorkspaceFolder(root, workspace) {
  const rootReal = await ensureRootDirectory(root)
  return withRootLock(rootReal, async function () {
    const mapping = await readMapping(rootReal)
    const hasExisting = Object.prototype.hasOwnProperty.call(mapping, workspace.id)
    const existing = hasExisting ? mapping[workspace.id] : null
    const folder = existing === null ? chooseFolder(mapping, workspace) : existing.folder
    const target = path.join(rootReal, folder)
    const folderPath = await ensureDirectory(rootReal, target)
    const title = workspace.title || ''
    const workspacePath = workspace.path || ''
    const changed = existing === null || existing.folder !== folder ||
      existing.title !== title || existing.path !== workspacePath
    if (changed) {
      mapping[workspace.id] = {
        folder,
        title,
        path: workspacePath,
        createdAt: existing && typeof existing.createdAt === 'string'
          ? existing.createdAt
          : new Date().toISOString(),
      }
      await ensureGitignore(rootReal)
      await writeMapping(rootReal, mapping)
    }
    return { folder, folderPath, mapping }
  })
}

export function getWorkspaceEntry(mapping, workspaceId) {
  if (Object.prototype.hasOwnProperty.call(mapping, workspaceId) === false) return null
  const entry = mapping[workspaceId]
  return isPlainObject(entry) && isSafeFolderName(entry.folder) ? entry : null
}
