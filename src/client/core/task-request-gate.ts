export function createTaskRequestGate() {
  let current = null
  return {
    begin() {
      if (current !== null) return null
      current = new AbortController()
      return current
    },
    stop() {
      const active = current
      current = null
      if (active !== null) active.abort()
    },
    finish(controller) {
      if (current === controller) current = null
    },
    active() { return current !== null },
  }
}
