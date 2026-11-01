import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  configureRoot,
  createHarness,
  createRequirement,
  expectOk,
  initWorkspace,
  makeWorkspace,
} from './helpers.js'
import { messages } from '../../src/host/messages/index.js'

/** 创建空 harness，注册一个工作区并初始化它的需求目录。 */
async function setupWorkspace() {
  const harness = await createHarness([])
  const workspace = await makeWorkspace(harness.tempRoot, 'w-fav', 'Favorite Workspace')
  harness.addWorkspace(workspace)
  await configureRoot(harness, path.join(harness.tempRoot, 'requirements-root'))
  const initialized = await initWorkspace(harness, workspace.id)
  return { harness, workspace, folderPath: initialized.folderPath }
}

function updatedAtLine(text) {
  const match = /^updatedAt: (.*)$/m.exec(text)
  return match === null ? '' : match[1]
}

function favoriteRequest(harness, workspaceId, id, favorite) {
  return harness.request('POST', '/requirement/favorite', {
    workspaceId,
    id,
    favorite,
  })
}

function expectError(result, status, code) {
  assert.equal(result.status, status, result.raw)
  assert.equal(result.data.ok, false)
  assert.equal(result.data.error.code, code)
  return result.data.error
}

test('favorite toggles persist in frontmatter without changing updatedAt', async function () {
  const { harness, workspace } = await setupWorkspace()
  try {
    const created = expectOk(await harness.request('POST', '/requirement/create', {
      workspaceId: workspace.id,
      title: 'Favorite me',
      body: '# Favorite me\n\nBody text.\n',
    }))
    const id = created.requirement.id
    const file = created.requirement.path
    assert.equal(created.requirement.favorite, false)

    const before = await fsp.readFile(file, 'utf8')
    assert.equal(/^favorite:/m.test(before), false)
    assert.equal(updatedAtLine(before), JSON.stringify(created.requirement.updatedAt))

    // 收藏：summary 与 frontmatter 都更新，updatedAt 保持不变。
    const favorited = expectOk(await favoriteRequest(harness, workspace.id, id, true))
    assert.equal(favorited.requirement.favorite, true)
    assert.equal(favorited.requirement.status, 'new')
    assert.equal(favorited.requirement.updatedAt, created.requirement.updatedAt)
    let text = await fsp.readFile(file, 'utf8')
    assert.match(text, /^favorite: true$/m)
    assert.equal(updatedAtLine(text), updatedAtLine(before))

    // 重新读取仍是收藏状态，正文与 updatedAt 未被改动。
    const detail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: workspace.id,
      id,
    }))
    assert.equal(detail.requirement.favorite, true)
    assert.equal(detail.requirement.updatedAt, created.requirement.updatedAt)
    assert.equal(detail.requirement.title, 'Favorite me')
    assert.equal(detail.body.includes('Body text.'), true)

    // 取消收藏：删除 frontmatter 中的 favorite 键，updatedAt 依旧不变。
    const unfavorited = expectOk(await favoriteRequest(harness, workspace.id, id, false))
    assert.equal(unfavorited.requirement.favorite, false)
    assert.equal(unfavorited.requirement.updatedAt, created.requirement.updatedAt)
    text = await fsp.readFile(file, 'utf8')
    assert.equal(/^favorite:/m.test(text), false)
    assert.equal(updatedAtLine(text), updatedAtLine(before))

    // 幂等：重复取消收藏也不报错。
    const again = expectOk(await favoriteRequest(harness, workspace.id, id, false))
    assert.equal(again.requirement.favorite, false)
  } finally {
    await harness.close()
  }
})

