/** Inline stroke icons — no icon package, no host CSS class dependency. */

import { createElement as h } from 'react'

function svg(size, children, extra) {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      ...extra,
    },
    children,
  )
}

export function MailIcon({ size = 18 }) {
  return svg(size, [
    h('rect', { key: 'r', x: 3, y: 5, width: 18, height: 14, rx: 2.5 }),
    h('path', { key: 'p', d: 'm3.6 7 7.6 5.6a1.5 1.5 0 0 0 1.6 0L20.4 7' }),
  ])
}

export function GearIcon({ size = 16 }) {
  return svg(size, [
    h('path', {
      key: 'p',
      d: 'M19.5 12a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-2-1.2L14.6 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7.5 7.5 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z',
    }),
    h('circle', { key: 'c', cx: 12, cy: 12, r: 3.1 }),
  ])
}

export function SendIcon({ size = 16 }) {
  return svg(size, [h('path', { key: 'p', d: 'm4 12 16-7-6.2 16-2.6-6.6L4 12Z' })])
}

export function SearchIcon({ size = 14 }) {
  return svg(size, [h('circle', { key: 'c', cx: 11, cy: 11, r: 6.5 }), h('path', { key: 'p', d: 'm16 16 4.2 4.2' })])
}

export function TrashIcon({ size = 15 }) {
  return svg(size, [
    h('path', { key: 'a', d: 'M4 7h16' }),
    h('path', { key: 'b', d: 'M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7' }),
    h('path', { key: 'c', d: 'M6.3 7 7 19a1.6 1.6 0 0 0 1.6 1.5h6.8A1.6 1.6 0 0 0 17 19l.7-12' }),
  ])
}

export function ReplyIcon({ size = 15 }) {
  return svg(size, [h('path', { key: 'p', d: 'M9 7 4 12l5 5' }), h('path', { key: 'q', d: 'M4 12h9.5A6.5 6.5 0 0 1 20 18.5' })])
}

export function ForwardIcon({ size = 15 }) {
  return svg(size, [h('path', { key: 'p', d: 'm15 7 5 5-5 5' }), h('path', { key: 'q', d: 'M20 12H10.5A6.5 6.5 0 0 0 4 18.5' })])
}

export function PaperclipIcon({ size = 13 }) {
  return svg(size, [
    h('path', { key: 'p', d: 'M20 11.5 11.6 20a4.6 4.6 0 0 1-6.5-6.5l8.7-8.7a3.1 3.1 0 0 1 4.4 4.4l-8.7 8.7a1.6 1.6 0 0 1-2.2-2.2l7.9-7.9' }),
  ])
}

export function BackIcon({ size = 16 }) {
  return svg(size, [h('path', { key: 'p', d: 'M15 5l-7 7 7 7' })])
}

export function RefreshIcon({ size = 15 }) {
  return svg(size, [
    h('path', { key: 'a', d: 'M20 11a8 8 0 1 0-2.6 6.4' }),
    h('path', { key: 'b', d: 'M20 5v6h-6' }),
  ])
}

export function CopyIcon({ size = 13 }) {
  return svg(size, [
    h('rect', { key: 'r', x: 9, y: 9, width: 11, height: 11, rx: 2 }),
    h('path', { key: 'p', d: 'M6 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1' }),
  ])
}

export function CloseIcon({ size = 16 }) {
  return svg(size, [h('path', { key: 'a', d: 'm6 6 12 12M18 6 6 18' })])
}

export function CheckIcon({ size = 14 }) {
  return svg(size, [h('path', { key: 'a', d: 'm5 12.5 4.5 4.5L19 7' })])
}

export function DownloadIcon({ size = 13 }) {
  return svg(size, [h('path', { key: 'a', d: 'M12 4v11' }), h('path', { key: 'b', d: 'm8 11 4 4 4-4' }), h('path', { key: 'c', d: 'M5 19h14' })])
}

export function ImageIcon({ size = 14 }) {
  return svg(size, [
    h('rect', { key: 'r', x: 3, y: 5, width: 18, height: 14, rx: 2 }),
    h('circle', { key: 'c', cx: 8.5, cy: 10, r: 1.4 }),
    h('path', { key: 'p', d: 'm4 17 5-5 4 4 3-3 4 4' }),
  ])
}

export function FolderIcon({ size = 14 }) {
  return svg(size, [h('path', { key: 'p', d: 'M3.5 7.5A1.5 1.5 0 0 1 5 6h4l1.6 2H19a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5v-9Z' })])
}
