/** Project document API routes (list, get, create, save, delete, search). */
import { MAX_TITLE_LENGTH } from '../../constants.js'
import { apiError } from '../../errors.js'
import { messages } from '../../messages/index.js'
import { requireRoot } from '../../storage/config.js'
import {
  ensureWorkspaceFolder,
  getWorkspaceEntry,
  readMapping,
  resolveWorkspaceFolder,
} from '../../storage/workspaces.js'
import {
  createDocument,
  deleteDocument,
  readDocument,
  saveDocument,
  scanDocumentSummaries,
} from '../../domain/documents.js'
import { normalizeSearchOptions } from '../../services/requirement-search.js'
import { searchWorkspaceDocuments } from '../../services/document-search.js'
import { isSafeDocumentId } from '../../shared/path-safety.js'
import { readStringField } from '../body.js'
import { findWorkspace } from './common.js'

export const documentRoutes = []

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function readBooleanField(body, key, required) {
  if (hasOwn(body, key) === false) {
    if (required === true) throw apiError(400, 'bad-field', messages.invalidField + ': ' + key)
    return undefined
  }
  if (typeof body[key] !== 'boolean') {
    throw apiError(400, 'bad-field', messages.invalidField + ': ' + key)
  }
  return body[key]
}

function readDocumentIdentity(body) {
  return {
    workspaceId: readStringField(body, 'workspaceId', { required: true }),
    id: readStringField(body, 'id', {
      required: true,
      missingCode: 'bad-document-id',
      missingMessage: messages.badDocumentId,
    }),
  }
}

function requireDocumentId(id) {
  if (isSafeDocumentId(id) === false) {
    throw apiError(400, 'bad-document-id', messages.badDocumentId)
  }
  return id
}

/** Resolve the workspace folder that owns the documents directory, or null. */
async function documentsFolder(root, workspaceId) {
  const mapping = await readMapping(root)
  const entry = getWorkspaceEntry(mapping, workspaceId)
  if (entry === null) return null
  return resolveWorkspaceFolder(root, entry.folder, { mustExist: false })
}

documentRoutes.push({
  method: 'GET',
  path: '/documents',
  async handle(context) {
    const root = requireRoot(context.config)
    const workspaceId = context.url.searchParams.get('workspaceId') || ''
    findWorkspace(context.ctx, workspaceId)
    const folder = await documentsFolder(root, workspaceId)
    const documents = folder === null ? [] : await scanDocumentSummaries(folder)
    return { documents }
  },
})

documentRoutes.push({
  method: 'POST',
  path: '/document/get',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readDocumentIdentity(body)
    findWorkspace(context.ctx, identity.workspaceId)
    const id = requireDocumentId(identity.id)
    const folder = await documentsFolder(root, identity.workspaceId)
    if (folder === null) throw apiError(404, 'document-not-found', messages.documentNotFound)
    const found = await readDocument(folder, id)
    return { document: found.document, body: found.body }
  },
})

documentRoutes.push({
  method: 'POST',
  path: '/document/create',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const workspaceId = readStringField(body, 'workspaceId', { required: true })
    const workspace = findWorkspace(context.ctx, workspaceId)
    const title = readStringField(body, 'title', {
      required: true,
      trim: true,
      maxLength: MAX_TITLE_LENGTH,
      missingCode: 'missing-title',
      missingMessage: messages.missingTitle,
    })
    const text = hasOwn(body, 'body') ? readStringField(body, 'body', { allowEmpty: true }) : ''
    const folderInfo = await ensureWorkspaceFolder(root, workspace)
    const created = await createDocument(folderInfo.folderPath, title, text)
    return { document: created.document }
  },
})

documentRoutes.push({
  method: 'POST',
  path: '/document/save',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readDocumentIdentity(body)
    findWorkspace(context.ctx, identity.workspaceId)
    const id = requireDocumentId(identity.id)
    const patch = {}
    if (hasOwn(body, 'title')) {
      patch.title = readStringField(body, 'title', {
        required: true,
        trim: true,
        maxLength: MAX_TITLE_LENGTH,
      })
    }
    if (hasOwn(body, 'body')) patch.body = readStringField(body, 'body', { allowEmpty: true })
    const hasExpectedUpdatedAt = hasOwn(body, 'expectedUpdatedAt') && body.expectedUpdatedAt !== null
    const expectedUpdatedAt = hasExpectedUpdatedAt
      ? readStringField(body, 'expectedUpdatedAt', { allowEmpty: true })
      : ''
    const force = readBooleanField(body, 'force', false) === true
    const folder = await documentsFolder(root, identity.workspaceId)
    if (folder === null) throw apiError(404, 'document-not-found', messages.documentNotFound)
    const saved = await saveDocument(folder, id, patch, { expectedUpdatedAt, force })
    return { document: saved.document }
  },
})

documentRoutes.push({
  method: 'POST',
  path: '/document/delete',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = readDocumentIdentity(body)
    findWorkspace(context.ctx, identity.workspaceId)
    const id = requireDocumentId(identity.id)
    const folder = await documentsFolder(root, identity.workspaceId)
    if (folder === null) throw apiError(404, 'document-not-found', messages.documentNotFound)
    return deleteDocument(folder, id)
  },
})

documentRoutes.push({
  method: 'GET',
  path: '/document/search',
  async handle(context) {
    const root = requireRoot(context.config)
    const workspaceId = context.url.searchParams.get('workspaceId') || ''
    findWorkspace(context.ctx, workspaceId)
    const params = context.url.searchParams
    // 路由层先校验查询参数（q 长度、scope 枚举、limit 范围），保证 HTTP 200/400
    // 判定在这里完成；服务层对直接调用方仍会做同一次归一化兜底。
    const options = normalizeSearchOptions({
      q: params.get('q'),
      scope: params.get('scope'),
      limit: params.get('limit'),
    })
    const folder = await documentsFolder(root, workspaceId)
    return searchWorkspaceDocuments(folder, {
      q: options.query,
      scope: options.scope,
      limit: options.limit,
    })
  },
})
