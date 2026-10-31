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
import {
  DOCUMENTS_DIR,
  MAX_FILE_TEXT_BYTES,
  MAX_TITLE_LENGTH,
} from '../../src/host/constants.js'
import {
  createDocument,
  deleteDocument,
  readDocument,
  saveDocument,
  scanDocumentSummaries,
} from '../../src/host/domain/documents.js'
import { DEFAULT_SEARCH_LIMIT } from '../../src/host/services/requirement-search.js'

const FIXED_TIME = '2026-10-28T00:00:00.000Z'
const DOC_ID_PATTERN = /^DOC-\d{8}-\d{3,}$/

/** Local calendar date part used by document ids (mirrors the domain helper). */
function todayPart() {
  const now = new Date()
  return String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0')
}

/** 创建空 harness，注册一个工作区并初始化它的需求目录。 */
async function setupWorkspace() {
  const harness = await createHarness([])
  const workspace = await makeWorkspace(harness.tempRoot, 'w-docs', 'Docs Workspace')
  harness.addWorkspace(workspace)
  const rootDir = path.join(harness.tempRoot, 'requirements-root')
  await configureRoot(harness, rootDir)
  const initialized = await initWorkspace(harness, workspace.id)
  return { harness, workspace, rootDir, folderPath: initialized.folderPath }
}

/** 直接写一个文档文件（frontmatter 可控，便于断言排序与损坏处理）。 */
async function seedDocument(folderPath, values) {
  const directory = path.join(folderPath, DOCUMENTS_DIR)
  await fsp.mkdir(directory, { recursive: true })
  const createdAt = values.createdAt || values.updatedAt || FIXED_TIME
  const updatedAt = values.updatedAt || createdAt
  const lines = [
    '---',
    'id: ' + JSON.stringify(values.id),
    'title: ' + JSON.stringify(values.title === undefined ? values.id : values.title),
    'createdAt: ' + JSON.stringify(createdAt),
    'updatedAt: ' + JSON.stringify(updatedAt),
    '---',
    '',
  ]
  await fsp.writeFile(
    path.join(directory, values.id + '.md'),
    lines.join('\n') + (values.body === undefined ? '' : values.body),
  )
}

function expectError(result, status, code) {
  assert.equal(result.status, status, result.raw)
  assert.equal(result.data.ok, false)
  assert.equal(result.data.error.code, code)
  return result.data.error
}

function searchUrl(workspaceId, query) {
  const params = new URLSearchParams()
  if (workspaceId !== undefined && workspaceId !== null) params.set('workspaceId', workspaceId)
  for (const key of Object.keys(query || {})) {
    if (query[key] === undefined || query[key] === null) continue
    params.set(key, String(query[key]))
  }
  return '/document/search?' + params.toString()
}

async function listDocuments(harness, workspaceId) {
  return expectOk(await harness.request('GET',
    '/documents?workspaceId=' + encodeURIComponent(workspaceId)))
}

