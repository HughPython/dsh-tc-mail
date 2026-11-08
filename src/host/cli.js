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
import { readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PLATFORM_DIR = `agently-cli-${process.platform}-${process.arch}`
const SCOPE_DIR = path.join('node_modules', '@tencent-qqmail', 'agently-cli')
const PLATFORM_SCOPE_DIR = path.join('node_modules', '@tencent-qqmail', PLATFORM_DIR)

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

/** Every layout an npm prefix may use for a scoped package. */
function packageRoots(root) {
  return [
    path.join(root, SCOPE_DIR),
    path.join(root, 'lib', SCOPE_DIR),
    path.join(root, '@tencent-qqmail', 'agently-cli'),
  ]
}

/**
 * The native binary lives in a *scoped* platform package
 * (`@tencent-qqmail/agently-cli-<platform>-<arch>`), which is easy to miss.
 */
function nativeBinaries(pkgRoot) {
  return [
    path.join(pkgRoot, 'node_modules', '@tencent-qqmail', PLATFORM_DIR, 'bin', exeName()),
    path.join(pkgRoot, 'node_modules', PLATFORM_DIR, 'bin', exeName()),
  ]
}

function describePrefix(root) {
  for (const pkgRoot of packageRoots(root)) {
    for (const exe of nativeBinaries(pkgRoot)) {
      if (isFile(exe)) return { kind: 'exe', path: exe }
    }
  }
  const hoisted = path.join(root, PLATFORM_SCOPE_DIR, 'bin', exeName())
  if (isFile(hoisted)) return { kind: 'exe', path: hoisted }
  for (const pkgRoot of packageRoots(root)) {
    const script = path.join(pkgRoot, 'scripts', 'run.js')
    if (isFile(script)) return { kind: 'node', script }
  }
  return null
}

function expandVersionDirs(base) {
  const found = []
  try {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) found.push(path.join(base, entry.name))
    }
  } catch {
    /* the base does not exist on this machine */
  }
  return found
}

/**
 * Global npm prefixes that are not on PATH.
 *
 * This is the common failure mode on Windows: `npm i -g` writes into a prefix
 * that a GUI-launched app never sees (portable Node bundles, nvm-windows,
 * Volta, fnm, or an app-managed runtime such as WorkBuddy's).
 */