test('favorite is exposed on requirement create/get summaries and search items', async function () {
  const { harness, workspace } = await setupWorkspace()
  try {
    const first = await createRequirement(harness, workspace.id, 'Alpha needle', 'first body')
    const second = await createRequirement(harness, workspace.id, 'Beta needle', 'second body')
    expectOk(await favoriteRequest(harness, workspace.id, second.requirement.id, true))

    const value = expectOk(await harness.request('GET',
      '/requirement/search?workspaceId=' + encodeURIComponent(workspace.id) +
      '&q=needle&scope=full'))
    assert.equal(value.total, 2)
    const byId = new Map<any, any>(value.items.map(function (item) { return [item.id, item] }))
    assert.equal(byId.get(first.requirement.id).favorite, false)
    assert.equal(byId.get(second.requirement.id).favorite, true)
    for (const item of value.items) {
      assert.equal(Object.prototype.hasOwnProperty.call(item, 'favorite'), true)
    }

    // 需求列表（state）里的 summary 同样带 favorite。
    const state = expectOk(await harness.request('GET', '/state'))
    const row = state.workspaces.find(function (entry) {
      return entry.workspaceId === workspace.id
    })
    assert.notEqual(row, undefined)
    const favoriteRow = row.requirements.find(function (item) {
      return item.id === second.requirement.id
    })
    assert.equal(favoriteRow.favorite, true)
  } finally {
    await harness.close()
  }
})

test('favorite route rejects invalid fields and unknown requirements', async function () {
  const { harness, workspace } = await setupWorkspace()
  try {
    const created = await createRequirement(harness, workspace.id, 'Route guard', 'body')
    const id = created.requirement.id

    // favorite 必填且必须是布尔值。
    for (const body of [
      { workspaceId: workspace.id, id },
      { workspaceId: workspace.id, id, favorite: 'true' },
      { workspaceId: workspace.id, id, favorite: 1 },
      { workspaceId: workspace.id, id, favorite: null },
    ]) {
      const error = expectError(
        await harness.request('POST', '/requirement/favorite', body), 400, 'bad-field')
      assert.equal(error.message, messages.invalidField + ': favorite')
    }

    // 缺少必需字段由 readStringField 统一返回 bad-field。
    expectError(await favoriteRequest(harness, workspace.id, '', true), 400, 'bad-field')
    expectError(await favoriteRequest(harness, '', id, true), 400, 'bad-field')

    // 未知需求与未知工作区都是 requirement-not-found。
    const missing = expectError(await favoriteRequest(harness, workspace.id, 'REQ-20261031-999', true),
      404, 'requirement-not-found')
    assert.equal(missing.message, messages.requirementNotFound)
    expectError(await favoriteRequest(harness, 'missing-workspace', id, true),
      404, 'requirement-not-found')

    // 失败请求不改变已存在的收藏状态。
    const detail = expectOk(await harness.request('POST', '/requirement/get', {
      workspaceId: workspace.id,
      id,
    }))
    assert.equal(detail.requirement.favorite, false)
  } finally {
    await harness.close()
  }
})

test('favorite survives a normal save while the save still bumps updatedAt', async function () {
  const { harness, workspace } = await setupWorkspace()
  try {
    const created = await createRequirement(harness, workspace.id, 'Keep favorite', 'v1')
    const id = created.requirement.id
    const favorited = expectOk(await favoriteRequest(harness, workspace.id, id, true))
    const favoriteTime = favorited.requirement.updatedAt

    const saved = expectOk(await harness.request('POST', '/requirement/save', {
      workspaceId: workspace.id,
      id,
      title: 'Keep favorite (renamed)',
      expectedUpdatedAt: favoriteTime,
    }))
    assert.equal(saved.requirement.favorite, true)
    assert.equal(saved.requirement.title, 'Keep favorite (renamed)')
    // 普通保存会刷新 updatedAt（与收藏切换时的语义不同）。
    assert.equal(
      String(saved.requirement.updatedAt).localeCompare(String(favoriteTime)) >= 0,
      true,
    )

    const text = await fsp.readFile(saved.requirement.path, 'utf8')
    assert.match(text, /^favorite: true$/m)
  } finally {
    await harness.close()
  }
})
