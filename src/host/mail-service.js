/**
 * One implementation of every mailbox operation.
 *
 * Both callers go through this module:
 *   - the HTTP routes that back the Web UI
 *   - the agent tools (`mail_list`, `mail_read`, …)
 * so the UI and the model can never drift apart.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { CliError } from './cli.js'
import { DOWNLOADS_DIR, OPS_DIR, UPLOADS_DIR } from './settings-store.js'

const DIR_NAMES = new Set(['inbox', 'sent', 'trash', 'spam'])

const attr = (value) => (typeof value === 'string' ? value.trim() : '')

function dirName(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return attr(value.dir_name) || attr(value.name)
  return ''
}

function addressList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry) return null
      if (typeof entry === 'string') return { email: entry.trim(), name: '' }
      const email = attr(entry.email)
      if (!email) return null
      return { email, name: attr(entry.name) }
    })
    .filter(Boolean)
}

function normalizeSummary(row) {
  if (!row || typeof row !== 'object') return null
  const id = attr(row.message_id)
  if (!id) return null
  return {
    id,
    subject: attr(row.subject),
    snippet: attr(row.snippet),
    from: addressList([row.from])[0] || { email: '', name: '' },
    to: addressList(row.to),
    createdAt: attr(row.created_at),
    isRead: row.is_read !== false,
    hasAttachments: Boolean(row.has_attachments),
    dir: dirName(row.dir),
  }
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return []
  return value.map((entry, index) => ({
    id: attr(entry && entry.attachment_id),
    filename: attr(entry && entry.filename) || `附件 ${index + 1}`,
    contentType: attr(entry && entry.content_type),
    size: Number(entry && entry.size) || 0,
    downloadUrl: attr(entry && entry.download_url),
  }))
}

function normalizeDetail(row) {
  const summary = normalizeSummary(row) || { id: '', subject: '', snippet: '', from: { email: '', name: '' }, to: [], createdAt: '', isRead: true, hasAttachments: false, dir: '' }
  return {
    ...summary,
    cc: addressList(row && row.cc),
    bcc: addressList(row && row.bcc),
    body: typeof (row && row.body) === 'string' ? row.body : '',
    bodyFormat: attr(row && row.body_format).toUpperCase() || 'PLAIN',
    attachments: normalizeAttachments(row && row.attachments),
    attachmentCount: Number(row && row.attachment_count) || 0,
    rfcMessageId: attr(row && row.rfc_message_id),
    calendarIcs: attr(row && row.calendar_ics),
  }
}

function paginationOf(data) {
  const pagination = (data && data.pagination) || {}
  return {
    hasMore: Boolean(pagination.has_more),
    nextCursor: attr(pagination.next_cursor) || null,
    previousCursor: attr(pagination.previous_cursor) || null,
  }
}

function rowsOf(data) {
  if (!data) return []
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data)) return data
  return []
}

/** Keep only characters that are safe inside a single path segment. */
function safeFileName(name, fallback = 'attachment') {
  const base = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^[._\-\s]+/, '')
    .trim()
  return (base || fallback).slice(0, 120)
}

function todayStartIso() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  return start.toISOString()
}

