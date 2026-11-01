/**
 * Project document store.
 *
 * Documents live outside the project directory, under the requirement root:
 * `<workspaceFolder>/.documents/<docId>.md`. Each file is Markdown with a
 * frontmatter header (id/title/createdAt/updatedAt) followed by a blank line and
 * the body. Writes are atomic and serialized through the shared keyed locks.
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  atomicWriteFile,
  mkdirIfMissing,
  withFileLock,
  withWorkspaceLock,
} from '../shared/atomic.js'
import {
  DOCUMENTS_DIR,
  MAX_FILE_TEXT_BYTES,
  MAX_TITLE_LENGTH,
} from '../constants.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import {
  isPathInside,
  isSafeDocumentId,
  lstatMaybe,
} from '../shared/path-safety.js'
import { parseRequirementText } from './requirement-document.js'

/** Extra file bytes tolerated for the frontmatter header beyond the body limit. */
const DOCUMENT_HEADER_ALLOWANCE = 8 * 1024
const MAX_DOCUMENT_FILE_BYTES = MAX_FILE_TEXT_BYTES + DOCUMENT_HEADER_ALLOWANCE

function documentNotFound() {
  return apiError(404, 'document-not-found', messages.documentNotFound)
}

function documentConflict() {
  return apiError(409, 'document-conflict', messages.documentConflict)
}

function badDocumentId() {
  return apiError(400, 'bad-document-id', messages.badDocumentId)
}

function documentsCorrupt() {
  return apiError(500, 'documents-corrupt', messages.documentsCorrupt)
}

function documentsDirectoryInvalid() {
  return apiError(500, 'documents-directory-invalid', messages.documentsDirectoryInvalid)
}

function assertDocumentId(id) {
  if (isSafeDocumentId(id) === false) throw badDocumentId()
  return id
}

function normalizeTitle(title) {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw apiError(400, 'missing-title', messages.missingTitle)
  }
  const text = title.trim()
  if (text.length > MAX_TITLE_LENGTH) {
    throw apiError(400, 'bad-field', messages.invalidField + ': title')
  }
  return text
}

function normalizeBody(body) {
  if (typeof body !== 'string') throw apiError(400, 'bad-body', messages.badBody)
  if (Buffer.byteLength(body, 'utf8') > MAX_FILE_TEXT_BYTES) {
    throw apiError(413, 'document-too-large', messages.documentTooLarge)
  }
  return body
}

function localDatePart(date) {
  return String(date.getFullYear()) +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0')
}

export function toDocumentSummary(meta) {
  return {
    id: meta.id,
    title: meta.title,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  }
}

function serializeDocumentText(meta, body) {
  const lines = [
    '---',
    'id: ' + JSON.stringify(meta.id),
    'title: ' + JSON.stringify(meta.title),
    'createdAt: ' + JSON.stringify(meta.createdAt),
    'updatedAt: ' + JSON.stringify(meta.updatedAt),
    '---',
  ]
  const normalized = String(body || '').replace(/^\r?\n+/, '')
  const suffix = normalized.length > 0 && normalized.endsWith('\n') === false ? '\n' : ''
  return lines.join('\n') + '\n\n' + normalized + suffix
}

/** Parse a document file, rejecting files whose frontmatter does not match. */
function parseDocumentText(text, id) {
  const parsed = parseRequirementText(text)
  const meta = parsed.meta
  if (meta.id !== id) throw documentsCorrupt()
  if (typeof meta.title !== 'string' || meta.title.length === 0) throw documentsCorrupt()
  if (typeof meta.createdAt !== 'string' || meta.createdAt.length === 0) throw documentsCorrupt()
  if (typeof meta.updatedAt !== 'string' || meta.updatedAt.length === 0) throw documentsCorrupt()
  return { meta, body: parsed.body }
}

/**
 * Resolve `<workspaceFolder>/.documents`, verifying the directory is a real
 * directory inside the workspace folder and is not a symlink.
 *
 * @returns {Promise<{ folder: string|null, directory: string|null }>}
 */
async function resolveDocumentsDirectory(workspaceFolder, create) {
  if (typeof workspaceFolder !== 'string' || workspaceFolder.length === 0) {
    if (create === true) throw apiError(404, 'workspace-not-found', messages.workspaceNotFound)
    return { folder: null, directory: null }
  }
  const folderStat = await lstatMaybe(workspaceFolder)
  if (folderStat === null) {
    if (create === true) throw apiError(404, 'workspace-not-found', messages.workspaceNotFound)
    return { folder: null, directory: null }
  }
  if (folderStat.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  }
  if (folderStat.isDirectory() === false) {
    throw apiError(500, 'mapping-corrupt', messages.mappingCorrupt)
  }
  const folder = await fsp.realpath(workspaceFolder)
  const target = path.join(folder, DOCUMENTS_DIR)
  let stat = await lstatMaybe(target)
  if (stat === null && create === true) {
    await mkdirIfMissing(target)
    stat = await fsp.lstat(target)
  }
  if (stat === null) return { folder, directory: null }
  if (stat.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  }
  if (stat.isDirectory() === false) throw documentsDirectoryInvalid()
  const directory = await fsp.realpath(target)
  if (isPathInside(folder, directory, false) === false) throw documentsDirectoryInvalid()
  return { folder, directory }
}

