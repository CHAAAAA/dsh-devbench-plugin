import type { HostContext } from '../context.js'
import type { ConfigDto, StateDto, WorkspaceDto } from '../../shared/api-types.js'
/** Builds the state DTO from registry workspaces and persisted mappings. */
import { promises as fsp } from 'node:fs'
import {
  DEFAULT_COMMIT_PROMPT_TEMPLATE,
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_REVIEW_PROMPT_TEMPLATE,
} from '../constants.js'
import { gitInfo, gitAvailable } from '../integrations/git.js'
import { scanRequirements } from '../domain/requirements.js'
import { ACTIVE_TASK_STATUSES, readTasks } from '../storage/tasks.js'
import { deriveRequirementTaskRecords } from './requirement-tasks.js'
import { defaultWorktreeRoot } from '../storage/config.js'
import {
  getWorkspaceEntry,
  readMapping,
  resolveWorkspaceFolder,
} from '../storage/workspaces.js'

export async function buildState(ctx: HostContext, config: ConfigDto): Promise<StateDto> {
  const workspaces = typeof ctx.workspaceRegistry.list === 'function'
    ? ctx.workspaceRegistry.list()
    : []
  const root = config.rootDir
  const mapping = typeof root === 'string' && root.length > 0 ? await readMapping(root) : {}
  let tasks = []
  try {
    tasks = await readTasks()
  } catch (error) {
    ctx.logger?.warn?.('devbench-manager: unable to read task indicators: ' +
      String(error && error.message ? error.message : error))
  }
  const activeTaskCounts = new Map()
  for (const task of tasks) {
    if (ACTIVE_TASK_STATUSES.includes(task.status) === false) continue
    const workspaceId = task.workspaceId || ''
    if (workspaceId.length === 0) continue
    activeTaskCounts.set(workspaceId, (activeTaskCounts.get(workspaceId) || 0) + 1)
  }
  const workspaceDtos: WorkspaceDto[] = []
  for (const workspace of workspaces) {
    const entry = getWorkspaceEntry(mapping, workspace.id)
    const folder = entry === null ? null : entry.folder
    const folderPath = root.length > 0 && folder !== null
      ? await resolveWorkspaceFolder(root, folder, { mustExist: false })
      : ''
    const requirements = folderPath.length > 0 ? await scanRequirements(folderPath, workspace.id) : []
    let activeCount = activeTaskCounts.get(workspace.id) || 0
    if (requirements.length > 0) {
      const derived = deriveRequirementTaskRecords(ctx, {
        workspaceId: workspace.id,
        title: workspace.title,
        path: workspace.path,
      }, requirements, tasks)
      for (const task of derived) {
        if (ACTIVE_TASK_STATUSES.includes(task.status)) activeCount += 1
      }
    }
    let missingPath = false
    try {
      await fsp.access(workspace.path)
    } catch {
      missingPath = true
    }
    workspaceDtos.push({
      workspaceId: workspace.id,
      title: workspace.title,
      path: workspace.path,
      folder,
      folderPath,
      missingPath,
      requirements,
      activeTaskCount: activeCount,
    })
  }
  const git = root.length > 0
    ? await gitInfo(root)
    : { available: await gitAvailable(), initialized: false }
  return {
    rootDir: root,
    configured: root.length > 0,
    git,
    config: {
      promptTemplate: config.promptTemplate,
      defaultPromptTemplate: DEFAULT_PROMPT_TEMPLATE,
      reviewPromptTemplate: config.reviewPromptTemplate,
      defaultReviewPromptTemplate: DEFAULT_REVIEW_PROMPT_TEMPLATE,
      commitPromptTemplate: config.commitPromptTemplate,
      defaultCommitPromptTemplate: DEFAULT_COMMIT_PROMPT_TEMPLATE,
      worktreeRoot: config.worktreeRoot || '',
      defaultWorktreeRoot: defaultWorktreeRoot(),
    },
    workspaces: workspaceDtos,
  }
}
