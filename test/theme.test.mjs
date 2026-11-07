import assert from 'node:assert/strict'
import test from 'node:test'

import { FALLBACK_THEME, flatten, luminance, parseColor, toRgba } from '../src/client/theme.js'

test('parseColor reads hex, rgb and srgb forms', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 })
  assert.deepEqual(parseColor('#1f7ae0'), { r: 31, g: 122, b: 224, a: 1 })
  assert.deepEqual(parseColor('rgba(21, 17, 14, 0.45)'), { r: 21, g: 17, b: 14, a: 0.45 })
  assert.deepEqual(parseColor('rgb(21 17 14)'), { r: 21, g: 17, b: 14, a: 1 })
  assert.deepEqual(parseColor('color(srgb 0.5 0.5 0.5)'), { r: 128, g: 128, b: 128, a: 1 })
})

test('parseColor rejects colour-mix and empty values', () => {
  assert.equal(parseColor('color-mix(in srgb, #2c2c2e 45%, transparent)'), null)
  assert.equal(parseColor(''), null)
  assert.equal(parseColor(undefined), null)
})

test('flatten composites a translucent colour over an opaque one', () => {
  const result = flatten('rgba(255, 255, 255, 0.5)', '#000000')
  assert.equal(result.r, 128)
  assert.equal(result.a, 1)
  assert.equal(flatten('#123456', '#ffffff').r, 0x12)
})

test('toRgba carries alpha and clamps it', () => {
  assert.equal(toRgba('#ffffff', 1), 'rgba(255, 255, 255, 1)')
  assert.equal(toRgba('#ffffff', 0.5), 'rgba(255, 255, 255, 0.5)')
  assert.equal(toRgba('#ffffff', 5), 'rgba(255, 255, 255, 1)')
  assert.equal(toRgba('#ffffff', -2), 'rgba(255, 255, 255, 0)')
})

test('luminance ranks light above dark', () => {
  assert.ok(luminance('#ffffff') > luminance('#000000'))
  assert.ok(luminance('#f7f8fa') > 0.5)
})

test('the fallback theme is fully resolvable', () => {
  for (const key of ['bgBase', 'layer1', 'layer2', 'text', 'text2', 'text3', 'border', 'brand']) {
    assert.ok(parseColor(FALLBACK_THEME[key]), `missing colour for ${key}`)
  }
})
