/** Profile patch text editor tests (REQ-20261029-002). */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PatchFormatError,
  appendInsertRow,
  appendPatchRow,
  findInsertedRow,
  findOverrideRows,
  hasRowId,
  parseScalarValue,
  removeRowsById,
  scanPatch,
  toYaml,
} from '../../src/host/domain/profile-patch.js'

const MCP_NAME = '@deepseek-ai/dsh-mcp-client'

/** Close to a real desktop profile patch: nested llm config, !js tags, quotes. */
const FIXTURE = [
  '# Your patch layer for this dsh profile, applied after every bundle layer.',
  '# `!!js` expressions are allowed.',
  '- id: ui-settings',
  '  name: "@deepseek-ai/dsh-client-ui-settings"',
  '  config:',
  '    enabled: true',
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers:',
  '      pku:',
  '        apiKeyEnv: PKU_API_KEY',
  '        baseURL: https://chat.pku.edu.cn/v1',
  '        models:',
  '          - id: deepseek-flash',
  '            name: deepseek-flash',
  '            contextWindow: 1000000',
  '            reasoningEfforts:',
  '              high: high',
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: pku',
  '    model: deepseek-flash@DEEPSEEK-default',
  '- id: prompt-template',
  '  name: "@deepseek-ai/dsh-agent-instructions"',
  '  config:',
  "    text: !!js process.env.DSH_PROMPT || 'default text'",
  '- id: block-scalar-row',
  '  config:',
  '    script: |',
  '      line one: with colon',
  '      - not a list item',
  '      line three',
  '- id: multiline-flow',
  '  config:',
  '    args: [',
  '      "one",',
  '      "two"',
  '    ]',
  '    note: "brace } and bracket ] inside quotes"',
  '- insert:',
  '    - id: db-metadata',
  `      name: '${MCP_NAME}'`,
  '      config:',
  '        serverName: db-metadata',
  '        transport: stdio',
  '        command: node',
  '        args:',
  "          - '/pkg/dist/index.js'",
  '        env:',
  '          DB_METADATA_CONFIG: "/pkg/config.json"',
  '',
  '- id: db-metadata',
  `  name: '${MCP_NAME}'`,
  '  disabled: true',
  '',
  '- id: final',
  '  disabled: false',
  '',
].join('\n')

test('scanPatch recognizes rows, inserts and overrides', function () {
  const doc = scanPatch(FIXTURE)
  assert.equal(doc.emptyToken, null)
  assert.deepEqual(doc.unsupported, [])
  assert.equal(doc.items.length, 9)
  const wrapper = doc.items.find(function (item) { return item.insert })
  assert.notEqual(wrapper, undefined)
  assert.equal(wrapper.inserted.length, 1)
  assert.equal(wrapper.inserted[0].id, 'db-metadata')
  assert.equal(wrapper.inserted[0].name, MCP_NAME)
  assert.notEqual(findInsertedRow(doc, 'db-metadata'), null)
  assert.equal(findInsertedRow(doc, 'nope'), null)
  const overrides = findOverrideRows(doc, 'db-metadata')
  assert.equal(overrides.length, 1)
  assert.equal(hasRowId(doc, 'db-metadata'), true)
  assert.equal(hasRowId(doc, 'final'), true)
  assert.equal(hasRowId(doc, 'nope'), false)
  // Nested config lines (flow collection, block scalar) must not create rows.
  assert.deepEqual(doc.items.map(function (item) { return item.id }), [
    'ui-settings', 'llm-pi-ai', 'agent-default-model', 'prompt-template',
    'block-scalar-row', 'multiline-flow', null, 'db-metadata', 'final',
  ])
})

test('scanPatch rejects empty, comment-only and invalid documents', function () {
  assert.throws(function () { scanPatch('') }, PatchFormatError)
  assert.throws(function () { scanPatch('# only a comment\n') }, PatchFormatError)
  assert.throws(function () { scanPatch('foo: bar\n') }, PatchFormatError)
  assert.throws(function () { scanPatch('---\n- id: x\n') }, PatchFormatError)
  // `[]` with comments around it is a valid empty patch.
  const empty = scanPatch('# empty\n[]\n')
  assert.equal(empty.items.length, 0)
  assert.notEqual(empty.emptyToken, null)
  assert.equal(empty.text.indexOf('[]'), empty.emptyToken.start)
})

