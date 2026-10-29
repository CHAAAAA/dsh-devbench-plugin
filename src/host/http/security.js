/** Browser trust boundary: plugin header plus exact loopback Host/Origin checks. */
import { isIP } from 'node:net'
import { REQUEST_HEADER } from '../constants.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'

export function isLoopbackHostname(value) {
  if (typeof value !== 'string') return false
  let host = value.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host === 'localhost') return true
  const family = isIP(host)
  if (family === 4) {
    const first = Number(host.split('.')[0])
    return first === 127
  }
  if (family === 6) return host === '::1'
  return false
}

function parseAuthority(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  let parsed
  try {
    parsed = new URL('http://' + value)
  } catch {
    return null
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) return null
  if (parsed.pathname !== '/' || parsed.search.length > 0 || parsed.hash.length > 0) return null
  return parsed
}

export function assertTrusted(req) {
  if (req.headers[REQUEST_HEADER] !== '1') {
    throw apiError(403, 'forbidden', messages.forbiddenHeader)
  }
  const hostHeader = req.headers.host
  const hostUrl = parseAuthority(hostHeader)
  if (hostUrl === null) {
    throw apiError(403, 'forbidden', messages.forbiddenHostHeader)
  }
  if (isLoopbackHostname(hostUrl.hostname) === false) {
    throw apiError(403, 'forbidden', messages.forbiddenHost)
  }
  const origin = req.headers.origin
  if (origin !== undefined) {
    if (typeof origin !== 'string' || origin.length === 0) {
      throw apiError(403, 'forbidden', messages.forbiddenOrigin)
    }
    let originUrl
    try {
      originUrl = new URL(origin)
    } catch {
      throw apiError(403, 'forbidden', messages.forbiddenOrigin)
    }
    if (isLoopbackHostname(originUrl.hostname) === false || originUrl.host !== hostUrl.host) {
      throw apiError(403, 'forbidden', messages.forbiddenOrigin)
    }
  }
  return { host: hostUrl.host, origin: origin || '' }
}
