/**
 * HTTP surface consumed by the browser half.
 *
 * All routes live under `/api/dsh-tc-mail`, are loopback-only, method-checked
 * and body-size-limited: the route prefix is reachable from any page served by
 * the host, so it must not become a confused-deputy channel.
 */

import { CliError, installCli } from './cli.js'

const API_PREFIX = '/api/dsh-tc-mail'
const JSON_BODY_LIMIT = 512 * 1024
const UPLOAD_BODY_LIMIT = 32 * 1024 * 1024

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])

function isLoopback(req) {
  const address = req.socket && req.socket.remoteAddress
  if (!address) return true
  return LOOPBACK.has(address)
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new CliError('bad_request', '请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new CliError('bad_request', '请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function statusFor(code) {
  switch (code) {
    case 'bad_request':
      return 400
    case 'not_logged_in':
      return 401
    case 'needs_confirm':
      return 409
    case 'cli_missing':
      return 424
    default:
      return 500
  }
}

export function registerRoutes({ webServer, mail, cli, settings, logger, runtime }) {
  const log = (level, message) => {
    if (logger && typeof logger[level] === 'function') logger[level](message)
  }

  const login = {
    status: 'idle',
    url: null,
    log: [],
    startedAt: 0,
    exitCode: null,
  }

  /* Installing the CLI from the panel: users should not need a terminal. */
  const install = {
    status: 'idle',
    log: [],
    startedAt: 0,
    exitCode: null,
    npm: null,
  }

  function resetLogin() {
    login.status = 'idle'
    login.url = null
    login.log = []
    login.startedAt = 0
    login.exitCode = null
  }

  async function handle(req, res) {
    if (!isLoopback(req)) {
      writeJson(res, 403, { ok: false, code: 'forbidden', message: '仅允许本机访问' })
      return
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const sub = url.pathname.slice(API_PREFIX.length) || '/'
    const method = req.method || 'GET'

    /* --- health ------------------------------------------------- */
    if (sub === '/health' && method === 'GET') {
      const health = await mail.health({ force: url.searchParams.get('force') === '1' })
      writeJson(res, 200, { ok: true, data: { ...health, tools: (runtime && runtime.tools) || [], toolError: (runtime && runtime.toolError) || null } })
      return
    }

    /* --- settings ----------------------------------------------- */
    if (sub === '/settings') {
      if (method === 'GET') {
        writeJson(res, 200, { ok: true, data: await settings.load() })
        return
      }
      if (method === 'PUT') {
        const patch = await readBody(req, JSON_BODY_LIMIT)
        const next = await settings.save(patch)
        if (patch && patch.advanced) {
          cli.reset()
          mail.invalidate()
        }
        writeJson(res, 200, { ok: true, data: next })
        return
      }
      writeJson(res, 405, { ok: false, code: 'bad_request', message: '方法不允许' })
      return
    }

    if (sub === '/settings/reset' && method === 'POST') {
      const next = await settings.reset()
      cli.reset()
      mail.invalidate()
      writeJson(res, 200, { ok: true, data: next })
      return
    }

    /* --- one-click CLI install ---------------------------------- */
    if (sub === '/setup/install') {
      if (method === 'GET') {
        writeJson(res, 200, { ok: true, data: { ...install, log: install.log.slice(-30) } })
        return
      }
      if (method === 'POST') {
        if (install.status === 'running') {
          writeJson(res, 200, { ok: true, data: { ...install, log: install.log.slice(-30) } })
          return
        }
        install.status = 'running'
        install.log = ['正在通过 npm 安装 @tencent-qqmail/agently-cli …']
        install.startedAt = Date.now()
        install.exitCode = null
        try {
          const started = installCli({
            onLine(line) {
              const trimmed = String(line || '').trimEnd()
              if (!trimmed) return
              install.log.push(trimmed)
              if (install.log.length > 300) install.log.splice(0, install.log.length - 300)
            },
            onClose(code) {
              install.exitCode = code
              install.status = code === 0 ? 'done' : 'failed'
              cli.reset()
              mail.invalidate()
            },
          })
          install.npm = started.npm ? started.npm.source : null
        } catch (error) {
          install.status = 'failed'
          install.exitCode = -1
          install.log.push(String((error && error.message) || error))
        }
        writeJson(res, 200, { ok: true, data: { ...install, log: install.log.slice(-30) } })
        return
      }
      writeJson(res, 405, { ok: false, code: 'bad_request', message: '方法不允许' })
      return
    }

    /* --- oauth login -------------------------------------------- */
    if (sub === '/auth/login') {
      if (method === 'GET') {
        writeJson(res, 200, { ok: true, data: { ...login, log: login.log.slice(-40) } })
        return
      }
      if (method === 'POST') {
        if (login.status === 'waiting') {
          writeJson(res, 200, { ok: true, data: { ...login, log: login.log.slice(-40) } })
          return
        }
        resetLogin()
        login.status = 'waiting'
        login.startedAt = Date.now()
        login.log.push('正在启动 agently-cli auth login …')
        try {
          cli.stream(['auth', 'login'], {
            onLine(line) {
              const trimmed = String(line || '').trim()
              if (!trimmed) return
              login.log.push(trimmed)
              if (login.log.length > 200) login.log.splice(0, login.log.length - 200)
              if (!login.url) {
                const match = /https?:\/\/[^\s"'<>]+/.exec(trimmed)
                if (match) login.url = match[0]
              }
            },
            onClose(code) {
              login.exitCode = code
              login.status = code === 0 ? 'done' : 'failed'
              if (code === 0) {
                cli.reset()
                mail.invalidate()
              }
            },
          })
        } catch (error) {
          login.status = 'failed'
          login.log.push(String((error && error.message) || error))
        }
        writeJson(res, 200, { ok: true, data: { ...login, log: login.log.slice(-40) } })
        return
      }
      writeJson(res, 405, { ok: false, code: 'bad_request', message: '方法不允许' })
      return
    }

    /* --- messages ----------------------------------------------- */
    if (sub === '/messages' && method === 'GET') {
      const params = url.searchParams
      const data = await mail.list({
        dir: params.get('dir') || 'inbox',
        limit: Number(params.get('limit')) || 20,
        cursor: params.get('cursor') || null,
        unreadOnly: params.get('unread') === '1',
      })
      writeJson(res, 200, { ok: true, data })
      return
    }

    if (sub.startsWith('/messages/') && method === 'GET') {
      const id = decodeURIComponent(sub.slice('/messages/'.length))
      writeJson(res, 200, { ok: true, data: await mail.read(id) })
      return
    }

    if (sub === '/search' && method === 'GET') {
      const params = url.searchParams
      const data = await mail.search({
        q: params.get('q') || '',
        dir: params.get('dir') || 'inbox',
        limit: Number(params.get('limit')) || 20,
        cursor: params.get('cursor') || null,
      })
      writeJson(res, 200, { ok: true, data })
      return
    }

    /* --- writes -------------------------------------------------- */
    if (sub === '/send' && method === 'POST') {
      writeJson(res, 200, { ok: true, data: await mail.send(await readBody(req, JSON_BODY_LIMIT)) })
      return
    }
    if (sub === '/reply' && method === 'POST') {
      writeJson(res, 200, { ok: true, data: await mail.reply(await readBody(req, JSON_BODY_LIMIT)) })
      return
    }
    if (sub === '/forward' && method === 'POST') {
      writeJson(res, 200, { ok: true, data: await mail.forward(await readBody(req, JSON_BODY_LIMIT)) })
      return
    }
    if (sub === '/trash' && method === 'POST') {
      writeJson(res, 200, { ok: true, data: await mail.trash(await readBody(req, JSON_BODY_LIMIT)) })
      return
    }
    if (sub === '/delete' && method === 'POST') {
      writeJson(res, 200, { ok: true, data: await mail.remove(await readBody(req, JSON_BODY_LIMIT)) })
      return
    }

    /* --- attachments -------------------------------------------- */
    if (sub === '/upload' && method === 'POST') {
      writeJson(res, 200, { ok: true, data: await mail.saveUpload(await readBody(req, UPLOAD_BODY_LIMIT)) })
      return
    }
    if (sub === '/attachment' && method === 'GET') {
      const params = url.searchParams
      const data = await mail.downloadAttachment({
        messageId: params.get('msg'),
        attachmentId: params.get('att'),
        filename: params.get('name'),
      })
      writeJson(res, 200, { ok: true, data })
      return
    }

    writeJson(res, 404, { ok: false, code: 'bad_request', message: `未知接口：${sub}` })
  }

  return webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      try {
        await handle(req, res)
      } catch (error) {
        const code = error instanceof CliError ? error.code : 'internal_error'
        const message = (error && error.message) || '未知错误'
        if (code === 'internal_error') log('error', `[dsh-tc-mail] ${message}\n${(error && error.stack) || ''}`)
        if (!res.headersSent) writeJson(res, statusFor(code), { ok: false, code, message })
        else res.end()
      }
    },
  })
}

export const API_BASE = API_PREFIX
