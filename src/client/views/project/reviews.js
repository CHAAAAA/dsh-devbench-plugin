/** Project reviews: master-detail list with search + Markdown preview. */
import { h } from '../../runtime.js'
import { useUiState, setListState } from '../../core/ui-store.js'
import { ListFooter, useListPage } from '../../ui/list-page.js'
import { Banner } from '../../ui/common.js'
import { renderMarkdown } from '../../ui/markdown.js'
function formatDate(value) {
  if (value === undefined || value === null || value === '') return ''
  try { return new Date(value).toLocaleString() } catch (err) { return String(value) }
}
function activateOnKey(event, handler) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    handler()
  }
}
export function ProjectReviews(props) {
  const t = props.t
  const reviews = Array.isArray(props.reviews) ? props.reviews : []
  const ui = useUiState()
  const lists = ui.lists || {}
  const savedSearch = (lists.reviews && lists.reviews.search) || ''
  const selectedName = props.selectedName || ''
  const content = props.content || { loading: false, error: '', data: null }
  const selectedReview = props.selectedReview || null
  const query = String(savedSearch).trim().toLowerCase()
  const filtered = query === '' ? reviews : reviews.filter(function (review) {
    const text = [
      review.name, review.commit, review.commitSubject, review.summary,
      review.target === 'uncommitted' ? t('project.review.uncommittedTarget') : '',
    ].join(' ').toLowerCase()
    return text.indexOf(query) >= 0
  })
  const page = useListPage(filtered)
  function changeSearch(event) {
    setListState('reviews', { search: event.target.value })
    page.reset()
  }
  function openReview(review) {
    if (typeof props.onOpen === 'function') props.onOpen(review)
  }
  const rows = page.rows.map(function (review) {
    const active = selectedName !== '' && review.name === selectedName
    const uncommitted = review.target === 'uncommitted'
    return h('div', {
      key: review.name,
      className: 'devbench-master-row' + (active ? ' active' : ''),
      role: 'button',
      tabIndex: 0,
      'aria-pressed': active ? 'true' : 'false',
      title: review.name,
      onClick() { openReview(review) },
      onKeyDown(event) { activateOnKey(event, function () { openReview(review) }) },
    },
    h('div', { className: 'devbench-master-row-main' },
      h('div', { className: 'devbench-master-row-title', title: review.name }, review.name),
      h('div', { className: 'devbench-master-row-meta' },
        h('span', { className: 'devbench-mono' },
          uncommitted ? t('project.review.uncommittedTarget') : String(review.commit || '').slice(0, 8)),
        h('span', null, formatDate(review.modifiedAt)),
        review.summary
          ? h('span', { className: 'devbench-overview-review-subject', title: review.summary }, review.summary)
          : null)))
  })
  let listContent
  if (reviews.length === 0) {
    listContent = h('div', { className: 'devbench-empty-panel' }, t('project.review.empty'))
  } else if (filtered.length === 0) {
    listContent = h('div', { className: 'devbench-empty-panel' }, t('tabs.reviews.noMatch'))
  } else {
    listContent = rows
  }
  const pager = page.total > page.size
    ? h('div', { className: 'devbench-master-list-foot' }, h(ListFooter, { t: t, page: page }))
    : null
  let detail
  if (selectedName === '') {
    detail = h('div', { className: 'devbench-master-empty' },
      h('div', null, t('project.review.selectHint')))
  } else {
    let body
    if (content.loading) {
      body = h('div', { className: 'devbench-inline-loading' }, t('project.review.loading'))
    } else if (content.error) {
      body = h('div', null,
        h(Banner, { kind: 'error' }, content.error),
        h('button', {
          className: 'devbench-btn',
          onClick() { if (typeof props.onRetry === 'function') props.onRetry() },
        }, t('panel.retry')))
    } else if (content.data) {
      const data = content.data
      const fallback = selectedReview || {}
      const meta = {
        name: data.name || fallback.name || selectedName,
        commit: data.commit || fallback.commit || '',
        commitSubject: data.commitSubject || fallback.commitSubject || '',
        target: data.target || fallback.target || 'commit',
        modifiedAt: data.modifiedAt || fallback.modifiedAt || '',
        size: data.size === undefined ? fallback.size : data.size,
      }
      const uncommitted = meta.target === 'uncommitted'
      detail = h('div', { className: 'devbench-master-detail' },
        h('div', { className: 'devbench-master-detail-head' },
          h('div', { className: 'devbench-data-title', title: meta.name, style: { fontSize: '15px', fontWeight: 600 } }, meta.name),
          h('div', { className: 'devbench-review-meta' },
            h('span', { className: 'devbench-mono' },
              uncommitted ? t('project.review.uncommittedTarget') : String(meta.commit || '').slice(0, 8)),
            meta.commitSubject !== ''
              ? h('span', { className: 'devbench-overview-review-subject', title: meta.commitSubject },
                meta.commitSubject)
              : null,
            h('span', null, formatDate(meta.modifiedAt)),
            meta.size === undefined ? null : h('span', { className: 'devbench-muted' }, String(meta.size) + ' B'))),
        h('div', { className: 'devbench-master-detail-body' },
          h('div', { className: 'devbench-md' }, renderMarkdown(data.content))))
      return h('div', { className: 'devbench-master' },
        h('div', { className: 'devbench-master-list' },
          listHead(),
          h('div', { className: 'devbench-master-list-body' }, listContent),
          pager),
        detail)
    } else {
      body = h('div', { className: 'devbench-empty-panel' }, t('project.review.selectHint'))
    }
    detail = h('div', { className: 'devbench-master-detail' },
      h('div', { className: 'devbench-master-detail-head' },
        h('div', { className: 'devbench-data-title', title: selectedName, style: { fontSize: '15px', fontWeight: 600 } }, selectedName)),
      h('div', { className: 'devbench-master-detail-body' }, body))
  }
  function listHead() {
    return h('div', { className: 'devbench-master-list-head' },
      h('div', { className: 'devbench-master-list-title' },
        h('span', null, t('project.tab.reviews')),
        h('span', { className: 'spacer' }),
        h('span', { className: 'devbench-muted' }, t('tabs.listCount', { count: filtered.length }))),
      h('input', {
        className: 'devbench-input',
        style: { fontSize: '12px', padding: '5px 8px' },
        placeholder: t('tabs.reviews.search'),
        'aria-label': t('tabs.reviews.search'),
        value: savedSearch,
        onChange: changeSearch,
      }))
  }
  return h('div', { className: 'devbench-master' },
    h('div', { className: 'devbench-master-list' },
      listHead(),
      h('div', { className: 'devbench-master-list-body' }, listContent),
      pager),
    detail)
}
