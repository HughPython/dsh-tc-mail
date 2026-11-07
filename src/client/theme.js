/**
 * Appearance settings -> CSS variables.
 *
 * Two facts learned from the running Harness, both easy to get wrong:
 *
 * 1. `--dsw-alias-*` are declared on `body`, not `:root`. Reading them from
 *    `document.documentElement` yields empty strings.
 * 2. `--dsw-alias-bg-base` is often a translucent glass value (skins set it to
 *    e.g. `rgba(21,17,14,.45)`). Used as-is the panel would show the desktop
 *    wallpaper through its own content, so the base is flattened against the
 *    opaque layer underneath it and the user's opacity slider then applies on
 *    top of that solid colour.
 */

const TOKENS = {
  bgBase: '--dsw-alias-bg-base',
  layer1: '--dsw-alias-bg-layer-1',
  layer2: '--dsw-alias-bg-layer-2',
  text: '--dsw-alias-label-primary',
  text2: '--dsw-alias-label-secondary',
  text3: '--dsw-alias-label-tertiary',
  border: '--dsw-alias-border-l1',
  border2: '--dsw-alias-border-l2',
  brand: '--dsw-alias-brand-primary',
  danger: '--dsw-alias-state-error-primary',
  hover: '--dsw-alias-interactive-bg-hover',
  active: '--dsw-alias-interactive-bg-active',
  onBrand: '--dsw-alias-label-primary-inverted',
  ok: '--dsw-alias-state-success-primary',
  warn: '--dsw-alias-state-warn-primary',
  mask: '--dsw-alias-bg-mask-1',
  scrollThumb: '--dsw-alias-scrollbar-bg-l2',
  scrollHover: '--dsw-alias-scrollbar-hover-l2',
  toastBg: '--dsw-alias-toast-bg',
  toastText: '--dsw-alias-toast-label',
  shadow: '--dsw-shadow-lv3',
}

export const FALLBACK_THEME = {
  bgBase: 'rgba(255, 255, 255, 1)',
  layer1: '#ffffff',
  layer2: '#f6f7f9',
  text: '#1a1a1a',
  text2: '#55595f',
  text3: '#8b8f96',
  border: 'rgba(0, 0, 0, 0.08)',
  border2: 'rgba(0, 0, 0, 0.12)',
  brand: '#1f7ae0',
  danger: '#d93f3f',
  hover: 'rgba(0, 0, 0, 0.045)',
  active: 'rgba(0, 0, 0, 0.075)',
  onBrand: '#ffffff',
  ok: '#23a06a',
  warn: '#d99b1f',
  mask: 'rgba(0, 0, 0, 0.45)',
  scrollThumb: 'rgba(0, 0, 0, 0.16)',
  scrollHover: 'rgba(0, 0, 0, 0.28)',
  toastBg: 'rgba(28, 28, 30, 0.95)',
  toastText: '#ffffff',
  shadow: '0 18px 48px rgba(0, 0, 0, 0.28)',
}

export function parseColor(input) {
  const value = String(input || '').trim()
  if (!value) return null
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }

  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)
  if (hex) {
    const raw = hex[1]
    if (raw.length === 3 || raw.length === 4) {
      const [r, g, b] = raw.slice(0, 3).split('').map((c) => parseInt(c + c, 16))
      const a = raw.length === 4 ? parseInt(raw[3] + raw[3], 16) / 255 : 1
      return { r, g, b, a }
    }
    if (raw.length === 6 || raw.length === 8) {
      return {
        r: parseInt(raw.slice(0, 2), 16),
        g: parseInt(raw.slice(2, 4), 16),
        b: parseInt(raw.slice(4, 6), 16),
        a: raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1,
      }
    }
    return null
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/i.exec(value)
  if (rgb) {
    const alphaRaw = rgb[4]
    const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? Number.parseFloat(alphaRaw) / 100 : Number(alphaRaw)
    return {
      r: Math.round(Number(rgb[1])),
      g: Math.round(Number(rgb[2])),
      b: Math.round(Number(rgb[3])),
      a: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1,
    }
  }

  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/i.exec(value)
  if (srgb) {
    return {
      r: Math.round(Number(srgb[1]) * 255),
      g: Math.round(Number(srgb[2]) * 255),
      b: Math.round(Number(srgb[3]) * 255),
      a: srgb[4] === undefined ? 1 : Number(srgb[4]),
    }
  }

  return null
}

