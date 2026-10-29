import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './helpers.js'

test('loopback verification rejects DNS names and requires exact origin', async function () {
  const harness = await createHarness([])
  try {
    let response = await harness.request('GET', '/state', undefined, {
      host: '127.0.0.1.evil.example:4321',
      origin: 'http://127.0.0.1.evil.example:4321',
    })
    assert.equal(response.status, 403)

    response = await harness.request('GET', '/state', undefined, {
      host: '127.evil.example:4321',
      origin: 'http://127.evil.example:4321',
    })
    assert.equal(response.status, 403)

    response = await harness.request('GET', '/state', undefined, {
      origin: 'http://127.0.0.1:9999',
    })
    assert.equal(response.status, 403)

    response = await harness.request('GET', '/state', undefined, {
      origin: 'http://localhost:4321',
    })
    assert.equal(response.status, 403)

    response = await harness.request('GET', '/state', undefined, {
      'x-dsh-devbench': undefined,
    })
    assert.equal(response.status, 403)

    response = await harness.request('GET', '/state', undefined, {
      host: 'localhost:4321',
      origin: 'http://localhost:4321',
    })
    assert.equal(response.status, 200)

    response = await harness.request('OPTIONS', '/state')
    assert.equal(response.status, 204)
    assert.equal(response.headers['access-control-allow-origin'], undefined)
  } finally {
    await harness.close()
  }
})

test('JSON bodies must be plain objects', async function () {
  const harness = await createHarness([])
  try {
    const response = await harness.request('POST', '/config', null)
    assert.equal(response.status, 400)
    assert.equal(response.data.error.code, 'bad-body')
  } finally {
    await harness.close()
  }
})
