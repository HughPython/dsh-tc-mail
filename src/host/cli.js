/**
 * Thin, injection-resistant wrapper around the `agently-cli` binary.
 *
 * Design notes:
 * - The CLI is the only stable contract surface: it owns OAuth refresh, the
 *   Windows DPAPI credential store, rate limits and HTML handling. We never
 *   read the token and never call `api.agent.qq.com` directly.
 * - Every invocation uses an argv array with `shell: false`, so recipient
 *   addresses, subjects and bodies can never be reinterpreted by a shell.
 * - Calls are serialised per process: the CLI takes a per-workspace token
 *   refresh lock (`locks/refresh.lock`) and concurrent calls contend on it.
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

const PLATFORM_DIR = `agently-cli-${process.platform}-${process.arch}`
const PKG_SCOPE = path.join('node_modules', '@tencent-qqmail', 'agently-cli')

export class CliError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.detail = detail
  }
}

/* ------------------------------------------------------------------ *
 * Binary resolution
 * ------------------------------------------------------------------ */

function isFile(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function exeName() {
  return process.platform === 'win32' ? 'agently-cli.exe' : 'agently-cli'
}

/** Describe a resolved npm package root, preferring the native binary. */
function describePackageRoot(root) {
  const exe = path.join(root, 'node_modules', PLATFORM_DIR, 'bin', exeName())
  if (isFile(exe)) return { kind: 'exe', path: exe, root }
  const script = path.join(root, 'scripts', 'run.js')
  if (isFile(script)) return { kind: 'node', script, root }
  return null
}

function searchDirs() {
  const dirs = new Set()
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) dirs.add(dir)
  }
  if (process.env.APPDATA) dirs.add(path.join(process.env.APPDATA, 'npm'))
  if (process.env.LOCALAPPDATA) dirs.add(path.join(process.env.LOCALAPPDATA, 'npm'))
  dirs.add('/usr/local/bin')
  dirs.add('/opt/homebrew/bin')
  dirs.add('/usr/bin')
  return [...dirs]
}

/**
 * Resolve the CLI in four tiers:
 *   1. the user's explicit override from settings
 *   2. a native executable on PATH
 *   3. the platform package behind an npm shim on PATH (`.cmd` / shell script)
 *   4. `scripts/run.js` executed by the current Node runtime
 */
export function resolveCli(override) {
  if (override && isFile(override)) {
    if (/\.(js|mjs|cjs)$/i.test(override)) {
      return { kind: 'node', script: override, path: override, source: 'settings' }
    }
    return { kind: 'exe', path: override, source: 'settings' }
  }

  for (const dir of searchDirs()) {
    const exe = path.join(dir, exeName())
    if (isFile(exe)) return { kind: 'exe', path: exe, source: `PATH:${dir}` }
  }

  for (const dir of searchDirs()) {
    for (const shim of ['agently-cli.cmd', 'agently-cli.ps1', 'agently-cli']) {
      if (!isFile(path.join(dir, shim))) continue
      const described = describePackageRoot(path.join(dir, PKG_SCOPE))
      if (described) return { ...described, source: `shim:${dir}` }
    }
  }

  if (process.env.APPDATA) {
    const described = describePackageRoot(path.join(process.env.APPDATA, 'npm', PKG_SCOPE))
    if (described) return { ...described, source: 'APPDATA/npm' }
  }

  return null
}

/* ------------------------------------------------------------------ *
 * Process plumbing
 * ------------------------------------------------------------------ */

/** Serialise every CLI call: one at a time, FIFO. */
let queue = Promise.resolve()
function enqueue(task) {
  const run = queue.then(task, task)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function invocation(cli, argv) {
  if (cli.kind === 'exe') {
    return { file: cli.path, args: argv, env: {} }
  }
  return {
    file: process.execPath,
    args: [cli.script, ...argv],
    // Inside Electron the host binary doubles as a Node runtime.
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

function runProcess(file, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(file, args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error && error.message), spawnError: true })
      return
    }

    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (payload) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(payload)
    }

    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish({ code: -2, stdout, stderr: `${stderr}\n[timeout after ${timeoutMs}ms]`, timedOut: true })
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => finish({ code: -1, stdout, stderr: String(error && error.message), spawnError: true }))
    child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr }))
  })
}

function parseJson(text) {
  const trimmed = String(text || '').replace(/^\uFEFF/, '').trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    /* fall through to the brace slice */
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
}

