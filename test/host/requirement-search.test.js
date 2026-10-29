import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  configureRoot,
  createHarness,
  expectOk,
  initWorkspace,
  makeWorkspace,
} from './helpers.js'
import { messages } from '../../src/host/messages/index.js'
import { serializeRequirementText } from '../../src/host/domain/requirement-document.js'
import { scanRequirementRecords, scanRequirements } from '../../src/host/domain/requirements.js'
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  MAX_SEARCH_QUERY_LENGTH,
} from '../../src/host/services/requirement-search.js'

const FIXED_TIME = '2026-10-28T00:00:00.000Z'

/** 创建空 harness，注册一个工作区并初始化它的需求目录。 */
async function setupWorkspace() {
  const harness = await createHarness([])
  const workspace = await makeWorkspace(harness.tempRoot, 'w-search', 'Search Workspace')
  harness.addWorkspace(workspace)
  await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
  const initialized = await initWorkspace(harness, workspace.id)
  return { harness, workspace, folderPath: initialized.folderPath }
}

/** 直接写一个需求文档（frontmatter 可控制 updatedAt，便于断言排序）。 */
async function seedRequirement(folderPath, values) {
  const folder = path.join(folderPath, values.id)
  await fsp.mkdir(folder, { recursive: true })
  const updatedAt = values.updatedAt || FIXED_TIME
  const meta = {
    id: values.id,
    title: values.title === undefined ? values.id : values.title,
    status: values.status || 'new',
    workspace: '',
    createdAt: values.createdAt || updatedAt,
    updatedAt: updatedAt,
    sessions: [],
    extra: values.worktree === true ? { worktree: true } : {},
  }
  const body = values.body === undefined ? '' : values.body
  await fsp.writeFile(path.join(folder, 'requirement.md'), serializeRequirementText(meta, body))
}

function searchUrl(workspaceId, query) {
  const params = new URLSearchParams()
  if (workspaceId !== undefined && workspaceId !== null) params.set('workspaceId', workspaceId)
  for (const key of Object.keys(query || {})) {
    if (query[key] === undefined || query[key] === null) continue
    params.set(key, String(query[key]))
  }
  return '/requirement/search?' + params.toString()
}

function searchRequest(harness, workspaceId, query) {
  return harness.request('GET', searchUrl(workspaceId, query))
}

async function searchOk(harness, workspaceId, query) {
  return expectOk(await searchRequest(harness, workspaceId, query))
}

test('scanRequirementRecords returns summaries with bodies and scanRequirements maps them', async function () {
  const { harness, workspace, folderPath } = await setupWorkspace()
  try {
    await seedRequirement(folderPath, {
      id: 'REQ-20261028-001',
      title: 'Older requirement',
      body: '# Older\n\nOld body text.\n',
      updatedAt: '2026-10-28T01:00:00.000Z',
    })
    await seedRequirement(folderPath, {
      id: 'REQ-20261028-002',
      title: 'Newer requirement',
      body: '# Newer\n\nNew body text.\n',
      updatedAt: '2026-10-28T02:00:00.000Z',
    })

    const records = await scanRequirementRecords(folderPath, workspace.id)
    assert.equal(records.length, 2)
    assert.deepEqual(records.map(function (record) { return record.summary.id }), [
      'REQ-20261028-002',
      'REQ-20261028-001',
    ])
    assert.equal(records[0].summary.title, 'Newer requirement')
    assert.equal(records[0].summary.workspaceId, workspace.id)
    assert.equal(records[0].body.includes('New body text.'), true)
    assert.equal(records[1].body.includes('Old body text.'), true)

    const summaries = await scanRequirements(folderPath, workspace.id)
    assert.deepEqual(summaries, records.map(function (record) { return record.summary }))
  } finally {
    await harness.close()
  }
})

