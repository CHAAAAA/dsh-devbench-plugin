/** Request body parsing and explicit field validation helpers. */
import { MAX_BODY_BYTES } from '../constants.js'
import { apiError } from '../errors.js'
import { messages } from '../messages/index.js'
import { isPlainObject } from '../shared/path-safety.js'

export async function readJsonBody(req, maxBytes: any = undefined) {
  const limit = typeof maxBytes === 'number' ? maxBytes : MAX_BODY_BYTES
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > limit) throw apiError(413, 'body-too-large', messages.bodyTooLarge)
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw apiError(400, 'bad-json', messages.badJson)
  }
  if (isPlainObject(value) === false) {
    throw apiError(400, 'bad-body', messages.badBody)
  }
  return value
}

function invalidField(field) {
  const prefix = messages.invalidField || 'invalid field'
  return apiError(400, 'bad-field', prefix + ': ' + field)
}

export function readStringField(body, key, options: any = {}) {
  const value = body[key]
  function missing() {
    if (typeof options.missingCode === 'string') {
      return apiError(400, options.missingCode, options.missingMessage || messages.invalidField)
    }
    return invalidField(key)
  }
  if (value === undefined) {
    if (options.required === true) throw missing()
    return options.defaultValue === undefined ? '' : options.defaultValue
  }
  if (value === null) throw invalidField(key)
  if (typeof value !== 'string') throw invalidField(key)
  const text = options.trim === true ? value.trim() : value
  if (text.length === 0 && options.allowEmpty !== true) throw missing()
  if (typeof options.maxLength === 'number' && text.length > options.maxLength) {
    throw invalidField(key)
  }
  return text
}
