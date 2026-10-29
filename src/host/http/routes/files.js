/** Attachment file API routes. */
import { MAX_FILE_TEXT_BYTES } from '../../constants.js'
import { requireRoot } from '../../storage/config.js'
import {
  createEntry,
  deleteEntry,
  inspectPath,
  listTree,
  readFileContent,
  writeFileContent,
} from '../../domain/files.js'
import { openInSystem } from '../../platform/open.js'
import { messages } from '../../messages/index.js'
import { readStringField } from '../body.js'
import { requireRequirement } from './common.js'

export const fileRoutes = []

function queryValue(url, name) {
  return url.searchParams.get(name) || ''
}

function bodyIdentity(body) {
  return {
    workspaceId: readStringField(body, 'workspaceId', { required: true }),
    id: readStringField(body, 'id', { required: true }),
  }
}

fileRoutes.push({
  method: 'GET',
  path: '/files',
  async handle(context) {
    const root = requireRoot(context.config)
    const workspaceId = queryValue(context.url, 'workspaceId')
    const id = queryValue(context.url, 'id')
    const found = await requireRequirement(root, workspaceId, id)
    const relative = queryValue(context.url, 'path')
    if (relative === '') {
      return { kind: 'dir', entries: await listTree(found.folderPath) }
    }
    const info = await inspectPath(found.folderPath, relative)
    if (info.stat.isDirectory()) {
      return { kind: 'dir', entries: await listTree(found.folderPath, relative) }
    }
    return { kind: 'file', ...(await readFileContent(found.folderPath, relative)) }
  },
})

fileRoutes.push({
  method: 'POST',
  path: '/files/write',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = bodyIdentity(body)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    const relative = readStringField(body, 'path', {
      required: true,
      missingCode: 'bad-path',
      missingMessage: messages.missingPath,
      maxLength: 4096,
    })
    const content = readStringField(body, 'content', { allowEmpty: true, maxLength: MAX_FILE_TEXT_BYTES })
    await writeFileContent(found.folderPath, relative, content)
    return { saved: true }
  },
})

fileRoutes.push({
  method: 'POST',
  path: '/files/create',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = bodyIdentity(body)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    const relative = readStringField(body, 'path', {
      required: true,
      missingCode: 'bad-path',
      missingMessage: messages.missingPath,
      maxLength: 4096,
    })
    const requestedType = readStringField(body, 'type', {
      allowEmpty: true,
      defaultValue: 'file',
    })
    const type = requestedType.length === 0 ? 'file' : requestedType
    const content = readStringField(body, 'content', { allowEmpty: true, maxLength: MAX_FILE_TEXT_BYTES })
    await createEntry(found.folderPath, relative, type, content)
    return { created: true }
  },
})

fileRoutes.push({
  method: 'POST',
  path: '/files/delete',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = bodyIdentity(body)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    const relative = readStringField(body, 'path', {
      required: true,
      missingCode: 'bad-path',
      missingMessage: messages.missingPath,
      maxLength: 4096,
    })
    await deleteEntry(found.folderPath, relative)
    return { deleted: true }
  },
})

fileRoutes.push({
  method: 'POST',
  path: '/files/open',
  async handle(context) {
    const root = requireRoot(context.config)
    const body = await context.readBody()
    const identity = bodyIdentity(body)
    const found = await requireRequirement(root, identity.workspaceId, identity.id)
    const relative = readStringField(body, 'path', { allowEmpty: true, defaultValue: '' })
    const info = await inspectPath(found.folderPath, relative)
    return openInSystem(info.target, Boolean(body.reveal))
  },
})
