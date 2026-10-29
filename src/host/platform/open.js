/** Open a file/folder with the operating system, or launch a project directory in an app. */
import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'

const execFileAsync = promisify(execFile)

/** Supported "open project directory" launchers, in display order. */
export const PROJECT_OPEN_TARGETS = Object.freeze(['vscode', 'system', 'iterm'])

export async function openInSystem(target, reveal) {
  let command
  let args
  if (process.platform === 'darwin') {
    command = 'open'
    args = reveal ? ['-R', target] : [target]
  } else if (process.platform === 'win32') {
    command = 'explorer.exe'
    args = reveal ? ['/select,' + target] : [target]
  } else {
    command = 'xdg-open'
    args = [reveal ? path.dirname(target) : target]
  }
  try {
    await execFileAsync(command, args, { windowsHide: true, timeout: 10000 })
    return { opened: true }
  } catch {
    throw apiError(500, 'open-failed', messages.openFailed)
  }
}

async function commandExists(command) {
  try {
    await execFileAsync(command, ['--version'], {
      windowsHide: true, timeout: 5000, maxBuffer: 1024 * 64,
    })
    return true
  } catch {
    return false
  }
}

async function appExists(name) {
  if (process.platform !== 'darwin') return false
  try {
    await execFileAsync('open', ['-Ra', name], {
      windowsHide: true, timeout: 5000, maxBuffer: 1024 * 64,
    })
    return true
  } catch {
    return false
  }
}

let targetCache = null

async function detectTargets() {
  const targets = []
  if (process.platform === 'darwin') {
    if (await appExists('Visual Studio Code') || await commandExists('code')) targets.push('vscode')
    targets.push('system')
    if (await appExists('iTerm') || await appExists('iTerm2')) targets.push('iterm')
    return PROJECT_OPEN_TARGETS.filter(function (target) { return targets.includes(target) })
  }
  if (await commandExists('code') || await commandExists('code.cmd')) targets.push('vscode')
  if (process.platform === 'win32') targets.push('system')
  else if (await commandExists('xdg-open')) targets.push('system')
  return PROJECT_OPEN_TARGETS.filter(function (target) { return targets.includes(target) })
}

/**
 * Detected launchers for project directories. Detection spawns a few short-lived
 * probes, so the result is cached for the host process lifetime.
 */
export function detectProjectOpenTargets() {
  if (targetCache === null) {
    targetCache = detectTargets().catch(function () { return ['system'] })
  }
  return targetCache
}

async function assertDirectory(target) {
  let real
  try {
    real = await fsp.realpath(target)
    const stat = await fsp.stat(real)
    if (stat.isDirectory() === false) throw new Error('not a directory')
  } catch {
    throw apiError(400, 'project-path-missing', messages.projectPathMissing)
  }
  return real
}

/** Open a project directory in VS Code, the OS file manager, or iTerm. */
export async function openProjectDirectory(target, launcher) {
  const selected = typeof launcher === 'string' ? launcher : ''
  if (PROJECT_OPEN_TARGETS.includes(selected) === false) {
    throw apiError(400, 'bad-open-target', messages.badOpenTarget)
  }
  const real = await assertDirectory(target)
  try {
    if (selected === 'system') {
      await openInSystem(real, false)
      return { opened: true, target: selected }
    }
    if (selected === 'vscode') {
      if (process.platform === 'darwin') {
        await execFileAsync('open', ['-a', 'Visual Studio Code', real], {
          windowsHide: true, timeout: 10000,
        })
      } else {
        await execFileAsync('code', [real], { windowsHide: true, timeout: 10000 })
      }
      return { opened: true, target: selected }
    }
    if (process.platform !== 'darwin') {
      throw apiError(400, 'open-target-unavailable', messages.openTargetUnavailable)
    }
    await execFileAsync('open', ['-a', 'iTerm', real], { windowsHide: true, timeout: 10000 })
    return { opened: true, target: selected }
  } catch (error) {
    if (error && error.code && error.status) throw error
    throw apiError(500, 'open-failed', messages.openFailed)
  }
}
