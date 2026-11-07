#!/usr/bin/env node
/**
 * Serve `dev/preview.html` on localhost so the panel can be inspected without
 * installing it into a Harness profile. Synthetic fixtures only.
 */

import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const port = Number(process.env.PREVIEW_PORT || 5177)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

try {
  await stat(path.join(root, 'lib/client.js'))
} catch {
  console.error('lib/client.js 不存在，请先运行：npm run build')
  process.exit(1)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/') pathname = '/dev/preview.html'
    const filePath = path.join(root, pathname)
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('forbidden')
      return
    }
    const body = await readFile(filePath)
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}/dev/preview.html`
  console.log(`preview: ${url}`)
  console.log('参数：?view=reader | settings | compose')
  const opener =
    process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' })
  opener.on('error', () => {})
  opener.unref()
})