test('document CRUD round-trips through HTTP and stores Markdown outside the project', async function () {
  const { harness, workspace, rootDir, folderPath } = await setupWorkspace()
  try {
    const created = expectOk(await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
      title: '发布流程',
      body: '# 发布流程\n\n第一步：构建。\n',
    }))
    const document = created.document
    assert.match(document.id, DOC_ID_PATTERN)
    assert.equal(document.title, '发布流程')
    assert.equal(typeof document.createdAt, 'string')
    assert.equal(document.updatedAt, document.createdAt)
    assert.equal(created.body, undefined)

    // 落盘位置：需求根目录下工作区目录的 .documents/，不在项目目录内。
    const file = path.join(folderPath, DOCUMENTS_DIR, document.id + '.md')
    assert.equal((await fsp.lstat(file)).isFile(), true)
    const rootReal = await fsp.realpath(rootDir)
    assert.equal(file.startsWith(rootReal + path.sep), true)
    assert.equal(file.startsWith(workspace.path + path.sep), false)
    assert.deepEqual(await fsp.readdir(workspace.path), [])

    // frontmatter 往返：字段顺序与引号格式符合契约。
    const text = await fsp.readFile(file, 'utf8')
    assert.equal(text.includes('---\nid: ' + JSON.stringify(document.id) + '\n'), true)
    assert.equal(text.includes('title: ' + JSON.stringify('发布流程') + '\n'), true)
    assert.equal(text.includes('createdAt: ' + JSON.stringify(document.createdAt) + '\n'), true)
    assert.equal(text.includes('updatedAt: ' + JSON.stringify(document.updatedAt) + '\n'), true)
    assert.equal(text.includes('\n---\n\n# 发布流程\n'), true)

    // 列表与读取。
    const listed = await listDocuments(harness, workspace.id)
    assert.deepEqual(listed.documents, [{
      id: document.id,
      title: '发布流程',
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }])
    const detail = expectOk(await harness.request('POST', '/document/get', {
      workspaceId: workspace.id,
      id: document.id,
    }))
    assert.deepEqual(detail.document, document)
    assert.equal(detail.body, '# 发布流程\n\n第一步：构建。\n')

    // 保存只更新传入字段。
    const saved = expectOk(await harness.request('POST', '/document/save', {
      workspaceId: workspace.id,
      id: document.id,
      title: '发布流程 v2',
      body: '# 发布流程 v2\n',
    }))
    assert.equal(saved.document.title, '发布流程 v2')
    assert.equal(saved.document.id, document.id)
    assert.equal(saved.document.createdAt, document.createdAt)
    assert.equal(
      String(saved.document.updatedAt).localeCompare(String(document.updatedAt)) >= 0,
      true,
    )
    const savedText = await fsp.readFile(file, 'utf8')
    assert.equal(savedText.includes('title: ' + JSON.stringify('发布流程 v2') + '\n'), true)
    assert.equal(savedText.includes('\n---\n\n# 发布流程 v2\n'), true)

    // 删除：真实删除 .md 文件并返回契约结构。
    const deleted = expectOk(await harness.request('POST', '/document/delete', {
      workspaceId: workspace.id,
      id: document.id,
    }))
    assert.deepEqual(deleted, { deleted: true, id: document.id })
    await assert.rejects(fsp.lstat(file), function (error) { return error.code === 'ENOENT' })
    assert.deepEqual((await listDocuments(harness, workspace.id)).documents, [])
    expectError(await harness.request('POST', '/document/get', {
      workspaceId: workspace.id,
      id: document.id,
    }), 404, 'document-not-found')
  } finally {
    await harness.close()
  }
})

test('create assigns the next per-day sequence, including 4+ digit sequences', async function () {
  const { harness, workspace, folderPath } = await setupWorkspace()
  try {
    const datePart = todayPart()
    await seedDocument(folderPath, { id: 'DOC-' + datePart + '-007', title: 'Seeded seven' })
    await seedDocument(folderPath, { id: 'DOC-' + datePart + '-010', title: 'Seeded ten' })

    const first = expectOk(await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
      title: 'Next one',
    }))
    assert.equal(first.document.id, 'DOC-' + datePart + '-011')
    // 省略 body 时的空正文往返为空串。
    const firstDetail = expectOk(await harness.request('POST', '/document/get', {
      workspaceId: workspace.id,
      id: first.document.id,
    }))
    assert.equal(firstDetail.body, '')

    const second = expectOk(await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
      title: 'Next two',
    }))
    assert.equal(second.document.id, 'DOC-' + datePart + '-012')

    await seedDocument(folderPath, { id: 'DOC-' + datePart + '-1000', title: 'Four digits' })
    const third = expectOk(await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
      title: 'After four digits',
    }))
    assert.equal(third.document.id, 'DOC-' + datePart + '-1001')
  } finally {
    await harness.close()
  }
})

