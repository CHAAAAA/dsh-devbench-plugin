/**
 * 需求检索服务。
 *
 * 需求数量少，不做持久化索引：每次按需扫描当前工作区的需求文档，对标题、需求 ID
 * 与正文做大小写不敏感的子串匹配（普通 indexOf，不用正则，无 ReDoS 风险）。
 * 正文命中时返回首次命中位置附近的上下文片段。
 */
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import { scanRequirementRecords } from '../domain/requirements.js'
import {
  getWorkspaceEntry,
  readMapping,
  resolveWorkspaceFolder,
} from '../storage/workspaces.js'
import { getRegisteredWorkspace } from './projects.js'

/** 检索词最大长度（trim 后，字符数）。 */
export const MAX_SEARCH_QUERY_LENGTH = 200
/** 调用方未传 limit 时的默认返回条数。 */
export const DEFAULT_SEARCH_LIMIT = 100
/** limit 上限。 */
export const MAX_SEARCH_LIMIT = 200
/** 支持的检索范围：仅标题/ID，或标题/ID + 正文。 */
export const SEARCH_SCOPES = Object.freeze(['title', 'full'])

/** 正文片段在命中位置前后各保留的字符数。 */
const SNIPPET_CONTEXT = 40
/** 正文片段总长上限（含首尾省略号）。 */
const MAX_SNIPPET_LENGTH = 140
const ELLIPSIS = '…'

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ')
}

function optionText(value) {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : String(value)
}

function searchLimit(value) {
  if (value === undefined || value === null) return DEFAULT_SEARCH_LIMIT
  const text = optionText(value).trim()
  if (text.length === 0) return DEFAULT_SEARCH_LIMIT
  if (/^\d+$/.test(text) === false) {
    throw apiError(400, 'bad-search-limit', messages.badSearchLimit)
  }
  const limit = Number(text)
  if (Number.isSafeInteger(limit) === false || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw apiError(400, 'bad-search-limit', messages.badSearchLimit)
  }
  return limit
}

/**
 * 归一化并校验检索参数：q trim、scope 默认 title、limit 默认 100。
 * HTTP 层与直接调用共用这一份校验，错误码与文案保持一致。
 *
 * @param {{ q?: string, scope?: string, limit?: string|number }} options
 * @returns {{ query: string, scope: 'title'|'full', limit: number }}
 */
export function normalizeSearchOptions(options) {
  const input = options || {}
  const query = optionText(input.q).trim()
  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    throw apiError(400, 'bad-search-query', messages.badSearchQuery)
  }
  const requestedScope = optionText(input.scope).trim()
  const scope = requestedScope.length === 0 ? 'title' : requestedScope
  if (SEARCH_SCOPES.includes(scope) === false) {
    throw apiError(400, 'bad-search-scope', messages.badSearchScope)
  }
  return { query, scope, limit: searchLimit(input.limit) }
}

/**
 * 构造正文命中片段：命中位置前后各约 40 字符的窗口，连续空白/换行折叠为
 * 单空格；截断侧以 `…` 表示，总长不超过 140 字符。检索词过长时优先保留
 * 命中开头附近的内容，片段仍受总长上限约束。
 *
 * @param {string} body 需求正文。
 * @param {number} matchIndex 首次命中的起始下标。
 * @param {number} queryLength 检索词长度（字符数）。
 * @returns {string}
 */
export function buildMatchSnippet(body, matchIndex, queryLength) {
  const source = typeof body === 'string' ? body : ''
  const index = Math.max(0, Math.min(matchIndex, source.length))
  const length = Math.max(0, queryLength)
  const rawStart = Math.max(0, index - SNIPPET_CONTEXT)
  const rawEnd = Math.min(source.length, index + length + SNIPPET_CONTEXT)
  const text = collapseWhitespace(source.slice(rawStart, rawEnd))
  const matchStart = collapseWhitespace(source.slice(rawStart, index)).length
  const matchLength = collapseWhitespace(source.slice(index, index + length)).length
  let start = 0
  let end = text.length
  let leading = rawStart > 0
  let trailing = rawEnd < source.length
  while (end - start > MAX_SNIPPET_LENGTH - (leading ? 1 : 0) - (trailing ? 1 : 0)) {
    // 从离命中更远的一侧裁剪，保证命中词尽量留在片段里。
    if (end - (matchStart + matchLength) >= matchStart - start) end -= 1
    else start += 1
    if (start > 0) leading = true
    if (end < text.length) trailing = true
  }
  const visible = text.slice(start, end).trim()
  return (leading ? ELLIPSIS : '') + visible + (trailing ? ELLIPSIS : '')
}

/** 判断一条需求记录是否命中，返回契约里的 match 结构；未命中返回 null。 */
function matchRequirement(record, query, scope) {
  const needle = query.toLowerCase()
  const summary = record.summary || {}
  const title = typeof summary.title === 'string' ? summary.title : ''
  if (title.toLowerCase().includes(needle)) return { field: 'title', snippet: '' }
  const id = typeof summary.id === 'string' ? summary.id : ''
  if (id.toLowerCase().includes(needle)) return { field: 'id', snippet: '' }
  if (scope !== 'full') return null
  const body = typeof record.body === 'string' ? record.body : ''
  const index = body.toLowerCase().indexOf(needle)
  if (index < 0) return null
  return { field: 'body', snippet: buildMatchSnippet(body, index, needle.length) }
}

function toSearchItem(record, match) {
  const summary = record.summary || {}
  return {
    id: summary.id,
    title: summary.title,
    status: summary.status,
    updatedAt: summary.updatedAt,
    worktree: summary.worktree === true,
    favorite: summary.favorite === true,
    match: match,
  }
}

/**
 * 检索一个工作区内符合条件的需求。
 *
 * @param ctx - 插件上下文，用于校验工作区是否已注册。
 * @param config - 插件配置，读取 rootDir（未配置时返回空结果）。
 * @param {string} workspaceId - 目标工作区 ID。
 * @param {{ q?: string, scope?: 'title'|'full', limit?: string|number }} options
 * @returns {Promise<{ query: string, scope: string, total: number, hasMore: boolean, items: object[] }>}
 */
export async function searchWorkspaceRequirements(ctx, config, workspaceId, options = {}) {
  const { query, scope, limit } = normalizeSearchOptions(options)
  getRegisteredWorkspace(ctx, workspaceId)
  const empty = { query, scope, total: 0, hasMore: false, items: [] }
  if (query.length === 0) return empty
  const root = config && typeof config.rootDir === 'string' ? config.rootDir : ''
  if (root.length === 0) return empty
  const mapping = await readMapping(root)
  const entry = getWorkspaceEntry(mapping, workspaceId)
  if (entry === null) return empty
  const folderPath = await resolveWorkspaceFolder(root, entry.folder, { mustExist: false })
  const records = await scanRequirementRecords(folderPath, workspaceId)
  const matched = []
  for (const record of records) {
    const match = matchRequirement(record, query, scope)
    if (match !== null) matched.push({ record, match })
  }
  // scan 已按 updatedAt 倒序：先按「标题/ID 命中优先、正文命中其次」拆成两组
  // 再拼接，组内顺序保持不变，即天然满足同组 updatedAt 倒序。
  const primary = matched.filter(function (item) { return item.match.field !== 'body' })
  const secondary = matched.filter(function (item) { return item.match.field === 'body' })
  const items = primary.concat(secondary).slice(0, limit).map(function (item) {
    return toSearchItem(item.record, item.match)
  })
  return {
    query,
    scope,
    total: matched.length,
    hasMore: matched.length > items.length,
    items,
  }
}
