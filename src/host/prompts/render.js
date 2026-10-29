/** Prompt placeholder renderer. Unknown placeholders are preserved. */
import { DEFAULT_PROMPT_TEMPLATE } from '../constants.js'

export function renderPrompt(template, values) {
  const source = typeof template === 'string' && template.length > 0
    ? template
    : DEFAULT_PROMPT_TEMPLATE
  return source.replace(/\{(\w+)\}/g, function (match, key) {
    if (Object.prototype.hasOwnProperty.call(values, key)) return String(values[key])
    return match
  })
}