test('parseScalarValue unquotes plain YAML scalars', function () {
  assert.equal(parseScalarValue('plain'), 'plain')
  assert.equal(parseScalarValue('"double quoted"'), 'double quoted')
  assert.equal(parseScalarValue("'single quoted'"), 'single quoted')
  assert.equal(parseScalarValue('"a\\"b"'), 'a"b')
  assert.equal(parseScalarValue("'it''s'"), "it's")
  assert.equal(parseScalarValue('value # comment'), 'value')
  assert.equal(parseScalarValue('!!js process.env.X'), null)
  assert.equal(parseScalarValue('&anchor value'), null)
  assert.equal(parseScalarValue(''), null)
})

test('appendInsertRow converts `[]` into a block sequence', function () {
  const text = appendInsertRow('[]\n', {
    id: 'mcp-demo',
    name: MCP_NAME,
    config: { serverName: 'demo', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] },
  })
  assert.equal(text.startsWith('- insert:'), true)
  assert.equal(text.includes('    - id: "mcp-demo"'), true)
  assert.equal(text.includes('      name: "@deepseek-ai/dsh-mcp-client"'), true)
  assert.equal(text.includes('      config:'), true)
  assert.equal(text.includes('        serverName: "demo"'), true)
  assert.equal(text.includes('          - "-y"'), true)
  const doc = scanPatch(text)
  assert.equal(doc.items.length, 1)
  assert.equal(findInsertedRow(doc, 'mcp-demo').name, MCP_NAME)
})

test('appendInsertRow keeps existing rows untouched and preserves eol', function () {
  const text = appendInsertRow(FIXTURE, {
    id: 'mcp-demo',
    name: MCP_NAME,
    config: { serverName: 'demo', transport: 'stdio', command: 'npx' },
  })
  assert.equal(text.startsWith(FIXTURE), true)
  assert.equal(text.endsWith('\n'), true)
  const doc = scanPatch(text)
  assert.equal(doc.items.length, 10)
  assert.notEqual(findInsertedRow(doc, 'mcp-demo'), null)
  const previous = scanPatch(FIXTURE)
  assert.deepEqual(doc.items.slice(0, previous.items.length).map(function (item) { return item.start }),
    previous.items.map(function (item) { return item.start }))
})

test('append helpers normalize a missing trailing newline and CRLF files', function () {
  const noNewline = FIXTURE.replace(/\n$/, '')
  const appended = appendPatchRow(noNewline, { id: 'some-row', disabled: false })
  assert.equal(appended.endsWith('\n'), true)
  assert.equal(appended.includes('\n- id: "some-row"\n  disabled: false\n'), true)
  const crlf = FIXTURE.replace(/\n/g, '\r\n')
  const crlfAppended = appendPatchRow(crlf, { id: 'some-row', disabled: false })
  assert.equal(crlfAppended.includes('\r\n- id: "some-row"\r\n  disabled: false\r\n'), true)
  assert.equal(/[^\r]\n/.test(crlfAppended), false)
})

test('append helpers reject empty or comment-only patch files', function () {
  assert.throws(function () {
    appendInsertRow('', { id: 'x', name: MCP_NAME, config: {} })
  }, PatchFormatError)
  assert.throws(function () {
    appendPatchRow('# comments only\n', { id: 'x', disabled: true })
  }, PatchFormatError)
})

test('appendPatchRow adds a top-level override row', function () {
  const text = appendPatchRow(FIXTURE, { id: 'bundle-mcp', name: MCP_NAME, disabled: true })
  const doc = scanPatch(text)
  const rows = findOverrideRows(doc, 'bundle-mcp')
  assert.equal(rows.length, 1)
  assert.equal(text.includes('- id: "bundle-mcp"'), true)
  assert.equal(text.includes('  name: "@deepseek-ai/dsh-mcp-client"\n  disabled: true'), true)
})

