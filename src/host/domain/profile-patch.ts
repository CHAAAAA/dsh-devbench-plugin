/**
 * Conservative text editor for a DSH profile `cordis.patch.yml`.
 *
 * DSH does not expose its YAML dependency to third-party plugins, so this
 * module understands just enough of the profile patch format to locate and
 * edit rows while leaving every unrelated byte intact:
 *
 * - a top-level block sequence of patch rows (`- id: ...`, `- insert:`);
 * - sequence items directly below a top-level `insert:` key;
 * - flow collections and block scalars inside values (scanned so row
 *   boundaries are never inferred from their content);
 * - `[]` (or a comment-only file, which DSH itself rejects with a
 *   `PatchFormatError` here so callers refuse instead of corrupting it).
 *
 * Anything it cannot prove safe (flow-style rows, anchors, unknown structures)
 * is reported through `doc.unsupported` and the editing helpers throw
 * `PatchFormatError` instead of guessing. Pure functions only: no file I/O and
 * no dependencies.
 */

/** Thrown when the patch list cannot be edited safely. */
export class PatchFormatError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PatchFormatError'
  }
}

const BRACKET_LINE = /^\s*\[\s*\]\s*(?:#.*)?$/
const TOP_LEVEL_ITEM = /^-(?:[ \t]|$)/
const MAP_KEY = /^([A-Za-z0-9_$.-]+)\s*:\s*(.*)$/
const BARE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/

function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** Split without the trailing newline sentinel; join restores it on demand. */
function toLines(text) {
  const eol = eolOf(text)
  const ended = text.endsWith('\n')
  const lines = text.split(/\r?\n/)
  if (ended) lines.pop()
  return { lines, eol, ended }
}

function fromLines(lines, eol) {
  if (lines.length === 0) return '[]' + eol
  return lines.join(eol) + eol
}

function indentOf(line) {
  return line.length - line.trimStart().length
}

function isBlank(line) {
  return line.trim() === ''
}

function isComment(line) {
  return line.trim().startsWith('#')
}

function isBlankOrComment(line) {
  return isBlank(line) || isComment(line)
}

/** Drop a trailing `# comment` that is outside quotes. */
function stripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (quote === '"') {
      if (char === '\\') {
        i += 1
      } else if (char === '"') {
        quote = null
      }
      continue
    }
    if (quote === "'") {
      if (char === "'") {
        if (line[i + 1] === "'") i += 1
        else quote = null
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

/** Bracket depth at the end of a line (`[]`/`{}` outside quotes/comments). */
/**
 * Advance multi-line YAML state over `line` starting at `start`.
 * Tracks flow bracket depth and an open quoted scalar so brackets inside a
 * multi-line quoted string never close (or open) a flow collection.
 */
function scanStateAfter(line, start, state) {
  let depth = state.depth
  let quote = state.quote
  for (let i = start; i < line.length; i += 1) {
    const char = line[i]
    if (quote === '"') {
      if (char === '\\') i += 1
      else if (char === '"') quote = null
      continue
    }
    if (quote === "'") {
      if (char === "'") {
        if (line[i + 1] === "'") i += 1
        else quote = null
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) break
    if (char === '[' || char === '{') depth += 1
    else if (char === ']' || char === '}') depth = Math.max(0, depth - 1)
  }
  return { depth, quote }
}

/** Index just past leading indentation and block-sequence dashes. */
function nodeStartOf(code) {
  let i = 0
  while (i < code.length && /[ \t]/.test(code[i])) i += 1
  while (code[i] === '-' && (i + 1 >= code.length || /[ \t]/.test(code[i + 1]))) {
    i += 1
    while (i < code.length && /[ \t]/.test(code[i])) i += 1
  }
  return i
}

/** Skip node properties (`!tag`, `&anchor`); `!!js` is a scalar, never a flow start. */
function skipNodeProperties(code, index) {
  let i = index
  for (let guard = 0; guard < 8; guard += 1) {
    while (i < code.length && /[ \t]/.test(code[i])) i += 1
    if (code[i] !== '!' && code[i] !== '&') break
    if (code.startsWith('!!js', i)) return { index: i, js: true }
    while (i < code.length && /[ \t]/.test(code[i]) === false) i += 1
  }
  return { index: i, js: false }
}

/** First `:` outside quotes at or after `start`. */
function colonOutsideQuotes(code, start) {
  let quote = null
  for (let i = start; i < code.length; i += 1) {
    const char = code[i]
    if (quote === '"') {
      if (char === '\\') i += 1
      else if (char === '"') quote = null
      continue
    }
    if (quote === "'") {
      if (char === "'") {
        if (code[i + 1] === "'") i += 1
        else quote = null
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ':' && (i + 1 >= code.length || /[ \t]/.test(code[i + 1]))) return i
  }
  return -1
}

/**
 * Locate the value node of one line in block context and describe its opening
 * state. Brackets merely appearing inside a plain scalar (`echo [`) are not a
 * flow collection; `!!js` scalars are never flow starts nor quoted scalars.
 */
function nodeValueState(line) {
  const code = stripComment(line)
  if (code.trim() === '') return null
  const start = nodeStartOf(code)
  if (start >= code.length) return null
  const node = skipNodeProperties(code, start)
  if (node.js) return null
  let index = node.index
  if (code[index] !== '[' && code[index] !== '{' && code[index] !== '"' && code[index] !== "'") {
    const colon = colonOutsideQuotes(code, start)
    if (colon < 0) return null
    const value = skipNodeProperties(code, colon + 1)
    if (value.js) return null
    index = value.index
  }
  if (index >= code.length) return null
  const char = code[index]
  if (char === '[' || char === '{') {
    const scanned = scanStateAfter(code, index, { depth: 0, quote: null })
    return { depth: scanned.depth, quote: scanned.quote, flow: true }
  }
  if (char === '"' || char === "'") {
    const scanned = scanStateAfter(code, index, { depth: 0, quote: null })
    return { depth: 0, quote: scanned.quote, flow: false }
  }
  return null
}

function endsWithBlockScalar(code) {
  const withoutQuotes = stripComment(code)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^']|'')*'/g, "''")
  return /(?:^|[:\s>|+-])[|>][+-]?\s*$/.test(withoutQuotes)
}

/**
 * Classify every line as structural or not. Structural lines start outside a
 * block scalar, outside a multi-line flow collection and outside a multi-line
 * quoted scalar; only those can carry patch structure.
 */
function scanLines(lines) {
  const meta = new Array(lines.length)
  let depth = 0
  let quote = null
  let blockIndent = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (blockIndent !== null) {
      if (isBlank(line) || indentOf(line) > blockIndent) {
        meta[i] = { structural: false, indent: 0, blank: isBlank(line) }
        continue
      }
      blockIndent = null
    }
    if (depth > 0 || quote !== null) {
      const scanned = scanStateAfter(line, 0, { depth, quote })
      depth = scanned.depth
      quote = scanned.quote
      meta[i] = { structural: false, indent: 0, blank: isBlank(line) }
      continue
    }
    if (isBlankOrComment(line)) {
      meta[i] = { structural: false, indent: 0, blank: isBlank(line) }
      continue
    }
    const indent = indentOf(line)
    const code = stripComment(line)
    if (indent === 0 && code.trim().startsWith('-') === false && MAP_KEY.test(code.trim()) === false &&
      BRACKET_LINE.test(line) === false) {
      throw new PatchFormatError('patch file is not a YAML sequence: ' + JSON.stringify(line.trim()))
    }
    meta[i] = { structural: true, indent, blank: false }
    if (endsWithBlockScalar(code)) {
      blockIndent = indent
      continue
    }
    const opened = nodeValueState(line)
    if (opened !== null) {
      depth = opened.depth
      quote = opened.quote
    }
  }
  if (depth > 0) throw new PatchFormatError('patch file has an unterminated flow collection')
  if (quote !== null) throw new PatchFormatError('patch file has an unterminated quoted scalar')
  return meta
}

/** Parse a plain YAML scalar; returns null for values we refuse to guess. */
export function parseScalarValue(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim()
  if (text === '') return null
  const code = stripComment(text).trim()
  if (code === '') return null
  if (code.startsWith('"')) {
    const match = /^"((?:[^"\\]|\\.)*)"/.exec(code)
    if (match === null) return null
    try {
      return JSON.parse('"' + match[1] + '"')
    } catch {
      return null
    }
  }
  if (code.startsWith("'")) {
    const match = /^'((?:[^']|'')*)'/.exec(code)
    if (match === null) return null
    return match[1].replace(/''/g, "'")
  }
  if (/^[&*!|>{[]/.test(code)) return null
  return code
}

function lineOffsets(lines, eol) {
  const offsets = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + eol.length
  }
  return offsets
}