test('list sorts documents by updatedAt descending and save bumps a document to the top', async function () {
  const { harness, workspace, folderPath } = await setupWorkspace()
  try {
    await seedDocument(folderPath, {
      id: 'DOC-20261028-001',
      title: 'Oldest',
      updatedAt: '2026-10-28T01:00:00.000Z',
      body: 'oldest body',
    })
    await seedDocument(folderPath, {
      id: 'DOC-20261028-002',
      title: 'Middle',
      updatedAt: '2026-10-28T02:00:00.000Z',
      body: 'middle body',
    })
    await seedDocument(folderPath, {
      id: 'DOC-20261028-003',
      title: 'Newest',
      updatedAt: '2026-10-28T03:00:00.000Z',
      body: 'newest body',
    })

    let listed = await listDocuments(harness, workspace.id)
    assert.deepEqual(listed.documents.map(function (item) { return item.id }), [
      'DOC-20261028-003',
      'DOC-20261028-002',
      'DOC-20261028-001',
    ])

    expectOk(await harness.request('POST', '/document/save', {
      workspaceId: workspace.id,
      id: 'DOC-20261028-001',
      body: 'oldest body updated',
    }))
    listed = await listDocuments(harness, workspace.id)
    assert.deepEqual(listed.documents.map(function (item) { return item.id }), [
      'DOC-20261028-001',
      'DOC-20261028-003',
      'DOC-20261028-002',
    ])
  } finally {
    await harness.close()
  }
})

test('save rejects a stale expectedUpdatedAt with document-conflict and force overwrites', async function () {
  const { harness, workspace } = await setupWorkspace()
  try {
    const created = expectOk(await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
      title: 'Conflict doc',
      body: 'v1',
    }))
    const id = created.document.id
    const current = created.document.updatedAt

    // 正确的版本戳可以保存。
    const saved = expectOk(await harness.request('POST', '/document/save', {
      workspaceId: workspace.id,
      id: id,
      body: 'v2',
      expectedUpdatedAt: current,
    }))
    assert.notEqual(saved.document.updatedAt, current)

    // 旧的版本戳命中冲突。
    const conflict = expectError(await harness.request('POST', '/document/save', {
      workspaceId: workspace.id,
      id: id,
      body: 'v3',
      expectedUpdatedAt: current,
    }), 409, 'document-conflict')
    assert.equal(conflict.message, messages.documentConflict)
    const unchanged = expectOk(await harness.request('POST', '/document/get', {
      workspaceId: workspace.id,
      id: id,
    }))
    // 保存正文时会补齐结尾换行（与需求正文一致），读取时保留。
    assert.equal(unchanged.body, 'v2\n')
    assert.equal(unchanged.document.title, 'Conflict doc')

    // force 覆盖冲突。
    const forced = expectOk(await harness.request('POST', '/document/save', {
      workspaceId: workspace.id,
      id: id,
      body: 'v3',
      expectedUpdatedAt: current,
      force: true,
    }))
    assert.notEqual(forced.document.updatedAt, current)
    const reread = expectOk(await harness.request('POST', '/document/get', {
      workspaceId: workspace.id,
      id: id,
    }))
    assert.equal(reread.body, 'v3\n')
  } finally {
    await harness.close()
  }
})