test('title scope matches title and id case-insensitively and ignores body matches', async function () {
  const { harness, workspace, folderPath } = await setupWorkspace()
  try {
    await seedRequirement(folderPath, {
      id: 'REQ-20261028-001',
      title: 'Worktree Fix',
      body: '# Worktree fix\n\nNo widget here.\n',
    })
    await seedRequirement(folderPath, {
      id: 'REQ-20261028-002',
      title: 'Deploy notes',
      status: 'done',
      body: '# Deploy notes\n\nThe pipeline mentions WidgetCache in passing.\n',
      worktree: true,
    })

    // 标题命中（大小写不敏感），q 回显 trim 后的值。
    let value = await searchOk(harness, workspace.id, { q: '  worktree  ' })
    assert.equal(value.query, 'worktree')
    assert.equal(value.scope, 'title')
    assert.equal(value.total, 1)
    assert.equal(value.hasMore, false)
    assert.deepEqual(value.items, [{
      id: 'REQ-20261028-001',
      title: 'Worktree Fix',
      status: 'new',
      updatedAt: FIXED_TIME,
      worktree: false,
      match: { field: 'title', snippet: '' },
    }])

    // 需求 ID 命中，match.field 为 id，snippet 为空串。
    value = await searchOk(harness, workspace.id, { q: '20261028-002' })
    assert.equal(value.total, 1)
    assert.equal(value.items[0].id, 'REQ-20261028-002')
    assert.equal(value.items[0].status, 'done')
    assert.equal(value.items[0].worktree, true)
    assert.deepEqual(value.items[0].match, { field: 'id', snippet: '' })

    // 标题/ID 不命中时，标题范围不检索正文。
    value = await searchOk(harness, workspace.id, { q: 'widgetcache' })
    assert.equal(value.total, 0)
    assert.deepEqual(value.items, [])

    // 全文范围命中正文，返回正文片段。
    value = await searchOk(harness, workspace.id, { q: 'WIDGETCACHE', scope: 'full' })
    assert.equal(value.total, 1)
    assert.equal(value.items[0].id, 'REQ-20261028-002')
    assert.equal(value.items[0].match.field, 'body')
    assert.equal(value.items[0].match.snippet.includes('WidgetCache'), true)
  } finally {
    await harness.close()
  }
})

test('full scope ranks title and id matches before body matches and keeps updatedAt order', async function () {
  const { harness, workspace, folderPath } = await setupWorkspace()
  try {
    await seedRequirement(folderPath, {
      id: 'REQ-TITLE-A',
      title: 'Needle in title A',
      body: 'no hit here',
      updatedAt: '2026-10-28T03:00:00.000Z',
    })
    await seedRequirement(folderPath, {
      id: 'REQ-TITLE-B',
      title: 'Needle in title B',
      body: 'no hit here either',
      updatedAt: '2026-10-28T01:00:00.000Z',
    })
    await seedRequirement(folderPath, {
      id: 'REQ-NEEDLE-001',
      title: 'Record matched by id',
      body: 'no hit here',
      updatedAt: '2026-10-28T05:00:00.000Z',
    })
    await seedRequirement(folderPath, {
      id: 'REQ-BODY-D',
      title: 'Body only D',
      body: 'the needle lives in the body',
      updatedAt: '2026-10-28T04:00:00.000Z',
    })
    await seedRequirement(folderPath, {
      id: 'REQ-BODY-E',
      title: 'Body only E',
      body: 'another needle in the text',
      updatedAt: '2026-10-28T02:00:00.000Z',
    })
    await seedRequirement(folderPath, {
      id: 'REQ-BOTH-F',
      title: 'Needle in title and body',
      body: 'the needle also appears here',
      updatedAt: '2026-10-28T06:00:00.000Z',
    })

    const value = await searchOk(harness, workspace.id, { q: 'needle', scope: 'full' })
    assert.equal(value.total, 6)
    assert.equal(value.hasMore, false)
    // 标题/ID 命中在前，正文命中在后；同组内按 updatedAt 倒序。
    assert.deepEqual(value.items.map(function (item) { return item.id }), [
      'REQ-BOTH-F',
      'REQ-NEEDLE-001',
      'REQ-TITLE-A',
      'REQ-TITLE-B',
      'REQ-BODY-D',
      'REQ-BODY-E',
    ])
    assert.deepEqual(value.items.map(function (item) { return item.match.field }), [
      'title',
      'id',
      'title',
      'title',
      'body',
      'body',
    ])
    // 标题命中优先于正文命中，即使正文也包含检索词。
    assert.equal(value.items[0].match.snippet, '')
  } finally {
    await harness.close()
  }
})

