import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_SETTINGS, normalizeSettings } from '../src/host/settings-store.js'

test('normalizeSettings returns defaults for empty input', () => {
  const result = normalizeSettings(undefined)
  assert.deepEqual(result, { ...DEFAULT_SETTINGS, font: { ...DEFAULT_SETTINGS.font }, surface: { ...DEFAULT_SETTINGS.surface }, behavior: { ...DEFAULT_SETTINGS.behavior }, advanced: { ...DEFAULT_SETTINGS.advanced } })
})

test('normalizeSettings clamps numeric ranges', () => {
  const result = normalizeSettings({
    font: { size: 99 },
    surface: { opacity: 3, radius: -5 },
    behavior: { pageSize: 500 },
  })
  assert.equal(result.font.size, 22)
  assert.equal(result.surface.opacity, 1)
  assert.equal(result.surface.radius, 0)
  assert.equal(result.behavior.pageSize, 50)
})

test('normalizeSettings rejects unknown folders and refresh intervals', () => {
  const result = normalizeSettings({ behavior: { dir: 'archive', autoRefreshSec: 7 } })
  assert.equal(result.behavior.dir, 'inbox')
  assert.equal(result.behavior.autoRefreshSec, 60)
})

test('normalizeSettings keeps valid values and coerces types', () => {
  const result = normalizeSettings({
    font: { family: '  "Microsoft YaHei"  ', size: '16', color: '#ff0000' },
    surface: { color: '#101010', opacity: 0.42, radius: 8 },
    behavior: { dir: 'trash', autoRefreshSec: 30, showImages: 'yes', pageSize: 30 },
    advanced: { cliPath: 'C:/bin/agently-cli.exe', workspace: 'work' },
  })
  assert.equal(result.font.family, '"Microsoft YaHei"')
  assert.equal(result.font.size, 16)
  assert.equal(result.surface.opacity, 0.42)
  assert.equal(result.behavior.dir, 'trash')
  assert.equal(result.behavior.autoRefreshSec, 30)
  assert.equal(result.behavior.showImages, true)
  assert.equal(result.advanced.workspace, 'work')
})

test('normalizeSettings drops unknown keys', () => {
  const result = normalizeSettings({ somethingElse: 1, font: { bogus: true } })
  assert.equal('somethingElse' in result, false)
  assert.equal('bogus' in result.font, false)
})
