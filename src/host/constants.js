/**
 * Host constants: protocol values shared with the browser bundle plus
 * host-only limits and default prompt templates.
 *
 * Values shared across the host/client boundary live in `src/shared/protocol.js`
 * and are re-exported here so host modules keep a single import site.
 */
export {
  ROUTE_PREFIX,
  API_BASE,
  REQUEST_HEADER,
  META_DIR,
  CONFIG_DIR_NAME,
  MCP_CLIENT_MODULE,
  MCP_SECRET_MASK,
} from '../shared/protocol.js'

export const MAPPING_FILE = 'workspaces.json'
export const REQUIREMENT_FILE = 'requirement.md'
export const DELETED_REQUIREMENTS_FILE = 'deleted-requirements.json'
export const VALID_STATUS = Object.freeze(['new', 'running', 'done', 'archived', 'cancelled'])
export const AGENT_WRITABLE_STATUS = Object.freeze(['new', 'running'])
export const MAX_BODY_BYTES = 8 * 1024 * 1024
export const MAX_FILE_TEXT_BYTES = 1024 * 1024
export const MAX_TITLE_LENGTH = 200
export const MAX_SESSION_ID_LENGTH = 256
export const MAX_GIT_MESSAGE_LENGTH = 2000

/** MCP management limits (REQ-20261029-002). */
export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
export const MCP_MAX_COMMAND_LENGTH = 4096
export const MCP_MAX_CWD_LENGTH = 4096
export const MCP_MAX_URL_LENGTH = 8192
export const MCP_MAX_ARGS = 256
export const MCP_MAX_ARG_LENGTH = 4096
export const MCP_MAX_KV_ENTRIES = 128
export const MCP_MAX_KV_KEY_LENGTH = 256
export const MCP_MAX_KV_VALUE_LENGTH = 32768
export const MCP_MAX_TIMEOUT_MS = 3600000
export const MCP_PATCH_BACKUP_PREFIX = '.bak-'

export const DEFAULT_PROMPT_TEMPLATE = [
  '你在工作区「{workspaceTitle}」中执行需求「{title}」（需求 ID：{id}）。',
  '',
  '需求文档：{requirementPath}',
  '需求资料目录：{folderPath}',
  '',
  '===== 需求正文 =====',
  '{body}',
  '===== 需求正文结束 =====',
  '',
  '执行要求：',
  '1. 先理解需求与工作区现状，再开始实现。',
  '2. 需求文档位于会话工作区之外，普通读写工具可能被沙箱限制；读取需求用 requirement_read，修改需求正文用 requirement_update（mode=replace 覆盖，mode=append 追加），不要修改文件头部的元数据。',
  '3. 需求资料目录中的文件（部署说明、过程记录等）可用 requirement_read 的 file 参数读取；新增或编辑资料文件请在插件页面由我操作。',
  '4. 需求状态由用户确认；你可以通过 requirement_update 把状态改为 running/new，但不要标记为已完成。',
  '5. 需要我确认的方案、风险或提交代码的操作，先询问我；不要自动 commit / push。',
  '6. 完成后用 requirement_read 复核需求正文，再汇报实现结果。',
].join('\n')

/**
 * Default review-task prompt. Placeholders are rendered by renderPrompt:
 * {taskId} {projectTitle} {projectPath} {commitHash} {commitShort} {commitSubject}.
 * Users can override it in settings; the override must keep {taskId}.
 */
export const DEFAULT_REVIEW_PROMPT_TEMPLATE = [
  '你是项目代码评审员。请评审下方提交并给出问题与改进建议。',
  '',
  '任务 ID: {taskId}',
  '项目: {projectTitle}',
  '项目路径: {projectPath}',
  '提交: {commitHash}',
  '提交摘要: {commitSubject}',
  '',
  '要求:',
  '1. 必须先调用 project_git_show 获取完整 diff，参数为 task_id。',
  '2. 从正确性、安全性、可维护性、性能和测试覆盖五个角度评审。',
  '3. 问题按严重级别分组，写明涉及文件和具体修复建议；没有问题的维度也要明确说明。',
  '4. summary 必须是简洁中文；content 必须是 Markdown。',
  '5. 必须调用 project_review_write 一次，并传入 task_id、summary 和 content。',
  '6. 禁止修改代码、执行 git 命令或运行修改类工具。',
  '7. 调用 project_review_write 后立即停止。',
].join('\n')

/**
 * Default commit-task prompt. Placeholders are rendered by renderPrompt:
 * {taskId} {projectPath} {worktreeInfo} {changedFiles} {diffText}.
 * Users can override it in settings; the override must keep {taskId},
 * {changedFiles} and {diffText}.
 */
export const DEFAULT_COMMIT_PROMPT_TEMPLATE = [
  '你是项目提交助手。根据下方变更生成一条中文 Conventional Commit 提交信息。',
  '',
  '任务 ID: {taskId}',
  '项目路径: {projectPath}',
  '{worktreeInfo}',
  '变更文件:',
  '{changedFiles}',
  '',
  '暂存、未暂存变更和未跟踪文件:',
  '{diffText}',
  '',
  '要求:',
  '1. 只允许调用 project_commit_propose 一次，并且必须调用。',
  '2. 必须传入 task_id 和 message，提交信息不超过 2000 字符。',
  '3. 提交信息必须是中文 Conventional Commit 格式。',
  '4. 禁止执行 git add、git commit、git push。',
  '5. 禁止修改文件或运行修改类工具。',
  '6. 调用 project_commit_propose 后立即停止。',
].join('\n')

/** Project commit log pagination: 10 per page, at most 100 per request. */
export const DEFAULT_COMMIT_PAGE_SIZE = 10
export const MAX_COMMIT_PAGE_SIZE = 100
/** Weekly report window in days (1..90). */
export const DEFAULT_WEEKLY_REPORT_DAYS = 7
/** Config-directory override used by tests and local development. */
export const CONFIG_DIR_ENV = 'DSH_DEVBENCH_CONFIG_DIR'
/** Pre-migration config-directory override kept as a read-only compatibility alias. */
export const LEGACY_CONFIG_DIR_ENV = 'DSH_REQUIREMENTS_CONFIG_DIR'
/** Directory name used before the DevBench rename. */
export const LEGACY_DIR_NAME = '.dsh-requirements'
/** Requirement-worktree branches created before the DevBench rename. */
export const LEGACY_WORKTREE_BRANCH_PREFIX = 'dsh-req/'
/** Branch prefix for per-requirement git worktrees. */
export const WORKTREE_BRANCH_PREFIX = 'devbench/'
