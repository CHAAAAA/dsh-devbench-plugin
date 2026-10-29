import test from 'node:test'
import assert from 'node:assert/strict'
import { messages } from '../../src/host/messages/index.js'

test('project and task messages remain localized in Chinese', function () {
  const keys = Object.keys(messages).filter(function (key) {
    return /^(project|review|agent|commit|task|toolWorkspace)/.test(key)
  })
  assert.equal(keys.length > 20, true)
  for (const key of keys) {
    assert.match(String(messages[key]), /[\u3400-\u9fff]/, key)
  }
})
