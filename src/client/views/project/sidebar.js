import { h, useState } from '../../runtime.js'
import { projectRows, relativeProjectPath } from '../../core/project-utils.js'
import { IconPlus, IconRefresh, IconSettings, IconHome } from '../../ui/icons.js'
import { Banner } from '../../ui/common.js'
export function ProjectSidebar(props) {
  const t = props.t
  const [search, setSearch] = useState('')
  const projects = props.projects || []
  const rows = projectRows(projects, search)
  const homeActive = props.view === 'home'
  let body
  if (projects.length === 0) {
    body = h('div', { className: 'devbench-empty-panel', style: { margin: '8px' } }, t('project.empty'))
  } else if (rows.length === 0) {
    body = h('div', { className: 'devbench-empty-panel', style: { margin: '8px' } }, t('project.emptySearch'))
  } else {
    body = rows.map(function (row) {
      const project = row.project
      const active = props.view === 'project' && props.selectedProjectId === project.workspaceId
      const activeTaskCount = Number(project.activeTaskCount) || 0
      const activeTaskLabel = t('project.tasks.activeCount', { count: activeTaskCount })
      return h('div', {
        key: project.workspaceId,
        className: 'devbench-project-row' + (active ? ' active' : ''),
        role: 'button', tabIndex: 0,
        'aria-current': active ? 'page' : undefined,
        style: { marginLeft: (row.depth * 14) + 'px' },
        onClick() { props.onSelect(project.workspaceId) },
        onKeyDown(event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            props.onSelect(project.workspaceId)
          }
        },
      },
      h('div', { className: 'devbench-project-main' },
        h('div', { className: 'devbench-project-name-row' },
          h('div', { className: 'devbench-project-name', title: project.title }, project.title),
          activeTaskCount > 0
            ? h('span', {
              className: 'devbench-project-activity-dot',
              title: activeTaskLabel,
              role: 'status',
              'aria-label': activeTaskLabel,
            })
            : null),
        h('div', { className: 'devbench-project-path', title: project.path },
          relativeProjectPath(project, projects)),
        project.missingPath ? h('div', { className: 'devbench-project-missing' }, t('project.missingPath')) : null))
    })
  }
  return h('aside', { className: 'devbench-projects' },
    h('div', { className: 'devbench-projects-head' },
      h('div', { className: 'devbench-projects-title' }, t('project.title')),
      h('button', {
        className: 'devbench-icon-btn', title: t('project.refresh'),
        onClick: props.onRefresh,
      }, h(IconRefresh, { size: 15 })),
      h('button', {
        className: 'devbench-icon-btn' + (props.view === 'settings' ? ' active' : ''),
        title: t('panel.settings'),
        'aria-pressed': props.view === 'settings',
        onClick: props.onSettings,
      }, h(IconSettings, { size: 15 }))),
    h('div', { className: 'devbench-projects-home' },
      h('div', {
        className: 'devbench-project-row devbench-home-row' + (homeActive ? ' active' : ''),
        role: 'button', tabIndex: 0,
        'aria-current': homeActive ? 'page' : undefined,
        onClick() { if (props.onHome) props.onHome() },
        onKeyDown(event) {
          if ((event.key === 'Enter' || event.key === ' ') && props.onHome) {
            event.preventDefault()
            props.onHome()
          }
        },
      },
      h('span', { className: 'devbench-home-icon' }, h(IconHome, { size: 15 })),
      h('div', { className: 'devbench-project-main' },
        h('div', { className: 'devbench-project-name' }, t('home.title'))))),
    h('div', { className: 'devbench-project-search' },
      h('input', {
        className: 'devbench-input',
        placeholder: t('project.search'),
        value: search,
        onChange(event) { setSearch(event.target.value) },
        style: { fontSize: '12.5px', padding: '5px 8px' },
      })),
    h('div', { className: 'devbench-project-add' },
      h('button', {
        className: 'devbench-btn primary',
        disabled: props.adding === true,
        onClick: props.onAdd,
      }, h(IconPlus, { size: 14 }), props.adding ? t('project.adding') : t('project.add')),
      props.addError ? h('div', { style: { marginTop: '8px' } }, h(Banner, { kind: 'error' }, props.addError)) : null),
    h('div', { className: 'devbench-project-list' }, body))
}
