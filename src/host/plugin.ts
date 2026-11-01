/** Host entry wiring: HTTP route registration and Agent tool registration. */
import { ROUTE_PREFIX } from './constants.js'
import { registerRequirementTools } from './tools/requirement-tools.js'
import { registerProjectTools } from './tools/project-tools.js'
import { recoverInterruptedTasks } from './storage/tasks.js'
import { handleHttp } from './http/router.js'
import type { HostContext } from './context.js'

export const inject = ['tools', 'webServer', 'workspaceRegistry']

let taskRecovery: Promise<number | void> = Promise.resolve()

export function waitForTaskRecovery(): Promise<number | void> {
  return taskRecovery
}

export function apply(ctx: HostContext): void {
  ctx.effect(function () {
    return ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: function (req, res) {
        return handleHttp(ctx, req, res)
      },
    })
  }, 'devbench-manager: http api')

  ctx.effect(function () {
    return registerRequirementTools(ctx)
  }, 'devbench-manager: agent tools')

  ctx.effect(function () {
    return registerProjectTools(ctx)
  }, 'devbench-manager: project agent tools')

  ctx.effect(function () {
    taskRecovery = recoverInterruptedTasks().catch(function (error: unknown) {
      const message = error && typeof error === 'object' && 'message' in error && error.message
        ? error.message : error
      ctx.logger?.warn?.('devbench-manager task recovery: ' + String(message))
    })
    return function () {}
  }, 'devbench-manager: project task recovery')
}
