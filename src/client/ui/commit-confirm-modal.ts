/** Commit preview confirmation. Closing the dialog must never cancel the task. */
import { h, useRef } from '../runtime.js'
import { Modal, Banner } from './common.js'
import { confirmDialog } from './dialogs.js'
import { changedFiles } from '../core/project-utils.js'

const MESSAGE_MAX = 2000
const CHINESE_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

function shortHash(value) {
  const text = String(value || '')
  return text.length > 8 ? text.slice(0, 8) : text
}

function infoRow(label, value, mono, key) {
  return h('div', {
    className: 'devbench-inline',
    key: key,
    style: { gap: '8px', alignItems: 'baseline', minWidth: 0 },
  },
  h('span', { className: 'devbench-muted', style: { flex: '0 0 64px' } }, label),
  h('span', {
    className: mono ? 'devbench-mono' : '',
    style: { minWidth: 0, wordBreak: 'break-all' },
    title: value,
  }, value))
}

export function CommitConfirmModal(props) {
  const t = props.t
  const askingRef = useRef(false)
  const modal = props.modal
  if (modal === null || modal === undefined) return null
  const task = modal.task || {}
  const message = typeof modal.message === 'string' ? modal.message : ''
  const trimmed = message.trim()
  const files = changedFiles(task)
  const worktreePath = task.worktreePath ? String(task.worktreePath) : ''
  const worktreeBranch = task.worktreeBranch ? String(task.worktreeBranch) : ''
  const isWorktree = worktreePath !== '' || worktreeBranch !== ''
  const projectTitle = props.projectTitle ? String(props.projectTitle) : String(task.projectTitle || '')
  const projectPath = props.projectPath ? String(props.projectPath) : String(task.projectPath || '')
  // A worktree commit must show its own devbench branch, never the project's
  // current branch (props.branch is the project branch).
  const branch = isWorktree && worktreeBranch !== ''
    ? worktreeBranch
    : (props.branch ? String(props.branch) : '')
  const head = shortHash(task.baseHead || task.commitHash)
  const busy = modal.busy === true
  const cancelling = modal.cancelling === true
  const locked = busy || cancelling
  const canConfirm = locked === false && trimmed !== ''
  const hasChinese = CHINESE_PATTERN.test(message)
  const warnings = []
  if (trimmed !== '' && hasChinese === false) warnings.push(t('project.commit.chineseMissing'))
  if (message.length > MESSAGE_MAX) warnings.push(t('project.commit.messageTooLong'))

  /** X / ESC / overlay: dismiss only. Never delegates to the cancel-task action. */
  function closeOnly() {
    if (askingRef.current) return
    if (typeof props.onClose === 'function') props.onClose()
  }
  function confirm() {
    if (canConfirm !== true) return undefined
    if (typeof props.onConfirm !== 'function') return undefined
    return props.onConfirm()
  }
  function requestCancelTask() {
    if (locked || askingRef.current) return
    if (typeof props.onCancelTask !== 'function') return
    askingRef.current = true
    confirmDialog({
      title: t('project.commit.cancelConfirm.title'),
      body: t('project.commit.cancelConfirm.body'),
      confirmText: t('project.commit.cancelTask'),
      cancelText: t('project.commit.later'),
      tone: 'danger',
    }).then(function (confirmed) {
      askingRef.current = false
      if (confirmed === true) props.onCancelTask()
    }, function () {
      askingRef.current = false
    })
  }
  function onMessageKeyDown(event) {
    const composing = event.isComposing === true || Boolean(event.nativeEvent && event.nativeEvent.isComposing)
    if (event.key !== 'Enter' || composing) return
    if (event.metaKey !== true && event.ctrlKey !== true) return
    event.preventDefault()
    confirm()
  }
  function changeMessage(event) {
    if (typeof props.onChangeMessage !== 'function') return
    props.onChangeMessage(event.target.value)
  }

  const info = [
    infoRow(t('project.commit.project'), projectTitle || '-', false, 'project'),
    projectPath !== '' ? infoRow(t('project.commit.path'), projectPath, true, 'path') : null,
    branch !== '' ? infoRow(t('project.worktrees.branch'), branch, true, 'branch') : null,
    head !== '' ? infoRow(t('project.commit.head'), head, true, 'head') : null,
    String(task.id || '') !== '' ? infoRow(t('project.commit.taskLabel'), String(task.id), true, 'task') : null,
  ]
  const fileList = files.length === 0
    ? h('div', { className: 'devbench-muted' }, t('project.none'))
    : files.map(function (file, index) {
      const path = typeof file === 'string' ? file : (file.path || file.name || String(file))
      return h('div', { className: 'devbench-modal-file', key: path + ':' + index }, path)
    })
  const footer = h('div', {
    className: 'devbench-modal-actions',
    style: { justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' },
  },
  h('div', { className: 'devbench-inline' },
    h('button', {
      className: 'devbench-btn ghost',
      type: 'button',
      disabled: locked,
      onClick: closeOnly,
    }, t('project.commit.later')),
    h('button', {
      className: 'devbench-btn ghost danger',
      type: 'button',
      disabled: locked,
      onClick: requestCancelTask,
    }, cancelling ? t('project.commit.cancelling') : t('project.commit.cancelTask'))),
  h('button', {
    className: 'devbench-btn primary',
    type: 'button',
    disabled: canConfirm !== true,
    title: canConfirm === true ? undefined : t('project.commit.messageRequired'),
    onClick: confirm,
  }, busy ? t('project.commit.confirming') : t('project.commit.confirm.action')))

  return h(Modal, {
    t: t,
    title: t('project.commit.confirm.title'),
    actions: false,
    size: 'lg',
    autoFocus: false,
    onClose: closeOnly,
  },
  h('div', { className: 'devbench-flexcol' },
    h('div', { className: 'devbench-inline', style: { gap: '8px' } },
      h('span', { className: 'devbench-pill awaiting_confirmation' }, t('status.awaiting_confirmation')),
      isWorktree
        ? h('span', { className: 'devbench-pill running' }, t('project.worktrees.branch') + ': ' + (worktreeBranch || '-'))
        : null),
    info,
    isWorktree
      ? h('div', { className: 'devbench-hint' }, t('project.commit.confirm.worktreeHint', { branch: worktreeBranch || t('project.noBranch') }))
      : h('div', { className: 'devbench-hint' }, t('project.commit.confirm.hint')),
    worktreePath !== ''
      ? h('div', { className: 'devbench-commit-target devbench-mono', title: worktreePath }, worktreePath)
      : null,
    h('div', { className: 'devbench-hint' }, t('project.commit.confirm.recheck')),
    h('div', { className: 'devbench-hint' }, t('project.commit.dismissHint')),
    h('div', { className: 'devbench-inline', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
      h('span', { className: 'devbench-hint' }, t('project.commit.confirm.files')),
      h('span', { className: 'devbench-muted' }, t('project.commit.filesCount', { count: files.length }))),
    h('div', { className: 'devbench-modal-files' }, fileList),
    h('div', { className: 'devbench-inline', style: { justifyContent: 'space-between', alignItems: 'baseline' } },
      h('label', { className: 'devbench-hint', htmlFor: 'devbench-commit-message' }, t('project.commit.confirm.message')),
      h('span', { className: 'devbench-muted' }, t('project.commit.charCount', { count: message.length }))),
    h('textarea', {
      id: 'devbench-commit-message',
      className: 'devbench-textarea devbench-mono',
      rows: 5,
      maxLength: MESSAGE_MAX,
      value: message,
      disabled: locked,
      placeholder: t('project.commit.confirm.message'),
      onChange: changeMessage,
      onKeyDown: onMessageKeyDown,
    }),
    h('div', { className: 'devbench-hint' }, t('project.commit.messageHint')),
    warnings.map(function (warning, index) {
      return h('div', {
        className: 'devbench-hint',
        key: 'warning-' + index,
        style: { color: 'var(--dsw-alias-state-warn-primary)' },
      }, warning)
    }),
    modal.error ? h(Banner, { kind: 'error' }, modal.error) : null,
    footer))
}
