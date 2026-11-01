/** Commit diff browser: the changed files become a tree on the left and the
 *  selected file diff fills the right pane. The diff pane owns both vertical and
 *  horizontal scrolling so very long diffs are never clipped by the master-detail
 *  layout. A single changed file skips the tree and uses the full width. */
import { h, getFragment, useState, useEffect } from '../runtime.js'
import { IconArrow } from './icons.js'

function toCount(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function walkStats(nodes) {
  let additions = 0
  let deletions = 0
  let fileCount = 0
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (node.type === 'dir') {
      const inner = walkStats(node.children)
      node.additions = inner.additions
      node.deletions = inner.deletions
      node.fileCount = inner.fileCount
      additions += inner.additions
      deletions += inner.deletions
      fileCount += inner.fileCount
    } else {
      additions += node.additions
      deletions += node.deletions
      fileCount += 1
    }
  }
  return { additions: additions, deletions: deletions, fileCount: fileCount }
}

/**
 * Build a directory tree from the flat changed-file rows returned by the host.
 * Sibling order follows the git path order; directory rows carry aggregated
 * additions/deletions/fileCount so the tree can show folder stats.
 */
export function buildCommitFileTree(files) {
  const rows = Array.isArray(files) ? files : []
  const root = { children: [], index: {} }
  for (let index = 0; index < rows.length; index++) {
    const file = rows[index]
    if (file === null || typeof file !== 'object') continue
    const path = String(file.path || '')
    if (path === '') continue
    const parts = path.split('/').filter(function (part) { return part !== '' })
    if (parts.length === 0) continue
    let parent = root
    let prefix = ''
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const name = parts[depth]
      prefix = prefix === '' ? name : prefix + '/' + name
      let dir = parent.index[name]
      if (dir === undefined) {
        dir = {
          type: 'dir',
          name: name,
          path: prefix,
          children: [],
          index: {},
          additions: 0,
          deletions: 0,
          fileCount: 0,
        }
        parent.index[name] = dir
        parent.children.push(dir)
      }
      parent = dir
    }
    parent.children.push({
      type: 'file',
      name: parts[parts.length - 1],
      path: path,
      file: file,
      additions: toCount(file.additions),
      deletions: toCount(file.deletions),
    })
  }
  walkStats(root.children)
  return root.children
}

function statusText(file) {
  const status = String((file && file.status) || 'M')
  return status === '' ? 'M' : status
}

export function CommitDiffBrowser(props) {
  const t = props.t
  const files = Array.isArray(props.files) ? props.files : []
  const multiple = files.length > 1
  const tree = buildCommitFileTree(files)
  const [selectedPath, setSelectedPath] = useState('')
  const [collapsed, setCollapsed] = useState({})
  useEffect(function () {
    if (files.length === 0) {
      if (selectedPath !== '') setSelectedPath('')
      return
    }
    const found = files.some(function (file) { return file.path === selectedPath })
    if (found === false) setSelectedPath(String(files[0].path || ''))
  }, [files, selectedPath])
  const activeFile = files.find(function (file) {
    return file.path === selectedPath
  }) || files[0] || null
  if (activeFile === null) return null
  const activeStatus = statusText(activeFile)
  function toggleDir(path) {
    setCollapsed(function (prev) {
      const next = Object.assign({}, prev)
      next[path] = prev[path] !== true
      return next
    })
  }
  function renderStats(additions, deletions, className) {
    if (additions <= 0 && deletions <= 0) return null
    return h('span', { className: className },
      h('span', { className: 'devbench-commit-file-add' }, '+' + String(additions)),
      h('span', { className: 'devbench-commit-file-del' }, '-' + String(deletions)))
  }
  function renderFileRow(node, depth) {
    const active = node.path === activeFile.path
    const status = statusText(node.file)
    return h('button', {
      key: node.path,
      type: 'button',
      className: 'devbench-commit-tree-row file' + (active ? ' active' : ''),
      style: { paddingLeft: (6 + depth * 14) + 'px' },
      title: node.file.oldPath ? node.path + ' ← ' + node.file.oldPath : node.path,
      'aria-pressed': active ? 'true' : 'false',
      onClick() { setSelectedPath(node.path) },
    },
    h('span', { className: 'devbench-commit-file-status ' + status }, status),
    h('span', { className: 'devbench-commit-tree-name' }, node.name),
    renderStats(node.additions, node.deletions, 'devbench-commit-tree-stats'))
  }
  function renderDirRow(node, depth) {
    const open = collapsed[node.path] !== true
    return h('button', {
      key: node.path,
      type: 'button',
      className: 'devbench-commit-tree-row dir',
      style: { paddingLeft: (6 + depth * 14) + 'px' },
      title: node.path,
      'aria-expanded': open ? 'true' : 'false',
      onClick() { toggleDir(node.path) },
    },
    h('span', {
      className: 'devbench-commit-tree-arrow',
      style: { transform: open ? 'rotate(90deg)' : 'none' },
    }, h(IconArrow, { size: 12 })),
    h('span', { className: 'devbench-commit-tree-dirname' }, node.name),
    renderStats(node.additions, node.deletions, 'devbench-commit-tree-stats'))
  }
  function renderNodes(nodes, depth) {
    return nodes.map(function (node) {
      if (node.type === 'file') return renderFileRow(node, depth)
      const open = collapsed[node.path] !== true
      return h(getFragment(), { key: 'dir-' + node.path },
        renderDirRow(node, depth),
        open ? renderNodes(node.children, depth + 1) : null)
    })
  }
  const treePane = multiple
    ? h('div', {
      className: 'devbench-commit-tree',
      role: 'group',
      'aria-label': t('tabs.commits.diffTree'),
    }, renderNodes(tree, 0))
    : null
  let diffBody
  if (activeFile.binary === true) {
    diffBody = h('div', { className: 'devbench-commit-diff-note' }, t('tabs.commits.binaryFile'))
  } else if (String(activeFile.diff || '') === '') {
    diffBody = h('div', { className: 'devbench-commit-diff-note' }, t('tabs.commits.emptyDiff'))
  } else {
    diffBody = h('pre', {
      className: 'devbench-commit-diff',
      tabIndex: 0,
      'aria-label': activeFile.path,
    }, activeFile.diff)
  }
  const diffPane = h('div', { className: 'devbench-commit-browser-diff' },
    h('div', { className: 'devbench-commit-diff-head' },
      h('span', { className: 'devbench-commit-file-status ' + activeStatus }, activeStatus),
      h('span', { className: 'devbench-commit-diff-path', title: activeFile.path }, activeFile.path),
      activeFile.oldPath
        ? h('span', { className: 'devbench-commit-diff-oldpath', title: activeFile.oldPath },
          '← ' + activeFile.oldPath)
        : null,
      renderStats(toCount(activeFile.additions), toCount(activeFile.deletions),
        'devbench-commit-diff-stats')),
    diffBody,
    activeFile.truncated === true
      ? h('div', { className: 'devbench-commit-diff-foot' }, t('tabs.commits.diffTruncated'))
      : null)
  return h('div', { className: 'devbench-commit-browser' + (multiple ? '' : ' single') },
    treePane,
    diffPane)
}