test('search matches titles, returns body snippets, and supports limit/hasMore', async function () {
  const { harness, workspace, folderPath } = await setupWorkspace()
  try {
    await seedDocument(folderPath, {
      id: 'DOC-20261028-001',
      title: 'Deploy Pipeline Notes',
      body: 'Nothing interesting in this body.',
    })
    await seedDocument(folderPath, {
      id: 'DOC-20261028-002',
      title: 'Other notes',
      body: 'The WidgetCache    appears in the middle of this body text.',
    })

    // 标题范围：标题命中 field=title、snippet 为空；正文不参与。
    let value = expectOk(await harness.request('GET',
      searchUrl(workspace.id, { q: '  deploy  ' })))
    assert.deepEqual(value, {
      query: 'deploy',
      scope: 'title',
      total: 1,
      hasMore: false,
      items: [{
        id: 'DOC-20261028-001',
        title: 'Deploy Pipeline Notes',
        updatedAt: FIXED_TIME,
        match: { field: 'title', snippet: '' },
      }],
    })

    value = expectOk(await harness.request('GET', searchUrl(workspace.id, { q: 'widgetcache' })))
    assert.equal(value.total, 0)
    assert.deepEqual(value.items, [])

    // 全文范围：正文命中返回折叠后的片段。
    value = expectOk(await harness.request('GET',
      searchUrl(workspace.id, { q: 'WIDGETCACHE', scope: 'full' })))
    assert.equal(value.total, 1)
    assert.equal(value.items[0].id, 'DOC-20261028-002')
    assert.equal(value.items[0].match.field, 'body')
    assert.equal(value.items[0].match.snippet.includes('WidgetCache'), true)
    assert.equal(value.items[0].match.snippet.includes('\n'), false)

    // 标题命中排在正文命中之前。
    await seedDocument(folderPath, {
      id: 'DOC-20261028-003',
      title: 'WidgetCache design',
      body: 'mentions WidgetCache too',
      updatedAt: '2026-10-28T01:00:00.000Z',
    })
    value = expectOk(await harness.request('GET',
      searchUrl(workspace.id, { q: 'widgetcache', scope: 'full' })))
    assert.deepEqual(value.items.map(function (item) { return item.match.field }), ['title', 'body'])

    // 空检索词不报错，返回空结果并回显 scope。
    value = expectOk(await harness.request('GET',
      searchUrl(workspace.id, { q: '   ', scope: 'full' })))
    assert.deepEqual(value, { query: '', scope: 'full', total: 0, hasMore: false, items: [] })

    // 分页：limit 截断 items，total 保持命中数，hasMore 表示是否截断。
    for (let index = 1; index <= DEFAULT_SEARCH_LIMIT + 1; index += 1) {
      await seedDocument(folderPath, {
        id: 'DOC-20260201-' + String(index).padStart(3, '0'),
        title: 'Batch needle ' + index,
      })
    }
    value = expectOk(await harness.request('GET',
      searchUrl(workspace.id, { q: 'batch needle' })))
    assert.equal(value.total, DEFAULT_SEARCH_LIMIT + 1)
    assert.equal(value.items.length, DEFAULT_SEARCH_LIMIT)
    assert.equal(value.hasMore, true)

    value = expectOk(await harness.request('GET',
      searchUrl(workspace.id, { q: 'batch needle', limit: '2' })))
    assert.equal(value.total, DEFAULT_SEARCH_LIMIT + 1)
    assert.equal(value.items.length, 2)
    assert.equal(value.hasMore, true)
  } finally {
    await harness.close()
  }
})

test('document endpoints require a configured root and a registered workspace', async function () {
  const harness = await createHarness([])
  try {
    const workspace = await makeWorkspace(harness.tempRoot, 'w-unconfigured', 'Unconfigured')
    harness.addWorkspace(workspace)

    // 未配置需求根目录：requireRoot 先返回 400 unconfigured。
    let response = await harness.request('GET',
      '/documents?workspaceId=' + encodeURIComponent(workspace.id))
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'unconfigured')
    assert.equal(response.data.error.message, messages.unconfigured)

    response = await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
      title: 'Doc',
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'unconfigured')

    response = await harness.request('GET', '/document/search?q=x')
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'unconfigured')

    // 配置后：工作区不存在或未注册都返回 404 workspace-not-found。
    await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
    response = await harness.request('GET', '/documents?workspaceId=missing-workspace')
    assert.equal(response.status, 404)
    assert.equal(response.data.error.code, 'workspace-not-found')
    assert.equal(response.data.error.message, messages.workspaceNotFound)

    response = await harness.request('GET', '/documents')
    assert.equal(response.status, 404)
    assert.equal(response.data.error.code, 'workspace-not-found')

    // 工作区已注册但尚未初始化：列表为空、读取 404，创建会初始化目录。
    let listed = await listDocuments(harness, workspace.id)
    assert.deepEqual(listed.documents, [])
    expectError(await harness.request('POST', '/document/get', {
      workspaceId: workspace.id,
      id: 'DOC-20261031-001',
    }), 404, 'document-not-found')

    const created = expectOk(await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
      title: 'First doc',
      body: 'hello',
    }))
    listed = await listDocuments(harness, workspace.id)
    assert.deepEqual(listed.documents.map(function (item) { return item.id }), [created.document.id])
  } finally {
    await harness.close()
  }
})

