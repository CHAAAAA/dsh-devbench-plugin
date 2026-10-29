/** Single source of truth for IDs, paths, realpath checks, and symlink boundaries. */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'

const MAX_SLUG = 40
const MAX_ID = 200

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Array.isArray(value) === false
}

export function isSafeRequirementId(value) {
  const text = String(value || '')
  if (text.length === 0 || text === '.' || text === '..') return false
  if (text.length > MAX_ID) return false
  const nul = String.fromCharCode(0)
  if (text.includes('/') || text.includes('\\') || text.includes(':') || text.includes(nul)) return false
  return /[\r\n]/.test(text) === false
}

export function safeSlug(text) {
  const cleaned = String(text || '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  const cut = cleaned.slice(0, MAX_SLUG)
  return cut.length > 0 ? cut : 'workspace'
}

export function isPathInside(base, target, allowSame = false) {
  const relative = path.relative(base, target)
  if (relative === '') return allowSame
  if (relative === '..') return false
  if (relative.startsWith('..' + path.sep)) return false
  return path.isAbsolute(relative) === false
}

export function isSafeFolderName(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  const nul = String.fromCharCode(0)
  if (value.includes(nul)) return false
  if (value === '.' || value === '..') return false
  if (value.includes('/') || value.includes('\\') || value.includes(':')) return false
  if (value.endsWith('.') || value.endsWith(' ')) return false
  return /[\r\n]/.test(value) === false
}

async function assertNoSymlinkComponents(base, target) {
  const relative = path.relative(base, target)
  if (relative === '') return
  let current = base
  for (const segment of relative.split(path.sep)) {
    if (segment === '') continue
    current = path.join(current, segment)
    try {
      const stat = await fsp.lstat(current)
      if (stat.isSymbolicLink()) {
        throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') return
      throw error
    }
  }
}

export async function resolveInside(base, relative, options = {}) {
  const baseReal = await fsp.realpath(base)
  const baseStat = await fsp.stat(baseReal)
  if (baseStat.isDirectory() === false) throw apiError(400, 'bad-path', messages.badPath)
  const raw = relative === null || relative === undefined ? '' : String(relative)
  const nul = String.fromCharCode(0)
  if (raw.includes(nul)) throw apiError(400, 'bad-path', messages.badPath)
  const target = path.resolve(baseReal, raw)
  if (isPathInside(baseReal, target, true) === false) {
    throw apiError(400, 'bad-path', messages.outsidePath)
  }
  if (target === baseReal && options.allowBase === false) {
    throw apiError(400, 'bad-path', messages.cannotDeleteRoot)
  }
  await assertNoSymlinkComponents(baseReal, target)
  if (options.mustExist) {
    try {
      const stat = await fsp.lstat(target)
      if (stat.isSymbolicLink()) throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
    } catch (error) {
      if (error && error.code === 'ENOENT') throw apiError(404, 'file-not-found', messages.fileNotFound)
      throw error
    }
    const real = await fsp.realpath(target)
    if (isPathInside(baseReal, real, true) === false) {
      throw apiError(400, 'bad-path', messages.outsidePath)
    }
    return real
  }
  let ancestor = target
  while (ancestor !== baseReal) {
    try {
      await fsp.lstat(ancestor)
      break
    } catch (error) {
      if (error && error.code === 'ENOENT') ancestor = path.dirname(ancestor)
      else throw error
    }
  }
  const realAncestor = await fsp.realpath(ancestor)
  if (isPathInside(baseReal, realAncestor, true) === false) {
    throw apiError(400, 'bad-path', messages.outsidePath)
  }
  return target
}

export async function ensureSafeDirectory(base, relative) {
  const baseReal = await fsp.realpath(base)
  const baseStat = await fsp.stat(baseReal)
  if (baseStat.isDirectory() === false) throw apiError(400, 'bad-path', messages.badPath)
  const raw = relative === null || relative === undefined ? '' : String(relative)
  const nul = String.fromCharCode(0)
  if (raw.includes(nul)) throw apiError(400, 'bad-path', messages.badPath)
  const target = path.resolve(baseReal, raw)
  if (isPathInside(baseReal, target, true) === false) {
    throw apiError(400, 'bad-path', messages.outsidePath)
  }
  if (target === baseReal) return baseReal
  let current = baseReal
  for (const segment of path.relative(baseReal, target).split(path.sep)) {
    if (segment === '') continue
    current = path.join(current, segment)
    let stat
    try {
      stat = await fsp.lstat(current)
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        await fsp.mkdir(current)
        stat = await fsp.lstat(current)
      } else {
        throw error
      }
    }
    if (stat.isSymbolicLink()) {
      throw apiError(400, 'symlink-not-allowed', messages.symlinkNotAllowed)
    }
    if (stat.isDirectory() === false) throw apiError(400, 'bad-path', messages.badPath)
  }
  const real = await fsp.realpath(current)
  if (isPathInside(baseReal, real, true) === false) {
    throw apiError(400, 'bad-path', messages.outsidePath)
  }
  return real
}

export async function lstatMaybe(target) {
  try {
    return await fsp.lstat(target)
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

export async function sameFileIdentity(left, right) {
  try {
    const values = await Promise.all([fsp.stat(left), fsp.stat(right)])
    return values[0].dev === values[1].dev && values[0].ino === values[1].ino
  } catch (error) {
    if (error && error.code === 'ENOENT') return false
    throw error
  }
}
