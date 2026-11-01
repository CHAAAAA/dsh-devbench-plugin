/**
 * MCP management host tests (REQ-20261029-002).
 *
 * The DSH host normally supplies `profileContext`, `loader`, `configEditor`
 * and `hmr`. These tests emulate that surface over a temporary profile patch
 * file, so the route/service chain runs end to end: patch text is written,
 * reconciled against a fake Loader world and listed again.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHarness, expectOk } from './helpers.js'
import {
  MCP_CLIENT_MODULE,
  MCP_PATCH_BACKUP_PREFIX,
  MCP_SECRET_MASK,
} from '../../src/host/constants.js'
import * as patchText from '../../src/host/domain/profile-patch.js'

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

// ---- Minimal reader for the canonical YAML the patch editor emits ----------

function indentOf(line) {
  return line.length - line.trimStart().length
}

function isSkippable(line) {
  const text = line.trim()
  return text === '' || text.startsWith('#')
}

function nextMeaningful(lines, index) {
  for (let i = index; i < lines.length; i += 1) {
    if (isSkippable(lines[i]) === false) return i
  }
  return null
}

function parseScalar(raw) {
  const text = raw.trim()
  if (text.startsWith('"')) return JSON.parse(text)
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  return text
}

function parseBlock(lines, index, indent) {
  const start = nextMeaningful(lines, index)
  if (start === null) return [null, index]
  const current = indentOf(lines[start])
  if (current < indent) return [null, index]
  if (lines[start].trim().startsWith('- ')) return parseSequence(lines, start, current)
  return parseMapping(lines, start, current)
}

function parseMapping(lines, start, indent) {
  const out = {}
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (isSkippable(line)) {
      i += 1
      continue
    }
    const current = indentOf(line)
    if (current !== indent) break
    const body = line.trim()
    const colon = body.indexOf(':')
    if (colon < 0) throw new Error('test yaml: expected mapping at ' + JSON.stringify(line))
    const key = body.slice(0, colon).trim()
    const rest = body.slice(colon + 1).trim()
    i += 1
    if (rest === '[]') {
      out[key] = []
    } else if (rest === '{}') {
      out[key] = {}
    } else if (rest === '') {
      const nested = nextMeaningful(lines, i)
      if (nested === null || indentOf(lines[nested]) <= indent) {
        out[key] = null
      } else {
        const parsed = parseBlock(lines, nested, indentOf(lines[nested]))
        out[key] = parsed[0]
        i = parsed[1]
      }
    } else {
      out[key] = parseScalar(rest)
    }
  }
  return [out, i]
}

function parseSequence(lines, start, indent) {
  const out = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (isSkippable(line)) {
      i += 1
      continue
    }
    const current = indentOf(line)
    if (current !== indent) break
    const body = line.trim()
    if (body.startsWith('- ') === false) break
    const rest = body.slice(2).trim()
    i += 1
    if (rest === '') {
      const parsed = parseBlock(lines, i, indent + 1)
      out.push(parsed[0])
      i = parsed[1]
    } else if (/^"[^"]*"$/.test(rest) || rest.startsWith('"')) {
      out.push(parseScalar(rest))
    } else if (rest.includes(':')) {
      throw new Error('test yaml: mapping sequence items are not supported')
    } else {
      out.push(parseScalar(rest))
    }
  }
  return [out, i]
}

function parseGeneratedBlock(lines, startIndex, parentIndent) {
  const parsed = parseBlock(lines, startIndex, parentIndent + 1)
  return parsed
}

function findFieldLine(lines, range, key) {
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (lines[i].trim().startsWith(key + ':')) return i
  }
  return -1
}

function readConfigField(lines, range) {
  const index = findFieldLine(lines, range, 'config')
  if (index < 0) return {}
  const line = lines[index]
  const rest = line.trim().slice('config:'.length).trim()
  if (rest !== '') return parseScalar(rest)
  const parsed = parseGeneratedBlock(lines, index + 1, indentOf(line))
  return parsed[0] === null ? {} : parsed[0]
}

function readDisabledField(lines, range) {
  const index = findFieldLine(lines, range, 'disabled')
  if (index < 0) return null
  const rest = lines[index].trim().slice('disabled:'.length).trim()
  return rest === 'true' ? true : (rest === 'false' ? false : null)
}

// ---- Fake DSH host services ------------------------------------------------

class FakeDsh {
  tempRoot: any
  patchPath: any
  profile: any
  extra: any[]
  records: any[]
  addressable: Set<any>
  invalidIds: Set<any>
  editError: any
  rejectNext: any
  rejectCount: number
  nextReconcileResult: any
  editBeforeChange: any
  ignoreOverrides: boolean
  options: any

  constructor(tempRoot) {
    this.tempRoot = tempRoot
    this.patchPath = path.join(tempRoot, 'cordis.patch.yml')
    this.profile = { name: 'desktop', patchPath: this.patchPath }
    this.extra = []
    this.records = []
    this.addressable = new Set()
    this.invalidIds = new Set()
    this.editError = null
    this.rejectNext = null
    this.rejectCount = 0
    this.nextReconcileResult = null
    this.editBeforeChange = null
    this.ignoreOverrides = false
  }

  static async create(tempRoot, options) {
    const fake = new FakeDsh(tempRoot)
    fake.options = options || {}
    await fsp.writeFile(fake.patchPath, fake.options.patchText || '[]\n')
    return fake
  }

  async readText() {
    return fsp.readFile(this.patchPath, 'utf8')
  }

  async writeText(text) {
    await fsp.writeFile(this.patchPath, text)
  }

  async seedProfileServer(record) {
    const text = await this.readText()
    await this.writeText(patchText.appendInsertRow(text, {
      id: record.id,
      name: MCP_CLIENT_MODULE,
      config: record.config,
    }))
    this.addressable.add(record.id)
    await this.reconcile([])
  }

  async seedBundleServer(record) {
    this.extra.push({
      id: record.id,
      config: clone(record.config),
      disabled: false,
      effective: clone(record.effective),
      failed: record.failed === true,
    })
    this.addressable.add(record.id)
    await this.reconcile([])
  }

  async appendRow(row) {
    const text = await this.readText()
    await this.writeText(patchText.appendPatchRow(text, row))
    await this.reconcile([])
  }

  async reconcile(requiredIds) {
    if (this.rejectCount > 0) {
      this.rejectCount -= 1
      throw new Error('mcp profile reload failed')
    }
    if (this.rejectNext !== null) {
      const error = this.rejectNext
      this.rejectNext = null
      throw (error instanceof Error ? error : new Error(String(error)))
    }
    const text = await this.readText()
    const doc = patchText.scanPatch(text)
    const lines = text.split(/\r?\n/)
    const records = new Map()
    for (const server of this.extra) records.set(server.id, clone(server))
    for (const item of doc.items) {
      if (item.insert) {
        for (const row of item.inserted) {
          if (row.name !== MCP_CLIENT_MODULE) continue
          const config = readConfigField(lines, row)
          records.set(row.id, {
            id: row.id,
            source: 'profile',
            disabled: false,
            config,
            effective: config,
          })
        }
        continue
      }
      if (typeof item.id !== 'string' || this.ignoreOverrides) continue
      const record = records.get(item.id)
      if (record === undefined) continue
      const disabled = readDisabledField(lines, item)
      if (disabled !== null) record.disabled = disabled
      const config = readConfigField(lines, item)
      if (config !== null && Object.keys(config).length > 0) {
        record.config = config
        record.effective = config
      }
    }
    for (const id of requiredIds || []) {
      const record = records.get(id)
      if (record === undefined || record.disabled === true) {
        throw new Error('mcp client entry not active: ' + id)
      }
    }
    this.records = [...records.values()]
    const extra = this.nextReconcileResult
    this.nextReconcileResult = null
    return Object.assign({ warnings: [] }, extra === null ? {} : extra)
  }

  entries() {
    return this.records.map(function (record) {
      const disabled = record.disabled === true
      const failed = record.failed === true
      const config = clone(record.config)
      return {
        options: { id: record.id, name: MCP_CLIENT_MODULE, config: config },
        disabled: disabled,
        fiber: disabled ? undefined : {
          state: failed ? 3 : 2,
          config: clone(record.effective === undefined ? config : record.effective),
          _error: failed ? new Error('mcp client startup failed') : undefined,
        },
      }
    })
  }

  configEditor() {
    const fake = this
    return {
      entries() {
        return fake.entries().filter(function (entry) {
          return fake.addressable.has(entry.options.id)
        })
      },
      async edit(entry, change) {
        if (fake.editError !== null) {
          const error = fake.editError
          fake.editError = null
          throw error
        }
        const record = fake.records.find(function (item) { return item.id === entry.options.id })
        if (record === undefined) throw new Error('Configuration entry is no longer available')
        await fsp.chmod(fake.patchPath, 0o600)
        if (typeof fake.editBeforeChange === 'function') fake.editBeforeChange(record)
        const next = change(clone(record.config), clone(record.config))
        record.config = clone(next)
        const sentinelKeys = []
        for (const key of Object.keys(next || {})) {
          const value = next[key]
          if (value !== null && typeof value === 'object' && typeof value.__jsExpr === 'string') sentinelKeys.push(key)
        }
        const previous = record.effective === undefined ? {} : record.effective
        record.effective = {}
        for (const key of Object.keys(next || {})) {
          record.effective[key] = sentinelKeys.includes(key) && previous[key] !== undefined ? previous[key] : clone(next[key])
        }
      },
    }
  }

  hmr() {
    const fake = this
    return {
      runExclusive(operation) {
        return Promise.resolve().then(operation)
      },
      reconcileProfile(requiredIds) {
        return fake.reconcile(requiredIds)
      },
    }
  }

  services(options: any) {
    const config = options || {}
    const services: any = {
      profileContext: this.profile,
      loader: { entries: () => this.entries() },
      configEditor: this.configEditor(),
    }
    if (config.tools !== undefined) services.tools = config.tools
    if (config.hmr !== false) services.hmr = this.hmr()
    return services
  }

  async backupFiles() {
    const names = await fsp.readdir(this.tempRoot)
    return names.filter(function (name) { return name.includes(MCP_PATCH_BACKUP_PREFIX) })
  }
}

async function withHostMounted(options, setup, run) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'devbench-mcp-'))
  const fake = await FakeDsh.create(tempRoot, options)
  if (typeof setup === 'function') await setup(fake)
  const harness = await createHarness([], { services: fake.services(options) })
  try {
    await run({ harness, fake })
  } finally {
    await harness.close()
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }
}

async function withHost(setup, run) {
  return withHostMounted({}, setup, run)
}

function requestMcp(harness: any, method: any, route: any, body?: any) {
  return harness.request(method, route, body)
}

const DB_CONFIG = {
  serverName: 'db-metadata',
  transport: 'stdio',
  command: 'node',
  args: ['/pkg/dist/index.js'],
  env: { DB_METADATA_CONFIG: '/pkg/config.json', API_TOKEN: 'super-secret-token' },
}

// ---- list -----------------------------------------------------------------

test('GET /mcp lists profile MCP rows with masked secrets', async function () {
  await withHostMounted({
    tools: {
      view() {
        return { visible: new Map([['mcp__db-metadata__query', {}], ['mcp__db-metadata__list', {}], ['bash', {}]]) }
      },
    },
  }, async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
  }, async function ({ harness, fake }) {
    const value = expectOk(await requestMcp(harness, 'GET', '/mcp'))
    assert.equal(value.available, true)
    assert.equal(value.canWrite, true)
    assert.equal(value.hotReload, true)
    assert.equal(value.profile.name, 'desktop')
    assert.equal(value.profile.patchPath, fake.patchPath)
    assert.equal(value.servers.length, 1)
    const server = value.servers[0]
    assert.equal(server.id, 'db-metadata')
    assert.equal(server.serverName, 'db-metadata')
    assert.equal(server.transport, 'stdio')
    assert.deepEqual(server.args, ['/pkg/dist/index.js'])
    assert.equal(server.phase, 'active')
    assert.equal(server.enabled, true)
    assert.equal(server.source, 'profile')
    assert.equal(server.canEdit, true)
    assert.equal(server.canDelete, true)
    assert.equal(server.toolCount, 2)
    assert.equal(server.env.DB_METADATA_CONFIG, '/pkg/config.json')
    assert.equal(server.env.API_TOKEN, MCP_SECRET_MASK)
    assert.equal(server.config.env.API_TOKEN, MCP_SECRET_MASK)
    assert.equal(server.config.env.DB_METADATA_CONFIG, '/pkg/config.json')
  })
})

test('GET /mcp reports an unavailable host without profile services', async function () {
  const harness = await createHarness([], {})
  try {
    const value = expectOk(await harness.request('GET', '/mcp'))
    assert.equal(value.available, false)
    assert.deepEqual(value.servers, [])
    const rejected = await harness.request('POST', '/mcp/save', {
      mode: 'create',
      server: DB_CONFIG,
    })
    assert.equal(rejected.status, 409)
    assert.equal(rejected.data.error.code, 'mcp-unavailable')
  } finally {
    await harness.close()
  }
})

test('GET /mcp lists a disabled row and marks bundle rows', async function () {
  await withHost(async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
    await fake.seedBundleServer({ id: 'bundle-mcp', config: { serverName: 'bundle', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp' } })
    await fake.appendRow({ id: 'db-metadata', name: MCP_CLIENT_MODULE, disabled: true })
  }, async function ({ harness }) {
    const value = expectOk(await requestMcp(harness, 'GET', '/mcp'))
    const disabled = value.servers.find(function (item) { return item.id === 'db-metadata' })
    assert.equal(disabled.phase, 'disabled')
    assert.equal(disabled.enabled, false)
    const bundled = value.servers.find(function (item) { return item.id === 'bundle-mcp' })
    assert.equal(bundled.source, 'bundle')
    assert.equal(bundled.canDelete, false)
    assert.equal(bundled.transport, 'streamable-http')
  })
})

test('GET /mcp refuses to edit an unsupported patch document', async function () {
  await withHost(async function (fake) {
    await fake.writeText('not a patch sequence\n')
  }, async function ({ harness }) {
    const value = expectOk(await requestMcp(harness, 'GET', '/mcp'))
    assert.equal(value.available, true)
    assert.equal(value.canWrite, false)
    assert.equal(value.patchError.length > 0, true)
    const rejected = await harness.request('POST', '/mcp/save', { mode: 'create', server: DB_CONFIG })
    assert.equal(rejected.status, 409)
    assert.equal(rejected.data.error.code, 'mcp-unsupported-format')
  })
})

const EXPR_CONFIG = {
  serverName: 'github',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: {
    GITHUB_TOKEN: { __jsExpr: 'process.env.GITHUB_TOKEN' },
    REPO: 'dsh/devbench',
  },
  cwd: { __jsExpr: 'process.cwd()' },
}
const EXPR_EFFECTIVE = {
  serverName: 'github',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_TOKEN: 'ghp_live_value', REPO: 'dsh/devbench' },
  cwd: '/Users/example/workspace',
}

test('GET /mcp shows !!js source instead of evaluated values and masks secrets', async function () {
  await withHost(async function (fake) {
    await fake.seedBundleServer({ id: 'gh-mcp', config: EXPR_CONFIG, effective: EXPR_EFFECTIVE })
  }, async function ({ harness }) {
    const server = expectOk(await requestMcp(harness, 'GET', '/mcp')).servers[0]
    assert.equal(server.env.GITHUB_TOKEN, MCP_SECRET_MASK)
    assert.equal(server.env.REPO, 'dsh/devbench')
    assert.equal(server.cwd, '!!js process.cwd()')
    assert.equal(server.command, 'npx')
    assert.equal(server.config.cwd, '!!js process.cwd()')
    assert.equal(server.config.env.GITHUB_TOKEN, MCP_SECRET_MASK)
    assert.equal(server.config.env.REPO, 'dsh/devbench')
    assert.equal(server.phase, 'active')
    // Evaluated secrets never reach the browser through expression display.
    assert.equal(JSON.stringify(server).includes('ghp_live_value'), false)
    assert.equal(JSON.stringify(server).includes('/Users/example/workspace'), false)
  })
})

test('POST /mcp/save keeps !!js expressions whose displayed value is unchanged', async function () {
  await withHost(async function (fake) {
    await fake.seedBundleServer({ id: 'gh-mcp', config: EXPR_CONFIG, effective: EXPR_EFFECTIVE })
  }, async function ({ harness, fake }) {
    const value = expectOk(await requestMcp(harness, 'POST', '/mcp/save', {
      mode: 'update',
      id: 'gh-mcp',
      server: {
        serverName: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        cwd: '!!js process.cwd()',
        env: { GITHUB_TOKEN: MCP_SECRET_MASK, REPO: 'dsh/devbench' },
      },
    }))
    assert.equal(value.action, 'updated')
    const record = fake.records.find(function (item) { return item.id === 'gh-mcp' })
    assert.deepEqual(record.config.cwd, { __jsExpr: 'process.cwd()' })
    assert.deepEqual(record.config.env.GITHUB_TOKEN, { __jsExpr: 'process.env.GITHUB_TOKEN' })
    assert.equal(record.config.env.REPO, 'dsh/devbench')
    // A changed display value replaces the expression with a literal.
    expectOk(await requestMcp(harness, 'POST', '/mcp/save', {
      mode: 'update',
      id: 'gh-mcp',
      server: {
        serverName: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        cwd: '/tmp/other',
        env: { GITHUB_TOKEN: MCP_SECRET_MASK, REPO: 'dsh/devbench' },
      },
    }))
    const updated = fake.records.find(function (item) { return item.id === 'gh-mcp' })
    assert.equal(updated.config.cwd, '/tmp/other')
    assert.deepEqual(updated.config.env.GITHUB_TOKEN, { __jsExpr: 'process.env.GITHUB_TOKEN' })
  })
})

test('GET /mcp reports a failed row as read-only with its error', async function () {
  await withHost(async function (fake) {
    await fake.seedBundleServer({
      id: 'broken-mcp',
      config: { serverName: 'broken', transport: 'stdio', command: 'node' },
      failed: true,
    })
  }, async function ({ harness }) {
    const server = expectOk(await requestMcp(harness, 'GET', '/mcp')).servers[0]
    assert.equal(server.phase, 'failed')
    assert.equal(server.error.includes('startup failed'), true)
    assert.equal(server.canEdit, false)
    assert.equal(server.readOnlyReason, 'failed')
  })
})

const ARGS_EXPR_CONFIG = {
  serverName: 'arg-mcp',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', { __jsExpr: 'process.env.ARG_VALUE' }],
}
const ARGS_EXPR_EFFECTIVE = {
  serverName: 'arg-mcp',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'resolved arg value'],
}

test('POST /mcp/save keeps each unchanged !!js argument in place', async function () {
  await withHost(async function (fake) {
    await fake.seedBundleServer({ id: 'arg-mcp', config: ARGS_EXPR_CONFIG, effective: ARGS_EXPR_EFFECTIVE })
  }, async function ({ harness, fake }) {
    const before = expectOk(await requestMcp(harness, 'GET', '/mcp')).servers[0]
    assert.deepEqual(before.args, ['-y', '!!js process.env.ARG_VALUE'])
    expectOk(await requestMcp(harness, 'POST', '/mcp/save', {
      mode: 'update',
      id: 'arg-mcp',
      server: {
        serverName: 'arg-mcp',
        transport: 'stdio',
        command: 'npx',
        args: ['-x', '!!js process.env.ARG_VALUE'],
      },
    }))
    const record = fake.records.find(function (item) { return item.id === 'arg-mcp' })
    assert.deepEqual(record.config.args, ['-x', { __jsExpr: 'process.env.ARG_VALUE' }])
    assert.equal(JSON.stringify(record.config).includes('resolved arg value'), false)
  })
})

test('POST /mcp/save rejects !!js expressions when creating a server', async function () {
  await withHost(undefined, async function ({ harness }) {
    const rejected = await harness.request('POST', '/mcp/save', {
      mode: 'create',
      server: { serverName: 'expr-mcp', transport: 'stdio', command: '!!js process.env.CMD' },
    })
    assert.equal(rejected.status, 400)
    assert.equal(rejected.data.error.code, 'mcp-bad-expression')
  })
})

test('POST /mcp/save keeps the profile patch file mode on update', async function () {
  await withHost(async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
    await fsp.chmod(fake.patchPath, 0o640)
  }, async function ({ harness, fake }) {
    expectOk(await requestMcp(harness, 'POST', '/mcp/save', {
      mode: 'update',
      id: 'db-metadata',
      server: { serverName: 'db-metadata', transport: 'stdio', command: 'node', args: ['/pkg/a.js'] },
    }))
    const stat = await fsp.stat(fake.patchPath)
    assert.equal(stat.mode & 0o777, 0o640)
  })
})

test('POST /mcp/save rebuilds from the config editor current value', async function () {
  await withHost(async function (fake) {
    await fake.seedBundleServer({
      id: 'concurrent-mcp',
      config: {
        serverName: 'concurrent',
        transport: 'stdio',
        command: 'node',
        maxInstructionBytes: 100,
      },
    })
    // Simulate another tab editing an untouched field just before our change
    // callback: the rebuilt config must start from the fresh current value.
    fake.editBeforeChange = function (record) {
      record.config.maxInstructionBytes = 4096
    }
  }, async function ({ harness, fake }) {
    expectOk(await requestMcp(harness, 'POST', '/mcp/save', {
      mode: 'update',
      id: 'concurrent-mcp',
      server: {
        serverName: 'concurrent', transport: 'stdio', command: 'node', args: ['--verbose'],
      },
    }))
    const record = fake.records.find(function (item) { return item.id === 'concurrent-mcp' })
    assert.equal(record.config.maxInstructionBytes, 4096)
    assert.deepEqual(record.config.args, ['--verbose'])
  })
})

test('POST /mcp/save reports restartRequired when HMR needs a restart', async function () {
  await withHost(async function (fake) {
    fake.nextReconcileResult = { warnings: [], restartReason: 'module-comparison' }
  }, async function ({ harness }) {
    const value = expectOk(await requestMcp(harness, 'POST', '/mcp/save', {
      mode: 'create',
      server: { serverName: 'restart-mcp', transport: 'stdio', command: 'npx' },
    }))
    assert.equal(value.restartRequired, true)
  })
})

test('POST /mcp/save surfaces a failed rollback instead of hiding it', async function () {
  await withHost(async function (fake) {
    // Both the apply reload and the rollback reload reject.
    fake.rejectCount = 2
  }, async function ({ harness }) {
    const rejected = await harness.request('POST', '/mcp/save', {
      mode: 'create',
      server: { serverName: 'rollback-mcp', transport: 'stdio', command: 'npx' },
    })
    assert.equal(rejected.status, 500)
    assert.equal(rejected.data.error.code, 'mcp-rollback-failed')
  })
})

test('POST /mcp/save with HMR disabled applies edits immediately', async function () {
  await withHostMounted({ hmr: false }, async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
  }, async function ({ harness, fake }) {
    const value = expectOk(await requestMcp(harness, 'POST', '/mcp/save', {
      mode: 'update',
      id: 'db-metadata',
      server: { serverName: 'db-metadata', transport: 'stdio', command: 'node', args: ['/pkg/new.js'] },
    }))
    assert.equal(value.action, 'updated')
    assert.equal(value.restartRequired, false)
    assert.deepEqual(fake.records.find(function (item) { return item.id === 'db-metadata' }).config.args, ['/pkg/new.js'])
  })
})

test('GET /mcp masks private key, cookie and session values', async function () {
  await withHost(async function (fake) {
    await fake.seedBundleServer({
      id: 'secrets-mcp',
      config: {
        serverName: 'secrets',
        transport: 'stdio',
        command: 'node',
        env: { PRIVATE_KEY: 'pk', COOKIE: 'c', SESSION: 's', NORMAL: 'n' },
      },
    })
  }, async function ({ harness }) {
    const server = expectOk(await requestMcp(harness, 'GET', '/mcp')).servers[0]
    assert.equal(server.env.PRIVATE_KEY, MCP_SECRET_MASK)
    assert.equal(server.env.COOKIE, MCP_SECRET_MASK)
    assert.equal(server.env.SESSION, MCP_SECRET_MASK)
    assert.equal(server.env.NORMAL, 'n')
  })
})

test('GET /mcp marks a bundle row editable but not deletable', async function () {
  await withHost(async function (fake) {
    await fake.seedBundleServer({ id: 'bundle-mcp', config: { serverName: 'bundle', transport: 'stdio', command: 'node' } })
  }, async function ({ harness }) {
    const server = expectOk(await requestMcp(harness, 'GET', '/mcp')).servers[0]
    assert.equal(server.source, 'bundle')
    assert.equal(server.canEdit, true)
    assert.equal(server.canToggle, true)
    assert.equal(server.canDelete, false)
    assert.equal(server.readOnlyReason, '')
  })
})

// ---- create ---------------------------------------------------------------

test('POST /mcp/save creates a stdio row, backs up the patch and hot reloads', async function () {
  await withHost(undefined, async function ({ harness, fake }) {
    const value = expectOk(await requestMcp(harness, 'POST', '/mcp/save', {
      mode: 'create',
      server: {
        serverName: 'demo',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: { DEMO_TOKEN: 'plain' },
        failOnStartupError: true,
        toolCallTimeoutMs: 5000,
      },
    }))
    assert.equal(value.action, 'created')
    assert.equal(value.restartRequired, false)
    const created = value.servers.find(function (item) { return item.serverName === 'demo' })
    assert.notEqual(created, undefined)
    assert.equal(created.id, 'mcp-demo')
    assert.equal(created.source, 'profile')
    assert.equal(created.phase, 'active')
    assert.deepEqual(created.args, ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'])
    const text = await fake.readText()
    assert.equal(text.includes('id: "mcp-demo"'), true)
    assert.equal(text.includes('name: "@deepseek-ai/dsh-mcp-client"'), true)
    assert.equal(text.includes('serverName: "demo"'), true)
    assert.equal(text.includes('failOnStartupError: true'), true)
    const backups = await fake.backupFiles()
    assert.equal(backups.length, 1)
    assert.equal(await fsp.readFile(path.join(fake.tempRoot, backups[0]), 'utf8'), '[]\n')
  })
})

test('POST /mcp/save creates a streamable-http row', async function () {
  await withHost(undefined, async function ({ harness }) {
    const value = expectOk(await requestMcp(harness, 'POST', '/mcp/save', {
      mode: 'create',
      server: {
        serverName: 'web-demo',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:3000/mcp',
        headers: { Authorization: 'Bearer x' },
      },
    }))
    const created = value.servers.find(function (item) { return item.serverName === 'web-demo' })
    assert.notEqual(created, undefined)
    assert.equal(created.transport, 'streamable-http')
    assert.equal(created.url, 'http://127.0.0.1:3000/mcp')
    assert.equal(created.headers.Authorization, MCP_SECRET_MASK)
  })
})

test('POST /mcp/save rejects duplicate server names and invalid fields', async function () {
  await withHost(async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
  }, async function ({ harness }) {
    const duplicate = await harness.request('POST', '/mcp/save', {
      mode: 'create', server: { serverName: 'db-metadata', transport: 'stdio', command: 'node' },
    })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.data.error.code, 'mcp-duplicate-name')

    const badName = await harness.request('POST', '/mcp/save', {
      mode: 'create', server: { serverName: 'bad name!', transport: 'stdio', command: 'node' },
    })
    assert.equal(badName.status, 400)
    assert.equal(badName.data.error.code, 'mcp-bad-name')

    const missingCommand = await harness.request('POST', '/mcp/save', {
      mode: 'create', server: { serverName: 'demo', transport: 'stdio' },
    })
    assert.equal(missingCommand.status, 400)
    assert.equal(missingCommand.data.error.code, 'mcp-missing-command')

    const badUrl = await harness.request('POST', '/mcp/save', {
      mode: 'create', server: { serverName: 'demo2', transport: 'streamable-http', url: 'ftp://x' },
    })
    assert.equal(badUrl.status, 400)
    assert.equal(badUrl.data.error.code, 'mcp-bad-url')

    const maskedOnCreate = await harness.request('POST', '/mcp/save', {
      mode: 'create',
      server: { serverName: 'demo3', transport: 'stdio', command: 'node', env: { TOKEN: MCP_SECRET_MASK } },
    })
    assert.equal(maskedOnCreate.status, 400)
    assert.equal(maskedOnCreate.data.error.code, 'mcp-secret-missing')
  })
})

test('POST /mcp/save rolls back when the reload rejects the new row', async function () {
  await withHost(undefined, async function ({ harness, fake }) {
    fake.rejectNext = new Error('mcp client config invalid')
    const rejected = await harness.request('POST', '/mcp/save', {
      mode: 'create', server: { serverName: 'demo', transport: 'stdio', command: 'npx' },
    })
    assert.equal(rejected.status, 409)
    assert.equal(rejected.data.error.code, 'mcp-apply-failed')
    assert.equal(await fake.readText(), '[]\n')
    const value = expectOk(await requestMcp(harness, 'GET', '/mcp'))
    assert.equal(value.servers.length, 0)
  })
})

test('POST /mcp/save without HMR reports restartRequired', async function () {
  await withHostMounted({ hmr: false }, undefined, async function ({ harness, fake }) {
    const value = expectOk(await requestMcp(harness, 'POST', '/mcp/save', {
      mode: 'create', server: { serverName: 'demo', transport: 'stdio', command: 'npx' },
    }))
    assert.equal(value.action, 'created')
    assert.equal(value.restartRequired, true)
    assert.equal(value.hotReload, false)
    assert.equal((await fake.readText()).includes('mcp-demo'), true)
  })
})

// ---- update ---------------------------------------------------------------

test('POST /mcp/save updates a row and keeps masked secrets', async function () {
  await withHost(async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
  }, async function ({ harness, fake }) {
    const value = expectOk(await requestMcp(harness, 'POST', '/mcp/save', {
      mode: 'update',
      id: 'db-metadata',
      server: {
        serverName: 'db-metadata',
        transport: 'stdio',
        command: 'node',
        args: ['/pkg/dist/index.js', '--verbose'],
        env: { API_TOKEN: MCP_SECRET_MASK, DB_METADATA_CONFIG: '/pkg/new.json' },
      },
    }))
    assert.equal(value.action, 'updated')
    assert.equal(value.restartRequired, false)
    const record = fake.records.find(function (item) { return item.id === 'db-metadata' })
    assert.deepEqual(record.config.args, ['/pkg/dist/index.js', '--verbose'])
    assert.equal(record.config.env.API_TOKEN, 'super-secret-token')
    assert.equal(record.config.env.DB_METADATA_CONFIG, '/pkg/new.json')
    const server = value.servers.find(function (item) { return item.id === 'db-metadata' })
    assert.equal(server.env.API_TOKEN, MCP_SECRET_MASK)
    assert.deepEqual(server.args, ['/pkg/dist/index.js', '--verbose'])
  })
})

test('POST /mcp/save switching transport drops stale fields', async function () {
  await withHost(async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
  }, async function ({ harness, fake }) {
    expectOk(await requestMcp(harness, 'POST', '/mcp/save', {
      mode: 'update',
      id: 'db-metadata',
      server: {
        serverName: 'db-metadata',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:9000/mcp',
        headers: {},
      },
    }))
    const record = fake.records.find(function (item) { return item.id === 'db-metadata' })
    assert.equal(record.config.transport, 'streamable-http')
    assert.equal(record.config.url, 'http://127.0.0.1:9000/mcp')
    assert.equal('command' in record.config, false)
    assert.equal('args' in record.config, false)
    assert.equal('env' in record.config, false)
  })
})

test('POST /mcp/save refuses editing a disabled row and an unknown row', async function () {
  await withHost(async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
    await fake.appendRow({ id: 'db-metadata', name: MCP_CLIENT_MODULE, disabled: true })
  }, async function ({ harness }) {
    const disabled = await harness.request('POST', '/mcp/save', {
      mode: 'update', id: 'db-metadata', server: { serverName: 'db-metadata', transport: 'stdio', command: 'node' },
    })
    assert.equal(disabled.status, 409)
    assert.equal(disabled.data.error.code, 'mcp-inactive')
    const missing = await harness.request('POST', '/mcp/save', {
      mode: 'update', id: 'nope', server: { serverName: 'nope', transport: 'stdio', command: 'node' },
    })
    assert.equal(missing.status, 404)
    assert.equal(missing.data.error.code, 'mcp-not-found')
  })
})

test('POST /mcp/save surfaces a config editor failure', async function () {
  await withHost(async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
    fake.editError = new Error('Configuration entry is no longer available')
  }, async function ({ harness }) {
    const rejected = await harness.request('POST', '/mcp/save', {
      mode: 'update', id: 'db-metadata', server: { serverName: 'db-metadata', transport: 'stdio', command: 'node' },
    })
    assert.equal(rejected.status, 409)
    assert.equal(rejected.data.error.code, 'mcp-apply-failed')
  })
})

// ---- delete / toggle ------------------------------------------------------

test('POST /mcp/delete removes a profile patch row', async function () {
  await withHost(async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
  }, async function ({ harness, fake }) {
    const value = expectOk(await requestMcp(harness, 'POST', '/mcp/delete', { id: 'db-metadata' }))
    assert.equal(value.action, 'deleted')
    assert.equal(value.restartRequired, false)
    assert.equal(value.servers.length, 0)
    assert.equal((await fake.readText()).includes('db-metadata'), false)
    const backups = await fake.backupFiles()
    assert.equal(backups.length, 1)
    const backup = await fsp.readFile(path.join(fake.tempRoot, backups[0]), 'utf8')
    assert.equal(backup.includes('db-metadata'), true)
  })
})

test('POST /mcp/delete keeps a loadable patch file when the last row goes', async function () {
  await withHostMounted({
    patchText: '# profile patch header\n# second comment line\n[]\n',
  }, async function (fake) {
    await fake.seedProfileServer({
      id: 'only-mcp',
      config: { serverName: 'only', transport: 'stdio', command: 'node' },
    })
  }, async function ({ harness, fake }) {
    const value = expectOk(await requestMcp(harness, 'POST', '/mcp/delete', { id: 'only-mcp' }))
    assert.equal(value.action, 'deleted')
    assert.equal(value.servers.length, 0)
    const text = await fake.readText()
    assert.equal(text.includes('# profile patch header'), true)
    assert.equal(text.includes('# second comment line'), true)
    assert.equal(text.trim().endsWith('[]'), true)
    const listed = expectOk(await requestMcp(harness, 'GET', '/mcp'))
    assert.equal(listed.servers.length, 0)
  })
})

test('POST /mcp/delete rolls back the file when the reload rejects the removal', async function () {
  await withHost(async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
    fake.rejectNext = new Error('profile reload failed')
  }, async function ({ harness, fake }) {
    const before = await fake.readText()
    const rejected = await harness.request('POST', '/mcp/delete', { id: 'db-metadata' })
    assert.equal(rejected.status, 409)
    assert.equal(rejected.data.error.code, 'mcp-apply-failed')
    assert.equal(await fake.readText(), before)
    const listed = expectOk(await requestMcp(harness, 'GET', '/mcp'))
    assert.equal(listed.servers.some(function (item) { return item.id === 'db-metadata' }), true)
  })
})

test('POST /mcp/delete disables a bundle-provided row', async function () {
  await withHost(async function (fake) {
    await fake.seedBundleServer({ id: 'bundle-mcp', config: { serverName: 'bundle', transport: 'stdio', command: 'node' } })
  }, async function ({ harness, fake }) {
    const value = expectOk(await requestMcp(harness, 'POST', '/mcp/delete', { id: 'bundle-mcp' }))
    assert.equal(value.action, 'disabled')
    const server = value.servers.find(function (item) { return item.id === 'bundle-mcp' })
    assert.equal(server.phase, 'disabled')
    const text = await fake.readText()
    assert.equal(text.includes('id: "bundle-mcp"'), true)
    assert.equal(text.includes('disabled: true'), true)
  })
})

test('POST /mcp/toggle enables and disables a row', async function () {
  await withHost(async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
  }, async function ({ harness, fake }) {
    const disabled = expectOk(await requestMcp(harness, 'POST', '/mcp/toggle', { id: 'db-metadata', enabled: false }))
    assert.equal(disabled.action, 'disabled')
    assert.equal(disabled.servers.find(function (item) { return item.id === 'db-metadata' }).phase, 'disabled')
    const enabled = expectOk(await requestMcp(harness, 'POST', '/mcp/toggle', { id: 'db-metadata', enabled: true }))
    assert.equal(enabled.action, 'enabled')
    assert.equal(enabled.servers.find(function (item) { return item.id === 'db-metadata' }).phase, 'active')
    assert.equal(fake.records.find(function (item) { return item.id === 'db-metadata' }).config.env.API_TOKEN, 'super-secret-token')
  })
})

test('POST /mcp/toggle rolls back when a higher-priority config overrides it', async function () {
  await withHost(async function (fake) {
    await fake.seedProfileServer({ id: 'db-metadata', config: DB_CONFIG })
    fake.ignoreOverrides = true
  }, async function ({ harness, fake }) {
    const before = await fake.readText()
    const rejected = await harness.request('POST', '/mcp/toggle', { id: 'db-metadata', enabled: false })
    assert.equal(rejected.status, 409)
    assert.equal(rejected.data.error.code, 'mcp-overridden')
    assert.equal(await fake.readText(), before)
  })
})

test('MCP routes keep the trust guard', async function () {
  const harness = await createHarness([], {})
  try {
    const rejected = await harness.request('GET', '/mcp', undefined, { 'x-dsh-devbench': '' })
    assert.equal(rejected.status, 403)
    assert.equal(rejected.data.error.code, 'forbidden')
  } finally {
    await harness.close()
  }
})
