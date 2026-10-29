export const ACTIVE_TASK_STATUSES = ['queued', 'running', 'awaiting_confirmation']
export function canonicalPath(project) {
  return String((project && (project.canonicalPath || project.path)) || '').replace(/\\/g, '/').replace(/\/+$/, '')
}
export function isPathPrefix(parent, child) {
  if (parent === '' || child === '') return false
  return child === parent || child.indexOf(parent + '/') === 0
}
export function projectDepth(project, projects) {
  const path = canonicalPath(project)
  let depth = 0
  ;(projects || []).forEach(function (item) {
    if (item.workspaceId === project.workspaceId) return
    const other = canonicalPath(item)
    if (other !== path && isPathPrefix(other, path)) depth += 1
  })
  return depth
}
export function sortProjects(projects) {
  return (projects || []).slice().sort(function (a, b) {
    const left = canonicalPath(a)
    const right = canonicalPath(b)
    if (left < right) return -1
    if (left > right) return 1
    return String(a.title || '').localeCompare(String(b.title || ''))
  })
}
export function lastPathSegment(path) {
  const text = String(path || '')
  const index = text.lastIndexOf('/')
  return index >= 0 ? text.slice(index + 1) : text
}
export function projectRows(projects, query) {
  const sorted = sortProjects(projects)
  const needle = String(query || '').trim().toLowerCase()
  const included = new Set()
  if (needle === '') {
    sorted.forEach(function (project) { included.add(project.workspaceId) })
  } else {
    sorted.forEach(function (project) {
      const text = String(project.title || '').toLowerCase() + ' ' + canonicalPath(project).toLowerCase()
      if (text.indexOf(needle) >= 0) {
        const matchPath = canonicalPath(project)
        sorted.forEach(function (candidate) {
          const path = canonicalPath(candidate)
          if (isPathPrefix(path, matchPath) || isPathPrefix(matchPath, path)) {
            included.add(candidate.workspaceId)
          }
        })
      }
    })
  }
  return sorted.filter(function (project) { return included.has(project.workspaceId) })
    .map(function (project) { return { project: project, depth: projectDepth(project, sorted) } })
}
export function isActiveTask(task) {
  return Boolean(task && ACTIVE_TASK_STATUSES.indexOf(task.status) >= 0)
}
export function activeTasks(tasks) {
  return (tasks || []).filter(isActiveTask)
}
export function findAwaitingCommitTask(tasks) {
  return (tasks || []).find(function (task) {
    return task && task.kind === 'commit' && task.status === 'awaiting_confirmation'
  }) || null
}
export function findReviewForCommit(reviews, commit) {
  const hash = String(commit || '')
  return (reviews || []).find(function (review) {
    const value = String(review && review.commit || '')
    return value === hash || (value !== '' && hash.indexOf(value) === 0) || (hash !== '' && value.indexOf(hash) === 0)
  }) || null
}
export function taskStatusKey(status) {
  if (status === 'running') return 'status.running'
  if (status === 'cancelled') return 'status.cancelled'
  return 'status.' + String(status || 'queued')
}
export function taskKindKey(kind) {
  if (kind === 'commit') return 'task.kind.commit'
  if (kind === 'requirement') return 'task.kind.requirement'
  return 'task.kind.review'
}
export function isRequirementTask(task) {
  return Boolean(task && task.kind === 'requirement')
}
export function taskCanCancel(task) {
  if (isRequirementTask(task)) return false
  return Boolean(task && (task.status === 'queued' || task.status === 'running' || task.status === 'awaiting_confirmation'))
}
export function taskCanRetry(task) {
  if (isRequirementTask(task)) return false
  return Boolean(task && (task.status === 'failed' || task.status === 'cancelled'))
}
export function changedFiles(task) {
  const value = task && task.changedFiles
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value !== '') return value.split('\n')
  return []
}
function taskTime(task) {
  const value = task && (task.updatedAt || task.createdAt)
  const parsed = value ? Date.parse(value) : 0
  return Number.isNaN(parsed) ? 0 : parsed
}
export function mergeTasks(existing, incoming) {
  const map = new Map()
  ;(existing || []).forEach(function (task) { if (task && task.id) map.set(task.id, task) })
  ;(incoming || []).forEach(function (task) {
    if (task === null || task === undefined || task.id === undefined) return
    const previous = map.get(task.id)
    if (previous === undefined || taskTime(task) >= taskTime(previous)) map.set(task.id, task)
  })
  return Array.from(map.values()).sort(function (a, b) {
    return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
  })
}
export function relativeProjectPath(project, projects) {
  const path = canonicalPath(project)
  let parent = null
  ;(projects || []).forEach(function (item) {
    if (item.workspaceId === project.workspaceId) return
    const other = canonicalPath(item)
    if (isPathPrefix(other, path) && (parent === null || other.length > parent.length)) parent = other
  })
  if (parent === null) return lastPathSegment(path)
  return path.slice(parent.length + 1)
}
export function findActiveReviewTask(tasks, hash) {
  const value = String(hash || '')
  return (tasks || []).find(function (task) {
    if (task === null || task === undefined) return false
    if (task.kind !== 'review' || isActiveTask(task) === false) return false
    const full = String(task.commitHash || '')
    const short = String(task.commitShort || '')
    return (full !== '' && (full === value || value.indexOf(full) === 0 || full.indexOf(value) === 0)) ||
      (short !== '' && value.indexOf(short) === 0)
  }) || null
}
/** Active review task that reviews the working tree instead of a commit. */
export function findActiveUncommittedReviewTask(tasks) {
  return (tasks || []).find(function (task) {
    if (task === null || task === undefined) return false
    return task.kind === 'review' && task.reviewTarget === 'uncommitted' && isActiveTask(task)
  }) || null
}
