/**
 * Host constants: protocol values shared with the browser bundle plus
 * host-only limits and default prompt templates.
 *
 * Values shared across the host/client boundary live in `src/shared/protocol.ts`
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
  PACKAGE_NAME,
  PROJECT_URL,
} from '../shared/protocol.js'

export const MAPPING_FILE = 'workspaces.json'
export const REQUIREMENT_FILE = 'requirement.md'
export const DELETED_REQUIREMENTS_FILE = 'deleted-requirements.json'
/** Directory under a workspace folder that stores project documents (Markdown files). */
export const DOCUMENTS_DIR = '.documents'
/** Project document id: DOC-<local date YYYYMMDD>-<3+ digit sequence>. */
export const DOCUMENT_ID_PATTERN = /^DOC-\d{8}-\d{3,}$/
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
 * Default "organize session into a requirement" prompt. Placeholders are
 * rendered by renderPrompt: {workspaceTitle} {workspaceId} {sessionId} {titleHint}.
 * Users can override it in settings; the override must keep {workspaceId}.
 */
export const DEFAULT_ORGANIZE_PROMPT_TEMPLATE = [
  '你正在一个 DSH 会话中。用户希望把本次会话的内容整理为一个需求，写入工作区「{workspaceTitle}」的需求目录。',
  '',
  '{titleHint}',
  '',
  '要求：',
  '1. 根据本次会话的完整上下文，提炼需求标题、背景、需求内容与验收标准；会话中已经讨论清楚的实现方案、约束和风险也要保留，写入「实现方案」章节。',
  '2. 调用 requirement_create 工具创建需求：workspace_id 使用「{workspaceId}」，title 为提炼出的中文标题，body 为完整 Markdown 正文（至少包含 # 标题、## 背景、## 需求内容、## 验收标准，如有实现方案再加 ## 实现方案）。',
  '3. 创建后工具会返回需求 ID 与路径，并自动把当前会话关联到新需求；不要用其他方式写文件。',
  '4. 最后用一两句话汇报需求 ID、标题和主要章节。如果会话内容不足以形成需求，先说明缺少什么并询问用户，不要凭空编造。',
].join('\n')

/**
 * Default requirement-discussion prompt. Placeholders are rendered by
 * renderPrompt: {workspaceTitle} {title} {id} {requirementPath} {folderPath} {body}.
 * Users can override it in settings.
 */
export const DEFAULT_DISCUSSION_PROMPT_TEMPLATE = [
  '你正在与用户讨论需求「{title}」（需求 ID：{id}），目标是共同完善这份需求，而不是直接实现它。',
  '',
  '需求文档：{requirementPath}',
  '需求资料目录：{folderPath}',
  '',
  '===== 需求正文 =====',
  '{body}',
  '===== 需求正文结束 =====',
  '',
  '讨论要求：',
  '1. 先读懂需求，围绕目标、范围、约束、验收标准与实现方案与用户对话。每轮聚焦最关键的问题，必要时给出可选方案和你的建议，不要一次罗列过多问题。',
  '2. 当讨论形成明确结论、用户同意修改，或用户直接要求修改时，主动更新需求正文：先调用 requirement_read 读取最新正文，再用 requirement_update 写回（mode=replace 覆盖，mode=append 追加），不要修改文件头部元数据；写入后简要说明改了哪些章节。',
  '3. 需求状态由用户确认；你可以把状态改为 running/new，但不要标记为已完成。',
  '4. 需求资料目录中的文件可用 requirement_read 的 file 参数读取；需要新增或修改资料文件时先询问用户。',
  '5. 本会话只讨论和完善需求，不要直接开始编码实现，也不要自动 commit / push。',
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

/** npm registries polled by the plugin update check, primary first (REQ-20261101-001). */
export const NPM_REGISTRY_URLS = Object.freeze([
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com',
])
/** One registry lookup of the update check; a slow registry must not block the page. */
export const UPDATE_CHECK_TIMEOUT_MS = 5000
/** How long a successful or failed update check is reused before checking again. */
export const UPDATE_CHECK_TTL_MS = 30 * 60 * 1000
/** Upper bound for the pnpm upgrade run (registry download + install). */
export const UPDATE_INSTALL_TIMEOUT_MS = 5 * 60 * 1000

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
