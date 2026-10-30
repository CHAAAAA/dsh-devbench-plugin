/** MCP server management routes of the active DSH profile (REQ-20261029-002). */
import { apiError } from '../../errors.js'
import { messages } from '../../messages/index.js'
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  toggleMcpServer,
  updateMcpServer,
} from '../../services/mcp-servers.js'
import { isPlainObject } from '../../shared/path-safety.js'
import { readStringField } from '../body.js'

function requireServer(body) {
  if (isPlainObject(body.server) === false) throw apiError(400, 'mcp-bad-field', messages.invalidField)
  return body.server
}

export const mcpRoutes = [
  {
    method: 'GET',
    path: '/mcp',
    async handle(context) {
      return listMcpServers(context.ctx)
    },
  },
  {
    method: 'POST',
    path: '/mcp/save',
    async handle(context) {
      const body = await context.readBody()
      const mode = readStringField(body, 'mode', { required: true })
      if (mode === 'create') return createMcpServer(context.ctx, { server: requireServer(body) })
      if (mode === 'update') {
        const id = readStringField(body, 'id', { required: true })
        return updateMcpServer(context.ctx, { id, server: requireServer(body) })
      }
      throw apiError(400, 'mcp-bad-field', messages.invalidField + ': mode')
    },
  },
  {
    method: 'POST',
    path: '/mcp/delete',
    async handle(context) {
      const body = await context.readBody()
      return deleteMcpServer(context.ctx, { id: readStringField(body, 'id', { required: true }) })
    },
  },
  {
    method: 'POST',
    path: '/mcp/toggle',
    async handle(context) {
      const body = await context.readBody()
      const id = readStringField(body, 'id', { required: true })
      if (typeof body.enabled !== 'boolean') throw apiError(400, 'mcp-bad-field', messages.invalidField + ': enabled')
      return toggleMcpServer(context.ctx, { id, enabled: body.enabled })
    },
  },
]
