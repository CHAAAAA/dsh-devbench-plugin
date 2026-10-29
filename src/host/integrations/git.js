/** Git integration that refuses to operate on a parent repository. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as fsConstants, createReadStream } from 'node:fs'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { DEFAULT_COMMIT_PAGE_SIZE, MAX_COMMIT_PAGE_SIZE } from '../constants.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import { isPathInside } from '../shared/path-safety.js'
import { ensureGitignore } from '../storage/workspaces.js'

const execFileAsync = promisify(execFile)
let gitCache

export async function gitAvailable() {
  if (gitCache !== undefined) return gitCache
  try {
    await execFileAsync('git', ['--version'], { timeout: 10000 })
    gitCache = true
  } catch {
    gitCache = false
  }
  return gitCache
}

export async function runGit(root, args, options = {}) {
  try {
    const settings = {
      cwd: root,
      timeout: options.timeout || 30000,
      maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
      windowsHide: true,
    }
    if (options.env !== undefined && options.env !== null) settings.env = Object.assign({}, process.env, options.env)
    const result = await execFileAsync('git', args, settings)
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return {
      code: typeof error.code === 'number' ? error.code : -1,
      stdout: error.stdout || '',
      stderr: error.stderr || String(error.message || error),
    }
  }
}

export async function assertGitRoot(root) {
  let rootReal
  try {
    rootReal = await fsp.realpath(root)
  } catch {
    throw apiError(400, 'git-not-initialized', messages.gitNotInitialized)
  }
  const result = await runGit(rootReal, ['rev-parse', '--show-toplevel'])
  if (result.code !== 0) {
    throw apiError(400, 'git-not-initialized', messages.gitNotInitialized)
  }
  const top = result.stdout.trim()
  if (top.length === 0) {
    throw apiError(400, 'git-not-initialized', messages.gitNotInitialized)
  }
  let topReal
  try {
    topReal = await fsp.realpath(top)
  } catch {
    throw apiError(400, 'git-not-initialized', messages.gitNotInitialized)
  }
  if (topReal !== rootReal) {
    throw apiError(400, 'git-not-initialized', messages.gitNotInitialized)
  }
  return { root: rootReal, topLevel: topReal }
}

/** First non-empty line of git output, bounded for error messages. */
export function firstLine(value) {
  const text = String(value || '')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return trimmed.slice(0, 300)
  }
  return ''
}

/** Strip embedded credentials from git URL remnants before echoing them to the UI. */
export function sanitizeGitDetail(value) {
  return String(value || '').replace(/\/\/[^/@\s]+@/g, '//***@').slice(0, 300)
}

async function currentBranch(root) {
  const result = await runGit(root, ['symbolic-ref', '--short', '-q', 'HEAD'])
  return result.code === 0 ? result.stdout.trim() : ''
}

async function revListCounts(cwd, leftRef, rightRef) {
  const result = await runGit(cwd, ['rev-list', '--left-right', '--count',
    leftRef + '...' + rightRef])
  if (result.code !== 0) return { left: 0, right: 0, known: false }
  const values = result.stdout.trim().split(/\s+/)
  return { left: Number(values[0]) || 0, right: Number(values[1]) || 0, known: true }
}

/**
 * Upstream of the checked-out branch with ahead/behind counts relative to
 * `HEAD`: right = ahead, left = behind. `known` is false when `rev-list` fails.
 */
