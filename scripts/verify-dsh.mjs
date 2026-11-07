#!/usr/bin/env node
/**
 * End-to-end check against the running Harness web UI.
 *
 * Reads the auth cookie from a curl cookie jar (passed as argv[2]) and drives
 * the real page: opens the sidebar entry, screenshots the panel, reports
 * console errors and the panel's own DOM state.
 *
 *   node scripts/verify-dsh.mjs /tmp/dshcookies.txt
 */

import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const jar = process.argv[2] || '/tmp/dshcookies.txt'
const base = process.argv[3] || 'http://127.0.0.1:17817'

const raw = await readFile(jar, 'utf8')
const cookies = raw
  .split(/\r?\n/)
  .filter((line) => line && (!line.startsWith('#') || line.startsWith('#HttpOnly_')))
  .map((line) => line.split('\t'))
  .filter((parts) => parts.length >= 7)
  .map((parts) => ({
    name: parts[5],
    value: parts[6],
    domain: parts[0].replace(/^#HttpOnly_/, '') || '127.0.0.1',
    path: parts[2] || '/',
  }))

if (!cookies.length) {
  console.error('no cookies parsed from', jar)
  process.exit(1)
}

await mkdir(path.join(root, 'dev/shots'), { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
await context.addCookies(cookies)
const page = await context.newPage()

const problems = []
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`)
})
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

await page.goto(base, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

/* 0. dismiss first-run modals / overlays that block pointer events */
for (const label of ['继续', '知道了', '我知道了', '关闭', '开始使用']) {
  const button = page.getByRole('button', { name: label, exact: true })
  if (await button.count()) {
    await button.first().click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(500)
  }
}
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(600)

/* 0b. the desktop layout may start with the sidebar collapsed off-canvas */
await page.evaluate(() => {
  const toggle = document.querySelector('[aria-label="打开侧边栏"], [aria-label="Open sidebar"]')
  if (toggle) toggle.click()
})
await page.waitForTimeout(900)

/* 1. sidebar entry present? */
const entry = page.getByText('我的邮箱', { exact: true }).last()
const visible = await entry.count()
console.log('sidebar entry found:', visible > 0)
if (visible > 0) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('span, div')) {
      if (el.children.length === 0 && el.textContent.trim() === '我的邮箱') {
        const row = el.closest('button, [role="button"], li, a') || el
        row.click()
        return
      }
    }
  })
  await page.waitForTimeout(9000)
}

/* 2. panel state */
const state = await page.evaluate(() => {
  const panel = document.querySelector('.tc-root')
  if (!panel) return { panel: false }
  const rows = panel.querySelectorAll('.tc-row').length
  const guide = panel.querySelector('.tc-guide')
  return {
    panel: true,
    rows,
    guide: guide ? guide.textContent.slice(0, 60) : null,
    title: (panel.querySelector('.tc-title') || {}).textContent || '',
    account: (panel.querySelector('.tc-account-email') || {}).textContent || '',
    tabs: [...panel.querySelectorAll('.tc-tab')].map((node) => node.textContent),
    text: panel.innerText.slice(0, 240),
    toast: (document.querySelector('.tc-toast') || {}).textContent || null,
  }
})
console.log('panel state:', JSON.stringify(state))

// keep the sidebar open in the reference screenshot
await page.evaluate(() => {
  const toggle = document.querySelector('[aria-label="打开侧边栏"], [aria-label="Open sidebar"]')
  if (toggle) toggle.click()
})
await page.waitForTimeout(900)
await page.screenshot({ path: path.join(root, 'dev/shots/dsh-panel.png') })
console.log('shot: dev/shots/dsh-panel.png')

/* 3. open the first message, verify the reader renders */
if (state.panel && state.rows > 0) {
  await page.locator('.tc-row').first().click()
  await page.waitForTimeout(2500)
  const reader = await page.evaluate(() => {
    const node = document.querySelector('.tc-reader')
    if (!node) return { reader: false }
    const frame = node.querySelector('iframe')
    return {
      reader: true,
      subject: (node.querySelector('.tc-reader-subject') || {}).textContent || '',
      attachments: node.querySelectorAll('.tc-attachment').length,
      iframe: Boolean(frame),
      hasImagesButton: Boolean(node.querySelector('.tc-btn--ghost')),
    }
  })
  console.log('reader state:', JSON.stringify(reader))
  await page.screenshot({ path: path.join(root, 'dev/shots/dsh-reader.png') })
  console.log('shot: dev/shots/dsh-reader.png')

  await page.locator('.tc-reader-head .tc-btn--ghost').first().click()
  await page.waitForTimeout(800)
}

/* 4. settings dialog */
await page.locator('[title="设置"]').first().click()
await page.waitForTimeout(900)
const dialog = await page.evaluate(() => {
  const overlay = document.querySelector('.tc-overlay')
  if (!overlay) return { dialog: false }
  const primary = overlay.querySelector('.tc-btn--primary')
  return {
    dialog: true,
    primaryBg: primary ? getComputedStyle(primary).backgroundColor : null,
    sections: [...overlay.querySelectorAll('.tc-section-title')].map((node) => node.textContent),
    ranges: overlay.querySelectorAll('input[type=range]').length,
    colors: overlay.querySelectorAll('input[type=color]').length,
  }
})
console.log('settings dialog:', JSON.stringify(dialog))
await page.screenshot({ path: path.join(root, 'dev/shots/dsh-settings.png') })
console.log('shot: dev/shots/dsh-settings.png')

await browser.close()

console.log(problems.length ? `\n--- problems ---\n${[...new Set(problems)].join('\n')}` : '\nno console errors')
