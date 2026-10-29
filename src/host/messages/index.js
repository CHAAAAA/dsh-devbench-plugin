import { messages as baseMessages } from './base.js'
import { extraMessages } from './extra.js'

export const messages = Object.freeze(Object.assign({}, baseMessages, extraMessages))
