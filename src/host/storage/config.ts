/** Config persistence with atomic writes and default-template sentinel handling. */
import fs, { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { atomicWriteJson, withFileLock } from '../shared/atomic.js'
import {
  CONFIG_DIR_ENV,
  CONFIG_DIR_NAME,
  DEFAULT_COMMIT_PROMPT_TEMPLATE,
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_REVIEW_PROMPT_TEMPLATE,
  LEGACY_CONFIG_DIR_ENV,
  LEGACY_DIR_NAME,
} from '../constants.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import { isPlainObject, lstatMaybe } from '../shared/path-safety.js'

const migratedConfigDirs = new Set()

/**
 * Move the complete pre-DevBench config directory to its new name once.
 * A compatibility symlink keeps existing git worktree registrations valid,
 * because those registrations store absolute paths under the old directory.
 */
function migrateLegacyConfigDirectorySync(target) {
  if (migratedConfigDirs.has(target)) return target
  if (fs.existsSync(target) === false) {
    const legacy = path.join(os.homedir(), LEGACY_DIR_NAME)
    if (fs.existsSync(legacy)) {
      let stat
      try {
        stat = fs.lstatSync(legacy)
      } catch {
        throw new Error('cannot inspect legacy DevBench config directory')
      }
      if (stat.isSymbolicLink() || stat.isDirectory() === false) {
        throw new Error('legacy DevBench config path is not a directory')
      }
      try {
        fs.renameSync(legacy, target)
      } catch {
        throw new Error('cannot migrate legacy DevBench config directory')
      }
      try {
        fs.symlinkSync(target, legacy, 'dir')
      } catch {
        // Symlink support is optional; the new config directory is already complete.
      }
    }
  }
  migratedConfigDirs.add(target)
  return target
}

export function configDirectory() {
  const override = process.env[CONFIG_DIR_ENV] || process.env[LEGACY_CONFIG_DIR_ENV]
  if (typeof override === 'string' && override.length > 0) return override
  return migrateLegacyConfigDirectorySync(path.join(os.homedir(), CONFIG_DIR_NAME))
}

export function configFilePath() {
  return path.join(configDirectory(), 'config.json')
}

/** Default root for per-requirement git worktrees, under the plugin config directory. */
export function defaultWorktreeRoot() {
  return path.join(configDirectory(), 'worktrees')
}

/** Resolve the configured worktree root, falling back to the default location. */
export function resolveWorktreeRoot(config) {
  const value = config && typeof config.worktreeRoot === 'string' ? config.worktreeRoot : ''
  return value.length > 0 ? value : defaultWorktreeRoot()
}

export function defaultConfig() {
  return {
    rootDir: '',
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    reviewPromptTemplate: DEFAULT_REVIEW_PROMPT_TEMPLATE,
    commitPromptTemplate: DEFAULT_COMMIT_PROMPT_TEMPLATE,
    worktreeRoot: '',
  }
}

export async function readConfig() {
  const file = configFilePath()
  const stat = await lstatMaybe(file)
  if (stat === null) return defaultConfig()
  if (stat.isSymbolicLink() || stat.isFile() === false) {
    throw apiError(500, 'config-corrupt', messages.configCorrupt)
  }
  const text = await fsp.readFile(file, 'utf8')
  let data
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw apiError(500, 'config-corrupt', messages.configCorrupt)
  }
  if (isPlainObject(data) === false) {
    throw apiError(500, 'config-corrupt', messages.configCorrupt)
  }
  const rootDir = typeof data.rootDir === 'string' ? data.rootDir : ''
  if (rootDir.length > 0 && path.isAbsolute(rootDir) === false) {
    throw apiError(500, 'config-corrupt', messages.configCorrupt)
  }
  const prompt = typeof data.promptTemplate === 'string' && data.promptTemplate.trim().length > 0
    ? data.promptTemplate
    : DEFAULT_PROMPT_TEMPLATE
  const reviewPrompt = typeof data.reviewPromptTemplate === 'string' &&
    data.reviewPromptTemplate.trim().length > 0
    ? data.reviewPromptTemplate
    : DEFAULT_REVIEW_PROMPT_TEMPLATE
  const commitPrompt = typeof data.commitPromptTemplate === 'string' &&
    data.commitPromptTemplate.trim().length > 0
    ? data.commitPromptTemplate
    : DEFAULT_COMMIT_PROMPT_TEMPLATE
  const worktreeRoot = typeof data.worktreeRoot === 'string' ? data.worktreeRoot : ''
  if (worktreeRoot.length > 0 && path.isAbsolute(worktreeRoot) === false) {
    throw apiError(500, 'config-corrupt', messages.configCorrupt)
  }
  return {
    rootDir,
    promptTemplate: prompt,
    reviewPromptTemplate: reviewPrompt,
    commitPromptTemplate: commitPrompt,
    worktreeRoot,
  }
}

async function persistConfig(next) {
  const rootDir = typeof next.rootDir === 'string' ? next.rootDir : ''
  if (rootDir.length > 0 && path.isAbsolute(rootDir) === false) {
    throw apiError(400, 'bad-root', messages.badRoot)
  }
  const promptTemplate = typeof next.promptTemplate === 'string' ? next.promptTemplate : ''
  const storedTemplate = promptTemplate === DEFAULT_PROMPT_TEMPLATE ? '' : promptTemplate
  const reviewPromptTemplate = typeof next.reviewPromptTemplate === 'string'
    ? next.reviewPromptTemplate
    : ''
  const storedReviewTemplate = reviewPromptTemplate === DEFAULT_REVIEW_PROMPT_TEMPLATE
    ? ''
    : reviewPromptTemplate
  const commitPromptTemplate = typeof next.commitPromptTemplate === 'string'
    ? next.commitPromptTemplate
    : ''
  const storedCommitTemplate = commitPromptTemplate === DEFAULT_COMMIT_PROMPT_TEMPLATE
    ? ''
    : commitPromptTemplate
  const worktreeRoot = typeof next.worktreeRoot === 'string' ? next.worktreeRoot : ''
  if (worktreeRoot.length > 0 && path.isAbsolute(worktreeRoot) === false) {
    throw apiError(400, 'bad-root', messages.badRoot)
  }
  await fsp.mkdir(configDirectory(), { recursive: true })
  await atomicWriteJson(configFilePath(), {
    version: 1,
    rootDir,
    promptTemplate: storedTemplate,
    reviewPromptTemplate: storedReviewTemplate,
    commitPromptTemplate: storedCommitTemplate,
    worktreeRoot,
  })
  return {
    rootDir,
    promptTemplate: storedTemplate || DEFAULT_PROMPT_TEMPLATE,
    reviewPromptTemplate: storedReviewTemplate || DEFAULT_REVIEW_PROMPT_TEMPLATE,
    commitPromptTemplate: storedCommitTemplate || DEFAULT_COMMIT_PROMPT_TEMPLATE,
    worktreeRoot,
  }
}

export function writeConfig(next) {
  return withFileLock(configFilePath(), function () { return persistConfig(next) })
}

export function updateConfig(updater) {
  return withFileLock(configFilePath(), async function () {
    const current = await readConfig()
    const next = await updater(current)
    return persistConfig(next)
  })
}

export function requireRoot(config) {
  if (typeof config.rootDir !== 'string' || config.rootDir.length === 0) {
    throw apiError(400, 'unconfigured', messages.unconfigured)
  }
  return config.rootDir
}
