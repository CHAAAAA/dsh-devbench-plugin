import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile, mkdirIfMissing, withFileLock, withRootLock } from '../shared/atomic.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import { isPathInside, lstatMaybe } from '../shared/path-safety.js'
import { assertGitRoot, runGit } from '../integrations/git.js'

export const REVIEWS_DIR = '.dsh-reviews'
const REVIEW_MARKER = REVIEWS_DIR + '/'

async function projectRoot(projectPath) {
  const real = await fsp.realpath(projectPath)
  const stat = await fsp.stat(real)
  if (stat.isDirectory() === false) throw apiError(400, 'bad-project-path', messages.projectPathInvalid)
  return real
}

async function resolveReviewsDirectory(projectPath, create) {
  const root = await projectRoot(projectPath)
  const target = path.join(root, REVIEWS_DIR)
  let stat = await lstatMaybe(target)
  if (stat === null && create) {
    await mkdirIfMissing(target)
    stat = await fsp.lstat(target)
  }
  if (stat === null) return { root, directory: null }
  if (stat.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.reviewsSymlink)
  }
  if (stat.isDirectory() === false) {
    throw apiError(400, 'bad-reviews-dir', messages.reviewsDirectoryInvalid)
  }
  const real = await fsp.realpath(target)
  if (isPathInside(root, real, false) === false) {
    throw apiError(400, 'bad-reviews-dir', messages.reviewsDirectoryInvalid)
  }
  return { root, directory: real }
}

export async function ensureReviewsDirectory(projectPath) {
  const result = await resolveReviewsDirectory(projectPath, true)
  return result.directory
}

export async function ensureReviewExclude(projectPath) {
  const git = await assertGitRoot(projectPath)
  const result = await runGit(git.root, ['rev-parse', '--git-dir'])
  if (result.code !== 0) {
    throw apiError(400, 'git-not-initialized', messages.gitNotInitialized)
  }
  let gitDir = result.stdout.trim()
  if (path.isAbsolute(gitDir) === false) gitDir = path.resolve(git.root, gitDir)
  const gitReal = await fsp.realpath(gitDir)
  if (isPathInside(git.root, gitReal, false) === false) {
    throw apiError(400, 'unsafe-git-dir', messages.projectGitDirUnsafe)
  }
  const dotGit = await lstatMaybe(path.join(git.root, '.git'))
  if (dotGit !== null && dotGit.isSymbolicLink()) {
    throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
  }
  const infoDir = path.join(gitReal, 'info')
  let infoStat = await lstatMaybe(infoDir)
  if (infoStat === null) {
    await fsp.mkdir(infoDir)
    infoStat = await fsp.lstat(infoDir)
  }
  if (infoStat.isSymbolicLink() || infoStat.isDirectory() === false) {
    throw apiError(400, 'unsafe-git-dir', messages.projectGitDirUnsafe)
  }
  const exclude = path.join(infoDir, 'exclude')
  return withFileLock(exclude, async function () {
    const stat = await lstatMaybe(exclude)
    if (stat !== null && stat.isSymbolicLink()) {
      throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
    }
    if (stat !== null && stat.isFile() === false) {
      throw apiError(400, 'unsafe-git-dir', messages.projectGitDirUnsafe)
    }
    let text = stat === null ? '' : await fsp.readFile(exclude, 'utf8')
    if (text.split(/\r?\n/).includes(REVIEW_MARKER)) return
    const trimmed = text.replace(/\s*$/, '')
    const prefix = trimmed.length > 0 ? trimmed + '\n' : ''
    await atomicWriteFile(exclude, prefix + REVIEW_MARKER + '\n')
  })
}

