import { apiError } from '../../errors.js'
import { messages } from '../../messages/index.js'
import { buildDashboard, buildWeeklyReport } from '../../services/dashboard.js'

export const dashboardRoutes = []

dashboardRoutes.push({
  method: 'GET',
  path: '/dashboard',
  async handle(context) {
    return buildDashboard(context.ctx, context.config)
  },
})

dashboardRoutes.push({
  method: 'POST',
  path: '/weekly-report',
  async handle(context) {
    const body = await context.readBody()
    if (body.days === undefined) {
      return buildWeeklyReport(context.ctx, context.config, {})
    }
    if (typeof body.days !== 'number' || Number.isInteger(body.days) === false) {
      throw apiError(400, 'bad-field', messages.invalidField + ': days')
    }
    return buildWeeklyReport(context.ctx, context.config, { days: body.days })
  },
})
