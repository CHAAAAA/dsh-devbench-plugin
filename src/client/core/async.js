/** Concurrency primitives: request generations, keyed single-flight, serial queue. */
export function createLatestRequest() {
  let seq = 0
  return {
    next() { seq += 1; return seq },
    current(token) { return token === seq },
    invalidate() { seq += 1 },
  }
}
export function createSingleFlight() {
  const inflight = new Map()
  return {
    run(key, factory) {
      if (inflight.has(key)) return inflight.get(key)
      const promise = Promise.resolve().then(factory).finally(function () {
        inflight.delete(key)
      })
      inflight.set(key, promise)
      return promise
    },
    has(key) { return inflight.has(key) },
  }
}
export function createSerialQueue() {
  let tail = Promise.resolve()
  return function enqueue(task) {
    const run = tail.then(task, task)
    tail = run.catch(function () {})
    return run
  }
}
export function pathInside(root, child) {
  if (!root || !child) return false
  if (child === root) return true
  return child.indexOf(root + '/') === 0
}