export function sanitizeReviewSummary(summary) {
  let text = String(summary || '')
  text = text.replace(/[\u0000-\u001f\u007f]/g, '')
  text = text.replace(/[\\/:*?"<>|]/g, '-')
  text = text.replace(/\s+/g, '-').replace(/-+/g, '-')
  text = text.replace(/^[-.]+|[-.]+$/g, '')
  text = text.slice(0, 48).replace(/[-.]+$/g, '')
  return text.length > 0 ? text : 'review'
}

function localDatePart(date) {
  return String(date.getFullYear()) +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0')
}

function serializeReview(task, summary, content, createdAt) {
  const project = task.projectTitle || task.projectPath || ''
  const lines = [
    '---',
    'task: ' + JSON.stringify(task.id),
    'project: ' + JSON.stringify(project),
    'workspaceId: ' + JSON.stringify(task.workspaceId || ''),
    'commit: ' + JSON.stringify(task.commitHash || ''),
    'commitSubject: ' + JSON.stringify(task.commitSubject || ''),
  ]
  // 未提交评审额外标记 target；普通提交评审保持原有 frontmatter 不变。
  if (task.reviewTarget === 'uncommitted') {
    lines.push('target: ' + JSON.stringify('uncommitted'))
  }
  lines.push(
    'createdAt: ' + JSON.stringify(createdAt),
    'summary: ' + JSON.stringify(String(summary || '').trim()),
    '---',
    '',
  )
  const body = String(content || '').replace(/^\r?\n+/, '')
  return lines.join('\n') + body + (body.endsWith('\n') ? '' : '\n')
}

export async function writeReview(projectPath, task, summary, content) {
  if (typeof summary !== 'string' || summary.trim().length === 0) {
    throw apiError(400, 'bad-review-summary', messages.reviewSummaryInvalid)
  }
  if (typeof content !== 'string') {
    throw apiError(400, 'bad-review-content', messages.reviewContentInvalid)
  }
  const root = await projectRoot(projectPath)
  return withRootLock(root, async function () {
    const directory = await ensureReviewsDirectory(root)
    const datePart = localDatePart(new Date())
    const slug = sanitizeReviewSummary(summary)
    let counter = 1
    let name = datePart + '-' + slug + '.md'
    while (true) {
      const existing = await lstatMaybe(path.join(directory, name))
      if (existing === null) break
      counter += 1
      name = datePart + '-' + slug + '-' + counter + '.md'
    }
    const createdAt = new Date().toISOString()
    const text = serializeReview(task, summary, content, createdAt)
    await atomicWriteFile(path.join(directory, name), text)
    return {
      name,
      relativePath: REVIEWS_DIR + '/' + name,
      createdAt,
    }
  })
}

function parseReviewText(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text)
  if (match === null) return { meta: {}, body: text }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(line)
    if (pair === null) continue
    const value = pair[2].trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        meta[pair[1]] = JSON.parse(value)
      } catch {
        meta[pair[1]] = value.slice(1, -1)
      }
    } else {
      meta[pair[1]] = value
    }
  }
  let body = text.slice(match[0].length)
  if (body.startsWith('\r\n')) body = body.slice(2)
  else if (body.startsWith('\n')) body = body.slice(1)
  return { meta, body }
}

export async function listReviews(projectPath) {
  const resolved = await resolveReviewsDirectory(projectPath, false)
  if (resolved.directory === null) return []
  const entries = await fsp.readdir(resolved.directory, { withFileTypes: true })
  const reviews = []
  for (const entry of entries) {
    if (entry.isFile() === false || entry.name.endsWith('.md') === false) continue
    const file = path.join(resolved.directory, entry.name)
    const stat = await lstatMaybe(file)
    if (stat === null || stat.isSymbolicLink() || stat.isFile() === false) continue
    const parsed = parseReviewText(await fsp.readFile(file, 'utf8'))
    reviews.push({
      name: entry.name,
      task: parsed.meta.task || '',
      project: parsed.meta.project || '',
      workspaceId: parsed.meta.workspaceId || '',
      commit: parsed.meta.commit || '',
      commitSubject: parsed.meta.commitSubject || '',
      target: parsed.meta.target === 'uncommitted' ? 'uncommitted' : 'commit',
      createdAt: parsed.meta.createdAt || '',
      modifiedAt: stat.mtime.toISOString(),
      size: stat.size,
      summary: parsed.meta.summary || '',
    })
  }
  reviews.sort(function (left, right) {
    const byDate = String(right.modifiedAt).localeCompare(String(left.modifiedAt))
    return byDate === 0 ? right.name.localeCompare(left.name) : byDate
  })
  return reviews
}

async function resolveReviewFile(projectPath, name) {
  if (typeof name !== 'string' || name.length === 0 || name.endsWith('.md') === false) {
    throw apiError(400, 'bad-review-name', messages.reviewNameInvalid)
  }
  const nul = String.fromCharCode(0)
  if (name.includes('/') || name.includes('\\') || name.includes(nul) || path.basename(name) !== name) {
    throw apiError(400, 'bad-review-name', messages.reviewNameInvalid)
  }
  const resolved = await resolveReviewsDirectory(projectPath, false)
  if (resolved.directory === null) {
    throw apiError(404, 'review-not-found', messages.reviewNotFound)
  }
  const target = path.join(resolved.directory, name)
  const stat = await lstatMaybe(target)
  if (stat === null || stat.isSymbolicLink() || stat.isFile() === false) {
    throw apiError(404, 'review-not-found', messages.reviewNotFound)
  }
  const real = await fsp.realpath(target)
  if (path.dirname(real) !== resolved.directory) {
    throw apiError(400, 'bad-review-name', messages.reviewNameInvalid)
  }
  return { stat, real }
}

export async function readReviewFile(projectPath, name) {
  const resolved = await resolveReviewFile(projectPath, name)
  const parsed = parseReviewText(await fsp.readFile(resolved.real, 'utf8'))
  return {
    name,
    task: parsed.meta.task || '',
    project: parsed.meta.project || '',
    workspaceId: parsed.meta.workspaceId || '',
    commit: parsed.meta.commit || '',
    commitSubject: parsed.meta.commitSubject || '',
    target: parsed.meta.target === 'uncommitted' ? 'uncommitted' : 'commit',
    createdAt: parsed.meta.createdAt || '',
    modifiedAt: resolved.stat.mtime.toISOString(),
    summary: parsed.meta.summary || '',
    size: resolved.stat.size,
    content: parsed.body,
  }
}

export async function readReviewContent(projectPath, name) {
  const file = await readReviewFile(projectPath, name)
  return file.content
}
