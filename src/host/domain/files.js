/** Attachment filesystem service. Handles symlinks, reserved document, and exclusive create. */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile } from '../shared/atomic.js'
import { MAX_FILE_TEXT_BYTES, META_DIR, REQUIREMENT_FILE } from '../constants.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import {
  ensureSafeDirectory,
  lstatMaybe,
  resolveInside,
  sameFileIdentity,
} from '../shared/path-safety.js'

function isProbablyText(buffer) {
  const nul = String.fromCharCode(0)
  return buffer.includes(nul) === false
}

async function assertNotReserved(folderPath, target, mode) {
  const document = path.join(folderPath, REQUIREMENT_FILE)
  const targetStat = await lstatMaybe(target)
  if (targetStat !== null && targetStat.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  }
  if (await sameFileIdentity(target, document)) {
    const code = mode === 'delete' ? 'reserved-file' : 'reserved-file'
    const text = mode === 'delete' ? messages.reservedDocumentDelete : messages.reservedDocumentWrite
    throw apiError(400, code, text)
  }
}

function normalizeRelative(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return text.split(path.sep).join('/')
}

function joinRelative(parent, name) {
  return parent.length === 0 ? name : path.posix.join(parent, name)
}

export async function listTree(folderPath, relative) {
  const input = relative === null || relative === undefined ? '' : String(relative)
  const target = await resolveInside(folderPath, input, { mustExist: true })
  const stat = await fsp.lstat(target)
  if (stat.isSymbolicLink()) throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  if (stat.isDirectory() === false) throw apiError(400, 'not-a-dir', messages.notADirectory)
  const entries = await fsp.readdir(target, { withFileTypes: true })
  const result = []
  const normalized = normalizeRelative(input)
  for (const entry of entries) {
    if (entry.name === META_DIR) continue
    const entryRelative = joinRelative(normalized, entry.name)
    if (entry.name === REQUIREMENT_FILE && normalized === '') {
      result.push({ name: entry.name, path: entryRelative, type: 'file', size: 0, isRequirementDoc: true })
      continue
    }
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      result.push({ name: entry.name, path: entryRelative, type: 'dir' })
    } else if (entry.isFile()) {
      const childStat = await fsp.lstat(path.join(target, entry.name))
      result.push({ name: entry.name, path: entryRelative, type: 'file', size: childStat.size })
    }
  }
  result.sort(function (left, right) {
    if (left.type === right.type) return left.name.localeCompare(right.name)
    return left.type === 'dir' ? -1 : 1
  })
  return result
}

export async function readFileContent(folderPath, relative) {
  const target = await resolveInside(folderPath, relative, { mustExist: true })
  const stat = await fsp.lstat(target)
  if (stat.isSymbolicLink()) throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  if (stat.isFile() === false) throw apiError(400, 'not-a-file', messages.notAFile)
  if (stat.size > MAX_FILE_TEXT_BYTES) {
    return { path: relative, size: stat.size, editable: false, binary: true }
  }
  const buffer = await fsp.readFile(target)
  if (isProbablyText(buffer) === false) {
    return { path: relative, size: stat.size, editable: false, binary: true }
  }
  return {
    path: relative,
    size: stat.size,
    editable: true,
    binary: false,
    content: buffer.toString('utf8'),
  }
}

export async function readTextFile(folderPath, relative) {
  const target = await resolveInside(folderPath, relative, { mustExist: true })
  const stat = await fsp.lstat(target)
  if (stat.isSymbolicLink()) throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  if (stat.isFile() === false) throw apiError(400, 'not-a-file', messages.notAFile)
  if (stat.size > MAX_FILE_TEXT_BYTES) {
    throw apiError(413, 'file-too-large', messages.toolFileTooLarge)
  }
  const buffer = await fsp.readFile(target)
  if (isProbablyText(buffer) === false) throw apiError(400, 'not-a-file', messages.notAFile)
  return buffer.toString('utf8')
}

export async function writeFileContent(folderPath, relative, content) {
  if (typeof content !== 'string') throw apiError(400, 'bad-body', messages.badBody)
  const input = String(relative || '')
  const target = await resolveInside(folderPath, input, { allowBase: false })
  await assertNotReserved(folderPath, target, 'write')
  const parentRelative = path.dirname(input)
  await ensureSafeDirectory(folderPath, parentRelative)
  const checked = await resolveInside(folderPath, input, { allowBase: false })
  await assertNotReserved(folderPath, checked, 'write')
  await atomicWriteFile(checked, content)
  return { saved: true }
}

export async function createEntry(folderPath, relative, type, content) {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw apiError(400, 'bad-path', messages.missingPath)
  }
  if (type !== 'file' && type !== 'dir') {
    throw apiError(400, 'bad-type', messages.invalidType)
  }
  if (type === 'file' && typeof content !== 'string') {
    throw apiError(400, 'bad-body', messages.badBody)
  }
  const target = await resolveInside(folderPath, relative, { allowBase: false })
  await assertNotReserved(folderPath, target, 'write')
  const existing = await lstatMaybe(target)
  if (existing !== null) throw apiError(409, 'file-exists', messages.fileExists)
  await ensureSafeDirectory(folderPath, path.dirname(relative))
  const checked = await resolveInside(folderPath, relative, { allowBase: false })
  if (type === 'dir') {
    try {
      await fsp.mkdir(checked)
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        throw apiError(409, 'file-exists', messages.fileExists)
      }
      throw error
    }
    return { created: true }
  }
  await createFileExclusive(checked, content)
  return { created: true }
}

async function createFileExclusive(target, content) {
  let handle = null
  let created = false
  try {
    handle = await fsp.open(target, 'wx')
    created = true
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw apiError(409, 'file-exists', messages.fileExists)
    }
    if (created) await fsp.rm(target, { force: true }).catch(function () {})
    throw error
  } finally {
    if (handle !== null) await handle.close().catch(function () {})
  }
}

export async function deleteEntry(folderPath, relative) {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw apiError(400, 'bad-path', messages.missingPath)
  }
  const target = await resolveInside(folderPath, relative, { allowBase: false })
  const stat = await lstatMaybe(target)
  if (stat === null) return { deleted: true }
  await assertNotReserved(folderPath, target, 'delete')
  if (stat.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  }
  await fsp.rm(target, { recursive: true, force: true })
  return { deleted: true }
}

export async function inspectPath(folderPath, relative) {
  const target = await resolveInside(folderPath, relative, { mustExist: true })
  const stat = await fsp.lstat(target)
  if (stat.isSymbolicLink()) throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  return { target, stat }
}
