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

/* ---------------------------------------------------------------- *
 * CLI discovery: the scoped platform package is the whole point.
 * ---------------------------------------------------------------- */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { __test__ as cliInternals } from '../src/host/cli.js'

const { describePrefix } = cliInternals

function platformDir() {
  return `agently-cli-${process.platform}-${process.arch}`
}

function binaryName() {
  return process.platform === 'win32' ? 'agently-cli.exe' : 'agently-cli'
}

test('describePrefix finds the scoped platform binary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tc-mail-'))
  try {
    const exe = path.join(
      root,
      'node_modules/@tencent-qqmail/agently-cli/node_modules/@tencent-qqmail',
      platformDir(),
      'bin',
      binaryName(),
    )
    await mkdir(path.dirname(exe), { recursive: true })
    await writeFile(exe, '')
    const found = describePrefix(root)
    assert.equal(found && found.kind, 'exe')
    assert.equal(found.path, exe)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('describePrefix falls back to run.js when the platform package is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tc-mail-'))
  try {
    const script = path.join(root, 'node_modules/@tencent-qqmail/agently-cli/scripts/run.js')
    await mkdir(path.dirname(script), { recursive: true })
    await writeFile(script, '')
    const found = describePrefix(root)
    assert.equal(found && found.kind, 'node')
    assert.equal(found.script, script)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('describePrefix returns null for an unrelated directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tc-mail-'))
  try {
    assert.equal(describePrefix(root), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
