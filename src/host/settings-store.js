/**
 * Appearance + behaviour settings, persisted at `~/.dsh/tc-mail/settings.json`.
 *
 * Plugin-owned data lives under `~/.dsh/` (the convention every community
 * plugin follows) instead of the profile's `cordis.patch.yml`: the user's
 * patch layer holds other plugins' rows and `!!js` expressions and must not be
 * rewritten by a plugin for its own preferences.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const DATA_DIR = path.join(os.homedir(), '.dsh', 'tc-mail')
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
export const OPS_DIR = path.join(DATA_DIR, 'ops')
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')
export const DOWNLOADS_DIR = path.join(DATA_DIR, 'downloads')

export const DIRS = ['inbox', 'sent', 'trash', 'spam']
export const REFRESH_OPTIONS = [0, 30, 60, 300]

export const DEFAULT_SETTINGS = Object.freeze({
  font: { family: '', size: 14, color: '' },
  surface: { color: '', opacity: 1, radius: 12 },
  behavior: { dir: 'inbox', autoRefreshSec: 60, showImages: false, pageSize: 20 },
  advanced: { cliPath: '', workspace: '' },
})

const clamp = (value, min, max, fallback) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

const text = (value, fallback = '') => (typeof value === 'string' ? value.trim() : fallback)

/** Coerce arbitrary input into a valid settings object (never throws). */
export function normalizeSettings(input) {
  const source = input && typeof input === 'object' ? input : {}
  const font = source.font && typeof source.font === 'object' ? source.font : {}
  const surface = source.surface && typeof source.surface === 'object' ? source.surface : {}
  const behavior = source.behavior && typeof source.behavior === 'object' ? source.behavior : {}
  const advanced = source.advanced && typeof source.advanced === 'object' ? source.advanced : {}

  const opacity = Number(surface.opacity)
  const dir = DIRS.includes(behavior.dir) ? behavior.dir : DEFAULT_SETTINGS.behavior.dir
  const refresh = REFRESH_OPTIONS.includes(Number(behavior.autoRefreshSec))
    ? Number(behavior.autoRefreshSec)
    : DEFAULT_SETTINGS.behavior.autoRefreshSec

  return {
    font: {
      family: text(font.family),
      size: Math.round(clamp(font.size, 11, 22, DEFAULT_SETTINGS.font.size)),
      color: text(font.color),
    },
    surface: {
      color: text(surface.color),
      opacity: Number.isFinite(opacity) ? Math.round(clamp(opacity, 0, 1, 1) * 100) / 100 : DEFAULT_SETTINGS.surface.opacity,
      radius: Math.round(clamp(surface.radius, 0, 24, DEFAULT_SETTINGS.surface.radius)),
    },
    behavior: {
      dir,
      autoRefreshSec: refresh,
      showImages: Boolean(behavior.showImages),
      pageSize: Math.round(clamp(behavior.pageSize, 10, 50, DEFAULT_SETTINGS.behavior.pageSize)),
    },
    advanced: {
      cliPath: text(advanced.cliPath),
      workspace: text(advanced.workspace),
    },
  }
}

export function createSettingsStore({ logger } = {}) {
  let cache = null

  async function load() {
    if (cache) return cache
    try {
      const raw = await readFile(SETTINGS_FILE, 'utf8')
      cache = normalizeSettings(JSON.parse(raw))
    } catch {
      cache = normalizeSettings(DEFAULT_SETTINGS)
    }
    return cache
  }

  async function save(patch) {
    const current = await load()
    const next = normalizeSettings({
      font: { ...current.font, ...(patch && patch.font) },
      surface: { ...current.surface, ...(patch && patch.surface) },
      behavior: { ...current.behavior, ...(patch && patch.behavior) },
      advanced: { ...current.advanced, ...(patch && patch.advanced) },
    })
    await mkdir(DATA_DIR, { recursive: true })
    const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    await rename(tmp, SETTINGS_FILE)
    cache = next
    return next
  }

  async function reset() {
    cache = normalizeSettings(DEFAULT_SETTINGS)
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(SETTINGS_FILE, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
    return cache
  }

  function peek() {
    return cache || normalizeSettings(DEFAULT_SETTINGS)
  }

  return { load, save, reset, peek, file: SETTINGS_FILE }
}