function bracketTokenRange(lines, eol) {
  const offsets = lineOffsets(lines, eol)
  for (let i = 0; i < lines.length; i += 1) {
    if (BRACKET_LINE.test(lines[i]) === false) continue
    const start = offsets[i] + lines[i].indexOf('[')
    const end = offsets[i] + lines[i].lastIndexOf(']') + 1
    return { start, end }
  }
  return null
}

function readFieldKey(content) {
  const match = MAP_KEY.exec(content.trim())
  if (match === null) return null
  return { key: match[1], rest: match[2] }
}

/** Walk a block value's structural lines to find the first item at the given indent. */
function firstStructuralAfter(meta, index, end) {
  for (let i = index + 1; i < end; i += 1) {
    if (meta[i].structural) return i
  }
  return -1
}

function analyzeInsertedRows(lines, meta, insertIndex, fieldIndent, end, unsupported) {
  const first = firstStructuralAfter(meta, insertIndex, end)
  if (first < 0) return { rows: [], flow: false }
  const firstLine = lines[first]
  if (firstLine.trim().startsWith('[') || firstLine.trim().startsWith('{')) {
    return { rows: [], flow: true }
  }
  if (meta[first].indent <= fieldIndent || TOP_LEVEL_ITEM.test(firstLine.trim()) === false) {
    return { rows: [], flow: true }
  }
  const seqIndent = meta[first].indent
  const rows = []
  for (let i = first; i < end; i += 1) {
    if (meta[i].structural === false) continue
    if (meta[i].indent !== seqIndent) continue
    const content = lines[i].trim()
    if (TOP_LEVEL_ITEM.test(content) === false) continue
    const rowStart = i
    let rowEnd = end
    for (let j = i + 1; j < end; j += 1) {
      if (meta[j].structural && meta[j].indent <= seqIndent) {
        rowEnd = j
        break
      }
    }
    const dashRest = lines[rowStart].slice(seqIndent)
    const dash = /^-([ \t]*)/.exec(dashRest)
    const rowIndent = seqIndent + (dash === null ? 1 : 1 + dash[1].length)
    const firstContent = lines[rowStart].slice(rowIndent)
    let id = null
    let name = null
    const firstField = readFieldKey(firstContent)
    if (firstField === null) {
      unsupported.push('unsupported inserted row at line ' + String(rowStart + 1))
      i = rowEnd - 1
      continue
    }
    if (firstField.key === 'id') id = parseScalarValue(firstField.rest)
    if (firstField.key === 'name') name = parseScalarValue(firstField.rest)
    if (firstField.key === 'id' && id === null && firstField.rest.trim() !== '') {
      unsupported.push('unparsable inserted row id at line ' + String(rowStart + 1))
    }
    for (let j = rowStart + 1; j < rowEnd; j += 1) {
      if (meta[j].structural === false) continue
      if (meta[j].indent !== rowIndent) continue
      const field = readFieldKey(lines[j])
      if (field === null) continue
      if (field.key === 'id' && id === null) {
        id = parseScalarValue(field.rest)
        if (id === null && field.rest.trim() !== '') {
          unsupported.push('unparsable inserted row id at line ' + String(j + 1))
        }
      }
      if (field.key === 'name' && name === null) name = parseScalarValue(field.rest)
    }
    rows.push({ id, name, start: rowStart, end: rowEnd, indent: seqIndent })
    i = rowEnd - 1
  }
  return { rows, flow: false }
}

