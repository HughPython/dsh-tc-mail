import assert from 'node:assert/strict'
import test from 'node:test'

import { __test__ } from '../src/host/cli.js'

const { parseJson, firstErrorLine } = __test__

test('parseJson accepts a clean document', () => {
  assert.deepEqual(parseJson('{"ok":true,"data":[]}'), { ok: true, data: [] })
})

test('parseJson strips a BOM and surrounding noise', () => {
  assert.deepEqual(parseJson('\uFEFF{"ok":true}'), { ok: true })
  assert.deepEqual(parseJson('tip: something\n{"ok":true,"data":1}\n'), { ok: true, data: 1 })
})

test('parseJson returns null for non-JSON output', () => {
  assert.equal(parseJson(''), null)
  assert.equal(parseJson('   '), null)
  assert.equal(parseJson('not json at all'), null)
})

test('firstErrorLine prefers the Error: line over tips', () => {
  assert.equal(firstErrorLine('tip: hello\nError: --limit must be between 1 and 50\n'), '--limit must be between 1 and 50')
  assert.equal(firstErrorLine('tip: only a tip\n'), 'tip: only a tip')
  assert.equal(firstErrorLine(''), '')
})
