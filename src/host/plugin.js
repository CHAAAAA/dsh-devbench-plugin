/** Host entry wiring: HTTP route registration and Agent tool registration. */
import { ROUTE_PREFIX } from './constants.js'
import { registerRequirementTools } from './tools/requirement-tools.js'
import { registerProjectTools } from './tools/project-tools.js'
import { recoverInterruptedTasks } from './storage/tasks.js'
import { handleHttp } from './http/router.js'

export const inject = ['tools', 'webServer', 'workspaceRegistry']

let taskRecovery = Promise.resolve()

export function waitForTaskRecovery() {
  return taskRecovery
}

export function apply(ctx) {
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
    taskRecovery = recoverInterruptedTasks().catch(function (error) {
      ctx.logger?.warn?.('devbench-manager task recovery: ' + String(error && error.message ? error.message : error))
    })
    return function () {}
  }, 'devbench-manager: project task recovery')
}
