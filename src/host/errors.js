/**
 * Error types shared by the host domain and HTTP layers.
 */
export class ApiError extends Error {
  constructor(status, code, message, options = {}) {
    super(message, options)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function apiError(status, code, message) {
  return new ApiError(status, code, message)
}

export function isNotFound(error) {
  return Boolean(error && error.code === 'ENOENT')
}

export function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
