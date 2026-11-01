import type { IncomingMessage, ServerResponse } from 'node:http'

export type Dispose = () => void

/** The host services used by this plugin; dynamic services are narrowed by their callers. */
export interface Workspace {
  id: string
  title: string
  path: string
  sessionIds: string[]
  attachSession(sessionId: string): Promise<void>
}

export interface ToolExecution {
  agent?: { session?: { id: string } }
}

export interface ToolResult {
  ok: boolean
  message?: string
  content?: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: Record<string, unknown>, value: ToolResult): { type: string; text: string }[]
  }
  execute(args: Record<string, unknown>, execution?: ToolExecution): Promise<ToolResult>
}

export interface HostContext {
  effect(callback: () => Dispose, name: string): void
  webServer: {
    register(options: {
      kind: 'prefix'
      path: string
      handler(req: IncomingMessage, res: ServerResponse): Promise<void>
    }): Dispose
  }
  tools: { register(definition: ToolDefinition): Dispose }
  workspaceRegistry: {
    list(): Workspace[]
    get(id: string): Workspace | null | undefined
    create?(path: string, title?: string): Promise<Workspace | string>
  }
  get?(name: string): unknown
  logger?: { warn(message: string): void }
}