function firstErrorLine(stderr) {
  const lines = String(stderr || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const explicit = lines.find((line) => /^error:/i.test(line))
  return (explicit || lines[0] || '').replace(/^error:\s*/i, '')
}

function errorFromPayload(parsed) {
  const error = parsed && parsed.error
  if (!error) return null
  if (typeof error === 'string') return { code: 'api_error', message: error }
  const code = error.code || error.type || 'api_error'
  const message = error.message || error.detail || JSON.stringify(error)
  return { code, message }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function createCli({ logger, getOverride, getWorkspace } = {}) {
  let cached = null
  let cachedAt = 0
  let cachedKey = ''

  const log = (level, message) => {
    if (logger && typeof logger[level] === 'function') logger[level](message)
  }

  function info(force) {
    const override = typeof getOverride === 'function' ? getOverride() : undefined
    const key = String(override || '')
    const fresh = cached && cachedKey === key && Date.now() - cachedAt < 30_000
    if (fresh && !force) return cached
    cached = resolveCli(override)
    cachedAt = Date.now()
    cachedKey = key
    return cached
  }

  /** Run an argv array, returning `{ parsed, stdout, stderr, code }`. */
  function call(argv, { cwd, timeoutMs = 30_000, allowFailure = false } = {}) {
    return enqueue(async () => {
      const cli = info()
      if (!cli) {
        throw new CliError(
          'cli_missing',
          '未找到 agently-cli。请先安装：npm install -g @tencent-qqmail/agently-cli',
        )
      }

      const { file, args, env } = invocation(cli, argv)
      const workspace = typeof getWorkspace === 'function' ? getWorkspace() : ''
      const childEnv = {
        ...process.env,
        AGENTLY_CLI_NO_UPDATE_NOTIFIER: '1',
        ...env,
      }
      if (workspace) childEnv.AGENTLY_WORKSPACE = workspace

      log('debug', `[dsh-tc-mail] ${file} ${args.join(' ')}`)
      const result = await runProcess(file, args, { cwd, timeoutMs })

      if (result.timedOut) {
        throw new CliError('cli_error', `agently-cli 调用超时（${Math.round(timeoutMs / 1000)}s）`, { argv })
      }
      if (result.spawnError) {
        throw new CliError('cli_error', `无法启动 agently-cli：${result.stderr}`, { argv })
      }

      const parsed = parseJson(result.stdout)
      if (result.code !== 0) {
        const message = firstErrorLine(result.stderr) || `agently-cli 退出码 ${result.code}`
        if (allowFailure) return { parsed, ...result, error: { code: 'cli_error', message } }
        throw new CliError('cli_error', message, { argv, stderr: result.stderr })
      }
      if (!parsed) {
        const message = firstErrorLine(result.stderr) || 'agently-cli 返回了无法解析的输出'
        if (allowFailure) return { parsed: null, ...result, error: { code: 'cli_error', message } }
        throw new CliError('cli_error', message, { argv, stdout: result.stdout.slice(0, 400) })
      }

      const failure = errorFromPayload(parsed)
      if (failure) {
        if (allowFailure) return { parsed, ...result, error: failure }
        throw new CliError(failure.code, failure.message, { argv })
      }

      return { parsed, ...result }
    })
  }

  /** Run a command and return only its `data` payload. */
  async function data(argv, options) {
    const { parsed } = await call(argv, options)
    return parsed && parsed.data !== undefined ? parsed.data : parsed
  }

  async function version() {
    const cli = info(true)
    if (!cli) return null
    try {
      const { file, args, env } = invocation(cli, ['--version'])
      const result = await runProcess(file, args, { timeoutMs: 10_000 })
      const match = /(\d+\.\d+\.\d+[^\s]*)/.exec(result.stdout || '')
      return { raw: (result.stdout || '').trim(), version: match ? match[1] : null, path: file, kind: cli.kind, source: cli.source }
    } catch {
      return { raw: '', version: null, path: cli.path || cli.script, kind: cli.kind, source: cli.source }
    }
  }

  /**
   * Start a long-lived command (`auth login`) outside the serial queue and
   * report stdout/stderr line by line. Returns the child process.
   */
  function stream(argv, { cwd, onLine, onClose } = {}) {
    const cli = info()
    if (!cli) throw new CliError('cli_missing', '未找到 agently-cli。请先安装：npm install -g @tencent-qqmail/agently-cli')
    const { file, args, env } = invocation(cli, argv)
    const workspace = typeof getWorkspace === 'function' ? getWorkspace() : ''
    const childEnv = { ...process.env, AGENTLY_CLI_NO_UPDATE_NOTIFIER: '1', ...env }
    if (workspace) childEnv.AGENTLY_WORKSPACE = workspace

    const child = spawn(file, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv })
    const pump = (readable) => {
      let buffer = ''
      readable.setEncoding('utf8')
      readable.on('data', (chunk) => {
        buffer += chunk
        let index = buffer.search(/\r?\n/)
        while (index >= 0) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + (buffer[index] === '\r' ? 2 : 1))
          if (typeof onLine === 'function') onLine(line)
          index = buffer.search(/\r?\n/)
        }
      })
      readable.on('end', () => {
        if (buffer && typeof onLine === 'function') onLine(buffer)
      })
    }
    pump(child.stdout)
    pump(child.stderr)
    child.on('error', (error) => {
      if (typeof onLine === 'function') onLine(String((error && error.message) || error))
      if (typeof onClose === 'function') onClose(-1)
    })
    child.on('close', (code) => {
      if (typeof onClose === 'function') onClose(code ?? -1)
    })
    return child
  }

  return { call, data, version, stream, info, reset: () => { cached = null; cachedAt = 0 } }
}

export const __test__ = { parseJson, firstErrorLine, resolveCli, describePackageRoot }
