/** Merge host hits with local summaries without changing hit order. */
export function mergeSearchItems<Hit extends { id: string }, Summary extends { id: string }>(
  items: readonly Hit[], summaries: readonly Summary[],
): Array<Hit & Partial<Summary>> {
  const local = new Map<string, Summary>()
  for (const item of Array.isArray(summaries) ? summaries : []) {
    if (item && item.id) local.set(item.id, item)
  }
  const seen = new Set<string>()
  const merged: Array<Hit & Partial<Summary>> = []
  for (const hit of Array.isArray(items) ? items : []) {
    if (!hit || !hit.id || seen.has(hit.id)) continue
    seen.add(hit.id)
    const summary = local.get(hit.id)
    merged.push(summary ? { ...summary, ...hit } : hit)
  }
  return merged
}

export type SearchEvent<T> =
  | { type: 'start'; query: string }
  | { type: 'success'; query: string; value: T }
  | { type: 'error'; query: string; error: unknown }

export interface FullTextSearch<T> {
  schedule(workspaceId: string, query: string): void
  run(workspaceId: string, query: string): Promise<T | null>
  cancel(): void
  pending(): boolean
}

/** Debounce input and discard responses invalidated by cancellation or a newer request. */
export function createFullTextSearch<T, Timer = ReturnType<typeof setTimeout>>(options: {
  search(workspaceId: string, query: string): Promise<T>
  onEvent?(event: SearchEvent<T>): void
  delay?: number
  timers?: {
    setTimeout(callback: () => void, delay: number): Timer
    clearTimeout(timer: Timer): void
  }
}): FullTextSearch<T> {
  const delay = Number(options.delay) > 0 ? Number(options.delay) : 250
  let clearPending: (() => void) | null = null
  let seq = 0
  function cancelTimer(): void {
    clearPending?.()
    clearPending = null
  }
  function start(workspaceId: string, query: string): Promise<T | null> {
    const token = ++seq
    options.onEvent?.({ type: 'start', query })
    return Promise.resolve().then(() => options.search(workspaceId, query)).then(value => {
      if (token !== seq) return null
      options.onEvent?.({ type: 'success', query, value })
      return value
    }, (error: unknown) => {
      if (token !== seq) return null
      options.onEvent?.({ type: 'error', query, error })
      return null
    })
  }
  return {
    schedule(workspaceId, query) {
      cancelTimer()
      const trimmed = String(query ?? '').trim()
      if (!workspaceId || trimmed === '') return
      const callback = () => {
        clearPending = null
        void start(workspaceId, trimmed)
      }
      if (options.timers) {
        const timer = options.timers.setTimeout(callback, delay)
        clearPending = () => options.timers.clearTimeout(timer)
      } else {
        const timer = setTimeout(callback, delay)
        clearPending = () => clearTimeout(timer)
      }
    },
    run(workspaceId, query) {
      cancelTimer()
      const trimmed = String(query ?? '').trim()
      return workspaceId && trimmed !== '' ? start(workspaceId, trimmed) : Promise.resolve(null)
    },
    cancel() {
      cancelTimer()
      seq += 1
    },
    pending() { return clearPending !== null },
  }
}