test('removeRowsById removes the insert wrapper and its override row', function () {
  const removed = removeRowsById(FIXTURE, 'db-metadata')
  assert.equal(removed.removed, true)
  assert.equal(removed.text.includes('db-metadata'), false)
  assert.equal(removed.text.includes('llm-pi-ai'), true)
  assert.equal(removed.text.includes('- id: "final"') || removed.text.includes('- id: final'), true)
  const doc = scanPatch(removed.text)
  assert.equal(doc.items.length, 7)
  assert.equal(findInsertedRow(doc, 'db-metadata'), null)
  assert.deepEqual(doc.unsupported, [])
})

test('removeRowsById keeps a wrapper that still holds other insert rows', function () {
  const base = [
    '- insert:',
    '    - id: first-mcp',
    `      name: ${MCP_NAME}`,
    '    - id: second-mcp',
    `      name: ${MCP_NAME}`,
    '- id: other',
    '  disabled: false',
    '',
  ].join('\n')
  const removed = removeRowsById(base, 'first-mcp')
  assert.equal(removed.removed, true)
  assert.equal(removed.text.includes('first-mcp'), false)
  assert.equal(removed.text.includes('second-mcp'), true)
  assert.equal(removed.text.includes('- insert:'), true)
  const doc = scanPatch(removed.text)
  assert.equal(doc.items.length, 2)
  assert.equal(findInsertedRow(doc, 'second-mcp') !== null, true)
})

test('removeRowsById removes only override rows when the id is bundle-provided', function () {
  const base = [
    '- id: bundle-mcp',
    `  name: ${MCP_NAME}`,
    '  disabled: true',
    '- id: keep',
    '  disabled: false',
    '',
  ].join('\n')
  const removed = removeRowsById(base, 'bundle-mcp')
  assert.equal(removed.removed, true)
  assert.equal(removed.text.includes('bundle-mcp'), false)
  assert.equal(removed.text.includes('keep'), true)
})

test('removeRowsById reports when nothing matched and preserves the text', function () {
  const removed = removeRowsById(FIXTURE, 'unknown-id')
  assert.equal(removed.removed, false)
  assert.equal(removed.text, FIXTURE)
})

test('removeRowsById refuses to edit flow-style rows that match the id', function () {
  const base = [
    `- insert: [{"id": "flow-mcp", "name": ${MCP_NAME}}]`,
    '- id: keep',
    '  disabled: false',
    '',
  ].join('\n')
  const doc = scanPatch(base)
  assert.equal(doc.unsupported.length > 0, true)
  assert.throws(function () { removeRowsById(base, 'flow-mcp') }, PatchFormatError)
  assert.equal(removeRowsById(base, 'unrelated').removed, false)
})

