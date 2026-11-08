import assert from 'node:assert/strict'
import test from 'node:test'

import { createMailService } from '../src/host/mail-service.js'

/**
 * The product has no trash folder, so `remove` must be a permanent delete.
 * These tests pin the strategy against a stub CLI: a single `+delete`, and a
 * move-then-delete fallback for deployments that only allow deleting from
 * trash.
 */

function makeService(handler) {
  const calls = []
  const cli = {
    async data(argv) {
      calls.push(argv.join(' '))
      return handler(argv, calls)
    },
    async version() {
      return { version: '1.0.18', kind: 'exe', path: 'stub' }
    },
  }
  const settings = { load: async () => ({}), peek: () => ({ advanced: { cliPath: '', workspace: '' } }) }
  const logger = { warn() {}, info() {}, debug() {}, error() {} }
  return { service: createMailService({ cli, settings, logger }), calls }
}

test('remove deletes permanently in a single call when the CLI allows it', async () => {
  const { service, calls } = makeService(() => ({}))
  const result = await service.remove({ ids: ['m1'] })
  assert.deepEqual(calls, ['message +delete --id m1'])
  assert.equal(result.deletedCount, 1)
  assert.equal(result.mode, 'direct')
})

test('remove falls back to move-then-delete when a direct delete fails', async () => {
  let deleteAttempts = 0
  const { service, calls } = makeService((argv) => {
    if (argv.includes('+delete')) {
      deleteAttempts += 1
      if (deleteAttempts === 1) throw new Error('message is not in trash')
    }
    return {}
  })
  const result = await service.remove({ ids: ['m1'] })
  assert.deepEqual(calls, ['message +delete --id m1', 'message +trash --id m1', 'message +delete --id m1'])
  assert.equal(result.deletedCount, 1)
  assert.equal(result.mode, 'via-trash')
})

test('remove keeps going after one failure and reports the failures', async () => {
  const { service } = makeService((argv) => {
    if (argv.includes('m2') && argv.includes('+delete')) throw new Error('boom')
    if (argv.includes('m2') && argv.includes('+trash')) throw new Error('boom')
    return {}
  })
  const result = await service.remove({ ids: ['m1', 'm2'] })
  assert.deepEqual(result.deletes, ['m1'])
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].id, 'm2')
})

test('remove rejects an empty selection', async () => {
  const { service } = makeService(() => ({}))
  await assert.rejects(() => service.remove({ ids: [] }), /未选择邮件/)
})

test('remove --all empties trash through the aggregate command', async () => {
  const { service, calls } = makeService(() => ({ deleted_count: 3 }))
  const result = await service.remove({ all: true })
  assert.deepEqual(calls, ['message +delete --all'])
  assert.equal(result.deletedCount, 3)
})
