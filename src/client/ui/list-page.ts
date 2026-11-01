/** Client-side incremental pagination shared by the workbench list views. */
import { h, useState } from '../runtime.js'

/** Rows rendered per list page; every paged list starts with exactly one page. */
export const LIST_PAGE_SIZE = 10

/**
 * Keep a list's visible-row count in component state. Project requirements,
 * reviews and tasks are already loaded by /state or /project/overview, so
 * "load more" reveals the next page locally instead of issuing another request.
 */
export function useListPage(items, pageSize?) {
  const size = pageSize === undefined ? LIST_PAGE_SIZE : pageSize
  const [limit, setLimit] = useState(size)
  const list = Array.isArray(items) ? items : []
  const rows = list.slice(0, limit)
  return {
    rows: rows,
    total: list.length,
    listed: rows.length,
    size: size,
    hasMore: list.length > rows.length,
    loadMore() {
      setLimit(function (value) { return value + size })
    },
    reset() {
      setLimit(size)
    },
  }
}

/** Footer for a client-paged list: hidden until the list exceeds one page. */
export function ListFooter(props) {
  const t = props.t
  const page = props.page
  if (!page || typeof page.loadMore !== 'function') return null
  if (page.total <= page.size) return null
  if (page.hasMore) {
    return h('div', { className: 'devbench-load-more' },
      h('button', {
        className: 'devbench-btn',
        type: 'button',
        onClick() { page.loadMore() },
      }, t('list.loadMore', { count: page.listed })))
  }
  return h('div', {
    className: 'devbench-hint',
    style: { textAlign: 'center', marginTop: '8px' },
  }, t('list.shownAll', { total: page.total }))
}
