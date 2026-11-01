import {
  DEFAULT_COMMIT_PROMPT_TEMPLATE,
  DEFAULT_REVIEW_PROMPT_TEMPLATE,
} from '../constants.js'
import { renderPrompt } from './render.js'

function changedFiles(task) {
  if (Array.isArray(task.changedFiles) && task.changedFiles.length > 0) {
    return task.changedFiles.map(function (file) { return '- ' + file }).join('\n')
  }
  return '- (\u65e0)'
}

function diffText(task) {
  return typeof task.diffText === 'string' && task.diffText.length > 0
    ? task.diffText
    : '(\u65e0)'
}

function worktreeLines(task) {
  if (typeof task.worktreeBranch !== 'string' || task.worktreeBranch.length === 0) return []
  const lines = []
  if (typeof task.worktreePath === 'string' && task.worktreePath.length > 0) {
    lines.push('\u5de5\u4f5c\u6811: ' + task.worktreePath)
  }
  lines.push('\u5de5\u4f5c\u6811\u5206\u652f: ' + task.worktreeBranch)
  return lines
}

/**
 * 提交提示词模板的占位值。主工作区的 worktreeInfo 为空串；工作树任务为
 * 「工作树: <path>」与「工作树分支: <branch>」两行。
 */
function commitPromptValues(task) {
  return {
    taskId: task.id,
    projectPath: task.projectPath || '',
    worktreeInfo: worktreeLines(task).join('\n'),
    changedFiles: changedFiles(task),
    diffText: diffText(task),
  }
}

export function buildCommitPrompt(task, template) {
  // 空模板必须先显式回退：renderPrompt 空串会回退到需求执行模板。
  const source = typeof template === 'string' && template.length > 0
    ? template
    : DEFAULT_COMMIT_PROMPT_TEMPLATE
  return renderPrompt(source, commitPromptValues(task))
}

function reviewPromptValues(task) {
  return {
    taskId: task.id,
    projectTitle: task.projectTitle || task.projectPath || '',
    projectPath: task.projectPath || '',
    commitHash: task.commitHash || '',
    commitShort: task.commitShort || '',
    commitSubject: task.commitSubject || '',
  }
}

export function buildReviewPrompt(task, template) {
  const source = typeof template === 'string' && template.length > 0
    ? template
    : DEFAULT_REVIEW_PROMPT_TEMPLATE
  return renderPrompt(source, reviewPromptValues(task))
}

/** 未提交评审在模板中替代提交信息的占位值，保证自定义模板仍可复用。 */
const UNCOMMITTED_COMMIT_HASH = '（未提交变更）'
const UNCOMMITTED_COMMIT_SHORT = 'worktree'
const UNCOMMITTED_COMMIT_SUBJECT = '当前工作区未提交的变更'

function uncommittedReviewValues(task) {
  return Object.assign(reviewPromptValues(task), {
    commitHash: UNCOMMITTED_COMMIT_HASH,
    commitShort: UNCOMMITTED_COMMIT_SHORT,
    commitSubject: UNCOMMITTED_COMMIT_SUBJECT,
  })
}

/** 提示词中列出的变更文件上限，避免超大工作区把 prompt 与任务记录撑爆。 */
const MAX_PROMPT_CHANGED_FILES = 200

function uncommittedChangedFileLines(task) {
  const files = Array.isArray(task.changedFiles) ? task.changedFiles : []
  if (files.length === 0) return '- (无)'
  const lines = files.slice(0, MAX_PROMPT_CHANGED_FILES).map(function (file) {
    return '- ' + file
  })
  if (files.length > MAX_PROMPT_CHANGED_FILES) {
    lines.push('- ……另有 ' + (files.length - MAX_PROMPT_CHANGED_FILES) + ' 个变更文件未列出')
  }
  return lines.join('\n')
}

/**
 * 追加在评审模板之后的未提交变更说明块。内容只包含纯文本（不使用花括号
 * 占位符），列出变更文件清单并提示 project_git_show 返回的组合 diff。
 */
function uncommittedReviewNotes(task) {
  return [
    '',
    '补充说明：',
    '本次评审目标是当前工作区未提交的变更（尚无提交）。',
    '变更文件清单（相对仓库根，包括已暂存、未暂存与未跟踪的新文件）：',
    uncommittedChangedFileLines(task),
    '调用 project_git_show 会返回当前工作区暂存、未暂存与未跟踪文件的完整 diff。',
    '请只针对上述未提交变更给出评审结论，不要假设它们已经提交。',
  ].join('\n')
}

/** 构建未提交变更评审的后台 Agent 提示词：复用评审模板并追加目标说明。 */
export function buildUncommittedReviewPrompt(task, template) {
  const source = typeof template === 'string' && template.length > 0
    ? template
    : DEFAULT_REVIEW_PROMPT_TEMPLATE
  const rendered = renderPrompt(source, uncommittedReviewValues(task))
  return rendered + uncommittedReviewNotes(task)
}