function analyzeItem(lines, meta, start, end, unsupported) {
  const item = {
    start,
    end,
    indent: meta[start].indent,
    id: null,
    insert: false,
    insertFlow: false,
    flow: false,
    fieldKeys: [],
    inserted: [],
  }
  const startLine = lines[start]
  const afterDash = startLine.replace(/^-[ \t]*/, '')
  let firstField = readFieldKey(afterDash)
  if (firstField === null && afterDash.trim() !== '') {
    if (afterDash.trim().startsWith('{')) {
      item.flow = true
      unsupported.push('flow mapping row at line ' + String(start + 1))
      return item
    }
    unsupported.push('unsupported row at line ' + String(start + 1))
    return item
  }
  const dash = /^-([ \t]*)/.exec(startLine)
  const dashSpaces = dash === null ? 1 : dash[1].length
  const fieldIndent = firstField === null
    ? firstStructuralFieldIndent(lines, meta, start, end)
    : indentOf(startLine) + 1 + dashSpaces
  if (fieldIndent < 0) {
    unsupported.push('empty patch row at line ' + String(start + 1))
    return item
  }
  let index = start
  while (index < end) {
    let content = null
    if (index === start && firstField !== null) {
      content = afterDash.trim()
    } else if (meta[index].structural && meta[index].indent === fieldIndent) {
      content = lines[index].trim()
    }
    if (content === null) {
      index += 1
      continue
    }
    const field = readFieldKey(content)
    if (field === null) {
      index += 1
      continue
    }
    item.fieldKeys.push(field.key)
    if (field.key === 'id') {
      item.id = parseScalarValue(field.rest)
      if (item.id === null && field.rest.trim() !== '') {
        unsupported.push('unparsable row id at line ' + String(index + 1))
      }
    } else if (field.key === 'insert') {
      item.insert = true
      if (field.rest.trim().startsWith('[') || field.rest.trim().startsWith('{')) {
        item.insertFlow = true
        unsupported.push('flow-style insert at line ' + String(index + 1))
        item.inserted = []
      } else {
        const inserted = analyzeInsertedRows(lines, meta, index, fieldIndent, end, unsupported)
        if (inserted.flow) {
          item.insertFlow = true
          unsupported.push('flow-style insert at line ' + String(index + 1))
        }
        item.inserted = inserted.rows
      }
    }
    index += 1
  }
  return item
}

