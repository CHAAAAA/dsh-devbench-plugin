/** Pure frontmatter parser and serializer. */
const KNOWN_KEYS = ['id', 'title', 'status', 'workspace', 'createdAt', 'updatedAt', 'sessions']

function parseScalar(raw) {
  const text = raw.trim()
  if (text === '') return ''
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }
  if (text === 'true') return true
  if (text === 'false') return false
  return text
}

export function parseRequirementText(text): { meta: Record<string, any>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text)
  if (match === null) return { meta: {}, body: text }
  const meta: Record<string, any> = {}
  const extra: Record<string, any> = {}
  const lines = match[1].split(/\r?\n/)
  let arrayKey = null
  for (const line of lines) {
    if (line.trim() === '') continue
    const arrayMatch = /^[ \t]+-[ \t]*(.*)$/.exec(line)
    if (arrayMatch !== null && arrayKey !== null) {
      meta[arrayKey].push(String(parseScalar(arrayMatch[1])))
      continue
    }
    const pair = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(line)
    if (pair === null) continue
    const key = pair[1]
    const value = pair[2]
    if (value.trim() === '') {
      meta[key] = []
      arrayKey = key
    } else if (value.trim() === '[]') {
      // Serializer writes empty extra arrays as `key: []`; keep the array shape
      // so callers never have to distinguish [] from the literal string "[]".
      meta[key] = []
      arrayKey = null
    } else {
      meta[key] = parseScalar(value)
      arrayKey = null
    }
    if (KNOWN_KEYS.includes(key) === false) extra[key] = meta[key]
  }
  let body = text.slice(match[0].length)
  if (body.startsWith('\r\n')) body = body.slice(2)
  else if (body.startsWith('\n')) body = body.slice(1)
  const clean = {
    id: typeof meta.id === 'string' ? meta.id : '',
    title: typeof meta.title === 'string' ? meta.title : '',
    status: typeof meta.status === 'string' ? meta.status : 'new',
    workspace: typeof meta.workspace === 'string' ? meta.workspace : '',
    createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : '',
    updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : '',
    sessions: Array.isArray(meta.sessions)
      ? meta.sessions.filter(function (item) { return typeof item === 'string' && item.length > 0 })
      : [],
    extra,
  }
  return { meta: clean, body }
}

export function serializeRequirementText(meta, body) {
  const lines = ['---']
  lines.push('id: ' + JSON.stringify(meta.id || ''))
  lines.push('title: ' + JSON.stringify(meta.title || ''))
  lines.push('status: ' + JSON.stringify(meta.status || 'new'))
  lines.push('workspace: ' + JSON.stringify(meta.workspace || ''))
  lines.push('createdAt: ' + JSON.stringify(meta.createdAt || ''))
  lines.push('updatedAt: ' + JSON.stringify(meta.updatedAt || ''))
  if (Array.isArray(meta.sessions) && meta.sessions.length > 0) {
    lines.push('sessions:')
    for (const session of meta.sessions) lines.push('  - ' + JSON.stringify(session))
  } else {
    lines.push('sessions: []')
  }
  const extra = meta.extra || {}
  for (const [key, value] of Object.entries(extra)) {
    if (KNOWN_KEYS.includes(key)) continue
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(key + ': []')
        continue
      }
      lines.push(key + ':')
      for (const item of value) lines.push('  - ' + JSON.stringify(String(item)))
    } else if (value === '') {
      lines.push(key + ': ""')
    } else {
      lines.push(key + ': ' + (typeof value === 'string' ? JSON.stringify(value) : String(value)))
    }
  }
  lines.push('---')
  const normalizedBody = body === null || body === undefined
    ? ''
    : String(body).replace(/^\r?\n+/, '')
  return lines.join('\n') + '\n\n' + normalizedBody +
    (normalizedBody.endsWith('\n') ? '' : '\n')
}

export function deriveTitle(body, fallback) {
  const heading = /^\s*#\s+(.+)$/m.exec(body || '')
  if (heading) return heading[1].trim().slice(0, 120)
  return fallback
}
