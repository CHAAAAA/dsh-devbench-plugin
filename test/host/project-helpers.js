import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { expectOk } from './helpers.js'

const execFileAsync = promisify(execFile)

export async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, windowsHide: true })
}

export async function addProject(harness, projectPath, title) {
  return expectOk(await harness.request('POST', '/project/add', {
    path: projectPath,
    title: title || 'Project',
  }))
}

export async function initProject(harness, workspaceId) {
  return expectOk(await harness.request('POST', '/project/git/init', { workspaceId }))
}

export async function makeGitProject(harness, options = {}) {
  const projectPath = path.join(harness.tempRoot, options.name || 'project')
  await fsp.mkdir(projectPath, { recursive: true })
  const added = await addProject(harness, projectPath, options.title || 'Project')
  const workspaceId = added.project.workspaceId
  await initProject(harness, workspaceId)
  await git(projectPath, ['config', 'user.name', 'Test User'])
  await git(projectPath, ['config', 'user.email', 'test@example.com'])
  const count = typeof options.commits === 'number' ? options.commits : 1
  for (let index = 1; index <= count; index += 1) {
    await fsp.writeFile(path.join(projectPath, 'file.txt'), 'version ' + index + '\n')
    await git(projectPath, ['add', '-A'])
    await git(projectPath, ['commit', '-m', 'commit ' + index])
  }
  return { projectPath, workspaceId, project: added.project }
}
