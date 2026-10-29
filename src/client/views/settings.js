/** Root/template/Git settings: dirty tracking, leave guard and dangerous-change confirmation. */
import { h, useState, useEffect, useRef, errorText, isAbortError } from '../runtime.js'
import { gitStatus, gitInit, gitCommit, saveConfig } from '../core/api.js'
import { Banner } from '../ui/common.js'
import { confirmDialog, choiceDialog } from '../ui/dialogs.js'
import { setLeaveGuard, clearLeaveGuard } from '../core/navigation.js'

const GIT_FILE_LIMIT = 40

export function SettingsView(props) {
  const t = props.t
  const data = props.data
  const config = data && data.config ? data.config : {}
  const serverRoot = data && data.rootDir ? String(data.rootDir) : ''
  const serverTemplate = typeof config.promptTemplate === 'string' ? config.promptTemplate : ''
  const serverReview = typeof config.reviewPromptTemplate === 'string' ? config.reviewPromptTemplate : ''
  const serverCommit = typeof config.commitPromptTemplate === 'string' ? config.commitPromptTemplate : ''
  const serverWorktree = typeof config.worktreeRoot === 'string' ? config.worktreeRoot : ''
  const [draftRoot, setDraftRoot] = useState(serverRoot)
  const [template, setTemplate] = useState(serverTemplate)
  const [reviewTemplate, setReviewTemplate] = useState(serverReview)
  const [commitTemplate, setCommitTemplate] = useState(serverCommit)
  const [worktreeRoot, setWorktreeRoot] = useState(serverWorktree)
  const [gitState, setGitState] = useState({ loading: false, error: '', data: null })
  const [commitMessage, setCommitMessage] = useState(t('detail.git.defaultMessage'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [commitBusy, setCommitBusy] = useState(false)
  const busyRef = useRef(false)
  const gitSeqRef = useRef(null)
  if (!gitSeqRef.current) gitSeqRef.current = { seq: 0 }
  const baselineRef = useRef(null)
  const leaveRef = useRef(null)

  const baseline = baselineRef.current || {
    root: serverRoot.trim(),
    template: serverTemplate,
    review: serverReview,
    commit: serverCommit,
    worktree: serverWorktree.trim(),
  }
  const rootDirty = draftRoot.trim() !== baseline.root
  const templateDirty = template !== baseline.template
  const reviewDirty = reviewTemplate !== baseline.review
  const commitDirty = commitTemplate !== baseline.commit
  const worktreeDirty = worktreeRoot.trim() !== baseline.worktree
  const dirty = rootDirty || templateDirty || reviewDirty || commitDirty || worktreeDirty

  function toast(kind, text) {
    if (typeof props.showToast === 'function') props.showToast(kind, text)
  }
  function loadGit() {
    const token = ++gitSeqRef.current.seq
    setGitState({ loading: true, error: '', data: null })
    gitStatus().then(function (value) {
      if (token !== gitSeqRef.current.seq) return
      setGitState({ loading: false, error: '', data: value })
    }, function (err) {
      if (token !== gitSeqRef.current.seq || isAbortError(err)) return
      setGitState({ loading: false, error: errorText(err), data: null })
    })
  }
  function begin() {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError('')
    return true
  }
  function end() {
    busyRef.current = false
    setBusy(false)
  }
  function refreshAfterSuccess() {
    if (typeof props.reload !== 'function') return
    props.reload().catch(function () {
      toast('error', t('common.refreshFailed'))
    })
  }
  function discardDrafts() {
    if (busyRef.current) return
    baselineRef.current = {
      root: serverRoot.trim(),
      template: serverTemplate,
      review: serverReview,
      commit: serverCommit,
      worktree: serverWorktree.trim(),
    }
    setDraftRoot(serverRoot)
    setTemplate(serverTemplate)
    setReviewTemplate(serverReview)
    setCommitTemplate(serverCommit)
    setWorktreeRoot(serverWorktree)
    setError('')
  }
  function reviewTemplateProblem() {
    if (reviewTemplate.trim() === '') return ''
    return reviewTemplate.indexOf('{taskId}') >= 0 ? '' : t('settings.reviewTemplate.invalid')
  }
  function commitTemplateProblem() {
    if (commitTemplate.trim() === '') return ''
    const required = ['{taskId}', '{changedFiles}', '{diffText}']
    const missing = required.some(function (token) { return commitTemplate.indexOf(token) < 0 })
    return missing === false ? '' : t('settings.commitTemplate.invalid')
  }
  function confirmPathChanges() {
    function confirmWorktreeChange() {
      if (!worktreeDirty) return Promise.resolve(true)
      return confirmDialog({
        title: t('settings.worktree.change.title'),
        body: t('settings.worktree.change.body', {
          old: serverWorktree.trim() || '—',
          new: worktreeRoot.trim() || '—',
        }),
        detail: t('settings.worktree.change.impact'),
        confirmText: t('settings.pathChange.confirm'),
        tone: 'danger',
      })
    }
    if (!rootDirty) return confirmWorktreeChange()
    return confirmDialog({
      title: t('settings.root.change.title'),
      body: t('settings.root.change.body', {
        old: serverRoot.trim() || '—',
        new: draftRoot.trim() || '—',
      }),
      detail: t('settings.root.change.impact'),
      confirmText: t('settings.pathChange.confirm'),
      tone: 'danger',
    }).then(function (confirmed) {
      if (confirmed !== true) return false
      return confirmWorktreeChange()
    })
  }
  function performSave() {
    if (!begin()) return Promise.resolve(false)
    const rootValue = draftRoot.trim()
    const worktreeValue = worktreeRoot.trim()
    return saveConfig({
      rootDir: rootValue,
      promptTemplate: template,
      reviewPromptTemplate: reviewTemplate,
      commitPromptTemplate: commitTemplate,
      worktreeRoot: worktreeValue,
    }).then(function () {
      end()
      baselineRef.current = {
        root: rootValue,
        template: template,
        review: reviewTemplate,
        commit: commitTemplate,
        worktree: worktreeValue,
      }
      setError('')
      toast('info', t('settings.saved'))
      refreshAfterSuccess()
      return true
    }, function (err) {
      end()
      const message = errorText(err)
      setError(message)
      toast('error', message)
      return false
    })
  }
  function saveDraft() {
    if (busyRef.current) return Promise.resolve(false)
    const problem = reviewTemplateProblem() || commitTemplateProblem()
    if (problem !== '') {
      setError(problem)
      toast('error', problem)
      return Promise.resolve(false)
    }
    return confirmPathChanges().then(function (allowed) {
      if (allowed !== true) return false
      return performSave()
    })
  }
  function confirmLeave() {
    return choiceDialog({
      title: t('settings.leave.title'),
      body: t('settings.leave.body'),
      tone: 'danger',
      dismissible: true,
      cancelValue: 'stay',
      actions: [
        { label: t('settings.leave.save'), value: 'save', kind: 'primary' },
        { label: t('settings.leave.discard'), value: 'discard', kind: 'ghost' },
        { label: t('settings.leave.stay'), value: 'stay', kind: 'ghost' },
      ],
    }).then(function (action) {
      if (action === 'discard') return true
      if (action !== 'save') return false
      return saveDraft()
    })
  }
  leaveRef.current = { dirty: dirty, run: confirmLeave }

  useEffect(function () {
    if (!data || !data.configured) return
    loadGit()
  }, [data && data.rootDir, data && data.git && data.git.initialized])
  useEffect(function () {
    if (busyRef.current) return
    baselineRef.current = {
      root: serverRoot.trim(),
      template: serverTemplate,
      review: serverReview,
      commit: serverCommit,
      worktree: serverWorktree.trim(),
    }
    setDraftRoot(serverRoot)
    setTemplate(serverTemplate)
    setReviewTemplate(serverReview)
    setCommitTemplate(serverCommit)
    setWorktreeRoot(serverWorktree)
  }, [serverRoot, serverTemplate, serverReview, serverCommit, serverWorktree])
  useEffect(function () {
    if (dirty !== true) return undefined
    function guard() {
      const view = leaveRef.current
      if (!view || typeof view.run !== 'function') return Promise.resolve(true)
      return view.run()
    }
    setLeaveGuard(guard)
    return function () {
      clearLeaveGuard(guard)
    }
  }, [dirty])

  function pickDirectory() {
    if (busyRef.current) return
    const ctx = props.runtimeCtx
    if (!ctx || !ctx.uiWorkspace || typeof ctx.uiWorkspace.pickDirectory !== 'function') return
    ctx.uiWorkspace.pickDirectory().then(function (picked) {
      if (picked) setDraftRoot(picked)
    }).catch(function (err) { setError(errorText(err)) })
  }
  function pickWorktreeDirectory() {
    if (busyRef.current) return
    const ctx = props.runtimeCtx
    if (!ctx || !ctx.uiWorkspace || typeof ctx.uiWorkspace.pickDirectory !== 'function') return
    ctx.uiWorkspace.pickDirectory().then(function (picked) {
      if (picked) setWorktreeRoot(picked)
    }).catch(function (err) { setError(errorText(err)) })
  }
  function resetReviewTemplate() {
    if (busyRef.current) return
    setReviewTemplate(typeof config.defaultReviewPromptTemplate === 'string' ? config.defaultReviewPromptTemplate : '')
  }
  function resetCommitTemplate() {
    if (busyRef.current) return
    setCommitTemplate(typeof config.defaultCommitPromptTemplate === 'string' ? config.defaultCommitPromptTemplate : '')
  }
  function initGit() {
    if (!begin()) return
    gitInit().then(function () {
      end()
      toast('info', t('settings.git.initSuccess'))
      loadGit()
      refreshAfterSuccess()
    }, function (err) {
      end()
      const message = errorText(err)
      setError(message)
      toast('error', message)
    })
  }
  function gitDetail(changes, message) {
    const rows = changes.slice(0, GIT_FILE_LIMIT).map(function (change) {
      return h('div', {
        className: 'devbench-modal-file',
        key: String(change.path || '') + ':' + String(change.status || ''),
      }, String(change.status || '') + ' ' + String(change.path || ''))
    })
    if (changes.length > GIT_FILE_LIMIT) {
      rows.push(h('div', { className: 'devbench-modal-file', key: 'more' },
        t('settings.git.confirm.more', { count: changes.length - GIT_FILE_LIMIT })))
    }
    return h('div', { className: 'devbench-flexcol' },
      h('div', null, t('settings.git.confirm.message', { message: message })),
      h('div', { className: 'devbench-hint' }, t('settings.git.confirm.files', { count: changes.length })),
      h('div', { className: 'devbench-modal-files' }, rows))
  }
  function commitAll() {
    if (busyRef.current) return
    const message = commitMessage.trim()
    if (message === '') {
      const text = t('settings.git.messageEmpty')
      setError(text)
      toast('error', text)
      return
    }
    const changes = gitState.data && Array.isArray(gitState.data.changes) ? gitState.data.changes : []
    if (changes.length === 0) return
    confirmDialog({
      title: t('settings.git.confirm.title'),
      body: t('settings.git.confirm.body', { count: changes.length }),
      detail: gitDetail(changes, message),
      confirmText: t('settings.git.confirm.action'),
      tone: 'danger',
    }).then(function (confirmed) {
      if (confirmed !== true) return
      runGitCommit(message)
    })
  }
  function runGitCommit(message) {
    if (!begin()) return
    setCommitBusy(true)
    gitCommit(message).then(function (result) {
      end()
      setCommitBusy(false)
      toast('info', result && result.committed === true ? t('settings.git.committed') : t('detail.git.nothing'))
      loadGit()
      refreshAfterSuccess()
    }, function (err) {
      end()
      setCommitBusy(false)
      const text = errorText(err)
      setError(text)
      toast('error', text)
    })
  }
  function gitSection() {
    if (!data || !data.configured) {
      return h('div', { className: 'devbench-section' },
        h('div', { className: 'devbench-section-title' }, t('settings.git')),
        h('div', { className: 'devbench-hint' }, t('settings.root.hint')))
    }
    const git = data.git || {}
    const children = [
      h('div', { className: 'devbench-section-title', key: 'title' }, t('settings.git')),
      h('div', { className: 'devbench-hint', key: 'hint' },
        git.initialized ? t('settings.git.initialized') : t('settings.git.notInitialized')),
      h('div', { className: 'devbench-hint', key: 'desc' }, t('settings.git.desc')),
    ]
    if (git.available === false) {
      children.push(h('div', { className: 'devbench-hint', key: 'unavailable' }, t('common.gitUnavailable')))
    }
    if (!git.initialized) {
      children.push(h('button', {
        className: 'devbench-btn', key: 'init', style: { marginTop: '8px' },
        disabled: busy || git.available === false, onClick: initGit,
      }, t('settings.git.init')))
      return h('div', { className: 'devbench-section' }, children)
    }
    if (gitState.loading) {
      children.push(h('div', { className: 'devbench-hint', key: 'loading' }, t('panel.loading')))
    } else if (gitState.error) {
      children.push(h('div', { key: 'error' },
        h(Banner, { kind: 'error' }, gitState.error),
        h('button', { className: 'devbench-btn', onClick: loadGit }, t('panel.retry'))))
    } else if (gitState.data) {
      appendGitChanges(children, gitState.data)
    }
    return h('div', { className: 'devbench-section' }, children)
  }
  function appendGitChanges(children, state) {
    const changes = Array.isArray(state.changes) ? state.changes : []
    const noChanges = changes.length === 0
    children.push(h('div', { className: 'devbench-hint', key: 'changes', style: { marginTop: '8px' } },
      noChanges ? t('settings.git.clean') : t('settings.git.changesCount', { count: changes.length })))
    if (noChanges === false) {
      children.push(h('div', {
        className: 'devbench-filetree', key: 'list',
        style: { maxHeight: '180px', overflow: 'auto', marginTop: '6px' },
      }, changes.map(function (change) {
        return h('div', { className: 'devbench-file-row', key: change.path },
          h('span', { className: 'devbench-log-hash' }, change.status),
          h('span', { className: 'devbench-file-name' }, change.path))
      })))
    }
    children.push(h('div', {
      className: 'devbench-inline', key: 'commit', style: { marginTop: '10px' },
    },
    h('input', {
      className: 'devbench-input', style: { flex: '1 1 260px' },
      value: commitMessage, disabled: busy,
      placeholder: t('detail.git.message'),
      onChange(event) { setCommitMessage(event.target.value) },
    }),
    h('button', {
      className: 'devbench-btn primary',
      disabled: busy || noChanges,
      title: noChanges ? t('settings.git.clean') : undefined,
      onClick: commitAll,
    }, commitBusy ? t('settings.git.committing') : t('settings.git.commit'))))
  }
  const rootSection = h('div', { className: 'devbench-section' },
    h('div', { className: 'devbench-section-title' }, t('settings.root')),
    h('div', { className: 'devbench-inline' },
      h('input', {
        className: 'devbench-input devbench-mono', style: { flex: '1 1 320px' },
        value: draftRoot, disabled: busy,
        placeholder: '/Users/you/Documents/dsh-devbench-plugin',
        onChange(event) { setDraftRoot(event.target.value) },
      }),
      h('button', { className: 'devbench-btn', disabled: busy, onClick: pickDirectory }, t('settings.pick'))),
    h('div', { className: 'devbench-hint' }, t('settings.root.hint')),
    h('div', { className: 'devbench-inline', style: { marginTop: '10px' } },
      h('button', { className: 'devbench-btn primary', disabled: busy, onClick: function () { saveDraft() } },
        busy ? t('settings.saving') : t('settings.save'))))
  const templateSection = h('div', { className: 'devbench-section' },
    h('div', { className: 'devbench-section-title' }, t('settings.template')),
    h('textarea', {
      className: 'devbench-textarea devbench-mono', rows: 12, value: template,
      disabled: busy,
      onChange(event) { setTemplate(event.target.value) },
    }),
    h('div', { className: 'devbench-hint' }, t('settings.template.hint')),
    h('div', { className: 'devbench-inline', style: { marginTop: '10px' } },
      h('button', { className: 'devbench-btn primary', disabled: busy, onClick: function () { saveDraft() } },
        busy ? t('settings.saving') : t('settings.save'))))
  const reviewTemplateSection = h('div', { className: 'devbench-section' },
    h('div', { className: 'devbench-section-title' }, t('settings.reviewTemplate')),
    h('textarea', {
      className: 'devbench-textarea devbench-mono', rows: 12, value: reviewTemplate,
      disabled: busy,
      onChange(event) { setReviewTemplate(event.target.value) },
    }),
    h('div', { className: 'devbench-hint' }, t('settings.reviewTemplate.hint')),
    h('div', { className: 'devbench-inline', style: { marginTop: '10px' } },
      h('button', { className: 'devbench-btn', disabled: busy, onClick: resetReviewTemplate },
        t('settings.reviewTemplate.reset')),
      h('button', { className: 'devbench-btn primary', disabled: busy, onClick: function () { saveDraft() } },
        busy ? t('settings.saving') : t('settings.save'))))
  const commitTemplateSection = h('div', { className: 'devbench-section' },
    h('div', { className: 'devbench-section-title' }, t('settings.commitTemplate')),
    h('textarea', {
      className: 'devbench-textarea devbench-mono', rows: 12, value: commitTemplate,
      disabled: busy,
      onChange(event) { setCommitTemplate(event.target.value) },
    }),
    h('div', { className: 'devbench-hint' }, t('settings.commitTemplate.hint')),
    h('div', { className: 'devbench-inline', style: { marginTop: '10px' } },
      h('button', { className: 'devbench-btn', disabled: busy, onClick: resetCommitTemplate },
        t('settings.commitTemplate.reset')),
      h('button', { className: 'devbench-btn primary', disabled: busy, onClick: function () { saveDraft() } },
        busy ? t('settings.saving') : t('settings.save'))))
  const defaultWorktreeRoot = typeof config.defaultWorktreeRoot === 'string' ? config.defaultWorktreeRoot : ''
  const worktreeRootSection = h('div', { className: 'devbench-section' },
    h('div', { className: 'devbench-section-title' }, t('settings.worktree.root')),
    h('div', { className: 'devbench-inline' },
      h('input', {
        className: 'devbench-input devbench-mono', style: { flex: '1 1 320px' },
        value: worktreeRoot, disabled: busy,
        placeholder: defaultWorktreeRoot,
        onChange(event) { setWorktreeRoot(event.target.value) },
      }),
      h('button', { className: 'devbench-btn', disabled: busy, onClick: pickWorktreeDirectory },
        t('settings.worktree.pick'))),
    h('div', { className: 'devbench-hint' }, t('settings.worktree.root.hint', { path: defaultWorktreeRoot })),
    h('div', { className: 'devbench-hint' },
      t('settings.worktree.default') + ': ' + (defaultWorktreeRoot || '-')),
    h('div', { className: 'devbench-inline', style: { marginTop: '10px' } },
      h('button', { className: 'devbench-btn primary', disabled: busy, onClick: function () { saveDraft() } },
        busy ? t('settings.saving') : t('settings.save'))))
  return h('div', { className: 'devbench-main-body' },
    props.onBack ? h('button', {
      className: 'devbench-btn ghost', style: { marginBottom: '10px' }, onClick: props.onBack,
    }, t('project.settings.back')) : null,
    h('div', { className: 'devbench-section-title', style: { fontSize: '16px' } }, t('settings.title')),
    dirty
      ? h(Banner, { kind: 'info' },
        h('span', null, t('settings.unsaved')),
        h('button', {
          className: 'devbench-btn ghost',
          style: { marginLeft: 'auto' },
          disabled: busy,
          onClick: discardDrafts,
        }, t('settings.unsaved.discard')))
      : null,
    error ? h(Banner, { kind: 'error' }, error) : null,
    rootSection,
    templateSection,
    reviewTemplateSection,
    commitTemplateSection,
    worktreeRootSection,
    gitSection())
}