export function createMailService({ cli, settings, logger }) {
  const log = (level, message) => {
    if (logger && typeof logger[level] === 'function') logger[level](message)
  }

  function requireLoggedIn(auth) {
    if (auth && auth.loggedIn === false) {
      throw new CliError('not_logged_in', '尚未授权 Agent Mail。请先执行：agently-cli auth login')
    }
  }

  /* -------------------------------------------------------------- *
   * Read paths
   * -------------------------------------------------------------- */

  async function authStatus() {
    try {
      const data = await cli.data(['auth', 'status'], { timeoutMs: 15_000 })
      return {
        loggedIn: Boolean(data && data.logged_in),
        status: attr(data && data.status) || 'unknown',
        workspace: attr(data && data.workspace) || 'default',
        storage: attr(data && data.storage),
        expiresAt: attr(data && data.expires_at),
        tokenStatus: attr(data && data.token_status),
      }
    } catch (error) {
      return { loggedIn: false, status: 'error', workspace: 'default', error: error && error.message }
    }
  }

  let healthCache = null
  let healthAt = 0

  async function health({ force = false } = {}) {
    if (!force && healthCache && Date.now() - healthAt < 15_000) return healthCache

    const version = await cli.version()
    if (!version || !version.version) {
      healthCache = {
        ready: false,
        reason: 'cli_missing',
        cli: null,
        auth: { loggedIn: false, status: 'unknown' },
        account: null,
      }
      healthAt = Date.now()
      return healthCache
    }

    const auth = await authStatus()
    let account = null
    let sentToday = null

    if (auth.loggedIn) {
      try {
        const me = await cli.data(['+me'], { timeoutMs: 20_000 })
        const aliases = Array.isArray(me && me.aliases) ? me.aliases : []
        const primary = aliases.find((entry) => entry && entry.is_primary) || aliases[0] || null
        const quota = Number(me && me.rate_limits && me.rate_limits.daily_send_quota) || null
        account = {
          aliasId: attr(primary && primary.alias_id),
          email: attr(primary && primary.email),
          name: attr(primary && primary.name),
          quota,
          constraints: (me && me.constraints) || null,
          scopes: Array.isArray(me && me.scopes) ? me.scopes : [],
        }
        try {
          const data = await cli.data(
            ['message', '+list', '--dir', 'sent', '--after', todayStartIso(), '--limit', '50'],
            { timeoutMs: 20_000 },
          )
          sentToday = rowsOf(data).length
        } catch {
          sentToday = null
        }
      } catch (error) {
        account = { error: error && error.message }
      }
    }

    healthCache = {
      ready: Boolean(auth.loggedIn),
      reason: auth.loggedIn ? null : 'not_logged_in',
      cli: version,
      auth,
      account,
      sentToday,
    }
    healthAt = Date.now()
    return healthCache
  }

  async function list({ dir = 'inbox', limit = 20, cursor = null, unreadOnly = false, since = null } = {}) {
    const folder = DIR_NAMES.has(dir) ? dir : 'inbox'
    const argv = ['message', '+list', '--dir', folder, '--limit', String(Math.min(50, Math.max(1, Number(limit) || 20)))]
    if (cursor) argv.push('--cursor', cursor)
    if (unreadOnly) argv.push('--is-unread')
    if (since) argv.push('--after', since)

    const data = await cli.data(argv, { timeoutMs: 25_000 })
    return {
      items: rowsOf(data).map(normalizeSummary).filter(Boolean),
      pagination: paginationOf(data),
      dir: folder,
    }
  }

  async function read(id) {
    const messageId = attr(id)
    if (!messageId) throw new CliError('bad_request', '缺少邮件 ID')
    const data = await cli.data(['message', '+read', '--id', messageId], { timeoutMs: 30_000 })
    return normalizeDetail(data)
  }

  async function search({ q = '', dir = 'inbox', limit = 20, cursor = null, from = '', to = '' } = {}) {
    const keyword = attr(q)
    if (!keyword) return { items: [], pagination: { hasMore: false, nextCursor: null }, query: '' }
    const folder = DIR_NAMES.has(dir) ? dir : 'inbox'
    const argv = [
      'message', '+search',
      '--q', keyword,
      '--dir', folder,
      '--limit', String(Math.min(50, Math.max(1, Number(limit) || 20))),
    ]
    if (cursor) argv.push('--cursor', cursor)
    if (from) argv.push('--from', from)
    if (to) argv.push('--to', to)

    const data = await cli.data(argv, { timeoutMs: 30_000 })
    return {
      items: rowsOf(data).map(normalizeSummary).filter(Boolean),
      pagination: paginationOf(data),
      query: keyword,
    }
  }

  /* -------------------------------------------------------------- *
   * Write paths
   * -------------------------------------------------------------- */

  async function withOpDir(run) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const dir = path.join(OPS_DIR, id)
    await mkdir(dir, { recursive: true })
    try {
      return await run(dir)
    } finally {
      setTimeout(() => {
        rm(dir, { recursive: true, force: true }).catch(() => {})
      }, 120_000).unref?.()
    }
  }

  async function stageBody(dir, body, format) {
    const text = typeof body === 'string' ? body : ''
    if (!text.trim()) throw new CliError('bad_request', '正文不能为空')
    const ext = format === 'html' ? 'html' : format === 'markdown' ? 'md' : 'txt'
    const name = `body.${ext}`
    await writeFile(path.join(dir, name), text, 'utf8')
    return { arg: `./${name}`, format: format === 'html' ? 'html' : format === 'markdown' ? 'markdown' : 'plain' }
  }

  /** Copy host-managed uploads into the operation directory and return argv paths. */
  async function stageAttachments(dir, uploads) {
    const list = Array.isArray(uploads) ? uploads.filter((entry) => entry && entry.uploadId) : []
    const staged = []
    for (const [index, upload] of list.entries()) {
      const uploadId = safeFileName(upload.uploadId, '')
      if (!uploadId) continue
      const source = path.join(UPLOADS_DIR, uploadId, 'file')
      try {
        const buffer = await readFile(source)
        const name = `${index + 1}-${safeFileName(upload.name || 'attachment')}`
        await writeFile(path.join(dir, name), buffer)
        staged.push(`./${name}`)
      } catch {
        log('warn', `[dsh-tc-mail] 附件暂存失败：${uploadId}`)
      }
    }
    return staged
  }

  /**
   * The CLI returns `{ confirmation_required: true, confirmation_token }` with
   * exit 0 for state-changing calls. The caller has already shown the user a
   * confirmation surface, so the retry may proceed immediately.
   */
  async function confirmed(argvFactory, { timeoutMs = 60_000 } = {}) {
    const first = await cli.data(argvFactory(), { timeoutMs })
    if (first && first.confirmation_required) {
      const token = attr(first.confirmation_token)
      if (!token) throw new CliError('needs_confirm', (first && first.message) || '该操作需要二次确认，但未取得确认令牌')
      return cli.data(argvFactory(token), { timeoutMs })
    }
    return first
  }

  async function send({ to, cc, bcc, subject, body, bodyFormat = 'plain', attachments = [] } = {}) {
    const recipients = (Array.isArray(to) ? to : []).map(attr).filter(Boolean)
    if (!recipients.length) throw new CliError('bad_request', '至少需要一个收件人')
    const title = attr(subject)
    if (!title) throw new CliError('bad_request', '主题不能为空')

    return withOpDir(async (dir) => {
      const staged = await stageBody(dir, body, bodyFormat)
      const attachArgs = await stageAttachments(dir, attachments)
      const build = (token) => {
        const argv = ['message', '+send']
        for (const address of recipients) argv.push('--to', address)
        for (const address of (cc || []).map(attr).filter(Boolean)) argv.push('--cc', address)
        for (const address of (bcc || []).map(attr).filter(Boolean)) argv.push('--bcc', address)
        argv.push('--subject', title, '--body-file', staged.arg, '--body-format', staged.format)
        for (const file of attachArgs) argv.push('--attachment', file)
        if (token) argv.push('--confirmation-token', token)
        else argv.push('--confirmed')
        return argv
      }
      const result = await confirmed(build, { timeoutMs: 120_000 })
      return { queued: result ? result.queued !== false : true, recipients, subject: title, attachmentCount: attachArgs.length }
    })
  }

  async function reply({ id, body, bodyFormat = 'plain', replyAll = false, cc = [], bcc = [], attachments = [] } = {}) {
    const messageId = attr(id)
    if (!messageId) throw new CliError('bad_request', '缺少邮件 ID')
    return withOpDir(async (dir) => {
      const staged = await stageBody(dir, body, bodyFormat === 'markdown' ? 'plain' : bodyFormat)
      const attachArgs = await stageAttachments(dir, attachments)
      const build = (token) => {
        const argv = ['message', '+reply', '--id', messageId, '--body-file', staged.arg, '--body-format', staged.format]
        for (const address of (cc || []).map(attr).filter(Boolean)) argv.push('--cc', address)
        for (const address of (bcc || []).map(attr).filter(Boolean)) argv.push('--bcc', address)
        for (const file of attachArgs) argv.push('--attachment', file)
        if (replyAll) argv.push('--reply-all')
        if (token) argv.push('--confirmation-token', token)
        else argv.push('--confirmed')
        return argv
      }
      const result = await confirmed(build, { timeoutMs: 120_000 })
      return { queued: result ? result.queued !== false : true, id: messageId, replyAll: Boolean(replyAll) }
    })
  }

  async function forward({ id, to, body = '', cc = [], bcc = [], includeAttachments = true } = {}) {
    const messageId = attr(id)
    if (!messageId) throw new CliError('bad_request', '缺少邮件 ID')
    const recipients = (Array.isArray(to) ? to : []).map(attr).filter(Boolean)
    if (!recipients.length) throw new CliError('bad_request', '至少需要一个转发收件人')

    return withOpDir(async (dir) => {
      const note = typeof body === 'string' ? body.trim() : ''
      const staged = note ? await stageBody(dir, note, 'plain') : null
      const build = (token) => {
        const argv = ['message', '+forward', '--id', messageId]
        for (const address of recipients) argv.push('--to', address)
        for (const address of (cc || []).map(attr).filter(Boolean)) argv.push('--cc', address)
        for (const address of (bcc || []).map(attr).filter(Boolean)) argv.push('--bcc', address)
        if (staged) argv.push('--body-file', staged.arg, '--body-format', staged.format)
        if (includeAttachments) argv.push('--include-attachments')
        if (token) argv.push('--confirmation-token', token)
        else argv.push('--confirmed')
        return argv
      }
      const result = await confirmed(build, { timeoutMs: 120_000 })
      return { queued: result ? result.queued !== false : true, id: messageId, recipients }
    })
  }

  async function trash({ ids = [] } = {}) {
    const messageIds = (Array.isArray(ids) ? ids : [ids]).map(attr).filter(Boolean)
    if (!messageIds.length) throw new CliError('bad_request', '未选择邮件')
    const done = []
    const failed = []
    for (const id of messageIds) {
      try {
        await confirmed((token) => {
          const argv = ['message', '+trash', '--id', id]
          if (token) argv.push('--confirmation-token', token)
          return argv
        })
        done.push(id)
      } catch (error) {
        failed.push({ id, message: error && error.message })
      }
    }
    if (!done.length && failed.length) {
      throw new CliError('cli_error', failed[0].message || '移入垃圾箱失败', { failed })
    }
    return { moved: done, failed }
  }

  async function remove({ ids = [], all = false } = {}) {
    if (all) {
      const result = await confirmed((token) => {
        const argv = ['message', '+delete', '--all']
        if (token) argv.push('--confirmation-token', token)
        return argv
      })
      return { deletedCount: Number(result && result.deleted_count) || 0, deletes: [] }
    }
    const messageIds = (Array.isArray(ids) ? ids : [ids]).map(attr).filter(Boolean)
    if (!messageIds.length) throw new CliError('bad_request', '未选择邮件')
    const deletes = []
    const failed = []
    for (const id of messageIds) {
      try {
        await confirmed((token) => {
          const argv = ['message', '+delete', '--id', id]
          if (token) argv.push('--confirmation-token', token)
          return argv
        })
        deletes.push(id)
      } catch (error) {
        failed.push({ id, message: error && error.message })
      }
    }
    if (!deletes.length && failed.length) {
      throw new CliError('cli_error', failed[0].message || '永久删除失败', { failed })
    }
    return { deletedCount: deletes.length, deletes, failed }
  }

  /* -------------------------------------------------------------- *
   * Attachments
   * -------------------------------------------------------------- */

  async function saveUpload({ name, data } = {}) {
    const buffer = Buffer.from(String(data || '').replace(/^data:[^;]+;base64,/, ''), 'base64')
    if (!buffer.length) throw new CliError('bad_request', '附件内容为空')
    const uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const dir = path.join(UPLOADS_DIR, uploadId)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'file'), buffer)
    await writeFile(
      path.join(dir, 'meta.json'),
      JSON.stringify({ name: safeFileName(name || 'attachment'), size: buffer.length }),
      'utf8',
    )
    return { uploadId, name: safeFileName(name || 'attachment'), size: buffer.length }
  }

  async function downloadAttachment({ messageId, attachmentId, filename } = {}) {
    const msg = attr(messageId)
    const att = attr(attachmentId)
    if (!msg || !att) throw new CliError('bad_request', '缺少邮件或附件 ID')
    await mkdir(DOWNLOADS_DIR, { recursive: true })
    const data = await cli.data(
      ['attachment', '+download', '--msg', msg, '--att', att, '--output', '.'],
      { cwd: DOWNLOADS_DIR, timeoutMs: 120_000 },
    )
    return { savedTo: attr(data && data.saved_to), filename: attr(data && data.filename) || safeFileName(filename) }
  }

  /* -------------------------------------------------------------- *
   * OAuth login (best-effort in-process)
   * -------------------------------------------------------------- */

  return {
    health,
    authStatus,
    list,
    read,
    search,
    send,
    reply,
    forward,
    trash,
    remove,
    saveUpload,
    downloadAttachment,
    invalidate: () => {
      healthCache = null
      healthAt = 0
    },
  }
}

export const __test__ = { normalizeSummary, normalizeDetail, normalizeAttachments, safeFileName, todayStartIso }