function firstStructuralFieldIndent(lines, meta, start, end) {
  for (let i = start + 1; i < end; i += 1) {
    if (meta[i].structural) return meta[i].indent
  }
  return -1
}

/** Scan a patch text into its structural model. */
export function scanPatch(text) {
  if (typeof text !== 'string') throw new PatchFormatError('patch file must be a string')
  const eol = eolOf(text)
  const { lines } = toLines(text)
  const meta = scanLines(lines)
  const structural = []
  for (let i = 0; i < lines.length; i += 1) {
    if (meta[i].structural) structural.push(i)
  }
  if (structural.length === 0) throw new PatchFormatError('patch file is empty or contains only comments')
  const bracketLines = structural.filter(function (index) { return BRACKET_LINE.test(lines[index]) })
  const contentLines = structural.filter(function (index) {
    return BRACKET_LINE.test(lines[index]) === false && lines[index].trim() !== '---' && lines[index].trim() !== '...'
  })
  const markers = structural.filter(function (index) {
    const value = lines[index].trim()
    return value === '---' || value === '...'
  })
  if (markers.length > 0) throw new PatchFormatError('patch file document markers are not supported')
  if (bracketLines.length > 0 && contentLines.length > 0) {
    throw new PatchFormatError('patch file mixes `[]` with sequence entries')
  }
  if (contentLines.length === 0) {
    if (bracketLines.length !== 1) throw new PatchFormatError('patch file is not a YAML sequence')
    return {
      text,
      eol,
      items: [],
      emptyToken: bracketTokenRange(lines, eol),
      unsupported: [],
    }
  }
  const starts = contentLines.filter(function (index) {
    return meta[index].indent === 0 && TOP_LEVEL_ITEM.test(lines[index].trim())
  })
  if (starts.length === 0) {
    const indentedItem = contentLines.some(function (index) {
      return meta[index].indent > 0 && TOP_LEVEL_ITEM.test(lines[index].trim())
    })
    if (indentedItem) {
      throw new PatchFormatError('top-level patch sequence must not be indented')
    }
    throw new PatchFormatError('patch file is not a YAML sequence')
  }
  const stray = contentLines.filter(function (index) {
    return meta[index].indent === 0 && TOP_LEVEL_ITEM.test(lines[index].trim()) === false
  })
  if (stray.length > 0) {
    throw new PatchFormatError('patch file is not a YAML sequence: ' + JSON.stringify(lines[stray[0]].trim()))
  }
  const unsupported = []
  const items = []
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length
    items.push(analyzeItem(lines, meta, start, end, unsupported))
  }
  return { text, eol, items, emptyToken: null, unsupported }
}