export function toRgba(color, alpha) {
  const rgb = typeof color === 'string' ? parseColor(color) : color
  if (!rgb) return null
  const a = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : rgb.a))
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.round(a * 1000) / 1000})`
}

export function luminance(color) {
  const rgb = typeof color === 'string' ? parseColor(color) : color
  if (!rgb) return 0.5
  const channel = (value) => {
    const srgb = value / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/** Composite a possibly translucent colour over an opaque one. */
export function flatten(top, bottom) {
  const a = typeof top === 'string' ? parseColor(top) : top
  const b = typeof bottom === 'string' ? parseColor(bottom) : bottom
  if (!a) return b
  if (!b || a.a >= 1) return { ...a, a: 1 }
  const alpha = a.a
  return {
    r: Math.round(a.r * alpha + b.r * (1 - alpha)),
    g: Math.round(a.g * alpha + b.g * (1 - alpha)),
    b: Math.round(a.b * alpha + b.b * (1 - alpha)),
    a: 1,
  }
}

function readToken(name, root) {
  try {
    const raw = getComputedStyle(root).getPropertyValue(name).trim()
    if (!raw) return ''
    const nested = /^var\(\s*(--[\w-]+)/.exec(raw)
    if (nested) return readToken(nested[1], root)
    return raw
  } catch {
    return ''
  }
}

/**
 * Resolve the live theme. Reads from `document.body` (where the Harness
 * declares the aliases) and falls back to the token defaults from the
 * stylesheet when a token is missing.
 */
export function resolveTheme() {
  const root = typeof document !== 'undefined' && document.body ? document.body : null
  if (!root) return { ...FALLBACK_THEME }
  const theme = {}
  for (const [key, token] of Object.entries(TOKENS)) {
    theme[key] = readToken(token, root) || FALLBACK_THEME[key]
  }
  return theme
}

/** Use a token value only when it is a colour we can reason about. */
function pick(value, fallback) {
  return parseColor(value) ? value : fallback
}

export function hexOf(color) {
  const rgb = typeof color === 'string' ? parseColor(color) : color
  if (!rgb) return ''
  const part = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`
}

/**
 * @param {object} settings normalised settings from the host
 * @param {object} theme resolved theme tokens (see resolveTheme)
 * @returns {object} React inline style carrying concrete --tc-* values
 */
export function appearanceStyle(settings, theme) {
  const base = theme || FALLBACK_THEME
  const style = {
    '--tc-font-family': (settings && settings.font && settings.font.family) || 'var(--dsw-font-family, system-ui, sans-serif)',
    '--tc-text': (settings && settings.font && settings.font.color) || base.text,
    '--tc-text-2': base.text2,
    '--tc-text-3': base.text3,
    '--tc-border': base.border,
    '--tc-border-2': base.border2,
    '--tc-brand': base.brand,
    '--tc-danger': base.danger,
    '--tc-hover': base.hover,
    '--tc-active': base.active,
    '--tc-card': pick(base.layer1, FALLBACK_THEME.layer1),
    '--tc-card-2': pick(base.layer2, FALLBACK_THEME.layer2),
    /* Auxiliary surfaces are emitted as concrete values too: inside a portal
     * the Host's own tokens resolve to the skin's translucent glass variants,
     * which would make dialogs see-through. */
    '--tc-on-brand': pick(base.onBrand, FALLBACK_THEME.onBrand),
    '--tc-ok': pick(base.ok, FALLBACK_THEME.ok),
    '--tc-warn': pick(base.warn, FALLBACK_THEME.warn),
    '--tc-mask': pick(base.mask, FALLBACK_THEME.mask),
    '--tc-scroll-thumb': pick(base.scrollThumb, FALLBACK_THEME.scrollThumb),
    '--tc-scroll-hover': pick(base.scrollHover, FALLBACK_THEME.scrollHover),
    '--tc-toast-bg': pick(base.toastBg, FALLBACK_THEME.toastBg),
    '--tc-toast-text': pick(base.toastText, FALLBACK_THEME.toastText),
    '--tc-shadow': base.shadow && !base.shadow.startsWith('var(') ? base.shadow : FALLBACK_THEME.shadow,
  }

  if (settings && settings.font && settings.font.size) style['--tc-font-size'] = `${settings.font.size}px`
  if (settings && settings.surface && Number.isFinite(settings.surface.radius)) {
    style['--tc-radius'] = `${settings.surface.radius}px`
  }

  const opacity = settings && settings.surface && Number.isFinite(settings.surface.opacity) ? settings.surface.opacity : 1
  const custom = settings && settings.surface && settings.surface.color ? settings.surface.color : ''

  if (custom) {
    const solid = flatten(custom, base.layer1)
    const bg = toRgba(solid, opacity)
    if (bg) style['--tc-bg'] = bg
    style['--tc-card'] = toRgba(solid, Math.min(1, opacity + 0.3)) || base.layer1
    style['--tc-card-2'] = toRgba(solid, Math.min(1, opacity + 0.16)) || base.layer2
    if (!(settings.font && settings.font.color) && opacity >= 0.8) {
      style['--tc-text'] = luminance(solid) > 0.55 ? '#1a1a1a' : '#f4f4f5'
    }
  } else {
    // Flatten the glass base against the opaque layer beneath it, so the panel
    // reads as a surface instead of letting the wallpaper through its content.
    const solid = flatten(base.bgBase, base.layer1)
    const bg = toRgba(solid, opacity)
    if (bg) style['--tc-bg'] = bg
  }

  if (opacity < 1) style.backdropFilter = 'blur(18px) saturate(1.08)'
  return style
}

/** Colours offered as one-click swatches in the settings dialog. */
export const SWATCHES = ['#ffffff', '#f7f8fa', '#111827', '#1f2937', '#eef6ff', '#fdf6ec', '#ecfdf5']
export const TEXT_SWATCHES = ['#1a1a1a', '#374151', '#6b7280', '#111827', '#ffffff']
