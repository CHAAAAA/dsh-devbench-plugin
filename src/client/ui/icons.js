/** Inline SVG icons that follow currentColor. */
import { h } from '../runtime.js'
export function Svg(props) {
  return h('svg', {
    viewBox: '0 0 24 24',
    width: props.size || 16,
    height: props.size || 16,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    style: { display: 'block', flex: '0 0 auto', pointerEvents: 'none' },
  }, props.children)
}
export function IconPlus() { return h(Svg, null, h('path', { d: 'M12 5v14M5 12h14' })) }
export function IconRefresh() { return h(Svg, null, h('path', { d: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6' })) }
export function IconBack() { return h(Svg, null, h('path', { d: 'M15 18l-6-6 6-6' })) }
export function IconPlay() { return h(Svg, null, h('path', { d: 'M8 5l11 7-11 7V5z' })) }
export function IconSettings() {
  return h(Svg, null,
    h('circle', { cx: 12, cy: 12, r: 3 }),
    h('path', {
      d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    }))
}
export function IconHome() {
  return h(Svg, null, h('path', { d: 'M3 10.6 12 3.5l9 7.1V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1v-9.4z' }))
}
export function IconWorktree() {
  return h(Svg, null,
    h('circle', { cx: 6.5, cy: 5, r: 2.2 }),
    h('circle', { cx: 6.5, cy: 19, r: 2.2 }),
    h('circle', { cx: 17.5, cy: 12, r: 2.2 }),
    h('path', { d: 'M6.5 7.2v9.6M8.7 5h3.8a3 3 0 0 1 3 3v1.8' }))
}
/** Server stack, used by the MCP management entry and overview panel. */
export function IconServer(props) {
  return h(Svg, { size: props && props.size ? props.size : 16 },
    h('rect', { x: 3.5, y: 4.5, width: 17, height: 6, rx: 2 }),
    h('rect', { x: 3.5, y: 13.5, width: 17, height: 6, rx: 2 }),
    h('path', { d: 'M7 7.5h.01M7 16.5h.01' }))
}
export function IconFolder() {
  return h(Svg, null, h('path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z' }))
}
export function IconFile() {
  return h(Svg, null, h('path', { d: 'M7 3.5h7L18 8v12.5H7z' }), h('path', { d: 'M14 3.5V8h4' }))
}
export function IconTrash() {
  return h(Svg, null, h('path', { d: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5' }))
}
export function IconExternal() {
  return h(Svg, null, h('path', { d: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }))
}
export function IconLink() {
  return h(Svg, null, h('path', { d: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.5 1.5M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.5-1.5' }))
}
export function IconCheck() { return h(Svg, null, h('path', { d: 'M5 12.5l4.5 4.5L19 7.5' })) }
/** Five-pointed star; `filled` renders a solid bookmark star (favorite state). */
export function IconStar(props) {
  const filled = Boolean(props && props.filled === true)
  const size = props && props.size ? props.size : 15
  return h(Svg, { size: size }, h('path', {
    d: 'M12 3.6l2.6 5.35 5.9.86-4.27 4.16 1.01 5.87L12 16.97l-5.24 2.87 1.01-5.87-4.27-4.16 5.9-.86z',
    fill: filled ? 'currentColor' : 'none',
  }))
}
export function IconArrow() { return h(Svg, null, h('path', { d: 'M9 18l6-6-6-6' })) }
/** VS Code-style code brackets, used by the "open project in editor" action. */
export function IconCode() {
  return h(Svg, null, h('path', { d: 'M9 7l-5 5 5 5M15 7l5 5-5 5' }))
}
/** Terminal window, used by the "open project in iTerm" action. */
export function IconTerminal() {
  return h(Svg, null,
    h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5 }),
    h('path', { d: 'M7.5 9.5l3 2.5-3 2.5M13.5 15h3.5' }))
}
/** Requirement clipboard icon, still used by the conversation-header requirement action. */
export function IconReq(props) {
  return h('svg', {
    viewBox: '0 0 24 24', width: props.size || 18, height: props.size || 18,
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    style: { display: 'block', pointerEvents: 'none' },
  },
  h('rect', { x: 5.2, y: 4.2, width: 13.6, height: 17, rx: 2.8 }),
  h('rect', { x: 9.1, y: 2.6, width: 5.8, height: 3, rx: 1 }),
  h('path', { d: 'M8.8 11.6l1.5 1.5 2.7-2.9' }),
  h('path', { d: 'M13.4 13.1h3.1M8.8 16.6h7.7M8.8 19.1h4.8' }))
}
/** Sidebar panel with an arrow that points toward the collapse/expand action. */
export function IconLayoutSidebar(props) {
  const collapsed = props && props.collapsed === true
  const size = props && props.size ? props.size : 16
  return h(Svg, { size: size },
    h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5 }),
    h('path', { d: 'M9 4.5v15' }),
    h('path', { d: collapsed ? 'M13 9.5l2.5 2.5-2.5 2.5' : 'M15.5 9.5L13 12l2.5 2.5' }))
}
/** Workbench panel icon: a left rail plus content area, i.e. the three-pane workbench. */
export function IconDevbench(props) {
  return h(Svg, { size: props && props.size ? props.size : 18 },
    h('rect', { x: 3.4, y: 4.2, width: 17.2, height: 15.6, rx: 2.6 }),
    h('path', { d: 'M9.6 4.2v15.6' }))
}
export function IconEdit() {
  return h(Svg, null,
    h('path', { d: 'M4 20h4.2L19 9.2 14.8 5 4 15.8V20z' }),
    h('path', { d: 'M12.8 7l4.2 4.2' }))
}
export function IconMaximize() {
  return h(Svg, null,
    h('path', { d: 'M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5' }))
}
export function IconMinimize() {
  return h(Svg, null,
    h('path', { d: 'M4 9h5V4M20 9h-5V4M15 20v-5h5M9 20v-5H4' }))
}
export function IconChevron(props) {
  const path = props.open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'
  return h(Svg, { size: props.size || 12 }, h('path', { d: path }))
}
export function IconCollapseAll() {
  return h(Svg, null, h('path', { d: 'M6 14l6-5 6 5M6 19l6-5 6 5' }))
}
export function IconExpandAll() {
  return h(Svg, null, h('path', { d: 'M6 10l6 5 6-5M6 5l6 5 6-5' }))
}
export function DevbenchIcon(props) {
  return h(IconDevbench, { size: props && props.size ? props.size : 18 })
}
