import type { DocumentSummary, SearchScope, SearchMatch, SearchResult, DocumentSearchItem } from '../../shared/api-types.js'
/**
 * 项目文档检索服务。
 *
 * 与需求检索一致：文档数量少，不做持久化索引，每次按需扫描工作区文档并做
 * 大小写不敏感的子串匹配（普通 indexOf，不用正则，无 ReDoS 风险）。标题命中的
 * 文档排在正文命中之前，同组内保持 updatedAt 倒序；正文命中返回上下文片段。
 */
import { scanDocumentRecords } from '../domain/documents.js'
import { buildMatchSnippet, normalizeSearchOptions } from './requirement-search.js'

/** 判断一条文档记录是否命中，返回契约里的 match 结构；未命中返回 null。 */
function matchDocument(record: { summary: DocumentSummary; body: string }, query: string, scope: SearchScope): SearchMatch | null {
  const needle = query.toLowerCase()
  const summary: Partial<DocumentSummary> = record.summary || {}
  const title = typeof summary.title === 'string' ? summary.title : ''
  if (title.toLowerCase().includes(needle)) return { field: 'title', snippet: '' }
  if (scope !== 'full') return null
  const body = typeof record.body === 'string' ? record.body : ''
  const index = body.toLowerCase().indexOf(needle)
  if (index < 0) return null
  return { field: 'body', snippet: buildMatchSnippet(body, index, needle.length) }
}

function toSearchItem(record: { summary: DocumentSummary }, match: SearchMatch): DocumentSearchItem {
  const summary: Partial<DocumentSummary> = record.summary || {}
  return {
    id: summary.id,
    title: summary.title,
    updatedAt: summary.updatedAt,
    match: match,
  }
}

/**
 * 检索一个工作区内的项目文档。
 *
 * 路由层已完成 requireRoot / findWorkspace 校验并解析出工作区目录；这里只负责
 * 参数归一化与检索本身。目录为空（工作区尚未初始化）时返回空结果。
 *
 * @param {string} folderPath - 工作区需求目录（可为 null，表示尚未初始化）。
 * @param {{ q?: string, scope?: 'title'|'full', limit?: string|number }} options
 * @returns {Promise<{ query: string, scope: string, total: number, hasMore: boolean, items: object[] }>}
 */
export async function searchWorkspaceDocuments(folderPath: string | null, options: { q?: unknown; scope?: unknown; limit?: unknown } = {}): Promise<SearchResult<DocumentSearchItem>> {
  const { query, scope, limit } = normalizeSearchOptions(options)
  const empty = { query, scope, total: 0, hasMore: false, items: [] }
  if (query.length === 0) return empty
  if (typeof folderPath !== 'string' || folderPath.length === 0) return empty
  const records = await scanDocumentRecords(folderPath)
  const matched = []
  for (const record of records) {
    const match = matchDocument(record, query, scope)
    if (match !== null) matched.push({ record, match })
  }
  const primary = matched.filter(function (item) { return item.match.field === 'title' })
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
