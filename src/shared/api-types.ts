/** JSON request/response shapes shared by the Host and browser. No runtime dependencies. */
export type RequirementStatus = 'new' | 'running' | 'done' | 'archived' | 'cancelled'
export type TaskKind = 'commit' | 'review' | 'requirement'
export type TaskStatus = 'queued' | 'running' | 'awaiting_confirmation' | 'succeeded' | 'failed' | 'cancelled'
export type SearchScope = 'title' | 'full'
export type OpenTarget = 'vscode' | 'system' | 'iterm'

export interface RequirementSelection { workspaceId: string; id: string }
export interface RequirementSummary extends RequirementSelection {
  title: string
  status: RequirementStatus
  folder: string
  path: string
  createdAt: string
  updatedAt: string
  sessions: string[]
  commits: string[]
  worktree: boolean
  favorite: boolean
}
export interface RequirementWorktree {
  enabled: boolean
  exists: boolean
  path: string
  branch: string
  base: string
  targetPath?: string
  registered?: boolean
}
export interface FileEntry { name: string; path: string; type: 'file' | 'dir'; size?: number; isRequirementDoc?: boolean }
export type FileContent =
  | { path: string; size: number; editable: true; binary: false; content: string }
  | { path: string; size: number; editable: false; binary: true; content?: undefined }
export type FileResult = { kind: 'dir'; entries: FileEntry[] } | ({ kind: 'file' } & FileContent)
export interface RequirementDetail {
  requirement: RequirementSummary
  body: string
  files: FileEntry[]
  worktree: RequirementWorktree
}
export interface CreateRequirementRequest { workspaceId: string; title: string; body?: string; worktree?: boolean }
export interface SaveRequirementRequest extends RequirementSelection {
  title?: string
  status?: RequirementStatus
  body?: string
  expectedUpdatedAt?: string | null
  force?: boolean
}
export interface RequirementLink extends RequirementSelection { title: string; status: RequirementStatus }
export interface DocumentSummary { id: string; title: string; createdAt: string; updatedAt: string }
export interface DocumentDetail { document: DocumentSummary; body: string }
export interface CreateDocumentRequest { workspaceId: string; title: string; body?: string }
export interface SaveDocumentRequest extends RequirementSelection { title?: string; body?: string; expectedUpdatedAt?: string | null; force?: boolean }
export interface SearchMatch { field: 'title' | 'id' | 'body'; snippet: string }
export interface RequirementSearchItem { id: string; title: string; status: RequirementStatus; updatedAt: string; worktree: boolean; favorite: boolean; match: SearchMatch }
export interface DocumentSearchItem { id: string; title: string; updatedAt: string; match: SearchMatch }
export interface SearchResult<T> { query: string; scope: SearchScope; total: number; hasMore: boolean; items: T[] }

export interface ConfigDto { rootDir: string; promptTemplate: string; reviewPromptTemplate: string; commitPromptTemplate: string; worktreeRoot: string }
export interface StateConfig extends Omit<ConfigDto, 'rootDir'> {
  defaultPromptTemplate: string
  defaultReviewPromptTemplate: string
  defaultCommitPromptTemplate: string
  defaultWorktreeRoot: string
}
export interface WorkspaceDto {
  workspaceId: string
  title: string
  path: string
  folder: string | null
  folderPath: string
  missingPath: boolean
  requirements: RequirementSummary[]
  activeTaskCount: number
}
export interface GitInfo { available: boolean; initialized: boolean }
export interface GitChange { status: string; path: string; from?: string }
export interface GitStatus { initialized: boolean; branch: string; changes: GitChange[] }
export interface ProjectGit extends GitInfo, GitStatus { head: string }
export interface StateDto { rootDir: string; configured: boolean; git: GitInfo; config: StateConfig; workspaces: WorkspaceDto[] }
export interface TaskDto {
  id: string
  kind: TaskKind
  reviewTarget: 'commit' | 'uncommitted'
  status: TaskStatus
  workspaceId: string
  projectPath: string
  projectTitle: string
  title: string
  sessionId: string
  baseHead: string
  fingerprint: string
  changedFiles: string[]
  proposedMessage: string
  commitHash: string
  commitShort: string
  commitSubject: string
  reviewFile: string
  worktreePath: string
  worktreeBranch: string
  requirementId: string
  pushed: boolean
  error: string
  createdAt: string
  updatedAt: string
}
export interface ProjectDto { workspaceId: string; title: string; path: string; canonicalPath: string; missingPath: boolean; requirementsCount?: number }
export interface CommitResult { hash: string; short: string; subject: string }
export interface GitLogEntry extends CommitResult { date: string }
export interface CommitMetadata extends GitLogEntry { authorName: string; authorEmail: string; parents: string[] }
export interface ProjectCommit extends CommitMetadata { reviewed: boolean; reviewName: string | null }
export interface CommitDiffFile { path: string; oldPath: string; status: string; additions: number; deletions: number; binary: boolean; diff: string; truncated: boolean }
export interface ReviewDto {
  name: string
  task: string
  project: string
  workspaceId: string
  commit: string
  commitSubject: string
  target: 'commit' | 'uncommitted'
  createdAt: string
  modifiedAt: string
  size: number
  summary: string
}
export interface ProjectOverview { project: ProjectDto; git: ProjectGit; commits: ProjectCommit[]; reviews: ReviewDto[]; tasks: TaskDto[] }
export interface ProjectCommits { commits: ProjectCommit[]; hasMore: boolean; offset: number; limit: number; git?: ProjectGit }
export interface ProjectCommitDetail { commit: CommitMetadata & { message: string }; files: CommitDiffFile[]; truncated: boolean; review: ReviewDto | null; requirements: RequirementLink[] }
export interface Upstream { remote: string; branch: string; ahead: number; behind: number }
export interface WorkspaceChanges {
  initialized: boolean
  branch: string
  head: string
  detached: boolean
  statusKnown: boolean
  hasChanges: boolean
  files: GitChange[]
  changedFiles: string[]
  diffText: string
  truncated: boolean
  remotes: string[]
  remote: string | null
  upstream: Upstream | null
  ahead: number
  behind: number
  aheadKnown: boolean
  behindKnown: boolean
}
export interface PushResult { pushed: boolean; remote: string; branch: string; upstream: Upstream; alreadyUpToDate: boolean; detail: string }
export interface PullResult { pulled: boolean; alreadyUpToDate: boolean; before: string; after: string; branch: string; upstream: Upstream; detail: string }
export interface ProjectWorktree {
  requirementId: string
  title: string
  status: RequirementStatus | 'missing'
  state: 'ready' | 'missing' | 'absent'
  created: boolean
  exists: boolean
  path: string
  branch: string
  base: string
  dirty: boolean
  changesCount: number
  statusKnown: boolean
  ahead: number
  behind: number
  aheadKnown: boolean
  lastCommit: GitLogEntry | null
  upstream: Upstream | null
  remote: string | null
  remotes: string[]
  canCreate: boolean
  canPrune: boolean
}
export interface ProjectWorktrees { git: GitInfo; defaultRoot: string; remote: string | null; remotes: string[]; worktrees: ProjectWorktree[] }
export interface WorktreeChanges { worktree: ProjectWorktree; hasChanges: boolean; changedFiles: string[]; files: GitChange[]; diffText: string; truncated: boolean; head: string; branch: string }
export interface TaskSelection { workspaceId: string; taskId: string }
export interface ConfirmCommitRequest extends TaskSelection { message?: string }
export interface CommitConfirmation { task: TaskDto; commit: CommitResult }