test('append then remove round-trips to the original text', function () {
  const appended = appendInsertRow(FIXTURE, {
    id: 'mcp-round-trip',
    name: MCP_NAME,
    config: { serverName: 'round-trip', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp' },
  })
  const removed = removeRowsById(appended, 'mcp-round-trip')
  assert.equal(removed.removed, true)
  assert.equal(removed.text, FIXTURE)
})

test('removeRowsById keeps comments and restores `[]` when the last row goes', function () {
  const template = [
    '# Your patch layer for this dsh profile, applied after every bundle layer:',
    '# a top-level YAML array of loader patch entries.',
    '- insert:',
    '    - id: mcp-only',
    `      name: ${MCP_NAME}`,
    '      config:',
    '        serverName: only',
  ].join('\n') + '\n'
  const removed = removeRowsById(template, 'mcp-only')
  assert.equal(removed.removed, true)
  assert.equal(removed.text.includes('# Your patch layer'), true)
  assert.equal(removed.text.includes('mcp-only'), false)
  assert.equal(removed.text.trim().endsWith('[]'), true)
  const doc = scanPatch(removed.text)
  assert.equal(doc.items.length, 0)
  assert.notEqual(doc.emptyToken, null)
  assert.deepEqual(doc.unsupported, [])
})

test('removeRowsById preserves comments that follow the removed row', function () {
  const base = [
    '- insert:',
    '    - id: first-mcp',
    `      name: ${MCP_NAME}`,
    '# keep this note about the next row',
    '- id: keep',
    '  disabled: false',
    '',
  ].join('\n')
  // The comment sits between two rows and belongs to the remaining one.
  const removed = removeRowsById(base, 'first-mcp')
  assert.equal(removed.removed, true)
  assert.equal(removed.text.includes('# keep this note about the next row'), true)
  assert.equal(removed.text.includes('first-mcp'), false)
  assert.equal(scanPatch(removed.text).items.length, 1)
})

test('scanPatch reports flow-style inserted rows and unparsable ids as unsupported', function () {
  const flowRow = [
    '- insert:',
    '    - {id: "flow-mcp", name: "x"}',
    '- id: keep',
    '  disabled: false',
    '',
  ].join('\n')
  const flowDoc = scanPatch(flowRow)
  assert.equal(flowDoc.unsupported.length > 0, true)
  assert.equal(findInsertedRow(flowDoc, 'flow-mcp'), null)

  const anchorId = [
    '- id: &shared keep',
    '  disabled: false',
    '',
  ].join('\n')
  const anchorDoc = scanPatch(anchorId)
  assert.equal(anchorDoc.unsupported.length > 0, true)

  const jsId = [
    '- id: !!js process.env.ROW_ID',
    '  disabled: false',
    '',
  ].join('\n')
  assert.equal(scanPatch(jsId).unsupported.length > 0, true)
})

test('scanPatch does not treat brackets in plain scalars as flow starts', function () {
  const text = [
    '- id: mcp-a',
    `  name: ${MCP_NAME}`,
    '  config:',
    '    command: echo [',
    '    note: a { b',
    '- id: keep',
    '  name: "@deepseek-ai/dsh-keep"',
    '',
  ].join('\n')
  const doc = scanPatch(text)
  assert.deepEqual(doc.items.map(function (item) { return item.id }), ['mcp-a', 'keep'])
  assert.equal(doc.unsupported.length, 0)
  const removed = removeRowsById(text, 'mcp-a')
  assert.equal(removed.removed, true)
  assert.equal(removed.text.includes('dsh-keep'), true)
  assert.equal(removed.text.includes('mcp-a'), false)
})

test('scanPatch rejects an unterminated flow collection instead of swallowing rows', function () {
  const text = [
    '- id: mcp-a',
    '  config:',
    '    args: [',
    '      "one",',
    '- id: keep',
    '',
  ].join('\n')
  assert.throws(function () { scanPatch(text) }, PatchFormatError)
  assert.throws(function () { removeRowsById(text, 'mcp-a') }, PatchFormatError)
})

test('scanPatch rejects an indented top-level sequence', function () {
  const text = ['  - id: a', '    name: y', ''].join('\n')
  assert.throws(function () { scanPatch(text) }, PatchFormatError)
  assert.throws(function () {
    appendPatchRow(text, { id: 'b', disabled: false })
  }, PatchFormatError)
})

test('scanPatch ignores brackets inside !!js scalars and continued plain scalars', function () {
  const text = [
    '- id: with-js',
    '  config:',
    "    text: !!js process.env.X || '['",
    '    description: first part',
    '      continued [with bracket and { brace',
    '- id: keep',
    '  disabled: false',
    '',
  ].join('\n')
  const doc = scanPatch(text)
  assert.deepEqual(doc.items.map(function (item) { return item.id }), ['with-js', 'keep'])
})

test('scanPatch folds multi-line double-quoted scalars instead of inventing rows', function () {
  const text = [
    '- id: a',
    '  config:',
    '    text: "line',
    '- id: fake',
    '  name: x',
    '  tail"',
    '- id: b',
    '',
  ].join('\n')
  const doc = scanPatch(text)
  assert.deepEqual(doc.items.map(function (item) { return item.id }), ['a', 'b'])
  assert.equal(doc.unsupported.length, 0)
  const removed = removeRowsById(text, 'a')
  assert.equal(removed.removed, true)
  assert.equal(removed.text, '- id: b\n')
})

test('scanPatch folds multi-line single-quoted scalars too', function () {
  const text = [
    '- id: a',
    '  config:',
    "    text: 'line",
    '- id: fake',
    "  tail'",
    '- id: b',
    '',
  ].join('\n')
  assert.deepEqual(scanPatch(text).items.map(function (item) { return item.id }), ['a', 'b'])
})

test('scanPatch does not close a flow collection inside a multi-line quoted scalar', function () {
  const text = [
    '- id: a',
    '  config:',
    '    args: [',
    '      "line',
    '- id: fake',
    'tail",',
    '    ]',
    '- id: b',
    '',
  ].join('\n')
  const doc = scanPatch(text)
  assert.deepEqual(doc.items.map(function (item) { return item.id }), ['a', 'b'])
  assert.equal(doc.unsupported.length, 0)
})

test('scanPatch rejects an unterminated quoted scalar', function () {
  const text = ['- id: a', '  config:', '    text: "oops', ''].join('\n')
  assert.throws(function () { scanPatch(text) }, PatchFormatError)
  assert.throws(function () { removeRowsById(text, 'a') }, PatchFormatError)
})

test('removeRowsById removes a whole inserted row containing a multi-line scalar', function () {
  const text = [
    '- insert:',
    '    - id: mcp-a',
    `      name: ${MCP_NAME}`,
    '      config:',
    '        note: "first',
    '- id: inside-scalar',
    '        second"',
    '- id: keep',
    '  disabled: false',
    '',
  ].join('\n')
  const doc = scanPatch(text)
  assert.deepEqual(doc.items.map(function (item) { return item.id }), [null, 'keep'])
  assert.notEqual(findInsertedRow(doc, 'mcp-a'), null)
  const removed = removeRowsById(text, 'mcp-a')
  assert.equal(removed.removed, true)
  assert.equal(removed.text.includes('mcp-a'), false)
  assert.equal(removed.text.includes('inside-scalar'), false)
  assert.equal(removed.text.includes('- id: keep'), true)
})

test('toYaml serializes JSON-compatible values as block YAML', function () {
  assert.equal(toYaml({ a: 'x', b: 1, c: true, d: null, e: [], f: {} }),
    'a: "x"\nb: 1\nc: true\nd: null\ne: []\nf: {}')
  assert.equal(toYaml({ args: ['a', 'b'], env: { KEY: 'V' } }, 4), [
    '    args:',
    '      - "a"',
    '      - "b"',
    '    env:',
    '      KEY: "V"',
  ].join('\n'))
  assert.equal(toYaml(['one', 'two']), '- "one"\n- "two"')
  assert.equal(toYaml({ list: [{ id: 'a' }, { id: 'b' }] }), [
    'list:',
    '  -',
    '    id: "a"',
    '  -',
    '    id: "b"',
  ].join('\n'))
  assert.equal(toYaml({ 'odd key': 'v' }), '"odd key": "v"')
})

test('toYaml quotes strings that YAML would otherwise misread', function () {
  const value = {
    quote: 'a"b',
    newline: 'line\nbreak',
    colon: 'key: value',
    hash: '# not a comment',
    chinese: '中文',
    backslash: 'C:\\path\\to',
  }
  assert.equal(toYaml(value), [
    'quote: "a\\"b"',
    'newline: "line\\nbreak"',
    'colon: "key: value"',
    'hash: "# not a comment"',
    'chinese: "中文"',
    'backslash: "C:\\\\path\\\\to"',
  ].join('\n'))
})

test('scanPatch ignores block-scalar and multi-line flow content', function () {
  const doc = scanPatch(FIXTURE)
  assert.equal(doc.unsupported.length, 0)
  // The block scalar body contains `- not a list item`, which must not become a row.
  const ids = doc.items.map(function (item) { return item.id })
  assert.equal(ids.includes('block-scalar-row'), true)
  assert.equal(ids.filter(function (id) { return id === 'not a list item' }).length, 0)
})