test('invalid ids, traversal attempts, and symlinked directories/files are rejected', async function () {
  const { harness, workspace, folderPath } = await setupWorkspace()
  try {
    const created = expectOk(await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
      title: 'Safe doc',
      body: 'safe',
    }))
    const id = created.document.id

    // 非法 ID 与路径穿越：400 bad-document-id。
    for (const badId of [
      '../escape',
      'DOC-20261031-001/../../etc/passwd',
      'doc-20261031-001',
      'DOC-2026103-001',
      'DOC-20261031-01',
      '..',
      '',
    ]) {
      const error = expectError(await harness.request('POST', '/document/get', {
        workspaceId: workspace.id,
        id: badId,
      }), 400, 'bad-document-id')
      assert.equal(error.message, messages.badDocumentId, 'id=' + JSON.stringify(badId))
    }

    // 缺少 id 字段同样映射为 bad-document-id。
    expectError(await harness.request('POST', '/document/get', {
      workspaceId: workspace.id,
    }), 400, 'bad-document-id')

    // .documents 是符号链接：拒绝。
    const outside = path.join(harness.tempRoot, 'outside-documents')
    await fsp.mkdir(outside, { recursive: true })
    await fsp.writeFile(path.join(outside, id + '.md'), 'outside')
    const documentsDirectory = path.join(folderPath, DOCUMENTS_DIR)
    await fsp.rm(documentsDirectory, { recursive: true, force: true })
    await fsp.symlink(outside, documentsDirectory, 'dir')
    expectError(await harness.request('GET',
      '/documents?workspaceId=' + encodeURIComponent(workspace.id)), 400, 'symlink-not-allowed')
    expectError(await harness.request('POST', '/document/get', {
      workspaceId: workspace.id,
      id: id,
    }), 400, 'symlink-not-allowed')

    // 文件本身是符号链接：拒绝。
    await fsp.rm(documentsDirectory, { force: true })
    await fsp.mkdir(documentsDirectory, { recursive: true })
    const outsideFile = path.join(harness.tempRoot, 'outside-doc.md')
    await fsp.writeFile(outsideFile, 'outside file')
    await fsp.symlink(outsideFile, path.join(documentsDirectory, id + '.md'))
    expectError(await harness.request('POST', '/document/get', {
      workspaceId: workspace.id,
      id: id,
    }), 400, 'symlink-not-allowed')
  } finally {
    await harness.close()
  }
})

test('corrupt document files fail consistently and unrelated files are ignored', async function () {
  const { harness, workspace, folderPath } = await setupWorkspace()
  try {
    const directory = path.join(folderPath, DOCUMENTS_DIR)
    await fsp.mkdir(directory, { recursive: true })
    await fsp.writeFile(path.join(directory, 'README.md'), 'not a document\n')
    await fsp.writeFile(path.join(directory, 'notes.txt'), 'ignored\n')
    await fsp.writeFile(path.join(directory, '.hidden.md'), 'ignored\n')
    await fsp.mkdir(path.join(directory, 'DOC-20261031-050'))

    // 不符合文档命名/格式的文件被忽略，列表为空。
    assert.deepEqual((await listDocuments(harness, workspace.id)).documents, [])

    // 合法文件名但 frontmatter 损坏：扫描与读取都返回 500 documents-corrupt。
    await fsp.writeFile(path.join(directory, 'DOC-20261031-001.md'), 'broken document\n')
    let response = await harness.request('GET',
      '/documents?workspaceId=' + encodeURIComponent(workspace.id))
    assert.equal(response.status, 500)
    assert.equal(response.data.error.code, 'documents-corrupt')
    assert.equal(response.data.error.message, messages.documentsCorrupt)

    response = await harness.request('POST', '/document/get', {
      workspaceId: workspace.id,
      id: 'DOC-20261031-001',
    })
    assert.equal(response.status, 500)
    assert.equal(response.data.error.code, 'documents-corrupt')

    // id 与文件名不一致同样视为损坏。
    await fsp.writeFile(path.join(directory, 'DOC-20261031-002.md'), [
      '---',
      'id: "DOC-20261031-099"',
      'title: "Mismatch"',
      'createdAt: "' + FIXED_TIME + '"',
      'updatedAt: "' + FIXED_TIME + '"',
      '---',
      '',
      'body',
    ].join('\n'))
    response = await harness.request('GET',
      '/documents?workspaceId=' + encodeURIComponent(workspace.id))
    assert.equal(response.status, 500)
    assert.equal(response.data.error.code, 'documents-corrupt')
  } finally {
    await harness.close()
  }
})

