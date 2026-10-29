#!/usr/bin/env node
/**
 * Validate the host message catalog (`src/host/messages/`).
 *
 * What it guarantees:
 *   1. every `messages.KEY` referenced in host source exists in base/extra;
 *   2. the generated aggregator `messages/index.js` matches its expected form
 *      (run with `--write` to regenerate it);
 *   3. unused keys are reported so dead copy can be removed.
 *
 * New keys are added manually to `base.js` (legacy shipped copy) or
 * `extra.js` (newer additions). Duplicate keys are intentional: `extra.js`
 * overrides `base.js`.
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const hostDir = path.join(root, 'src', 'host')
const messagesDir = path.join(hostDir, 'messages')
const baseFile = path.join(messagesDir, 'base.js')
const extraFile = path.join(messagesDir, 'extra.js')
const indexFile = path.join(messagesDir, 'index.js')
const write = process.argv.includes('--write')

const EXPECTED_INDEX = [
  "import { messages as baseMessages } from './base.js'",
  "import { extraMessages } from './extra.js'",
  '',
  'export const messages = Object.freeze(Object.assign({}, baseMessages, extraMessages))',
  '',
].join('\n')

function objectKeys(file) {
  const text = fs.readFileSync(file, 'utf8')
  const keys = new Set()
  for (const match of text.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)) keys.add(match[1])
  return keys
}

function sourceFiles(dir) {
  const result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...sourceFiles(target))
    else if (entry.name.endsWith('.js')) result.push(target)
  }
  return result
}

const baseKeys = objectKeys(baseFile)
const extraKeys = objectKeys(extraFile)
const available = new Set([...baseKeys, ...extraKeys])
const referenced = new Set()
for (const file of sourceFiles(hostDir)) {
  if (file.startsWith(messagesDir + path.sep)) continue
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(/messages\.([A-Za-z0-9_]+)/g)) referenced.add(match[1])
}
referenced.delete('js')

const errors = []
const warnings = []
const missing = [...referenced].filter((key) => available.has(key) === false)
if (missing.length > 0) errors.push('missing message keys: ' + missing.join(', '))
for (const key of [...available].sort()) {
  if (referenced.has(key) === false) warnings.push('unused message key: ' + key)
}

let currentIndex = ''
try {
  currentIndex = fs.readFileSync(indexFile, 'utf8')
} catch {
  errors.push('missing generated aggregator: ' + path.relative(root, indexFile))
}
if (currentIndex !== '' && currentIndex !== EXPECTED_INDEX) {
  if (write) {
    fs.writeFileSync(indexFile, EXPECTED_INDEX)
    console.log('check-messages: regenerated src/host/messages/index.js')
  } else {
    errors.push('src/host/messages/index.js has drifted; run `npm run messages:check -- --write`')
  }
}

for (const warning of warnings) console.warn('check-messages: ' + warning)
if (errors.length > 0) {
  for (const error of errors) console.error('check-messages: ' + error)
  process.exit(1)
}
console.log('check-messages: OK — ' + available.size + ' keys (' +
  baseKeys.size + ' base + ' + extraKeys.size + ' extra), ' + referenced.size + ' referenced')