function globalPrefixes() {
  const home = os.homedir()
  const env = process.env
  const bases = []
  const push = (value) => {
    if (value) bases.push(value)
  }

  push(env.APPDATA && path.join(env.APPDATA, 'npm'))
  push(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'npm'))
  push(env.ProgramFiles && path.join(env.ProgramFiles, 'nodejs'))
  push(env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'nodejs'))
  push(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Volta', 'bin'))
  push(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Volta', 'tools', 'image', 'node'))
  push(path.join(home, '.volta', 'bin'))
  push('/usr/local/bin')
  push('/opt/homebrew/bin')
  push('/usr/local')
  push('/usr/bin')

  const versionRoots = [
    env.APPDATA && path.join(env.APPDATA, 'nvm'),
    env.APPDATA && path.join(env.APPDATA, 'fnm', 'node-versions'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'fnm', 'node-versions'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Volta', 'tools', 'image', 'node'),
    path.join(home, '.nvm', 'versions', 'node'),
    path.join(home, '.workbuddy', 'binaries', 'node', 'versions'),
    path.join(home, 'AppData', 'Roaming', 'npm', 'node_modules', 'node'),
  ].filter(Boolean)

  for (const root of versionRoots) {
    push(root)
    for (const version of expandVersionDirs(root)) {
      push(version)
      push(path.join(version, 'installation'))
    }
  }

  return bases
}

function pathDirs() {
  return String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
}

/**
 * Resolve the CLI in this order:
 *   1. the explicit override from settings
 *   2. a native executable on PATH
 *   3. an npm package behind a PATH entry (covers `%APPDATA%\npm`, portable Node)
 *   4. well-known global prefixes that are not on PATH
 *   5. `scripts/run.js` executed by the current Node runtime (last resort)
 *
 * A native `.exe` is always preferred: going through the npm shim means
 * `node run.js` -> `agently-cli.exe`, and that intermediate console process is
 * what makes a `cmd` window flash on Windows.
 */
export function resolveCli(override) {
  if (override && isFile(override)) {
    if (/\.(js|mjs|cjs)$/i.test(override)) {
      return { kind: 'node', script: override, path: override, source: 'settings' }
    }
    return { kind: 'exe', path: override, source: 'settings' }
  }

  const labelled = []
  for (const dir of pathDirs()) labelled.push({ root: dir, source: `PATH:${dir}` })
  for (const prefix of globalPrefixes()) labelled.push({ root: prefix, source: `npm-global:${prefix}` })

  // 1) a plain executable sitting directly in a searched directory
  for (const entry of labelled) {
    const exe = path.join(entry.root, exeName())
    if (isFile(exe)) return { kind: 'exe', path: exe, source: entry.source }
  }

  // 2) package layouts — a native binary always beats `scripts/run.js`.
  //    A broken global install (package present, platform binary missing) can
  //    coexist with a healthy one, so every candidate is collected first.
  const described = []
  for (const entry of labelled) {
    const found = describePrefix(entry.root)
    if (found) described.push({ ...found, source: entry.source })
  }

  const native = described.find((entry) => entry.kind === 'exe')
  if (native) return native
  return described.find((entry) => entry.kind === 'node') || null
}

/* ------------------------------------------------------------------ *
 * Streaming helpers
 * ------------------------------------------------------------------ */

function pumpLines(readable, onLine) {
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

function wireChild(child, { onLine, onClose } = {}) {
  pumpLines(child.stdout, onLine)
  pumpLines(child.stderr, onLine)
  child.on('error', (error) => {
    if (typeof onLine === 'function') onLine(String((error && error.message) || error))
    if (typeof onClose === 'function') onClose(-1)
  })
  child.on('close', (code) => {
    if (typeof onClose === 'function') onClose(code ?? -1)
  })
  return child
}

/**
 * Install the CLI into the npm global prefix this machine actually uses.
 *
 * Runs npm's own entry script through the current Node runtime instead of a
 * shell hop through the npm shim: no console window, no quoting concerns.
 */
export function installCli({ onLine, onClose } = {}) {
  const npm = resolveNpm()
  if (!npm) {
    throw new CliError('cli_missing', '未找到 npm。请手动执行：npm install -g @tencent-qqmail/agently-cli')
  }

  const child = spawn(
    process.execPath,
    [npm.script, 'install', '-g', '@tencent-qqmail/agently-cli', '--no-audit', '--no-fund'],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        npm_config_yes: 'true',
        npm_config_update_notifier: 'false',
      },
    },
  )
  return { child: wireChild(child, { onLine, onClose }), npm }
}

/** Locate npm itself, so the panel can install the CLI for the user. */
export function resolveNpm() {
  const cliScript = (root) => {
    const candidates = [
      path.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(root, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ]
    return candidates.find(isFile) || null
  }

  for (const dir of pathDirs()) {
    const script = cliScript(dir)
    if (script) return { kind: 'node', script, source: `PATH:${dir}` }
  }
  for (const prefix of globalPrefixes()) {
    const script = cliScript(prefix)
    if (script) return { kind: 'node', script, source: `npm-global:${prefix}` }
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

function runProcess(file, args, { cwd, timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(file, args, {
        cwd,
        // Windows: a console subsystem child of a GUI parent otherwise flashes
        // a cmd window. Every spawn in this plugin sets it.
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AGENTLY_CLI_NO_UPDATE_NOTIFIER: '1', ...env },
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
      const result = await runProcess(file, args, { cwd, timeoutMs, env: childEnv })

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
    const { file, args, env } = invocation(cli, ['--version'])
    const result = await runProcess(file, args, { timeoutMs: 10_000, env })
    const match = /(\d+\.\d+\.\d+[^\s]*)/.exec(result.stdout || '')
    const failed = result.code !== 0 || !match
    return {
      raw: (result.stdout || '').trim(),
      version: match ? match[1] : null,
      path: cli.path || cli.script,
      kind: cli.kind,
      source: cli.source,
      failed,
      error: failed ? (result.stderr || result.stdout || `exit ${result.code}`).split(/\r?\n/)[0].trim() : null,
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
    return wireChild(child, { onLine, onClose })
  }

  return { call, data, version, stream, info, reset: () => { cached = null; cachedAt = 0 } }
}

export const __test__ = { parseJson, firstErrorLine, resolveCli, describePrefix, globalPrefixes }
