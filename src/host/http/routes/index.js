/** Aggregated route table. */
import { configRoutes } from './config.js'
import { dashboardRoutes } from './dashboard.js'
import { fileRoutes } from './files.js'
import { gitRoutes } from './git.js'
import { projectRoutes } from './projects.js'
import { projectWorktreeRoutes } from './project-worktrees.js'
import { requirementRoutes } from './requirements.js'

export const routes = [
  ...configRoutes,
  ...dashboardRoutes,
  ...requirementRoutes,
  ...projectRoutes,
  ...projectWorktreeRoutes,
  ...fileRoutes,
  ...gitRoutes,
]
