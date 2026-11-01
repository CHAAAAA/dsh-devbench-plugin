import { addProject, requireProject } from '../../services/projects.js'
import { readReviewFile } from '../../domain/reviews.js'
import {
  cancelProjectTask,
  confirmProjectCommit,
  initializeProjectGit,
  listProjectCommits,
  listProjectTasks,
  previewProjectCommit,
  projectCommitDetail,
  projectOverview,
  retryProjectTask,
  startProjectReview,
  startUncommittedReview,
} from '../../services/project-service.js'
import {
  manualCommitProject,
  pullProject,
  pushProject,
  readProjectWorkspaceState,
} from '../../services/project-git-ops.js'
import { detectProjectOpenTargets, openProjectDirectory } from '../../platform/open.js'
import { readStringField } from '../body.js'

export const projectRoutes = []

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function workspaceIdFromBody(body) {
  return readStringField(body, 'workspaceId', { required: true })
}

function taskIdFromBody(body) {
  return readStringField(body, 'taskId', { required: true })
}

projectRoutes.push({
  method: 'POST',
  path: '/project/add',
  async handle(context) {
    const body = await context.readBody()
    const requestedPath = readStringField(body, 'path', { required: true })
    const title = readStringField(body, 'title', { allowEmpty: true, trim: true })
    return addProject(context.ctx, requestedPath, title)
  },
})

projectRoutes.push({
  method: 'GET',
  path: '/project/overview',
  async handle(context) {
    const workspaceId = context.url.searchParams.get('workspaceId') || ''
    return projectOverview(context.ctx, workspaceId)
  },
})

projectRoutes.push({
  method: 'GET',
  path: '/project/changes',
  async handle(context) {
    const workspaceId = context.url.searchParams.get('workspaceId') || ''
    return readProjectWorkspaceState(context.ctx, workspaceId)
  },
})

projectRoutes.push({
  method: 'POST',
  path: '/project/commit/manual',
  async handle(context) {
    const body = await context.readBody()
    const workspaceId = workspaceIdFromBody(body)
    const message = readStringField(body, 'message', { allowEmpty: true })
    return manualCommitProject(context.ctx, workspaceId, message)
  },
})

projectRoutes.push({
  method: 'POST',
  path: '/project/pull',
  async handle(context) {
    const body = await context.readBody()
    return pullProject(context.ctx, workspaceIdFromBody(body))
  },
})

projectRoutes.push({
  method: 'POST',
  path: '/project/push',
  async handle(context) {
    const body = await context.readBody()
    return pushProject(context.ctx, workspaceIdFromBody(body))
  },
})

projectRoutes.push({
  method: 'GET',
  path: '/project/commits',
  async handle(context) {
    const workspaceId = context.url.searchParams.get('workspaceId') || ''
    const offset = context.url.searchParams.get('offset')
    const limit = context.url.searchParams.get('limit')
    return listProjectCommits(context.ctx, workspaceId, {
      offset: offset === null ? undefined : offset,
      limit: limit === null ? undefined : limit,
    })
  },
})

projectRoutes.push({
  method: 'POST',
  path: '/project/git/init',
  async handle(context) {
    const body = await context.readBody()
    return initializeProjectGit(context.ctx, workspaceIdFromBody(body))
  },
})

projectRoutes.push({
  method: 'POST',
  path: '/project/commit/preview',
  async handle(context) {
    const body = await context.readBody()
    return previewProjectCommit(context.ctx, workspaceIdFromBody(body))
  },
})

projectRoutes.push({
  method: 'POST',
  path: '/project/commit/confirm',
  async handle(context) {
    const body = await context.readBody()
    const workspaceId = workspaceIdFromBody(body)
    const taskId = taskIdFromBody(body)
    const message = hasOwn(body, 'message')
      ? readStringField(body, 'message', { allowEmpty: false, trim: true, maxLength: 2000 })
      : undefined
    return confirmProjectCommit(context.ctx, workspaceId, taskId, message)
  },
})

projectRoutes.push({
  method: 'POST',
  path: '/project/review/start',
  async handle(context) {
    const body = await context.readBody()
    const workspaceId = workspaceIdFromBody(body)
    const commit = readStringField(body, 'commit', { required: true })
    return startProjectReview(context.ctx, workspaceId, commit)
  },
})

projectRoutes.push({
  method: 'POST',
  path: '/project/review/uncommitted',
  async handle(context) {
    const body = await context.readBody()
    return startUncommittedReview(context.ctx, workspaceIdFromBody(body))
  },
})

projectRoutes.push({
  method: 'GET',
  path: '/project/tasks',
  async handle(context) {
    const workspaceId = context.url.searchParams.get('workspaceId') || ''
    return listProjectTasks(context.ctx, workspaceId)
  },
})

projectRoutes.push({
  method: 'POST',
  path: '/project/task/cancel',
  async handle(context) {
    const body = await context.readBody()
    return cancelProjectTask(context.ctx, workspaceIdFromBody(body), taskIdFromBody(body))
  },
})

projectRoutes.push({
  method: 'POST',
  path: '/project/task/retry',
  async handle(context) {
    const body = await context.readBody()
    return retryProjectTask(context.ctx, workspaceIdFromBody(body), taskIdFromBody(body))
  },
})

projectRoutes.push({
  method: 'GET',
  path: '/project/review/content',
  async handle(context) {
    const workspaceId = context.url.searchParams.get('workspaceId') || ''
    const name = context.url.searchParams.get('name') || ''
    const current = await requireProject(context.ctx, workspaceId)
    return readReviewFile(current.canonicalPath, name)
  },
})

projectRoutes.push({
  method: 'GET',
  path: '/project/commit/detail',
  async handle(context) {
    const workspaceId = context.url.searchParams.get('workspaceId') || ''
    const commit = context.url.searchParams.get('commit') || ''
    return projectCommitDetail(context.ctx, workspaceId, commit)
  },
})

projectRoutes.push({
  method: 'GET',
  path: '/project/open-targets',
  async handle() {
    return { targets: await detectProjectOpenTargets() }
  },
})

projectRoutes.push({
  method: 'POST',
  path: '/project/open',
  async handle(context) {
    const body = await context.readBody()
    const workspaceId = workspaceIdFromBody(body)
    const target = readStringField(body, 'target', { required: true })
    const current = await requireProject(context.ctx, workspaceId)
    return openProjectDirectory(current.canonicalPath, target)
  },
})
