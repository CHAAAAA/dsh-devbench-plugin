/** Atomic writes and in-process keyed locks. Multi-process locking is not provided. */
import { randomBytes } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

const lockChains = new Map()

export function withKeyLock(key, task) {
  const prior = lockChains.get(key) || Promise.resolve()
  const run = prior.catch(function () {}).then(task)
  const tail = run.then(function () {}, function () {})
  lockChains.set(key, tail)
  tail.then(function () {
    if (lockChains.get(key) === tail) lockChains.delete(key)
  })
  return run
}

export function withFileLock(file, task) {
  return withKeyLock('file:' + path.resolve(file), task)
}

export function withRootLock(root, task) {
  return withKeyLock('root:' + path.resolve(root), task)
}

export function withWorkspaceLock(folder, task) {
  return withKeyLock('workspace:' + path.resolve(folder), task)
}

/** mkdir that tolerates a concurrent creator (EEXIST). */
export async function mkdirIfMissing(directory) {
  try {
    await fsp.mkdir(directory)
  } catch (error) {
    if (error && error.code === 'EEXIST') return
    throw error
  }
}

export async function atomicWriteFile(file, content) {
  const directory = path.dirname(file)
  await fsp.mkdir(directory, { recursive: true })
  const suffix = process.pid + '-' + randomBytes(6).toString('hex')
  const temp = path.join(directory, '.' + path.basename(file) + '.tmp-' + suffix)
  let handle = null
  try {
    handle = await fsp.open(temp, 'wx')
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = null
    await fsp.rename(temp, file)
  } catch (error) {
    if (handle !== null) await handle.close().catch(function () {})
    await fsp.rm(temp, { force: true }).catch(function () {})
    throw error
  }
}

export function atomicWriteJson(file, value) {
  const text = JSON.stringify(value, null, 2) + '\n'
  return atomicWriteFile(file, text, 'utf8')
}