test('create and save validate titles and body size', async function () {
  const { harness, workspace } = await setupWorkspace()
  try {
    let response = await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'missing-title')
    assert.equal(response.data.error.message, messages.missingTitle)

    response = await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
      title: '   ',
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'missing-title')

    response = await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
      title: 'x'.repeat(MAX_TITLE_LENGTH + 1),
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'bad-field')

    response = await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
      title: 'Too long body',
      body: 'x'.repeat(MAX_FILE_TEXT_BYTES + 1),
    })
    assert.equal(response.status, 413)
    assert.equal(response.data.error.code, 'document-too-large')
    assert.equal(response.data.error.message, messages.documentTooLarge)

    // 保存时同样校验正文大小；标题为空则沿用原标题（只有显式传入才改）。
    const created = expectOk(await harness.request('POST', '/document/create', {
      workspaceId: workspace.id,
      title: 'Keep title',
      body: 'body',
    }))
    response = await harness.request('POST', '/document/save', {
      workspaceId: workspace.id,
      id: created.document.id,
      body: 'x'.repeat(MAX_FILE_TEXT_BYTES + 1),
    })
    assert.equal(response.status, 413)
    assert.equal(response.data.error.code, 'document-too-large')

    response = await harness.request('POST', '/document/save', {
      workspaceId: workspace.id,
      id: created.document.id,
      title: '',
    })
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'bad-field')

    expectError(await harness.request('POST', '/document/delete', {
      workspaceId: workspace.id,
      id: 'DOC-20261031-999',
    }), 404, 'document-not-found')
    expectError(await harness.request('POST', '/document/save', {
      workspaceId: workspace.id,
      id: 'DOC-20261031-999',
      body: 'x',
    }), 404, 'document-not-found')
  } finally {
    await harness.close()
  }
})

test('domain helpers round-trip frontmatter, sort summaries, and delete real files', async function () {
  const { harness, folderPath } = await setupWorkspace()
  try {
    const created = await createDocument(folderPath, 'Domain doc', '# Title\n\nBody text\n')
    assert.match(created.document.id, DOC_ID_PATTERN)
    assert.equal(created.body, '# Title\n\nBody text\n')

    const loaded = await readDocument(folderPath, created.document.id)
    assert.deepEqual(loaded.document, created.document)
    assert.equal(loaded.body, '# Title\n\nBody text\n')

    // 冲突与 force 也能在 domain 层直接使用。
    await assert.rejects(saveDocument(folderPath, created.document.id, { body: 'v2' }, {
      expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
    }), function (error) { return error.status === 409 && error.code === 'document-conflict' })
    const forced = await saveDocument(folderPath, created.document.id, { body: 'v2' }, {
      expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
      force: true,
    })
    assert.equal(forced.body, 'v2')

    await seedDocument(folderPath, {
      id: 'DOC-20261028-900',
      title: 'Older',
      updatedAt: '2026-10-28T00:00:00.000Z',
    })
    const summaries = await scanDocumentSummaries(folderPath)
    assert.deepEqual(summaries.map(function (item) { return item.id }), [
      created.document.id,
      'DOC-20261028-900',
    ])

    // domain 层同样校验标题与正文大小（校验在返回 Promise 前同步抛出）。
    assert.throws(function () { return createDocument(folderPath, '   ', '') }, function (error) {
      return error.status === 400 && error.code === 'missing-title'
    })
    assert.throws(
      function () { return createDocument(folderPath, 'Big', 'x'.repeat(MAX_FILE_TEXT_BYTES + 1)) },
      function (error) { return error.status === 413 && error.code === 'document-too-large' },
    )

    assert.deepEqual(await deleteDocument(folderPath, created.document.id), {
      deleted: true,
      id: created.document.id,
    })
    await assert.rejects(readDocument(folderPath, created.document.id), function (error) {
      return error.status === 404 && error.code === 'document-not-found'
    })
  } finally {
    await harness.close()
  }
})
