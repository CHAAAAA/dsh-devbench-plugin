import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../../src/index.js'
import { API_BASE } from '../../src/host/constants.js'
import { waitForBackgroundTask } from '../../src/host/services/background-agent.js'
import { waitForTaskRecovery } from '../../src/host/plugin.js'

export async function createHarness(workspaces: any[] = [], options: any = {}): Promise<any> {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'devbench-host-'))
  const configDir = path.join(tempRoot, 'config')
  const previousConfigDir = process.env.DSH_DEVBENCH_CONFIG_DIR
  process.env.DSH_DEVBENCH_CONFIG_DIR = configDir
  const services = options.services || {}
  const registry = new Map()
  for (const workspace of workspaces) registry.set(workspace.id, workspace)
  const tools = new Map()
  const effects = []
  let handler = null
  let workspaceSequence = workspaces.length
  const createWorkspace = options.createWorkspace || async function (projectPath, title) {
    workspaceSequence += 1
    return {
      id: 'workspace-' + workspaceSequence,
      title: title || path.basename(projectPath),
      path: projectPath,
      sessionIds: [],
      async attachSession(sessionId) {
        if (this.sessionIds.includes(sessionId) === false) this.sessionIds.push(sessionId)
      },
    }
  }
  const ctx = {
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') effects.push(dispose)
    },
    webServer: {
      register(options) {
        handler = options.handler
        return function () {}
      },
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return function () {}
      },
    },
    get(name) { return services[name] },
    workspaceRegistry: {
      list() { return Array.from(registry.values()) },
      get(id) { return registry.get(id) },
      async create(projectPath, title) {
        const workspace = await createWorkspace(projectPath, title)
        registry.set(workspace.id, workspace)
        return workspace
      },
    },
    logger: { warnings: [], warn(message) { this.warnings.push(message) } },
  }
  if (typeof options.beforeApply === 'function') {
    await options.beforeApply({ tempRoot, configDir, ctx, tools, services })
  }
  Object.freeze(ctx)
  apply(ctx)
  await waitForTaskRecovery()
  await fsp.mkdir(tempRoot, { recursive: true })
  return {
    tempRoot,
    configDir,
    ctx,
    tools,
    services,
    waitTask(taskId) { return waitForBackgroundTask(taskId) },
    addWorkspace(workspace) { registry.set(workspace.id, workspace) },
    request(method, route, body, headerOverrides) {
      return invoke(handler, tempRoot, method, route, body, headerOverrides)
    },
    async close() {
      for (const dispose of effects.reverse()) {
        try { dispose() } catch {}
      }
      if (previousConfigDir === undefined) delete process.env.DSH_DEVBENCH_CONFIG_DIR
      else process.env.DSH_DEVBENCH_CONFIG_DIR = previousConfigDir
      await fsp.rm(tempRoot, { recursive: true, force: true })
    },
  }
}

async function invoke(handler: any, tempRoot: any, method: any, route: any, body?: any, headerOverrides?: any) {
  if (handler === null) throw new Error('handler not registered')
  const headers = Object.assign({
    host: '127.0.0.1:4321',
    origin: 'http://127.0.0.1:4321',
    'x-dsh-devbench': '1',
  }, headerOverrides || {})
  const payload = body === undefined ? null : JSON.stringify(body)
  const req = {
    method,
    url: API_BASE + route,
    headers,
    async *[Symbol.asyncIterator]() {
      if (payload !== null) yield Buffer.from(payload)
    },
  }
  const response = { status: 0, headers: {}, text: '', headersSent: false }
  const res = {
    writeHead(status, nextHeaders) {
      response.status = status
      response.headers = nextHeaders || {}
      response.headersSent = true
    },
    end(chunk) {
      if (chunk !== undefined) response.text += String(chunk)
      response.headersSent = true
    },
  }
  await handler(req, res)
  const data = response.text.length > 0 ? JSON.parse(response.text) : null
  return { status: response.status, headers: response.headers, data, raw: response.text }
}

export function expectOk(result: any) {
  if (result.data === null || result.data.ok !== true) {
    throw new Error('expected ok response: ' + result.raw)
  }
  return result.data.value
}

export async function makeWorkspace(tempRoot: any, id: any, title: any) {
  const workspacePath = path.join(tempRoot, 'workspace-' + id)
  await fsp.mkdir(workspacePath, { recursive: true })
  return {
    id,
    title,
    path: workspacePath,
    sessionIds: [],
    async attachSession(sessionId) {
      if (this.sessionIds.includes(sessionId) === false) this.sessionIds.push(sessionId)
    },
  }
}

export async function configureRoot(harness: any, rootDir: any) {
  return expectOk(await harness.request('POST', '/config', { rootDir, promptTemplate: '' }))
}

export async function initWorkspace(harness: any, workspaceId: any) {
  return expectOk(await harness.request('POST', '/workspace/init', { workspaceId }))
}

export async function createRequirement(harness: any, workspaceId: any, title: any, body?: any) {
  return expectOk(await harness.request('POST', '/requirement/create', {
    workspaceId,
    title,
    body,
  }))
}

export async function runTool(harness: any, name: any, args?: any, exec?: any) {
  const tool = harness.tools.get(name)
  if (tool === undefined) throw new Error('missing tool ' + name)
  return tool.execute(args || {}, exec || {})
}

export async function waitForTaskStatus(harness: any, workspaceId: any, taskId: any, wanted: any, timeoutMs?: number) {
  const deadline = Date.now() + (timeoutMs || 2000)
  while (Date.now() < deadline) {
    const value = expectOk(await harness.request('GET',
      '/project/tasks?workspaceId=' + encodeURIComponent(workspaceId)))
    const task = value.tasks.find(function (item) { return item.id === taskId })
    if (task && wanted.includes(task.status)) return task
    await new Promise(function (resolve) { setTimeout(resolve, 10) })
  }
  throw new Error('task did not reach status: ' + wanted.join(','))
}