export function findInsertedRow(doc, id) {
  if (doc === null || doc === undefined || id === null || id === undefined) return null
  for (const item of doc.items) {
    for (const row of item.inserted) {
      if (row.id === id) return row
    }
  }
  return null
}

export function findOverrideRows(doc, id) {
  if (doc === null || doc === undefined) return []
  return doc.items.filter(function (item) {
    return item.insert === false && item.id === id
  })
}

export function hasRowId(doc, id) {
  if (doc === null || doc === undefined) return false
  for (const item of doc.items) {
    if (item.id === id) return true
    for (const row of item.inserted) if (row.id === id) return true
  }
  return false
}

// ---- serialization --------------------------------------------------------

function scalarOf(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return JSON.stringify(value)
}

function keyOf(key) {
  const text = String(key)
  return BARE_KEY.test(text) ? text : JSON.stringify(text)
}

function isPlainMapping(value) {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false
}

function toYamlBlock(value, indent, lines) {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isPlainMapping(entry) || Array.isArray(entry)) {
        lines.push(pad + '-')
        toYamlBlock(entry, indent + 2, lines)
      } else {
        lines.push(pad + '- ' + scalarOf(entry))
      }
    }
    return
  }
  for (const key of Object.keys(value)) {
    const entry = value[key]
    if (entry === undefined) continue
    if (isPlainMapping(entry)) {
      if (Object.keys(entry).length === 0) {
        lines.push(pad + keyOf(key) + ': {}')
      } else {
        lines.push(pad + keyOf(key) + ':')
        toYamlBlock(entry, indent + 2, lines)
      }
    } else if (Array.isArray(entry)) {
      if (entry.length === 0) {
        lines.push(pad + keyOf(key) + ': []')
      } else {
        lines.push(pad + keyOf(key) + ':')
        toYamlBlock(entry, indent + 2, lines)
      }
    } else {
      lines.push(pad + keyOf(key) + ': ' + scalarOf(entry))
    }
  }
}

/** Serialize a JSON-compatible value to block YAML without a trailing newline. */
export function toYaml(value, indent = 0) {
  const lines = []
  if (isPlainMapping(value) || Array.isArray(value)) {
    if (isPlainMapping(value) && Object.keys(value).length === 0) return '{}'
    if (Array.isArray(value) && value.length === 0) return '[]'
    toYamlBlock(value, indent, lines)
    return lines.join('\n')
  }
  return ' '.repeat(indent) + scalarOf(value)
}

// ---- appending ------------------------------------------------------------