test('full scope returns a collapsed, ellipsis-wrapped context snippet', async function () {
  const { harness, workspace, folderPath } = await setupWorkspace()
  try {
    const body = [
      '# 部署说明',
      '',
      '前置说明段落比较长，用来保证片段左侧必须被省略。这里继续补充一些上下文文字。',
      '',
      '部署流程会在中途提到 WidgetCache   并且继续描述后续步骤。',
      '',
      '后续说明段落也很长，用来保证片段右侧必须以省略号结束。这里继续补充文字。',
    ].join('\n')
    await seedRequirement(folderPath, {
      id: 'REQ-20261028-010',
      title: 'Deploy notes',
      body: body,
    })

    let value = await searchOk(harness, workspace.id, { q: 'widgetcache', scope: 'full' })
    assert.equal(value.total, 1)
    const snippet = value.items[0].match.snippet
    assert.equal(value.items[0].match.field, 'body')
    assert.equal(snippet.includes('WidgetCache'), true)
    assert.equal(snippet.startsWith('…'), true)
    assert.equal(snippet.endsWith('…'), true)
    assert.equal(snippet.length <= 140, true)
    assert.equal(snippet.length > 20, true)
    assert.equal(snippet.includes('\n'), false)
    assert.equal(/\s{2,}/.test(snippet), false)
    // 命中位置前后各保留上下文，窗口外的标题被省略。
    assert.equal(snippet.includes('部署流程会在中途提到'), true)
    assert.equal(snippet.includes('并且继续描述后续步骤'), true)
    assert.equal(snippet.includes('部署说明'), false)

    // 中文关键词同样按子串匹配并返回片段。
    value = await searchOk(harness, workspace.id, { q: '  部署流程会在中途提到  ', scope: 'full' })
    assert.equal(value.query, '部署流程会在中途提到')
    assert.equal(value.total, 1)
    assert.equal(value.items[0].match.field, 'body')
    assert.equal(value.items[0].match.snippet.includes('部署流程会在中途提到'), true)
    assert.equal(value.items[0].match.snippet.length <= 140, true)

    // 检索词本身很长时片段仍不超过 140 字符。
    await seedRequirement(folderPath, {
      id: 'REQ-20261028-011',
      title: 'Long match',
      body: 'HEAD ' + 'x'.repeat(150) + ' TAIL',
    })
    value = await searchOk(harness, workspace.id, { q: 'x'.repeat(150), scope: 'full' })
    assert.equal(value.total, 1)
    assert.equal(value.items[0].match.snippet.length <= 140, true)
  } finally {
    await harness.close()
  }
})

test('limit truncates items while total counts every match and hasMore reflects truncation', async function () {
  const { harness, workspace, folderPath } = await setupWorkspace()
  try {
    for (let index = 1; index <= DEFAULT_SEARCH_LIMIT + 1; index += 1) {
      const sequence = String(index).padStart(3, '0')
      await seedRequirement(folderPath, {
        id: 'REQ-BATCH-' + sequence,
        title: 'Batch needle ' + sequence,
        updatedAt: '2026-10-28T00:00:' + String(index % 60).padStart(2, '0') + '.000Z',
      })
    }

    // 默认 limit = 100：101 条命中里只返回前 100 条，total 仍是 101。
    let value = await searchOk(harness, workspace.id, { q: 'batch needle' })
    assert.equal(value.total, 101)
    assert.equal(value.items.length, DEFAULT_SEARCH_LIMIT)
    assert.equal(value.hasMore, true)

    value = await searchOk(harness, workspace.id, { q: 'batch needle', limit: '2' })
    assert.equal(value.total, 101)
    assert.equal(value.items.length, 2)
    assert.equal(value.hasMore, true)

    value = await searchOk(harness, workspace.id, { q: 'batch needle', limit: '101' })
    assert.equal(value.total, 101)
    assert.equal(value.items.length, 101)
    assert.equal(value.hasMore, false)

    value = await searchOk(harness, workspace.id, {
      q: 'batch needle',
      limit: String(MAX_SEARCH_LIMIT),
    })
    assert.equal(value.items.length, 101)
    assert.equal(value.hasMore, false)
  } finally {
    await harness.close()
  }
})