export interface DashboardProject { workspaceId: string; title: string; path: string; requirementsCount: number; activeTaskCount: number; runningRequirementsCount: number; missingPath: boolean }
export interface RunningRequirement { workspaceId: string; projectTitle: string; id: string; title: string; updatedAt: string; folder: string }
export interface Dashboard {
  generatedAt: string
  week: { start: string; end: string }
  totals: { projects: number; requirements: number; activeTasks: number; tasksThisWeek: number; runningRequirements: number }
  projects: DashboardProject[]
  recentTasks: TaskDto[]
  activeTasks: TaskDto[]
  runningRequirements: RunningRequirement[]
}
export interface WeeklyReport {
  generatedAt: string
  days: number
  week: { start: string; end: string }
  markdown: string
  counts: { projects: number; commits: number; reviews: number; tasks: number; requirementsCreated: number; requirementsUpdated: number; runningRequirements: number }
  projects: {
    workspaceId: string
    title: string
    commits: GitLogEntry[]
    reviews: Pick<ReviewDto, 'name' | 'commit' | 'commitSubject' | 'modifiedAt'>[]
    tasks: { succeeded: number; failed: number; cancelled: number; active: number; total: number }
    requirements: { created: number; updated: number; running: Pick<RequirementSummary, 'id' | 'title' | 'status'>[] }
  }[]
  skippedProjects: { workspaceId: string; title: string; path: string; reason: 'missing-path' }[]
}

export type McpTransport = 'stdio' | 'streamable-http'
export type McpPhase = 'active' | 'failed' | 'pending' | 'inactive' | 'disabled'
export interface McpServerInput {
  serverName: string
  transport: McpTransport
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  failOnStartupError?: boolean
  toolCallTimeoutMs?: number | string
}
export interface McpServerDto {
  id: string
  serverName: string
  transport: McpTransport | ''
  phase: McpPhase
  error: string
  enabled: boolean
  command: string
  args: string[]
  cwd: string
  url: string
  env: Record<string, string>
  headers: Record<string, string>
  failOnStartupError: boolean
  toolCallTimeoutMs: number
  toolCount: number | null
  source: 'unknown' | 'profile' | 'bundle'
  canEdit: boolean
  canDelete: boolean
  canToggle: boolean
  readOnlyReason: '' | 'inactive' | 'overlay' | 'unsupported' | 'failed' | 'pending'
  config: Record<string, unknown>
}
export interface McpServers { profile: { name: string; patchPath: string } | null; available: boolean; canWrite: boolean; hotReload: boolean; patchError: string; servers: McpServerDto[] }
export interface McpMutationResult extends McpServers { action: 'created' | 'updated' | 'deleted' | 'enabled' | 'disabled'; restartRequired: boolean; backupPath?: string }
export type SaveMcpServerRequest = { mode: 'create'; server: McpServerInput } | { mode: 'update'; id: string; server: McpServerInput }
