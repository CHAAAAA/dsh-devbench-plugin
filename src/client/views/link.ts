/** Requirement picker for the current session. Parent owns the linking single-flight. */
import { h, useState } from '../runtime.js'

function matches(requirement, needle) {
  if (needle === '') return true
  const text = String(requirement && requirement.title || '') + ' ' + String(requirement && requirement.id || '')
  return text.toLowerCase().indexOf(needle) >= 0
}

export function LinkView(props) {
  const t = props.t
  const data = props.data
  const linking = props.linking === true
  const [search, setSearch] = useState('')
  const sessionId = props.sessionId === null || props.sessionId === undefined ? '' : String(props.sessionId)
  const sessionTitle = props.sessionTitle === null || props.sessionTitle === undefined ? '' : String(props.sessionTitle)
  const sessionLabel = sessionTitle !== '' ? sessionTitle : sessionId
  const needle = String(search || '').trim().toLowerCase()
  const groups = []
  let total = 0
  if (data && Array.isArray(data.workspaces)) {
    data.workspaces.forEach(function (workspace) {
      const requirements = (Array.isArray(workspace.requirements) ? workspace.requirements : [])
        .filter(function (requirement) { return matches(requirement, needle) })
      if (requirements.length === 0) return
      total += requirements.length
      groups.push({ workspace: workspace, requirements: requirements })
    })
  }
  function pick(workspaceId, id) {
    if (linking) return
    props.onPick(workspaceId, id)
  }
  function renderRow(workspace, requirement) {
    return h('button', {
      key: requirement.id,
      type: 'button',
      className: 'devbench-req',
      disabled: linking,
      title: linking ? t('link.busy') : t('link.action') + ': ' + requirement.title,
      style: {
        width: '100%',
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: linking ? 'not-allowed' : 'pointer',
        opacity: linking ? 0.6 : 1,
      },
      onClick: function () { pick(workspace.workspaceId, requirement.id) },
    },
    h('span', { className: 'devbench-dot ' + requirement.status }),
    h('div', { className: 'devbench-req-main' },
      h('div', { className: 'devbench-req-title' }, requirement.title),
      h('div', { className: 'devbench-req-meta' },
        h('span', null, t('status.' + requirement.status)),
        h('span', null, '.'),
        h('span', null, requirement.id))),
    h('span', { className: 'devbench-pill', style: { flex: 'none' } },
      linking ? t('link.busy') : t('link.action')))
  }
  return h('div', { className: 'devbench-main-body' },
    h('div', { className: 'devbench-section' },
      h('div', { className: 'devbench-section-title', style: { fontSize: '16px' } }, t('link.title')),
      h('div', { className: 'devbench-hint' }, t('link.body'))),
    sessionLabel !== ''
      ? h('div', {
        className: 'devbench-notice',
        style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', marginBottom: '12px', padding: '8px 12px' },
      },
      h('span', { className: 'devbench-hint', style: { margin: 0 } }, t('link.session', { name: sessionLabel })),
      sessionTitle !== '' && sessionId !== ''
        ? h('span', { className: 'devbench-mono', style: { flex: 'none' }, title: sessionId }, sessionId)
        : null)
      : null,
    h('div', { className: 'devbench-section' },
      h('div', { className: 'devbench-inline', style: { justifyContent: 'space-between' } },
        h('input', {
          className: 'devbench-input',
          style: { flex: '0 1 360px', minWidth: '180px' },
          placeholder: t('link.search'),
          value: search,
          disabled: linking,
          onChange: function (event) { setSearch(event.target.value) },
        }),
        h('span', { className: 'devbench-muted' }, t('link.totalCount', { count: total })))),
    groups.length === 0
      ? h('div', { className: 'devbench-empty' }, needle === '' ? t('link.empty') : t('link.search.empty'))
      : groups.map(function (group) {
        return h('div', { className: 'devbench-section', key: group.workspace.workspaceId },
          h('div', { className: 'devbench-section-title' },
            group.workspace.title,
            h('span', { className: 'spacer' }),
            h('span', { className: 'devbench-pill' }, t('link.groupCount', { count: group.requirements.length }))),
          group.requirements.map(function (requirement) {
            return renderRow(group.workspace, requirement)
          }))
      }),
    h('button', {
      className: 'devbench-btn ghost',
      style: { marginTop: '8px' },
      onClick: props.onCancel,
    }, t('link.cancel')))
}