async function upstreamWithCounts(root) {
  const result = await runGit(root,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  if (result.code !== 0) return null
  const value = result.stdout.trim()
  const index = value.indexOf('/')
  if (index <= 0) return null
  const counts = await revListCounts(root, value, 'HEAD')
  return {
    remote: value.slice(0, index),
    branch: value.slice(index + 1),
    ahead: counts.right,
    behind: counts.left,
    known: counts.known,
  }
}

/** Configured upstream of the checked-out branch, or null when none is set. */
export async function upstreamState(root) {
  const state = await upstreamWithCounts(root)
  if (state === null) return null
  return { remote: state.remote, branch: state.branch, ahead: state.ahead, behind: state.behind }
}

/** Configured remote names for the project, empty when git cannot answer. */
export async function resolveRemotes(root) {
  const result = await runGit(root, ['remote'])
  if (result.code !== 0) return []
  return result.stdout.split('\n').map(function (item) {
    return item.trim()
  }).filter(Boolean)
}

/** origin first, then the only configured remote; otherwise null (push unavailable). */
export function preferredRemote(remotes) {
  const items = Array.isArray(remotes) ? remotes : []
  if (items.includes('origin')) return 'origin'
  if (items.length === 1) return items[0]
  return null
}

export async function gitInfo(root) {
  const available = await gitAvailable()
  if (available === false || typeof root !== 'string' || root.length === 0) {
    return { available, initialized: false }
  }
  try {
    await assertGitRoot(root)
    return { available, initialized: true }
  } catch {
    return { available, initialized: false }
  }
}

export async function gitStatus(root) {
  await assertGitRoot(root)
  const branch = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = await runGit(root, ['status', '--porcelain'])
  const changes = status.code === 0
    ? status.stdout.split('\n').filter(Boolean).map(function (line) {
      return { status: line.slice(0, 2).trim(), path: line.slice(3) }
    })
    : []
  return {
    initialized: true,
    branch: branch.code === 0 ? branch.stdout.trim() : '',
    changes,
  }
}

export async function gitInit(root) {
  if (await gitAvailable() === false) {
    throw apiError(400, 'git-unavailable', messages.gitUnavailable)
  }
  await fsp.mkdir(root, { recursive: true })
  const info = await gitInfo(root)
  if (info.initialized) return { initialized: true }
  const result = await runGit(root, ['init'])
  if (result.code !== 0) {
    throw apiError(500, 'git-init-failed', result.stderr || messages.gitInitFailed)
  }
  await assertGitRoot(root)
  return { initialized: true }
}

export async function gitCommit(root, message) {
  await assertGitRoot(root)
  await ensureGitignore(root)
  const before = await runGit(root, ['status', '--porcelain'])
  if (before.code !== 0) {
    throw apiError(500, 'git-status-failed', before.stderr || messages.gitStatusFailed)
  }
  if (before.stdout.trim() === '') {
    return { committed: false, message: messages.noChanges }
  }
  const add = await runGit(root, ['add', '-A'])
  if (add.code !== 0) {
    throw apiError(500, 'git-add-failed', add.stderr || messages.gitAddFailed)
  }
  const commit = await runGit(root, ['commit', '-m', message])
  if (commit.code === 0) return { committed: true, message }
  const after = await runGit(root, ['status', '--porcelain'])
  if (after.code === 0 && after.stdout.trim() === '') {
    return { committed: false, message: messages.noChanges }
  }
  const detail = (after.stdout + '\n' + commit.stdout + '\n' + commit.stderr).trim()
  throw apiError(500, 'git-commit-failed', detail || messages.gitCommitFailed)
}

export async function gitLog(root, folder, limit) {
  const gitRoot = await assertGitRoot(root)
  const count = Math.max(1, Math.min(Number(limit) || 30, 200))
  const args = ['log', '--pretty=format:%H%x1f%h%x1f%ad%x1f%s', '--date=iso', '-n', String(count)]
  if (folder) {
    let folderReal
    try {
      folderReal = await fsp.realpath(folder)
    } catch {
      return []
    }
    if (isPathInside(gitRoot.topLevel, folderReal, true) === false) return []
    const relative = path.relative(gitRoot.topLevel, folderReal)
    if (relative.length > 0) args.push('--', relative)
  }
  const result = await runGit(gitRoot.root, args)
  if (result.code !== 0) return []
  return result.stdout.split('\n').filter(Boolean).map(function (line) {
    const values = line.split('\x1f')
    return { hash: values[0], short: values[1], date: values[2], subject: values[3] }
  })
}

async function hashFile(file) {
  const hash = createHash('sha256')
  const stream = createReadStream(file)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

/**
 * Parse `git status --porcelain=v1 -z` output. Each record is `XY <path>` NUL
 * terminated; rename/copy records append the original path as the next field.
 * NUL separation keeps non-ASCII paths unquoted (UTF-8), unlike the plain
 * porcelain format which escapes them behind `core.quotePath`.
 */
export function parseStatusEntries(stdout) {
  const parts = String(stdout || '').split('\u0000')
  const entries = []
  for (let index = 0; index < parts.length; index += 1) {
    const record = parts[index]
    if (record.length < 4) continue
    const status = record.slice(0, 2)
    const entry = { path: record.slice(3), status: status.trim() || 'M' }
    if (status.indexOf('R') >= 0 || status.indexOf('C') >= 0) {
      const original = parts[index + 1]
      if (typeof original === 'string' && original.length > 0) {
        entry.from = original
        index += 1
      }
    }
    entries.push(entry)
  }
  return entries
}

function changedPaths(statusText) {
  const result = []
  for (const entry of parseStatusEntries(statusText)) {
    if (entry.path.startsWith(REVIEW_PREFIX) === false) result.push(entry.path)
  }
  return result
}

const REVIEW_PREFIX = '.dsh-reviews/'

function expectedPathSet(expected) {
  const result = new Set()
  const changed = expected && Array.isArray(expected.changedFiles) ? expected.changedFiles : []
  for (const item of changed) {
    const text = String(item)
    if (text.length === 0 || text.endsWith('/')) continue
    result.add(text)
  }
  const untracked = expected && Array.isArray(expected.untrackedPaths) ? expected.untrackedPaths : []
  for (const item of untracked) {
    const text = String(item)
    if (text.length > 0) result.add(text)
  }
  return result
}

async function gitHashObjects(root, paths) {
  const result = await runGit(root, ['hash-object', '--'].concat(paths),
    { timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
  if (result.code !== 0) return null
  const lines = result.stdout.split('\n')
    .map(function (line) { return line.trim() })
    .filter(Boolean)
  if (lines.length !== paths.length) return null
  return lines
}

/**
 * Git blob hashes for the changed / untracked worktree files at snapshot time.
 * Used to re-verify that the index staged at confirm time still contains exactly
 * the previewed content. Symlinks and unreadable entries are recorded without a
 * hash (unverifiable) but still participate in the path-set comparison.
 */
async function collectFileHashes(root, paths) {
  const seen = new Set()
  const entries = []
  const hashable = []
  for (const value of paths) {
    const relative = String(value || '')
    if (relative.length === 0 || relative.endsWith('/') || seen.has(relative)) continue
    seen.add(relative)
    const absolute = path.resolve(root, relative)
    if (isPathInside(root, absolute, false) === false) continue
    const stat = await fsp.lstat(absolute).catch(function () { return null })
    if (stat === null) {
      entries.push({ path: relative, hash: null, deleted: true })
      continue
    }
    if (stat.isSymbolicLink()) {
      entries.push({ path: relative, hash: null })
      continue
    }
    if (stat.isFile() === false) continue
    hashable.push(relative)
  }
  for (let index = 0; index < hashable.length; index += 50) {
    const chunk = hashable.slice(index, index + 50)
    const hashes = await gitHashObjects(root, chunk)
    for (let offset = 0; offset < chunk.length; offset += 1) {
      entries.push({ path: chunk[offset], hash: hashes === null ? null : hashes[offset] })
    }
  }
  entries.sort(function (left, right) { return left.path.localeCompare(right.path) })
  return entries
}

async function indexBlobHash(root, relative) {
  const result = await runGit(root, ['--literal-pathspecs', 'ls-files', '-s', '-z', '--', relative],
    { timeout: 15000 })
  if (result.code !== 0) return null
  const entries = result.stdout.split('\u0000').filter(Boolean)
  if (entries.length === 0) return null
  const match = /^\d{6} ([0-9a-f]{40,64}) \d\t/.exec(entries[0])
  return match === null ? null : match[1]
}

async function restoreIndex(root, tree) {
  if (typeof tree !== 'string' || /^[0-9a-f]{40,64}$/.test(tree) === false) return false
  const result = await runGit(root, ['read-tree', tree], { timeout: 30000 })
  return result.code === 0
}

/**
 * Verify that the staged index produced by `git add -A` still matches the
 * previewed snapshot: same HEAD, same changed path set, and identical blob
 * hashes for every previewed file. Exported for focused tests.
 */
export async function stagedMatchesExpected(root, expected) {
  const gitRoot = await assertGitRoot(root)
  const expectedHead = expected && typeof expected.head === 'string' ? expected.head : ''
  if (expectedHead.length > 0) {
    const head = await runGit(gitRoot.root, ['rev-parse', 'HEAD'])
    if (head.code !== 0 || head.stdout.trim() !== expectedHead) return false
  }
  const status = await runGit(gitRoot.root, ['status', '--porcelain=v1', '-z'])
  if (status.code !== 0) return false
  const entries = parseStatusEntries(status.stdout).filter(function (entry) {
    return entry.path.startsWith(REVIEW_PREFIX) === false
  })
  const wanted = expectedPathSet(expected)
  // `git add -A` may collapse an unstaged `mv old new` (preview sees `D old`
  // plus `?? new`) into a single rename record `R new\0old`. Match both the
  // staged-rename preview (only the new path) and the unstaged-move preview
  // (old + new paths) without weakening the unexpected-path check.
  const consumed = new Set()
  for (const entry of entries) {
    const from = typeof entry.from === 'string' ? entry.from : ''
    if (wanted.has(entry.path)) consumed.add(entry.path)
    else if (from.length === 0 || wanted.has(from) === false) return false
    if (from.length > 0 && wanted.has(from)) consumed.add(from)
  }
  if (consumed.size !== wanted.size) return false
  for (const value of wanted) {
    if (consumed.has(value) === false) return false
  }
  const hashes = expected && Array.isArray(expected.fileHashes) ? expected.fileHashes : []
  for (const item of hashes) {
    if (item === null || typeof item !== 'object') return false
    const relative = typeof item.path === 'string' ? item.path : ''
    if (relative.length === 0) return false
    const found = await indexBlobHash(gitRoot.root, relative)
    if (typeof item.hash === 'string' && /^[0-9a-f]{40,64}$/.test(item.hash)) {
      if (found !== item.hash) return false
    } else if (item.deleted === true && found !== null) {
      return false
    }
  }
  return true
}

export async function captureProjectSnapshot(root, options = {}) {
  const gitRoot = await assertGitRoot(root)
  const branchResult = await runGit(gitRoot.root, ['symbolic-ref', '--short', '-q', 'HEAD'])
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() : ''
  // 未提交变更评审允许在 detached HEAD 上工作（没有可评审的提交，只需工作区内容）。
  const allowDetached = options !== null && typeof options === 'object' &&
    options.allowDetached === true
  if (branch.length === 0 && allowDetached === false) {
    throw apiError(400, 'detached-head', messages.projectDetached)
  }
  const headResult = await runGit(gitRoot.root, ['rev-parse', 'HEAD'])
  const head = headResult.code === 0 ? headResult.stdout.trim() : ''
  const status = await runGit(gitRoot.root, ['status', '--porcelain=v1', '-z'])
  if (status.code !== 0) {
    throw apiError(500, 'git-status-failed', status.stderr || messages.gitStatusFailed)
  }
  const statusEntries = parseStatusEntries(status.stdout)
  const diff = await runGit(gitRoot.root, ['diff', '--binary'], { maxBuffer: 32 * 1024 * 1024 })
  const staged = await runGit(gitRoot.root, ['diff', '--cached', '--binary'], { maxBuffer: 32 * 1024 * 1024 })
  if (diff.code !== 0 || staged.code !== 0) {
    throw apiError(500, 'git-diff-failed', messages.projectDiffFailed)
  }
  const untrackedResult = await runGit(gitRoot.root, ['ls-files', '--others', '--exclude-standard', '-z'])
  if (untrackedResult.code !== 0) {
    throw apiError(500, 'git-status-failed', untrackedResult.stderr || messages.gitStatusFailed)
  }
  const untracked = []
  for (const relative of untrackedResult.stdout.split('\u0000')) {
    if (relative.length === 0 || relative.startsWith(REVIEW_PREFIX)) continue
    const file = path.resolve(gitRoot.root, relative)
    if (isPathInside(gitRoot.root, file, false) === false) continue
    const stat = await fsp.lstat(file).catch(function () { return null })
    if (stat === null) continue
    let digest = ''
    if (stat.isSymbolicLink()) {
      digest = 'link:' + await fsp.readlink(file)
    } else if (stat.isFile()) {
      digest = await hashFile(file)
    } else {
      continue
    }
    untracked.push({ path: relative, hash: digest })
  }
  untracked.sort(function (left, right) { return left.path.localeCompare(right.path) })
  const changedFiles = changedPaths(status.stdout)
  let fileHashes = []
  if (options && options.fileHashes === true) {
    const hashTargets = changedFiles.concat(untracked.map(function (item) { return item.path }))
    fileHashes = await collectFileHashes(gitRoot.root, hashTargets)
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({
    head,
    branch,
    status: status.stdout,
    diff: diff.stdout,
    staged: staged.stdout,
    untracked,
  })).digest('hex')
  return {
    root: gitRoot.root,
    head,
    branch,
    changedFiles,
    statusEntries,
    fingerprint,
    diff: diff.stdout,
    stagedDiff: staged.stdout,
    untracked,
    fileHashes,
    hasChanges: changedFiles.length > 0,
  }
}

/** 未提交评审文本的总长度上限、未跟踪文件数与单文件读取上限。 */
const MAX_WORKTREE_DIFF_CHARS = 200000
const MAX_UNTRACKED_FILES = 500
const MAX_UNTRACKED_FILE_BYTES = 64 * 1024

function looksBinary(buffer) {
  const length = Math.min(buffer.length, 8000)
  for (let index = 0; index < length; index += 1) {
    if (buffer[index] === 0) return true
  }
  return false
}

/**
 * 只读取上限内的字节，避免超大未跟踪文件占用内存。O_NOFOLLOW 阻止 lstat
 * 与 open 之间文件被替换为符号链接后读到项目根之外的内容。
 */
async function readLimitedBytes(file, limit) {
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
  const handle = await fsp.open(file, fsConstants.O_RDONLY | noFollow)
  try {
    const buffer = Buffer.alloc(limit + 1)
    let offset = 0
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (result.bytesRead === 0) break
      offset += result.bytesRead
    }
    return buffer.subarray(0, offset)
  } finally {
    await handle.close().catch(function () {})
  }
}

/**
 * 读取一个未跟踪文件用于评审文本。绝不跟随符号链接：先 lstat 判断类型，
 * 且解析后的绝对路径必须位于项目根内；二进制文件与超长内容输出占位文本。
 * `limit` 是本次可占用的最大字节数（仍受单文件上限约束）。
 */
async function untrackedFileContent(root, relative, limit) {
  const absolute = path.resolve(root, relative)
  if (isPathInside(root, absolute, false) === false) return '[skipped: outside project]'
  const stat = await fsp.lstat(absolute).catch(function () { return null })
  if (stat === null) return '[missing]'
  if (stat.isSymbolicLink()) {
    const target = await fsp.readlink(absolute).catch(function () { return '' })
    return '[symlink -> ' + target + ']'
  }
  if (stat.isFile() === false) return '[skipped: not a file]'
  const cap = Math.max(1, Math.min(limit, MAX_UNTRACKED_FILE_BYTES))
  let buffer
  try {
    buffer = await readLimitedBytes(absolute, cap)
  } catch {
    return '[unreadable]'
  }
  if (looksBinary(buffer)) return '[binary file]'
  const truncated = buffer.length > cap
  const text = buffer.subarray(0, cap).toString('utf8')
  return truncated ? text + '\n[truncated]' : text
}

/**
 * 组合当前工作区未提交变更的完整评审文本：暂存 diff、未暂存 diff 与未跟踪
 * 文件内容。未跟踪文件逐个按项目根内的相对路径读取，符号链接只输出目标、
 * 二进制文件输出占位文本、单文件内容超限截断。
 *
 * 读取过程边累加边检查总长度：达到上限立即停止，不再读取剩余未跟踪文件，
 * 避免包含大量未跟踪文件的工程把 Host 的内存与耗时打满。
 */
export async function showWorktreeDiff(root) {
  const snapshot = await captureProjectSnapshot(root, { allowDetached: true })
  const projectRoot = snapshot.root
  const sections = []
  let used = 0
  let truncated = false
  if (snapshot.stagedDiff.length > 0 && used < MAX_WORKTREE_DIFF_CHARS) {
    const block = 'STAGED DIFF:\n' + snapshot.stagedDiff
    sections.push(block)
    used += block.length + 2
  }
  if (snapshot.diff.length > 0 && used < MAX_WORKTREE_DIFF_CHARS) {
    const block = 'UNSTAGED DIFF:\n' + snapshot.diff
    sections.push(block)
    used += block.length + 2
  }
  if (snapshot.untracked.length > 0 && used < MAX_WORKTREE_DIFF_CHARS) {
    const entries = []
    for (const item of snapshot.untracked) {
      if (entries.length >= MAX_UNTRACKED_FILES || used >= MAX_WORKTREE_DIFF_CHARS) {
        truncated = true
        break
      }
      // 评审产物目录不属于评审对象；快照已过滤，这里再显式跳过一次。
      if (item.path.startsWith(REVIEW_PREFIX)) continue
      const header = '--- ' + item.path + ' ---'
      const remaining = MAX_WORKTREE_DIFF_CHARS - used
      const content = await untrackedFileContent(projectRoot, item.path, remaining)
      const entry = header + '\n' + content
      entries.push(entry)
      used += entry.length + 1
    }
    if (entries.length > 0) {
      sections.push('UNTRACKED FILES:\n' + entries.join('\n'))
      used += 'UNTRACKED FILES:\n'.length + 2
    }
  }
  const combined = sections.length > 0 ? sections.join('\n\n') : '(no uncommitted changes)'
  const clipped = combined.length > MAX_WORKTREE_DIFF_CHARS
  return {
    text: clipped
      ? combined.slice(0, MAX_WORKTREE_DIFF_CHARS) + '\n[truncated]\n'
      : combined,
    truncated: truncated || clipped,
    changedFiles: snapshot.changedFiles,
    hasChanges: snapshot.hasChanges,
    branch: snapshot.branch,
    head: snapshot.head,
  }
}

function emptyWorkspaceChanges() {
  return {
    initialized: false,
    branch: '',
    head: '',
    detached: false,
    statusKnown: false,
    hasChanges: false,
    files: [],
    changedFiles: [],
    diffText: '',
    truncated: false,
    remotes: [],
    remote: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    aheadKnown: false,
    behindKnown: false,
  }
}

/**
 * Uncommitted working-tree state of the project repository for the commits tab
 * workspace panel: branch/HEAD, changed files (review artifacts excluded),
 * segmented diff text, remotes and upstream ahead/behind counts.
 *
 * A directory that is not a Git repository degrades to the `initialized: false`
 * shape instead of throwing. The diff sections mirror the worktree changes
 * format (STAGED / UNSTAGED / UNTRACKED file paths) and are capped.
 */
export async function projectWorkspaceChanges(root) {
  const info = await gitInfo(root)
  if (info.initialized === false) return emptyWorkspaceChanges()
  const gitRoot = await assertGitRoot(root)
  const cwd = gitRoot.root
  const branch = await currentBranch(cwd)
  const headResult = await runGit(cwd, ['rev-parse', 'HEAD'])
  const head = headResult.code === 0 ? headResult.stdout.trim() : ''
  const status = await runGit(cwd, ['status', '--porcelain=v1', '-z'])
  const statusKnown = status.code === 0
  const files = []
  if (statusKnown) {
    for (const entry of parseStatusEntries(status.stdout)) {
      if (entry.path.startsWith(REVIEW_PREFIX)) continue
      files.push(entry)
    }
    files.sort(function (left, right) { return left.path.localeCompare(right.path) })
  }
  const changedFiles = files.map(function (entry) { return entry.path })
  const hasChanges = changedFiles.length > 0
  let diffText = ''
  let truncated = false
  if (hasChanges) {
    const sections = []
    const staged = await runGit(cwd, ['diff', '--cached', '--binary'],
      { maxBuffer: 32 * 1024 * 1024 })
    if (staged.code === 0 && staged.stdout.length > 0) {
      sections.push('STAGED DIFF:\n' + staged.stdout)
    }
    const unstaged = await runGit(cwd, ['diff', '--binary'], { maxBuffer: 32 * 1024 * 1024 })
    if (unstaged.code === 0 && unstaged.stdout.length > 0) {
      sections.push('UNSTAGED DIFF:\n' + unstaged.stdout)
    }
    const untracked = await runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])
    if (untracked.code === 0) {
      const paths = untracked.stdout.split('\u0000').filter(function (item) {
        return item.length > 0 && item.startsWith(REVIEW_PREFIX) === false
      })
      if (paths.length > 0) sections.push('UNTRACKED FILES:\n' + paths.join('\n'))
    }
    const combined = sections.join('\n\n')
    if (combined.length > MAX_WORKTREE_DIFF_CHARS) {
      diffText = combined.slice(0, MAX_WORKTREE_DIFF_CHARS) + '\n[truncated]\n'
      truncated = true
    } else {
      diffText = combined
    }
  }
  const remotes = await resolveRemotes(cwd)
  const upstream = await upstreamWithCounts(cwd)
  return {
    initialized: true,
    branch,
    head,
    detached: branch.length === 0,
    statusKnown,
    hasChanges,
    files,
    changedFiles,
    diffText,
    truncated,
    remotes,
    remote: preferredRemote(remotes),
    upstream: upstream === null ? null : {
      remote: upstream.remote,
      branch: upstream.branch,
      ahead: upstream.ahead,
      behind: upstream.behind,
    },
    ahead: upstream === null ? 0 : upstream.ahead,
    behind: upstream === null ? 0 : upstream.behind,
    aheadKnown: upstream === null ? true : upstream.known,
    behindKnown: upstream === null ? true : upstream.known,
  }
}

/** First non-empty line of a git result, preferring stderr, sanitized for the UI. */
function gitFailureDetail(result) {
  return sanitizeGitDetail(firstLine(result.stderr) || firstLine(result.stdout))
}

/**
 * Fast-forward-only pull of the checked-out branch. Never creates a merge
 * commit: a diverged or otherwise failing pull is surfaced as `pull-failed`.
 * The git process never prompts for credentials (fails fast instead of hanging).
 */
export async function pullProjectBranch(root) {
  const gitRoot = await assertGitRoot(root)
  const cwd = gitRoot.root
  const branch = await currentBranch(cwd)
  if (branch.length === 0) throw apiError(400, 'detached-head', messages.projectDetached)
  const upstreamBefore = await upstreamState(cwd)
  if (upstreamBefore === null) {
    throw apiError(400, 'pull-no-upstream', messages.projectPullNoUpstream)
  }
  const beforeResult = await runGit(cwd, ['rev-parse', 'HEAD'])
  const before = beforeResult.code === 0 ? beforeResult.stdout.trim() : ''
  const result = await runGit(cwd, ['pull', '--ff-only'], {
    timeout: 120000,
    env: { GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.code !== 0) {
    const detail = gitFailureDetail(result)
    throw apiError(400, 'pull-failed',
      messages.projectPullFailed + (detail.length > 0 ? ': ' + detail : ''))
  }
  const afterResult = await runGit(cwd, ['rev-parse', 'HEAD'])
  const after = afterResult.code === 0 ? afterResult.stdout.trim() : ''
  const pulled = before !== after
  const detail = sanitizeGitDetail(firstLine(result.stdout) || firstLine(result.stderr))
  return {
    pulled,
    alreadyUpToDate: pulled === false,
    before,
    after,
    branch,
    upstream: await upstreamState(cwd) || upstreamBefore,
    detail,
  }
}

/**
 * Push the checked-out branch: to its configured upstream, or with `-u` to the
 * preferred remote when no upstream exists. Remote output is sanitized before
 * being returned; credentials never prompt.
 */
export async function pushProjectBranch(root) {
  const gitRoot = await assertGitRoot(root)
  const cwd = gitRoot.root
  const branch = await currentBranch(cwd)
  if (branch.length === 0) throw apiError(400, 'detached-head', messages.projectDetached)
  const remotes = await resolveRemotes(cwd)
  const remote = preferredRemote(remotes)
  if (remote === null) {
    if (remotes.length > 1) {
      throw apiError(400, 'push-remote-ambiguous', messages.projectPushRemoteAmbiguous)
    }
    throw apiError(400, 'push-no-remote', messages.projectPushNoRemote)
  }
  const upstreamBefore = await upstreamState(cwd)
  const args = upstreamBefore === null ? ['push', '-u', remote, branch] : ['push']
  const result = await runGit(cwd, args, {
    timeout: 60000,
    env: { GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.code !== 0) {
    const detail = gitFailureDetail(result)
    throw apiError(400, 'push-failed',
      messages.projectPushFailed + (detail.length > 0 ? ': ' + detail : ''))
  }
  const detail = sanitizeGitDetail(firstLine(result.stdout) || firstLine(result.stderr))
  const upstream = await upstreamState(cwd) ||
    { remote, branch, ahead: 0, behind: 0 }
  const alreadyUpToDate = upstreamBefore !== null &&
    Number(upstreamBefore.ahead) === 0 && Number(upstreamBefore.behind) === 0
  return {
    pushed: true,
    remote,
    branch,
    upstream,
    alreadyUpToDate,
    detail,
  }
}

export async function projectGitOverview(root) {
  const available = await gitAvailable()
  const info = await gitInfo(root)
  if (info.initialized === false) {
    return { available, initialized: false, branch: '', head: '', changes: [] }
  }
  const branchResult = await runGit(root, ['symbolic-ref', '--short', '-q', 'HEAD'])
  const headResult = await runGit(root, ['rev-parse', 'HEAD'])
  const status = await gitStatus(root)
  return {
    available,
    initialized: true,
    branch: branchResult.code === 0 ? branchResult.stdout.trim() : '',
    head: headResult.code === 0 ? headResult.stdout.trim() : '',
    changes: status.changes,
  }
}

/** Upper bound for a single commit page offset; keeps `git log --skip` bounded. */
export const MAX_COMMIT_OFFSET = 10000

export async function recentProjectCommits(root, limit, offset) {
  await assertGitRoot(root)
  const count = Math.max(1,
    Math.min(Number(limit) || DEFAULT_COMMIT_PAGE_SIZE, MAX_COMMIT_PAGE_SIZE))
  const skip = Math.max(0, Math.min(Math.trunc(Number(offset)) || 0, MAX_COMMIT_OFFSET))
  const format = '%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%P'
  const args = ['log', '--pretty=format:' + format, '-n', String(count)]
  if (skip > 0) args.push('--skip', String(skip))
  const result = await runGit(root, args)
  if (result.code !== 0) return []
  return result.stdout.split('\n').filter(Boolean).map(function (line) {
    const values = line.split('\x1f')
    return {
      hash: values[0],
      short: values[1],
      subject: values[2],
      authorName: values[3],
      authorEmail: values[4],
      date: values[5],
      parents: values[6] ? values[6].split(' ').filter(Boolean) : [],
      reviewed: false,
      reviewName: null,
    }
  })
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export async function resolveProjectCommit(root, value) {
  if (typeof value !== 'string' || /^[0-9a-fA-F]{4,64}$/.test(value) === false) return null
  await assertGitRoot(root)
  const hashResult = await runGit(root, ['rev-parse', '--verify', value + '^{commit}'])
  if (hashResult.code !== 0) return null
  const hash = hashResult.stdout.trim()
  const format = '%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%P'
  const info = await runGit(root, ['show', '-s', '--pretty=format:' + format, hash])
  if (info.code !== 0) return null
  const values = info.stdout.split('\x1f')
  return {
    hash: values[0],
    short: values[1],
    subject: values[2],
    authorName: values[3],
    authorEmail: values[4],
    date: values[5],
    parents: values[6] ? values[6].split(' ').filter(Boolean) : [],
  }
}

export async function showProjectCommitDiff(root, value) {
  const info = await resolveProjectCommit(root, value)
  if (info === null) return null
  const parentResult = await runGit(root, ['rev-list', '--parents', '-n', '1', info.hash])
  const parts = parentResult.code === 0 ? parentResult.stdout.trim().split(' ').filter(Boolean) : []
  const parent = parts.length > 1 ? parts[1] : EMPTY_TREE
  const diff = await runGit(root, ['diff', parent, info.hash], { maxBuffer: 16 * 1024 * 1024 })
  if (diff.code !== 0) throw apiError(500, 'git-diff-failed', messages.projectDiffFailed)
  const limit = 200000
  const truncated = diff.stdout.length > limit
  const text = truncated ? diff.stdout.slice(0, limit) + '\n[truncated]\n' : diff.stdout
  return { commit: info, diff: text, truncated }
}

/** Output caps for the commit detail view: keep responses bounded for the UI. */
const MAX_COMMIT_DIFF_CHARS = 512 * 1024
const MAX_COMMIT_FILE_DIFF_CHARS = 96 * 1024

function unquoteGitPath(value) {
  const text = String(value || '').trim()
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }
  return text
}

function stripGitPrefix(value, prefix) {
  if (value === '/dev/null') return ''
  let text = unquoteGitPath(value)
  if (text.startsWith(prefix + '/')) text = text.slice(prefix.length + 1)
  return text
}

/**
 * Split a raw `git diff` into one entry per file. Exported for focused tests so
 * the parser can be verified without spawning git.
 */
export function parseCommitDiffText(text) {
  const files = []
  let current = null
  let inHunk = false
  function finish() {
    if (current === null) return
    if (current.path === '' && current.oldPath === '') {
      const match = /^diff --git a\/(.*) b\/(.*)$/.exec(current.lines[0] || '')
      if (match !== null) {
        current.oldPath = unquoteGitPath(match[1])
        current.path = unquoteGitPath(match[2])
      }
    }
    let path = current.path !== '' ? current.path : current.oldPath
    if (path !== '') {
      files.push({
        path: path,
        oldPath: current.oldPath !== '' && current.oldPath !== path ? current.oldPath : '',
        status: current.status,
        additions: current.additions,
        deletions: current.deletions,
        binary: current.binary,
        diff: current.lines.join('\n'),
        truncated: false,
      })
    }
    current = null
  }
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      finish()
      current = {
        path: '', oldPath: '', status: 'M', additions: 0, deletions: 0,
        binary: false, lines: [line],
      }
      inHunk = false
      continue
    }
    if (current === null) continue
    current.lines.push(line)
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (inHunk) {
      if (line.startsWith('+')) current.additions += 1
      else if (line.startsWith('-')) current.deletions += 1
      continue
    }
    if (line.startsWith('new file mode')) current.status = 'A'
    else if (line.startsWith('deleted file mode')) current.status = 'D'
    else if (line.startsWith('rename from ')) {
      current.status = 'R'
      current.oldPath = unquoteGitPath(line.slice('rename from '.length))
    } else if (line.startsWith('rename to ')) {
      current.status = 'R'
      current.path = unquoteGitPath(line.slice('rename to '.length))
    } else if (line.startsWith('copy from ')) {
      current.status = 'C'
      current.oldPath = unquoteGitPath(line.slice('copy from '.length))
    } else if (line.startsWith('copy to ')) {
      current.status = 'C'
      current.path = unquoteGitPath(line.slice('copy to '.length))
    } else if (line.startsWith('--- ')) {
      const path = stripGitPrefix(line.slice(4), 'a')
      if (path !== '') current.oldPath = path
    } else if (line.startsWith('+++ ')) {
      const path = stripGitPrefix(line.slice(4), 'b')
      if (path !== '') current.path = path
    } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.binary = true
    }
  }
  finish()
  files.sort(function (left, right) { return left.path.localeCompare(right.path) })
  return files
}

/**
 * Full detail for one commit: metadata plus every changed file with its diff.
 * Diffs are bounded per file and in aggregate so a huge commit cannot flood the
 * browser; `truncated` tells the UI that content was clipped.
 */
export async function showProjectCommitDetail(root, value) {
  const info = await resolveProjectCommit(root, value)
  if (info === null) return null
  const parentResult = await runGit(root, ['rev-list', '--parents', '-n', '1', info.hash])
  const parts = parentResult.code === 0 ? parentResult.stdout.trim().split(' ').filter(Boolean) : []
  const parent = parts.length > 1 ? parts[1] : EMPTY_TREE
  const diff = await runGit(root,
    ['diff', '--no-color', '--no-ext-diff', '--find-renames', '-U3', parent, info.hash],
    { maxBuffer: 64 * 1024 * 1024, timeout: 60000 })
  if (diff.code !== 0) throw apiError(500, 'git-diff-failed', messages.projectDiffFailed)
  const files = parseCommitDiffText(diff.stdout)
  let remaining = MAX_COMMIT_DIFF_CHARS
  let truncated = false
  for (const file of files) {
    let content = file.diff
    if (content.length > MAX_COMMIT_FILE_DIFF_CHARS) {
      content = content.slice(0, MAX_COMMIT_FILE_DIFF_CHARS) + '\n[truncated]\n'
      file.truncated = true
    }
    if (content.length > remaining) {
      content = content.slice(0, Math.max(0, remaining)) + '\n[truncated]\n'
      file.truncated = true
      remaining = 0
    } else {
      remaining -= content.length
    }
    file.diff = content
    if (file.truncated) truncated = true
  }
  return { commit: info, files: files, truncated: truncated }
}

/**
 * Stage and commit all project changes.
 *
 * When `options.expected` is provided (the confirmed preview snapshot), the
 * function re-validates HEAD/fingerprint before staging and then re-validates
 * the resulting index against the previewed path set and blob hashes before
 * creating the commit. A write landing in the window between the confirmation
 * snapshot and `git add -A` therefore aborts the commit: the index is restored
 * to its pre-add tree and `stale-preview` is returned.
 *
 * `options.beforeStage` / `options.afterStage` are deterministic test hooks used
 * to inject that race; production callers leave them unset.
 */
export async function commitProject(root, message, options = {}) {
  const gitRoot = await assertGitRoot(root)
  const expected = options && options.expected ? options.expected : null
  const status = await runGit(gitRoot.root, ['status', '--porcelain'])
  if (status.code !== 0) {
    throw apiError(500, 'git-status-failed', status.stderr || messages.gitStatusFailed)
  }
  if (status.stdout.trim() === '') {
    throw apiError(400, 'no-changes', messages.projectNoChanges)
  }
  if (expected !== null) {
    const before = await captureProjectSnapshot(gitRoot.root)
    const expectedHead = typeof expected.head === 'string' ? expected.head : ''
    const expectedFingerprint = typeof expected.fingerprint === 'string' ? expected.fingerprint : ''
    if (before.head !== expectedHead || before.fingerprint !== expectedFingerprint) {
      throw apiError(409, 'stale-preview', messages.projectStalePreview)
    }
  }
  const preTreeResult = await runGit(gitRoot.root, ['write-tree'], { timeout: 30000 })
  const preTree = preTreeResult.code === 0 ? preTreeResult.stdout.trim() : ''
  if (typeof options.beforeStage === 'function') {
    await options.beforeStage({ root: gitRoot.root })
  }
  const add = await runGit(gitRoot.root, ['add', '-A'])
  if (add.code !== 0) {
    throw apiError(500, 'git-add-failed', add.stderr || messages.gitAddFailed)
  }
  if (typeof options.afterStage === 'function') {
    await options.afterStage({ root: gitRoot.root })
  }
  if (expected !== null) {
    const stagedOk = await stagedMatchesExpected(gitRoot.root, expected)
    if (stagedOk === false) {
      const restored = await restoreIndex(gitRoot.root, preTree)
      if (restored === false) {
        await runGit(gitRoot.root, ['reset', '--mixed'], { timeout: 30000 })
      }
      throw apiError(409, 'stale-preview', messages.projectStalePreview)
    }
  }
  const commit = await runGit(gitRoot.root, ['commit', '-m', message])
  if (commit.code !== 0) {
    const detail = (commit.stdout + '\n' + commit.stderr).trim()
    throw apiError(500, 'git-commit-failed', detail || messages.gitCommitFailed)
  }
  const info = await runGit(gitRoot.root, ['show', '-s', '--pretty=format:%H%x1f%h%x1f%s', 'HEAD'])
  if (info.code !== 0) {
    throw apiError(500, 'git-commit-failed', messages.gitCommitFailed)
  }
  const values = info.stdout.split('\x1f')
  return { hash: values[0], short: values[1], subject: values[2] }
}
