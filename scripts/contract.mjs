#!/usr/bin/env node
/**
 * Snapshot the CLI's own field reference for every command the plugin calls.
 *
 * `--print-output-schema` exits without touching the network, so this is a
 * side-effect-free way to detect field drift after an `agently-cli` upgrade:
 * run it, then diff test/contract/.
 *
 * Resolution reuses the plugin's own CLI locator, which also exercises it.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { createCli } from '../src/host/cli.js'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'test/contract')

const COMMANDS = {
  me: ['+me'],
  'message-list': ['message', '+list'],
  'message-read': ['message', '+read'],
  'message-search': ['message', '+search'],
  'message-send': ['message', '+send'],
  'message-reply': ['message', '+reply'],
  'message-forward': ['message', '+forward'],
  'message-trash': ['message', '+trash'],
  'message-delete': ['message', '+delete'],
}

const cli = createCli({})
const info = await cli.version()
if (!info || !info.version) {
  console.error('未找到 agently-cli。安装：npm install -g @tencent-qqmail/agently-cli')
  process.exit(1)
}
console.log(`agently-cli ${info.version} (${info.source})`)

await mkdir(outDir, { recursive: true })

let failures = 0
for (const [name, argv] of Object.entries(COMMANDS)) {
  try {
    const { parsed } = await cli.call([...argv, '--print-output-schema'], { timeoutMs: 20_000 })
    await writeFile(path.join(outDir, `${name}.schema.json`), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
    console.log(`ok   ${name}`)
  } catch (error) {
    failures += 1
    console.log(`fail ${name}: ${(error && error.message) || error}`)
  }
}

const total = Object.keys(COMMANDS).length
console.log(`\n${total - failures}/${total} snapshots written to test/contract/`)
process.exitCode = failures ? 1 : 0
