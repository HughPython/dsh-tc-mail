import assert from 'node:assert/strict'
import test from 'node:test'

import { TOOL_NAMES, buildTools } from '../src/host/tools.js'

/**
 * `@deepseek-ai/dsh-tools` rejects type arrays (`type: ['string','null']`) with
 * a JsonSchemaError. One such node aborts the whole `registerTools()` call, so
 * every tool silently disappears — this test walks the full schemas and pins
 * the rule.
 */

function walk(node, path, problems) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${path}[${index}]`, problems))
    return
  }

  if (Object.prototype.hasOwnProperty.call(node, 'type') && Array.isArray(node.type)) {
    problems.push(`${path}.type is an array (${JSON.stringify(node.type)})`)
  }
  if (node.type !== undefined && typeof node.type !== 'string') {
    problems.push(`${path}.type is not a string`)
  }

  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') walk(value, `${path}.${key}`, problems)
  }
}

const stubMail = {
  list: async () => ({ items: [], pagination: {} }),
  read: async () => ({}),
  search: async () => ({ items: [] }),
  send: async () => ({}),
  health: async () => ({ ready: true, account: {}, sentToday: 0 }),
}

test('every tool schema uses single-value types only', () => {
  const problems = []
  for (const tool of buildTools({ mail: stubMail })) {
    walk(tool.parameters, `${tool.name}.parameters`, problems)
    walk(tool.output && tool.output.schema, `${tool.name}.output.schema`, problems)
  }
  assert.deepEqual(problems, [])
})

test('each tool has the shape the registry validates', () => {
  for (const tool of buildTools({ mail: stubMail })) {
    assert.equal(typeof tool.name, 'string')
    assert.ok(tool.name.length > 0)
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 0)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(tool.parameters && tool.parameters.type, 'object')
    assert.ok(tool.output && tool.output.schema, `${tool.name} needs an output schema`)
    assert.equal(typeof tool.output.render, 'function')
  }
})

test('the advertised tool names match the built tools', () => {
  const built = buildTools({ mail: stubMail }).map((tool) => tool.name)
  assert.deepEqual(built.sort(), [...TOOL_NAMES].sort())
})

test('destructive deletion is not exposed to the agent', () => {
  const names = buildTools({ mail: stubMail }).map((tool) => tool.name)
  assert.equal(names.includes('mail_trash'), false)
  assert.equal(names.includes('mail_delete'), false)
})