async function readDocumentAt(resolved, id) {
  if (resolved.directory === null) throw documentNotFound()
  const file = path.join(resolved.directory, id + '.md')
  const stat = await lstatMaybe(file)
  if (stat === null) throw documentNotFound()
  if (stat.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  }
  if (stat.isFile() === false) throw documentNotFound()
  if (stat.size > MAX_DOCUMENT_FILE_BYTES) {
    throw apiError(413, 'document-too-large', messages.documentTooLarge)
  }
  const real = await fsp.realpath(file)
  if (path.dirname(real) !== resolved.directory) throw documentNotFound()
  const parsed = parseDocumentText(await fsp.readFile(real, 'utf8'), id)
  return {
    meta: parsed.meta,
    body: parsed.body,
    file: real,
    folderPath: resolved.folder,
  }
}

/** All readable documents with bodies, sorted by updatedAt descending. */
export async function scanDocumentRecords(workspaceFolder) {
  const resolved = await resolveDocumentsDirectory(workspaceFolder, false)
  if (resolved.directory === null) return []
  let entries
  try {
    entries = await fsp.readdir(resolved.directory, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  const records = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name.endsWith('.md') === false) continue
    if (entry.isSymbolicLink()) {
      throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
    }
    if (entry.isFile() === false) continue
    const id = entry.name.slice(0, -3)
    if (isSafeDocumentId(id) === false) continue
    const document = await readDocumentAt(resolved, id)
    records.push({ summary: toDocumentSummary(document.meta), body: document.body })
  }
  records.sort(function (left, right) {
    return String(right.summary.updatedAt).localeCompare(String(left.summary.updatedAt))
  })
  return records
}

/** All document summaries in one workspace, sorted by updatedAt descending. */
export async function scanDocumentSummaries(workspaceFolder) {
  const records = await scanDocumentRecords(workspaceFolder)
  return records.map(function (record) { return record.summary })
}

export async function readDocument(workspaceFolder, id) {
  assertDocumentId(id)
  const resolved = await resolveDocumentsDirectory(workspaceFolder, false)
  const document = await readDocumentAt(resolved, id)
  return { document: toDocumentSummary(document.meta), body: document.body }
}

export function createDocument(workspaceFolder, title, body) {
  const normalizedTitle = normalizeTitle(title)
  const normalizedBody = normalizeBody(body === undefined || body === null ? '' : body)
  const createdAt = new Date()
  return withWorkspaceLock(workspaceFolder, async function () {
    const resolved = await resolveDocumentsDirectory(workspaceFolder, true)
    const datePart = localDatePart(createdAt)
    const pattern = new RegExp('^DOC-' + datePart + '-(\\d+)\\.md$')
    let sequence = 0
    const entries = await fsp.readdir(resolved.directory)
    for (const name of entries) {
      const match = pattern.exec(name)
      if (match !== null) sequence = Math.max(sequence, Number(match[1]))
    }
    while (true) {
      sequence += 1
      const id = 'DOC-' + datePart + '-' + String(sequence).padStart(3, '0')
      const file = path.join(resolved.directory, id + '.md')
      const existing = await lstatMaybe(file)
      if (existing !== null) continue
      const meta = {
        id,
        title: normalizedTitle,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      }
      await atomicWriteFile(file, serializeDocumentText(meta, normalizedBody))
      return {
        document: toDocumentSummary(meta),
        body: normalizedBody,
        file,
        folderPath: resolved.folder,
      }
    }
  })
}

export async function saveDocument(workspaceFolder, id, patch, options: any = {}) {
  assertDocumentId(id)
  const input = patch || {}
  const hasTitle = Object.prototype.hasOwnProperty.call(input, 'title')
  const hasBody = Object.prototype.hasOwnProperty.call(input, 'body')
  const nextTitle = hasTitle ? normalizeTitle(input.title) : ''
  const nextBody = hasBody ? normalizeBody(input.body) : ''
  const resolved = await resolveDocumentsDirectory(workspaceFolder, false)
  if (resolved.directory === null) throw documentNotFound()
  const file = path.join(resolved.directory, id + '.md')
  return withFileLock(file, async function () {
    const latest = await readDocumentAt(resolved, id)
    const expectedUpdatedAt = typeof options.expectedUpdatedAt === 'string'
      ? options.expectedUpdatedAt
      : ''
    if (expectedUpdatedAt.length > 0 && options.force !== true &&
        latest.meta.updatedAt !== expectedUpdatedAt) {
      throw documentConflict()
    }
    const meta = {
      id,
      title: hasTitle ? nextTitle : latest.meta.title,
      createdAt: latest.meta.createdAt,
      updatedAt: new Date().toISOString(),
    }
    const body = hasBody ? nextBody : latest.body
    await atomicWriteFile(latest.file, serializeDocumentText(meta, body))
    return { document: toDocumentSummary(meta), body, file: latest.file, folderPath: latest.folderPath }
  })
}

export async function deleteDocument(workspaceFolder, id) {
  assertDocumentId(id)
  const resolved = await resolveDocumentsDirectory(workspaceFolder, false)
  if (resolved.directory === null) throw documentNotFound()
  const file = path.join(resolved.directory, id + '.md')
  return withFileLock(file, async function () {
    const stat = await lstatMaybe(file)
    if (stat === null) throw documentNotFound()
    if (stat.isSymbolicLink()) {
      throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
    }
    if (stat.isFile() === false) throw documentNotFound()
    const real = await fsp.realpath(file)
    if (path.dirname(real) !== resolved.directory) throw documentNotFound()
    await fsp.rm(real, { force: true })
    return { deleted: true, id }
  })
}