function appendBlock(text, blockLines) {
  // Validate the document first: empty, comment-only, indented-root and other
  // unsupported shapes must be refused before mixed indentation is appended.
  scanPatch(text)
  const eol = eolOf(text)
  const { lines } = toLines(text)
  const structural = []
  for (let i = 0; i < lines.length; i += 1) {
    if (isBlankOrComment(lines[i]) === false) structural.push(i)
  }
  if (structural.length === 0) throw new PatchFormatError('patch file is empty or contains only comments')
  const bracket = structural.find(function (index) { return BRACKET_LINE.test(lines[index]) })
  if (bracket !== undefined && structural.length === 1) {
    const original = lines[bracket]
    const comment = /#.*$/.exec(original)
    const replacement = comment === null ? [] : ['# ' + comment[0].replace(/^#\s*/, '')]
    lines.splice(bracket, 1, ...replacement, ...blockLines)
    return fromLines(lines, eol)
  }
  if (structural.some(function (index) { return BRACKET_LINE.test(lines[index]) })) {
    throw new PatchFormatError('patch file mixes `[]` with sequence entries')
  }
  lines.push(...blockLines)
  return fromLines(lines, eol)
}

/** Append one `insert:` row holding an MCP client entry. */
export function appendInsertRow(text, row) {
  const id = typeof row.id === 'string' ? row.id : String(row.id)
  const name = typeof row.name === 'string' ? row.name : String(row.name)
  const block = [
    '- insert:',
    '    - id: ' + JSON.stringify(id),
    '      name: ' + JSON.stringify(name),
  ]
  const config = row.config === undefined ? {} : row.config
  const configYaml = toYaml(config, 8)
  if (configYaml.includes('\n')) {
    block.push('      config:')
    block.push(...configYaml.split('\n'))
  } else {
    block.push('      config: ' + configYaml)
  }
  return appendBlock(text, block)
}

/** Append one plain patch row (id-targeted override, e.g. `disabled`). */
export function appendPatchRow(text, row) {
  const id = typeof row.id === 'string' ? row.id : String(row.id)
  const block = ['- id: ' + JSON.stringify(id)]
  for (const key of Object.keys(row)) {
    if (key === 'id') continue
    const value = row[key]
    if (value === undefined) continue
    if (isPlainMapping(value) || Array.isArray(value)) {
      const yaml = toYaml(value, 4)
      if (yaml.includes('\n')) {
        block.push('  ' + keyOf(key) + ':')
        block.push(...yaml.split('\n'))
      } else {
        block.push('  ' + keyOf(key) + ': ' + yaml)
      }
    } else {
      block.push('  ' + keyOf(key) + ': ' + scalarOf(value))
    }
  }
  return appendBlock(text, block)
}

// ---- removal --------------------------------------------------------------

function matchesIdText(lines, item, id) {
  const text = lines.slice(item.start, item.end).join('\n')
  if (text.includes(id) === false) return false
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp('(?:^|[\\s"\'\\[{,])' + escaped + '(?:[\\s"\',}\\]]|$)')
  return pattern.test(text)
}

/** Shrink a removal range so trailing blank/comment lines stay in the file. */
function trimTrailingNoise(lines, start, end) {
  let boundary = end
  while (boundary - 1 > start && isBlankOrComment(lines[boundary - 1])) boundary -= 1
  return boundary
}

/** True when the text still holds at least one non-comment YAML line. */
function hasStructuralContent(lines) {
  return lines.some(function (line) { return isBlankOrComment(line) === false })
}

/**
 * Remove every inserted row and top-level override row carrying `id`.
 * @returns `{ text, removed }`; `removed` is false when the id is not present.
 * @throws {PatchFormatError} when the id only exists inside unsupported syntax.
 */
export function removeRowsById(text, id) {
  if (typeof id !== 'string' || id.length === 0) return { text, removed: false }
  const doc = scanPatch(text)
  const eol = doc.eol
  const { lines } = toLines(text)
  const ranges = []
  let removed = false
  for (const item of doc.items) {
    if (item.insert) {
      if (item.flow === true || item.insertFlow === true) {
        if (matchesIdText(lines, item, id)) {
          throw new PatchFormatError('cannot edit a flow-style insert row: ' + id)
        }
        continue
      }
      const matched = item.inserted.filter(function (row) { return row.id === id })
      if (matched.length === 0) continue
      const others = item.fieldKeys.filter(function (key) { return key !== 'insert' })
      if (item.inserted.length === matched.length && others.length === 0) {
        ranges.push([item.start, trimTrailingNoise(lines, item.start, item.end)])
      } else {
        for (const row of matched) {
          ranges.push([row.start, trimTrailingNoise(lines, row.start, row.end)])
        }
      }
      removed = true
      continue
    }
    if (item.id !== id) continue
    if (item.flow === true) throw new PatchFormatError('cannot edit a flow-style patch row: ' + id)
    ranges.push([item.start, trimTrailingNoise(lines, item.start, item.end)])
    removed = true
  }
  if (removed === false) {
    if (doc.unsupported.length > 0) {
      const hinted = doc.items.some(function (item) { return matchesIdText(lines, item, id) })
      if (hinted) throw new PatchFormatError('cannot edit unsupported patch syntax for: ' + id)
    }
    return { text, removed: false }
  }
  const merged = mergeRanges(ranges)
  for (let i = merged.length - 1; i >= 0; i -= 1) {
    lines.splice(merged[i][0], merged[i][1] - merged[i][0])
  }
  // DSH rejects a patch file without a top-level sequence, so an emptied file
  // keeps its comments and regains an empty `[]` document.
  if (hasStructuralContent(lines) === false) lines.push('[]')
  return { text: fromLines(lines, eol), removed: true }
}

function mergeRanges(ranges) {
  const sorted = ranges.slice().sort(function (left, right) { return left[0] - right[0] })
  const merged = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1])
    } else {
      merged.push([range[0], range[1]])
    }
  }
  return merged
}
