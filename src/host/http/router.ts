/** JSON response envelope, route dispatch, and error mapping. */
import { API_BASE } from '../constants.js'
import { ApiError, errorMessage } from '../errors.js'
import { messages } from '../messages/index.js'
import { readConfig } from '../storage/config.js'
import { readJsonBody } from './body.js'
import { assertTrusted } from './security.js'
import { routes } from './routes/index.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HostContext } from '../context.js'

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function findRoute(method, route) {
  return routes.find(function (entry) {
    return entry.method === method && entry.path === route
  }) || null
}

export async function handleHttp(ctx: HostContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    assertTrusted(req)
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname.startsWith(API_BASE) === false) {
      sendJson(res, 404, { ok: false, error: { code: 'not-found', message: 'not found' } })
      return
    }
    const routePath = url.pathname.slice(API_BASE.length) || '/'
    const method = req.method || 'GET'
    const route = findRoute(method, routePath)
    if (route === null) {
      sendJson(res, 404, { ok: false, error: { code: 'unknown-route', message: 'unknown route' } })
      return
    }
    const config = await readConfig()
    let bodyPromise: Promise<Record<string, unknown>> | undefined
    function readBody(): Promise<Record<string, unknown>> {
      if (bodyPromise === undefined) bodyPromise = readJsonBody(req)
      return bodyPromise
    }
    const payload = await route.handle({ ctx, config, req, url, readBody })
    sendJson(res, 200, { ok: true, value: payload })
  } catch (error) {
    const isApi = error instanceof ApiError
    const status = isApi ? error.status : 500
    const code = isApi ? error.code : 'internal'
    if (isApi === false) ctx.logger?.warn?.('devbench-manager: ' + errorMessage(error))
    const message = isApi ? error.message : (messages.internalError || 'internal server error')
    if (res.headersSent === true) {
      res.end()
    } else {
      sendJson(res, status, { ok: false, error: { code, message } })
    }
  }
}
