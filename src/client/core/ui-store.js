/** Global panel selection, view history and list UI state. Remote data stays out. */
import { useSyncExternalStore } from '../runtime.js'

const EMPTY_SELECTION = {
  commits: null,
  worktrees: null,
  reviews: null,
  tasks: null,
}
const EMPTY_LISTS = {
  requirements: { search: '', status: 'all', scope: 'title', limit: 10, scrollTop: 0 },
  tasks: { status: 'all', kind: 'all', limit: 10, scrollTop: 0 },
  reviews: { search: '', limit: 10, scrollTop: 0 },
  commits: { scrollTop: 0 },
  worktrees: { scrollTop: 0 },
}
const initial = {
  view: 'home',
  selectedProjectId: null,
  selectedRequirement: null,
  activeTab: 'overview',
  linkSessionId: null,
  history: [],
  selection: Object.assign({}, EMPTY_SELECTION),
  lists: Object.assign({}, EMPTY_LISTS),
  revision: 0,
}
function notify() {
  uiStore.listeners.forEach(function (listener) { listener() })
}
function viewSnapshot(state) {
  return {
    view: state.view,
    selectedProjectId: state.selectedProjectId,
    selectedRequirement: state.selectedRequirement,
    activeTab: state.activeTab,
    linkSessionId: state.linkSessionId,
  }
}
function cloneEmpty(value) {
  return JSON.parse(JSON.stringify(value))
}
export const uiStore = {
  state: Object.assign({}, initial, {
    selection: cloneEmpty(EMPTY_SELECTION),
    lists: cloneEmpty(EMPTY_LISTS),
  }),
  listeners: new Set(),
  set(patch) {
    uiStore.state = Object.assign({}, uiStore.state, patch, {
      revision: uiStore.state.revision + 1,
    })
    notify()
  },
  /** Record the current view snapshot and switch to a new view. */
  enterView(patch) {
    const history = uiStore.state.history.concat([viewSnapshot(uiStore.state)]).slice(-30)
    uiStore.state = Object.assign({}, uiStore.state, patch, {
      history: history,
      revision: uiStore.state.revision + 1,
    })
    notify()
  },
  /** Restore the last view; falls back to the supplied patch when no history exists. */
  back(fallbackPatch) {
    const history = (uiStore.state.history || []).slice()
    const previous = history.pop()
    const next = previous || fallbackPatch || { view: 'home', selectedRequirement: null }
    uiStore.state = Object.assign({}, uiStore.state, next, {
      history: history,
      revision: uiStore.state.revision + 1,
    })
    notify()
    return previous !== undefined
  },
  subscribe(listener) {
    uiStore.listeners.add(listener)
    return function () { uiStore.listeners.delete(listener) }
  },
  snapshot() { return uiStore.state },
}
export function useUiState() {
  return useSyncExternalStore(uiStore.subscribe, uiStore.snapshot, uiStore.snapshot)
}
export function setSelection(tab, value) {
  if (!Object.prototype.hasOwnProperty.call(EMPTY_SELECTION, tab)) return
  const selection = Object.assign({}, uiStore.state.selection)
  selection[tab] = value
  uiStore.set({ selection: selection })
}
export function setListState(tab, patch) {
  if (!Object.prototype.hasOwnProperty.call(EMPTY_LISTS, tab)) return
  const lists = Object.assign({}, uiStore.state.lists)
  const current = lists[tab] || {}
  lists[tab] = Object.assign({}, current, patch)
  uiStore.set({ lists: lists })
}
export function resetListState(tab) {
  if (!Object.prototype.hasOwnProperty.call(EMPTY_LISTS, tab)) return
  const lists = Object.assign({}, uiStore.state.lists)
  lists[tab] = Object.assign({}, cloneEmpty(EMPTY_LISTS[tab]))
  uiStore.set({ lists: lists })
}
export function resetUiStore() {
  uiStore.state = Object.assign({}, initial, {
    selection: cloneEmpty(EMPTY_SELECTION),
    lists: cloneEmpty(EMPTY_LISTS),
    history: [],
    revision: uiStore.state.revision + 1,
  })
  notify()
}
