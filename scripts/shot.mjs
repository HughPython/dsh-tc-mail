#!/usr/bin/env node
/**
 * Local-only visual check. Serves the repo, opens dev/preview.html in Edge via
 * playwright-core, prints console/page errors and writes screenshots to
 * dev/shots/. Never shipped (`dev/` is outside `files`).
 *
 *   node scripts/shot.mjs [--view=panel|reader|settings|compose] [--dark]
 */

import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const port = 5199
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
    const filePath = path.join(root, decodeURIComponent(url.pathname))
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end()
      return
    }
    const body = await readFile(filePath)
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))

const args = process.argv.slice(2)
const viewArg = args.find((arg) => arg.startsWith('--view='))
const views = viewArg ? viewArg.split('=')[1].split(',') : ['panel', 'reader', 'settings', 'compose']
const dark = args.includes('--dark')

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 880 }, deviceScaleFactor: 2 })

const problems = []
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`)
})
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

await mkdir(path.join(root, 'dev/shots'), { recursive: true })

for (const view of views) {
  const query = view === 'panel' ? '' : `?view=${view}`
  await page.goto(`http://127.0.0.1:${port}/dev/preview.html${query}`, { waitUntil: 'load' })
  if (dark) {
    await page.addStyleTag({
      content: `:root{--dsw-alias-bg-base:#17191c;--dsw-alias-bg-layer-1:#1e2126;--dsw-alias-bg-layer-2:#23262c;
        --dsw-alias-border-l1:rgba(255,255,255,.09);--dsw-alias-border-l2:rgba(255,255,255,.16);
        --dsw-alias-label-primary:#eceef1;--dsw-alias-label-secondary:#b6bac1;--dsw-alias-label-tertiary:#84898f;
        --dsw-alias-label-primary-inverted:#ffffff;--dsw-alias-interactive-bg-hover:rgba(255,255,255,.06);
        --dsw-alias-interactive-bg-active:rgba(255,255,255,.1);--dsw-alias-bg-mask-1:rgba(0,0,0,.55)}`,
    })
    await page.evaluate(() => {
      document.body.style.background = '#17191c'
      document.body.style.color = '#eceef1'
    })
  }
  await page.waitForSelector('.tc-root', { timeout: 8000 })
  await page.waitForTimeout(view === 'panel' ? 500 : 900)
  const info = await page.evaluate(() => {
    const panel = document.querySelector('.tc-root')
    const style = getComputedStyle(panel)
    return { bg: style.backgroundColor, fg: style.color }
  })
  console.log(`  panel bg=${info.bg} fg=${info.fg}`)
  await page.screenshot({ path: path.join(root, `dev/shots/${view}${dark ? '-dark' : ''}.png`) })
  console.log(`shot: dev/shots/${view}${dark ? '-dark' : ''}.png`)
}

await browser.close()
server.close()

if (problems.length) {
  console.log('\n--- console problems ---')
  for (const problem of [...new Set(problems)]) console.log(problem)
} else {
  console.log('\nno console errors')
}
