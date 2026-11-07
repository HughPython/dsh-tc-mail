/**
 * Mail bodies are untrusted third-party HTML rendered inside the Harness
 * window, and that window exposes `window.dshDesktop` (file read/write). A
 * sanitizer hole is therefore a local-file risk, so the body gets two layers:
 *
 *   1. this allowlist pass, run on an inert DOMParser document (no scripts run,
 *      no images load);
 *   2. a sandboxed iframe without `allow-scripts` or `allow-same-origin`, plus
 *      a restrictive CSP inside the document.
 *
 * `<style>` is kept: transactional mail relies on it for layout, and inside a
 * script-less, network-less sandbox CSS is not an escape vector.
 */

const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'param',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'optgroup',
  'link',
  'meta',
  'base',
  'svg',
  'math',
  'template',
  'video',
  'audio',
  'source',
  'track',
  'portal',
])

const BLOCKED_ATTRS = new Set([
  'srcdoc',
  'formaction',
  'action',
  'ping',
  'poster',
  'dynsrc',
  'lowsrc',
  'srcset',
  'xlink:href',
  'contenteditable',
  'autofocus',
])

const SAFE_LINK = /^(https?:\/\/|mailto:|tel:)/i
const SAFE_IMAGE = /^(https?:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i

export function safeUrl(value, { image = false } = {}) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('#')) return trimmed
  const compact = trimmed.replace(/[\u0000-\u0020]/g, '')
  if (/^https?:\/\//i.test(compact)) return trimmed
  if (!image && SAFE_LINK.test(compact)) return trimmed
  if (image && SAFE_IMAGE.test(compact)) return trimmed
  return ''
}

function cleanStyleValue(value) {
  return String(value || '')
    .replace(/expression\s*\(/gi, '')
    .replace(/url\s*\(\s*['"]?\s*(javascript|vbscript|data:text\/html)[^)]*\)/gi, 'none')
}

function cleanStyleSheet(css) {
  return String(css || '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/url\s*\(\s*['"]?\s*(javascript|vbscript)[^)]*\)/gi, 'none')
}

function walk(node, state) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 8) {
      child.remove()
      continue
    }
    if (child.nodeType !== 1) continue

    const tag = child.tagName.toLowerCase()
    if (FORBIDDEN_TAGS.has(tag)) {
      child.remove()
      continue
    }
    if (tag === 'img' && !state.showImages) {
      child.remove()
      continue
    }
    if (tag === 'style') {
      child.textContent = cleanStyleSheet(child.textContent)
      continue
    }

    for (const attribute of Array.from(child.attributes)) {
      const name = attribute.name.toLowerCase()

      if (name.startsWith('on') || BLOCKED_ATTRS.has(name)) {
        child.removeAttribute(attribute.name)
        continue
      }
      if (name === 'href' || name === 'src') {
        const safe = safeUrl(attribute.value, { image: name === 'src' })
        if (safe) child.setAttribute(attribute.name, safe)
        else child.removeAttribute(attribute.name)
        continue
      }
      if (name === 'style') {
        child.setAttribute('style', cleanStyleValue(attribute.value))
        continue
      }
      if (name === 'background') {
        const safe = safeUrl(attribute.value, { image: true })
        if (safe) child.setAttribute('background', safe)
        else child.removeAttribute('background')
      }
    }

    if (tag === 'a') {
      child.setAttribute('target', '_blank')
      child.setAttribute('rel', 'noopener noreferrer')
    }

    walk(child, state)
  }
}

const BASE_STYLE = `
:root { color-scheme: light; }
html, body { margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px; line-height: 1.6; word-break: break-word; overflow-wrap: anywhere; }
img { max-width: 100%; height: auto; }
table { max-width: 100%; }
pre { white-space: pre-wrap; }
a { color: #1f7ae0; }
`

function cspFor(showImages) {
  const images = showImages ? "data: https: http:" : 'data:'
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    'font-src data:',
    `img-src ${images}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

/**
 * Produce a self-contained, sandbox-safe document string for `<iframe srcdoc>`.
 */
export function buildMailDocument({ html, showImages = false } = {}) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')

  for (const node of Array.from(doc.querySelectorAll('meta, base, link'))) node.remove()
  walk(doc, { showImages: Boolean(showImages) })

  const root = doc.documentElement
  let head = doc.head
  if (!head) {
    head = doc.createElement('head')
    root.insertBefore(head, root.firstChild)
  }

  const csp = doc.createElement('meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', cspFor(showImages))
  head.insertBefore(csp, head.firstChild)

  const viewport = doc.createElement('meta')
  viewport.setAttribute('name', 'viewport')
  viewport.setAttribute('content', 'width=device-width, initial-scale=1')
  head.appendChild(viewport)

  const base = doc.createElement('base')
  base.setAttribute('target', '_blank')
  head.appendChild(base)

  const style = doc.createElement('style')
  style.textContent = BASE_STYLE
  head.appendChild(style)

  if (!doc.body) {
    const body = doc.createElement('body')
    root.appendChild(body)
  }

  return `<!doctype html>${root.outerHTML}`
}

/** Strip tags for list previews and tool output. */
export function toPlainText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