test('empty query returns an empty result without an error', async function () {
  const { harness, workspace, folderPath } = await setupWorkspace()
  try {
    await seedRequirement(folderPath, {
      id: 'REQ-20261028-020',
      title: 'Anything',
      body: 'anything',
    })

    for (const q of ['', '   ']) {
      const value = await searchOk(harness, workspace.id, { q: q })
      assert.deepEqual(value, {
        query: '',
        scope: 'title',
        total: 0,
        hasMore: false,
        items: [],
      })
    }
    const scopeFull = await searchOk(harness, workspace.id, { q: '', scope: 'full' })
    assert.equal(scopeFull.scope, 'full')
    assert.equal(scopeFull.total, 0)

    // 完全不传 q 参数同样返回空结果。
    const response = await harness.request('GET',
      '/requirement/search?workspaceId=' + encodeURIComponent(workspace.id))
    assert.equal(response.status, 200)
    assert.deepEqual(expectOk(response).items, [])
  } finally {
    await harness.close()
  }
})

test('search rejects oversized q, unknown scope and invalid limits', async function () {
  const { harness, workspace } = await setupWorkspace()
  try {
    let response = await searchRequest(harness, workspace.id, {
      q: 'a'.repeat(MAX_SEARCH_QUERY_LENGTH + 1),
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'bad-search-query')
    assert.equal(response.data.error.message, messages.badSearchQuery)

    // 200 字符是允许的边界。
    response = await searchRequest(harness, workspace.id, {
      q: 'a'.repeat(MAX_SEARCH_QUERY_LENGTH),
    })
    assert.equal(response.status, 200)

    response = await searchRequest(harness, workspace.id, { q: 'x', scope: 'body' })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'bad-search-scope')
    assert.equal(response.data.error.message, messages.badSearchScope)

    for (const limit of ['abc', '0', '201', '1.5', '-1']) {
      response = await searchRequest(harness, workspace.id, { q: 'x', limit: limit })
      assert.equal(response.status, 400, 'limit=' + limit)
      assert.equal(response.data.error.code, 'bad-search-limit')
      assert.equal(response.data.error.message, messages.badSearchLimit)
    }
  } finally {
    await harness.close()
  }
})

test('search requires a registered workspace', async function () {
  const { harness } = await setupWorkspace()
  try {
    let response = await harness.request('GET', '/requirement/search?q=x')
    assert.equal(response.status, 404)
    assert.equal(response.data.error.code, 'workspace-not-found')
    assert.equal(response.data.error.message, messages.workspaceNotFound)

    response = await searchRequest(harness, 'missing-workspace', { q: 'x' })
    assert.equal(response.status, 404)
    assert.equal(response.data.error.code, 'workspace-not-found')
    assert.equal(response.data.error.message, messages.workspaceNotFound)
  } finally {
    await harness.close()
  }
})

test('search returns an empty result when rootDir is unset or the workspace has no folder', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w-no-root', 'No Root Workspace')
    harness.addWorkspace(workspace)

    // 未配置 rootDir：不抛错，返回空结果。
    let value = await searchOk(harness, workspace.id, { q: 'anything', scope: 'full' })
    assert.deepEqual(value, {
      query: 'anything',
      scope: 'full',
      total: 0,
      hasMore: false,
      items: [],
    })

    // 配置了 rootDir 但工作区尚未初始化（没有需求目录）：同样返回空结果。
    await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
    value = await searchOk(harness, workspace.id, { q: 'anything' })
    assert.equal(value.total, 0)
    assert.deepEqual(value.items, [])
  } finally {
    await harness.close()
  }
})

test('deleted requirements are excluded from search results', async function () {
  const { harness, workspace, folderPath } = await setupWorkspace()
  try {
    await seedRequirement(folderPath, {
      id: 'REQ-20261028-030',
      title: 'Deleted needle',
      body: 'deleted body',
    })
    await seedRequirement(folderPath, {
      id: 'REQ-20261028-031',
      title: 'Kept needle',
      body: 'kept body',
    })

    const deleted = expectOk(await harness.request('POST', '/requirement/delete', {
      workspaceId: workspace.id,
      id: 'REQ-20261028-030',
    }))
    assert.equal(deleted.deleted, true)

    const value = await searchOk(harness, workspace.id, { q: 'needle', scope: 'full' })
    assert.equal(value.total, 1)
    assert.deepEqual(value.items.map(function (item) { return item.id }), ['REQ-20261028-031'])
  } finally {
    await harness.close()
  }
})
