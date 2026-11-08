// src/host/cli.js
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
var PLATFORM_DIR = `agently-cli-${process.platform}-${process.arch}`;
var SCOPE_DIR = path.join("node_modules", "@tencent-qqmail", "agently-cli");
var PLATFORM_SCOPE_DIR = path.join("node_modules", "@tencent-qqmail", PLATFORM_DIR);
var CliError = class extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.detail = detail;
  }
};
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
function exeName() {
  return process.platform === "win32" ? "agently-cli.exe" : "agently-cli";
}
function packageRoots(root) {
  return [
    path.join(root, SCOPE_DIR),
    path.join(root, "lib", SCOPE_DIR),
    path.join(root, "@tencent-qqmail", "agently-cli")
  ];
}
function nativeBinaries(pkgRoot) {
  return [
    path.join(pkgRoot, "node_modules", "@tencent-qqmail", PLATFORM_DIR, "bin", exeName()),
    path.join(pkgRoot, "node_modules", PLATFORM_DIR, "bin", exeName())
  ];
}
function describePrefix(root) {
  for (const pkgRoot of packageRoots(root)) {
    for (const exe of nativeBinaries(pkgRoot)) {
      if (isFile(exe)) return { kind: "exe", path: exe };
    }
  }
  const hoisted = path.join(root, PLATFORM_SCOPE_DIR, "bin", exeName());
  if (isFile(hoisted)) return { kind: "exe", path: hoisted };
  for (const pkgRoot of packageRoots(root)) {
    const script = path.join(pkgRoot, "scripts", "run.js");
    if (isFile(script)) return { kind: "node", script };
  }
  return null;
}
function expandVersionDirs(base) {
  const found = [];
  try {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) found.push(path.join(base, entry.name));
    }
  } catch {
  }
  return found;
}
function globalPrefixes() {
  const home = os.homedir();
  const env = process.env;
  const bases = [];
  const push = (value) => {
    if (value) bases.push(value);
  };
  push(env.APPDATA && path.join(env.APPDATA, "npm"));
  push(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "npm"));
  push(env.ProgramFiles && path.join(env.ProgramFiles, "nodejs"));
  push(env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "nodejs"));
  push(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Volta", "bin"));
  push(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Volta", "tools", "image", "node"));
  push(path.join(home, ".volta", "bin"));
  push("/usr/local/bin");
  push("/opt/homebrew/bin");
  push("/usr/local");
  push("/usr/bin");
  const versionRoots = [
    env.APPDATA && path.join(env.APPDATA, "nvm"),
    env.APPDATA && path.join(env.APPDATA, "fnm", "node-versions"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "fnm", "node-versions"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Volta", "tools", "image", "node"),
    path.join(home, ".nvm", "versions", "node"),
    path.join(home, ".workbuddy", "binaries", "node", "versions"),
    path.join(home, "AppData", "Roaming", "npm", "node_modules", "node")
  ].filter(Boolean);
  for (const root of versionRoots) {
    push(root);
    for (const version of expandVersionDirs(root)) {
      push(version);
      push(path.join(version, "installation"));
    }
  }
  return bases;
}
function pathDirs() {
  return String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
}
function resolveCli(override) {
  if (override && isFile(override)) {
    if (/\.(js|mjs|cjs)$/i.test(override)) {
      return { kind: "node", script: override, path: override, source: "settings" };
    }
    return { kind: "exe", path: override, source: "settings" };
  }
  const labelled = [];
  for (const dir of pathDirs()) labelled.push({ root: dir, source: `PATH:${dir}` });
  for (const prefix of globalPrefixes()) labelled.push({ root: prefix, source: `npm-global:${prefix}` });
  for (const entry of labelled) {
    const exe = path.join(entry.root, exeName());
    if (isFile(exe)) return { kind: "exe", path: exe, source: entry.source };
  }
  const described = [];
  for (const entry of labelled) {
    const found = describePrefix(entry.root);
    if (found) described.push({ ...found, source: entry.source });
  }
  const native = described.find((entry) => entry.kind === "exe");
  if (native) return native;
  return described.find((entry) => entry.kind === "node") || null;
}
function pumpLines(readable, onLine) {
  let buffer = "";
  readable.setEncoding("utf8");
  readable.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.search(/\r?\n/);
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + (buffer[index] === "\r" ? 2 : 1));
      if (typeof onLine === "function") onLine(line);
      index = buffer.search(/\r?\n/);
    }
  });
  readable.on("end", () => {
    if (buffer && typeof onLine === "function") onLine(buffer);
  });
}
function wireChild(child, { onLine, onClose } = {}) {
  pumpLines(child.stdout, onLine);
  pumpLines(child.stderr, onLine);
  child.on("error", (error) => {
    if (typeof onLine === "function") onLine(String(error && error.message || error));
    if (typeof onClose === "function") onClose(-1);
  });
  child.on("close", (code) => {
    if (typeof onClose === "function") onClose(code ?? -1);
  });
  return child;
}
function installCli({ onLine, onClose } = {}) {
  const npm = resolveNpm();
  if (!npm) {
    throw new CliError("cli_missing", "未找到 npm。请手动执行：npm install -g @tencent-qqmail/agently-cli");
  }
  const child = spawn(
    process.execPath,
    [npm.script, "install", "-g", "@tencent-qqmail/agently-cli", "--no-audit", "--no-fund"],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        npm_config_yes: "true",
        npm_config_update_notifier: "false"
      }
    }
  );
  return { child: wireChild(child, { onLine, onClose }), npm };
}
function resolveNpm() {
  const cliScript = (root) => {
    const candidates = [
      path.join(root, "node_modules", "npm", "bin", "npm-cli.js"),
      path.join(root, "lib", "node_modules", "npm", "bin", "npm-cli.js")
    ];
    return candidates.find(isFile) || null;
  };
  for (const dir of pathDirs()) {
    const script = cliScript(dir);
    if (script) return { kind: "node", script, source: `PATH:${dir}` };
  }
  for (const prefix of globalPrefixes()) {
    const script = cliScript(prefix);
    if (script) return { kind: "node", script, source: `npm-global:${prefix}` };
  }
  return null;
}
var queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => void 0,
    () => void 0
  );
  return run;
}
function invocation(cli, argv) {
  if (cli.kind === "exe") {
    return { file: cli.path, args: argv, env: {} };
  }
  return {
    file: process.execPath,
    args: [cli.script, ...argv],
    // Inside Electron the host binary doubles as a Node runtime.
    env: { ELECTRON_RUN_AS_NODE: "1" }
  };
}
function runProcess(file, args, { cwd, timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd,
        // Windows: a console subsystem child of a GUI parent otherwise flashes
        // a cmd window. Every spawn in this plugin sets it.
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, AGENTLY_CLI_NO_UPDATE_NOTIFIER: "1", ...env }
      });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: String(error && error.message), spawnError: true });
      return;
    }
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
      }
      finish({ code: -2, stdout, stderr: `${stderr}
[timeout after ${timeoutMs}ms]`, timedOut: true });
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish({ code: -1, stdout, stderr: String(error && error.message), spawnError: true }));
    child.on("close", (code) => finish({ code: code ?? -1, stdout, stderr }));
  });
}
function parseJson(text2) {
  const trimmed = String(text2 || "").replace(/^\uFEFF/, "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}
function firstErrorLine(stderr) {
  const lines = String(stderr || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const explicit = lines.find((line) => /^error:/i.test(line));
  return (explicit || lines[0] || "").replace(/^error:\s*/i, "");
}
function errorFromPayload(parsed) {
  const error = parsed && parsed.error;
  if (!error) return null;
  if (typeof error === "string") return { code: "api_error", message: error };
  const code = error.code || error.type || "api_error";
  const message = error.message || error.detail || JSON.stringify(error);
  return { code, message };
}
function createCli({ logger, getOverride, getWorkspace } = {}) {
  let cached = null;
  let cachedAt = 0;
  let cachedKey = "";
  const log = (level, message) => {
    if (logger && typeof logger[level] === "function") logger[level](message);
  };
  function info(force) {
    const override = typeof getOverride === "function" ? getOverride() : void 0;
    const key = String(override || "");
    const fresh = cached && cachedKey === key && Date.now() - cachedAt < 3e4;
    if (fresh && !force) return cached;
    cached = resolveCli(override);
    cachedAt = Date.now();
    cachedKey = key;
    return cached;
  }
  function call(argv, { cwd, timeoutMs = 3e4, allowFailure = false } = {}) {
    return enqueue(async () => {
      const cli = info();
      if (!cli) {
        throw new CliError(
          "cli_missing",
          "未找到 agently-cli。请先安装：npm install -g @tencent-qqmail/agently-cli"
        );
      }
      const { file, args, env } = invocation(cli, argv);
      const workspace = typeof getWorkspace === "function" ? getWorkspace() : "";
      const childEnv = {
        ...process.env,
        AGENTLY_CLI_NO_UPDATE_NOTIFIER: "1",
        ...env
      };
      if (workspace) childEnv.AGENTLY_WORKSPACE = workspace;
      log("debug", `[dsh-tc-mail] ${file} ${args.join(" ")}`);
      const result = await runProcess(file, args, { cwd, timeoutMs, env: childEnv });
      if (result.timedOut) {
        throw new CliError("cli_error", `agently-cli 调用超时（${Math.round(timeoutMs / 1e3)}s）`, { argv });
      }
      if (result.spawnError) {
        throw new CliError("cli_error", `无法启动 agently-cli：${result.stderr}`, { argv });
      }
      const parsed = parseJson(result.stdout);
      if (result.code !== 0) {
        const message = firstErrorLine(result.stderr) || `agently-cli 退出码 ${result.code}`;
        if (allowFailure) return { parsed, ...result, error: { code: "cli_error", message } };
        throw new CliError("cli_error", message, { argv, stderr: result.stderr });
      }
      if (!parsed) {
        const message = firstErrorLine(result.stderr) || "agently-cli 返回了无法解析的输出";
        if (allowFailure) return { parsed: null, ...result, error: { code: "cli_error", message } };
        throw new CliError("cli_error", message, { argv, stdout: result.stdout.slice(0, 400) });
      }
      const failure = errorFromPayload(parsed);
      if (failure) {
        if (allowFailure) return { parsed, ...result, error: failure };
        throw new CliError(failure.code, failure.message, { argv });
      }
      return { parsed, ...result };
    });
  }
  async function data(argv, options) {
    const { parsed } = await call(argv, options);
    return parsed && parsed.data !== void 0 ? parsed.data : parsed;
  }
  async function version() {
    const cli = info(true);
    if (!cli) return null;
    const { file, args, env } = invocation(cli, ["--version"]);
    const result = await runProcess(file, args, { timeoutMs: 1e4, env });
    const match = /(\d+\.\d+\.\d+[^\s]*)/.exec(result.stdout || "");
    const failed = result.code !== 0 || !match;
    return {
      raw: (result.stdout || "").trim(),
      version: match ? match[1] : null,
      path: cli.path || cli.script,
      kind: cli.kind,
      source: cli.source,
      failed,
      error: failed ? (result.stderr || result.stdout || `exit ${result.code}`).split(/\r?\n/)[0].trim() : null
    };
  }
  function stream(argv, { cwd, onLine, onClose } = {}) {
    const cli = info();
    if (!cli) throw new CliError("cli_missing", "未找到 agently-cli。请先安装：npm install -g @tencent-qqmail/agently-cli");
    const { file, args, env } = invocation(cli, argv);
    const workspace = typeof getWorkspace === "function" ? getWorkspace() : "";
    const childEnv = { ...process.env, AGENTLY_CLI_NO_UPDATE_NOTIFIER: "1", ...env };
    if (workspace) childEnv.AGENTLY_WORKSPACE = workspace;
    const child = spawn(file, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: childEnv });
    return wireChild(child, { onLine, onClose });
  }
  return { call, data, version, stream, info, reset: () => {
    cached = null;
    cachedAt = 0;
  } };
}

// src/host/mail-service.js
import { mkdir as mkdir2, readdir, readFile as readFile2, rm, stat, writeFile as writeFile2 } from "node:fs/promises";
import path3 from "node:path";

// src/host/settings-store.js
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os2 from "node:os";
import path2 from "node:path";
var DATA_DIR = path2.join(os2.homedir(), ".dsh", "tc-mail");
var SETTINGS_FILE = path2.join(DATA_DIR, "settings.json");
var OPS_DIR = path2.join(DATA_DIR, "ops");
var UPLOADS_DIR = path2.join(DATA_DIR, "uploads");
var DOWNLOADS_DIR = path2.join(DATA_DIR, "downloads");
var DIRS = ["inbox", "sent", "trash", "spam"];
var REFRESH_OPTIONS = [0, 30, 60, 300];
var DEFAULT_SETTINGS = Object.freeze({
  font: { family: "", size: 14, color: "" },
  surface: { color: "", opacity: 1, radius: 12 },
  behavior: { dir: "inbox", autoRefreshSec: 60, showImages: false, pageSize: 20 },
  advanced: { cliPath: "", workspace: "" }
});
var clamp = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};
var text = (value, fallback = "") => typeof value === "string" ? value.trim() : fallback;
function normalizeSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const font = source.font && typeof source.font === "object" ? source.font : {};
  const surface = source.surface && typeof source.surface === "object" ? source.surface : {};
  const behavior = source.behavior && typeof source.behavior === "object" ? source.behavior : {};
  const advanced = source.advanced && typeof source.advanced === "object" ? source.advanced : {};
  const opacity = Number(surface.opacity);
  const dir = DIRS.includes(behavior.dir) ? behavior.dir : DEFAULT_SETTINGS.behavior.dir;
  const refresh = REFRESH_OPTIONS.includes(Number(behavior.autoRefreshSec)) ? Number(behavior.autoRefreshSec) : DEFAULT_SETTINGS.behavior.autoRefreshSec;
  return {
    font: {
      family: text(font.family),
      size: Math.round(clamp(font.size, 11, 22, DEFAULT_SETTINGS.font.size)),
      color: text(font.color)
    },
    surface: {
      color: text(surface.color),
      opacity: Number.isFinite(opacity) ? Math.round(clamp(opacity, 0, 1, 1) * 100) / 100 : DEFAULT_SETTINGS.surface.opacity,
      radius: Math.round(clamp(surface.radius, 0, 24, DEFAULT_SETTINGS.surface.radius))
    },
    behavior: {
      dir,
      autoRefreshSec: refresh,
      showImages: Boolean(behavior.showImages),
      pageSize: Math.round(clamp(behavior.pageSize, 10, 50, DEFAULT_SETTINGS.behavior.pageSize))
    },
    advanced: {
      cliPath: text(advanced.cliPath),
      workspace: text(advanced.workspace)
    }
  };
}
function createSettingsStore({ logger } = {}) {
  let cache = null;
  async function load() {
    if (cache) return cache;
    try {
      const raw = await readFile(SETTINGS_FILE, "utf8");
      cache = normalizeSettings(JSON.parse(raw));
    } catch {
      cache = normalizeSettings(DEFAULT_SETTINGS);
    }
    return cache;
  }
  async function save(patch) {
    const current = await load();
    const next = normalizeSettings({
      font: { ...current.font, ...patch && patch.font },
      surface: { ...current.surface, ...patch && patch.surface },
      behavior: { ...current.behavior, ...patch && patch.behavior },
      advanced: { ...current.advanced, ...patch && patch.advanced }
    });
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}
`, "utf8");
    await rename(tmp, SETTINGS_FILE);
    cache = next;
    return next;
  }
  async function reset() {
    cache = normalizeSettings(DEFAULT_SETTINGS);
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(SETTINGS_FILE, `${JSON.stringify(cache, null, 2)}
`, "utf8");
    return cache;
  }
  function peek() {
    return cache || normalizeSettings(DEFAULT_SETTINGS);
  }
  return { load, save, reset, peek, file: SETTINGS_FILE };
}

// src/host/mail-service.js
var DIR_NAMES = /* @__PURE__ */ new Set(["inbox", "sent", "trash", "spam"]);
var attr = (value) => typeof value === "string" ? value.trim() : "";
function dirName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return attr(value.dir_name) || attr(value.name);
  return "";
}
function addressList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry) return null;
    if (typeof entry === "string") return { email: entry.trim(), name: "" };
    const email = attr(entry.email);
    if (!email) return null;
    return { email, name: attr(entry.name) };
  }).filter(Boolean);
}
function normalizeSummary(row) {
  if (!row || typeof row !== "object") return null;
  const id = attr(row.message_id);
  if (!id) return null;
  return {
    id,
    subject: attr(row.subject),
    snippet: attr(row.snippet),
    from: addressList([row.from])[0] || { email: "", name: "" },
    to: addressList(row.to),
    createdAt: attr(row.created_at),
    isRead: row.is_read !== false,
    hasAttachments: Boolean(row.has_attachments),
    dir: dirName(row.dir)
  };
}
function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => ({
    id: attr(entry && entry.attachment_id),
    filename: attr(entry && entry.filename) || `附件 ${index + 1}`,
    contentType: attr(entry && entry.content_type),
    size: Number(entry && entry.size) || 0,
    downloadUrl: attr(entry && entry.download_url)
  }));
}
function normalizeDetail(row) {
  const summary = normalizeSummary(row) || { id: "", subject: "", snippet: "", from: { email: "", name: "" }, to: [], createdAt: "", isRead: true, hasAttachments: false, dir: "" };
  return {
    ...summary,
    cc: addressList(row && row.cc),
    bcc: addressList(row && row.bcc),
    body: typeof (row && row.body) === "string" ? row.body : "",
    bodyFormat: attr(row && row.body_format).toUpperCase() || "PLAIN",
    attachments: normalizeAttachments(row && row.attachments),
    attachmentCount: Number(row && row.attachment_count) || 0,
    rfcMessageId: attr(row && row.rfc_message_id),
    calendarIcs: attr(row && row.calendar_ics)
  };
}
function paginationOf(data) {
  const pagination = data && data.pagination || {};
  return {
    hasMore: Boolean(pagination.has_more),
    nextCursor: attr(pagination.next_cursor) || null,
    previousCursor: attr(pagination.previous_cursor) || null
  };
}
function rowsOf(data) {
  if (!data) return [];
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}
function safeFileName(name2, fallback = "attachment") {
  const base = String(name2 || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^[._\-\s]+/, "").trim();
  return (base || fallback).slice(0, 120);
}
function todayStartIso() {
  const now = /* @__PURE__ */ new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return start.toISOString();
}
function createMailService({ cli, settings, logger }) {
  const log = (level, message) => {
    if (logger && typeof logger[level] === "function") logger[level](message);
  };
  function requireLoggedIn(auth) {
    if (auth && auth.loggedIn === false) {
      throw new CliError("not_logged_in", "尚未授权 Agent Mail。请先执行：agently-cli auth login");
    }
  }
  async function authStatus() {
    try {
      const data = await cli.data(["auth", "status"], { timeoutMs: 15e3 });
      return {
        loggedIn: Boolean(data && data.logged_in),
        status: attr(data && data.status) || "unknown",
        workspace: attr(data && data.workspace) || "default",
        storage: attr(data && data.storage),
        expiresAt: attr(data && data.expires_at),
        tokenStatus: attr(data && data.token_status)
      };
    } catch (error) {
      return { loggedIn: false, status: "error", workspace: "default", error: error && error.message };
    }
  }
  let healthCache = null;
  let healthAt = 0;
  async function health({ force = false } = {}) {
    if (!force && healthCache && Date.now() - healthAt < 15e3) return healthCache;
    const version = await cli.version();
    if (!version || !version.version) {
      healthCache = {
        ready: false,
        // A package can be installed yet unusable (platform binary missing,
        // broken global prefix). Telling the two apart decides whether the UI
        // offers "install" or "reinstall".
        reason: version ? "cli_broken" : "cli_missing",
        cli: version,
        auth: { loggedIn: false, status: "unknown" },
        account: null
      };
      healthAt = Date.now();
      return healthCache;
    }
    const auth = await authStatus();
    let account = null;
    let sentToday = null;
    if (auth.loggedIn) {
      try {
        const me = await cli.data(["+me"], { timeoutMs: 2e4 });
        const aliases = Array.isArray(me && me.aliases) ? me.aliases : [];
        const primary = aliases.find((entry) => entry && entry.is_primary) || aliases[0] || null;
        const quota = Number(me && me.rate_limits && me.rate_limits.daily_send_quota) || null;
        account = {
          aliasId: attr(primary && primary.alias_id),
          email: attr(primary && primary.email),
          name: attr(primary && primary.name),
          quota,
          constraints: me && me.constraints || null,
          scopes: Array.isArray(me && me.scopes) ? me.scopes : []
        };
        try {
          const data = await cli.data(
            ["message", "+list", "--dir", "sent", "--after", todayStartIso(), "--limit", "50"],
            { timeoutMs: 2e4 }
          );
          sentToday = rowsOf(data).length;
        } catch {
          sentToday = null;
        }
      } catch (error) {
        account = { error: error && error.message };
      }
    }
    healthCache = {
      ready: Boolean(auth.loggedIn),
      reason: auth.loggedIn ? null : "not_logged_in",
      cli: version,
      auth,
      account,
      sentToday
    };
    healthAt = Date.now();
    return healthCache;
  }
  async function list({ dir = "inbox", limit = 20, cursor = null, unreadOnly = false, since = null } = {}) {
    const folder = DIR_NAMES.has(dir) ? dir : "inbox";
    const argv = ["message", "+list", "--dir", folder, "--limit", String(Math.min(50, Math.max(1, Number(limit) || 20)))];
    if (cursor) argv.push("--cursor", cursor);
    if (unreadOnly) argv.push("--is-unread");
    if (since) argv.push("--after", since);
    const data = await cli.data(argv, { timeoutMs: 25e3 });
    return {
      items: rowsOf(data).map(normalizeSummary).filter(Boolean),
      pagination: paginationOf(data),
      dir: folder
    };
  }
  async function read(id) {
    const messageId = attr(id);
    if (!messageId) throw new CliError("bad_request", "缺少邮件 ID");
    const data = await cli.data(["message", "+read", "--id", messageId], { timeoutMs: 3e4 });
    return normalizeDetail(data);
  }
  async function search({ q = "", dir = "inbox", limit = 20, cursor = null, from = "", to = "" } = {}) {
    const keyword = attr(q);
    if (!keyword) return { items: [], pagination: { hasMore: false, nextCursor: null }, query: "" };
    const folder = DIR_NAMES.has(dir) ? dir : "inbox";
    const argv = [
      "message",
      "+search",
      "--q",
      keyword,
      "--dir",
      folder,
      "--limit",
      String(Math.min(50, Math.max(1, Number(limit) || 20)))
    ];
    if (cursor) argv.push("--cursor", cursor);
    if (from) argv.push("--from", from);
    if (to) argv.push("--to", to);
    const data = await cli.data(argv, { timeoutMs: 3e4 });
    return {
      items: rowsOf(data).map(normalizeSummary).filter(Boolean),
      pagination: paginationOf(data),
      query: keyword
    };
  }
  async function withOpDir(run) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const dir = path3.join(OPS_DIR, id);
    await mkdir2(dir, { recursive: true });
    try {
      return await run(dir);
    } finally {
      setTimeout(() => {
        rm(dir, { recursive: true, force: true }).catch(() => {
        });
      }, 12e4).unref?.();
    }
  }
  async function stageBody(dir, body, format) {
    const text2 = typeof body === "string" ? body : "";
    if (!text2.trim()) throw new CliError("bad_request", "正文不能为空");
    const ext = format === "html" ? "html" : format === "markdown" ? "md" : "txt";
    const name2 = `body.${ext}`;
    await writeFile2(path3.join(dir, name2), text2, "utf8");
    return { arg: `./${name2}`, format: format === "html" ? "html" : format === "markdown" ? "markdown" : "plain" };
  }
  async function stageAttachments(dir, uploads) {
    const list2 = Array.isArray(uploads) ? uploads.filter((entry) => entry && entry.uploadId) : [];
    const staged = [];
    const used = /* @__PURE__ */ new Set();
    for (const upload of list2) {
      const uploadId = safeFileName(upload.uploadId, "");
      if (!uploadId) continue;
      const source = path3.join(UPLOADS_DIR, uploadId, "file");
      try {
        const buffer = await readFile2(source);
        const base = safeFileName(upload.name || "attachment");
        const ext = path3.extname(base);
        let name2 = base;
        let counter = 2;
        while (used.has(name2.toLowerCase())) {
          name2 = `${path3.basename(base, ext)} (${counter})${ext}`;
          counter += 1;
        }
        used.add(name2.toLowerCase());
        await writeFile2(path3.join(dir, name2), buffer);
        staged.push(`./${name2}`);
      } catch {
        log("warn", `[dsh-tc-mail] 附件暂存失败：${uploadId}`);
      }
    }
    return staged;
  }
  async function confirmed(argvFactory, { timeoutMs = 6e4, cwd, dryRun = false } = {}) {
    if (dryRun) {
      const { parsed } = await cli.call([...argvFactory(), "--dry-run"], { timeoutMs, cwd });
      return { dryRun: true, plan: parsed };
    }
    const first = await cli.data(argvFactory(), { timeoutMs, cwd });
    if (first && first.confirmation_required) {
      const token = attr(first.confirmation_token);
      if (!token) throw new CliError("needs_confirm", first && first.message || "该操作需要二次确认，但未取得确认令牌");
      return cli.data(argvFactory(token), { timeoutMs, cwd });
    }
    return first;
  }
  async function send({ to, cc, bcc, subject, body, bodyFormat = "plain", attachments = [], dryRun = false } = {}) {
    const recipients = (Array.isArray(to) ? to : []).map(attr).filter(Boolean);
    if (!recipients.length) throw new CliError("bad_request", "至少需要一个收件人");
    const title = attr(subject);
    if (!title) throw new CliError("bad_request", "主题不能为空");
    return withOpDir(async (dir) => {
      const staged = await stageBody(dir, body, bodyFormat);
      const attachArgs = await stageAttachments(dir, attachments);
      const build = (token) => {
        const argv = ["message", "+send"];
        for (const address of recipients) argv.push("--to", address);
        for (const address of (cc || []).map(attr).filter(Boolean)) argv.push("--cc", address);
        for (const address of (bcc || []).map(attr).filter(Boolean)) argv.push("--bcc", address);
        argv.push("--subject", title, "--body-file", staged.arg, "--body-format", staged.format);
        for (const file of attachArgs) argv.push("--attachment", file);
        if (token) argv.push("--confirmation-token", token);
        else argv.push("--confirmed");
        return argv;
      };
      const result = await confirmed(build, { timeoutMs: 12e4, cwd: dir, dryRun });
      if (result && result.dryRun) return { dryRun: true, plan: result.plan, recipients, subject: title, attachmentCount: attachArgs.length };
      return { queued: result ? result.queued !== false : true, recipients, subject: title, attachmentCount: attachArgs.length };
    });
  }
  async function reply({ id, body, bodyFormat = "plain", replyAll = false, cc = [], bcc = [], attachments = [], dryRun = false } = {}) {
    const messageId = attr(id);
    if (!messageId) throw new CliError("bad_request", "缺少邮件 ID");
    return withOpDir(async (dir) => {
      const staged = await stageBody(dir, body, bodyFormat === "markdown" ? "plain" : bodyFormat);
      const attachArgs = await stageAttachments(dir, attachments);
      const build = (token) => {
        const argv = ["message", "+reply", "--id", messageId, "--body-file", staged.arg, "--body-format", staged.format];
        for (const address of (cc || []).map(attr).filter(Boolean)) argv.push("--cc", address);
        for (const address of (bcc || []).map(attr).filter(Boolean)) argv.push("--bcc", address);
        for (const file of attachArgs) argv.push("--attachment", file);
        if (replyAll) argv.push("--reply-all");
        if (token) argv.push("--confirmation-token", token);
        else argv.push("--confirmed");
        return argv;
      };
      const result = await confirmed(build, { timeoutMs: 12e4, cwd: dir, dryRun });
      if (result && result.dryRun) return { dryRun: true, plan: result.plan, id: messageId, replyAll: Boolean(replyAll) };
      return { queued: result ? result.queued !== false : true, id: messageId, replyAll: Boolean(replyAll) };
    });
  }
  async function forward({ id, to, body = "", cc = [], bcc = [], includeAttachments = true, dryRun = false } = {}) {
    const messageId = attr(id);
    if (!messageId) throw new CliError("bad_request", "缺少邮件 ID");
    const recipients = (Array.isArray(to) ? to : []).map(attr).filter(Boolean);
    if (!recipients.length) throw new CliError("bad_request", "至少需要一个转发收件人");
    return withOpDir(async (dir) => {
      const note = typeof body === "string" ? body.trim() : "";
      const staged = note ? await stageBody(dir, note, "plain") : null;
      const build = (token) => {
        const argv = ["message", "+forward", "--id", messageId];
        for (const address of recipients) argv.push("--to", address);
        for (const address of (cc || []).map(attr).filter(Boolean)) argv.push("--cc", address);
        for (const address of (bcc || []).map(attr).filter(Boolean)) argv.push("--bcc", address);
        if (staged) argv.push("--body-file", staged.arg, "--body-format", staged.format);
        if (includeAttachments) argv.push("--include-attachments");
        if (token) argv.push("--confirmation-token", token);
        else argv.push("--confirmed");
        return argv;
      };
      const result = await confirmed(build, { timeoutMs: 12e4, cwd: dir, dryRun });
      if (result && result.dryRun) return { dryRun: true, plan: result.plan, id: messageId, recipients };
      return { queued: result ? result.queued !== false : true, id: messageId, recipients };
    });
  }
  async function softDeleteOne(id) {
    return confirmed((token) => {
      const argv = ["message", "+trash", "--id", id];
      if (token) argv.push("--confirmation-token", token);
      return argv;
    });
  }
  async function removeOne(id) {
    try {
      await confirmed((token) => {
        const argv = ["message", "+delete", "--id", id];
        if (token) argv.push("--confirmation-token", token);
        return argv;
      });
      return "direct";
    } catch (error) {
      log("warn", `[dsh-tc-mail] 直接永久删除失败，先移入垃圾箱重试：${error && error.message || error}`);
      await softDeleteOne(id);
      await confirmed((token) => {
        const argv = ["message", "+delete", "--id", id];
        if (token) argv.push("--confirmation-token", token);
        return argv;
      });
      return "via-trash";
    }
  }
  async function remove({ ids = [], all = false } = {}) {
    if (all) {
      const result = await confirmed((token) => {
        const argv = ["message", "+delete", "--all"];
        if (token) argv.push("--confirmation-token", token);
        return argv;
      });
      return { deletedCount: Number(result && result.deleted_count) || 0, deletes: [], mode: "all" };
    }
    const messageIds = (Array.isArray(ids) ? ids : [ids]).map(attr).filter(Boolean);
    if (!messageIds.length) throw new CliError("bad_request", "未选择邮件");
    const deletes = [];
    const failed = [];
    const modes = /* @__PURE__ */ new Set();
    for (const id of messageIds) {
      try {
        modes.add(await removeOne(id));
        deletes.push(id);
      } catch (error) {
        failed.push({ id, message: error && error.message });
      }
    }
    if (!deletes.length && failed.length) {
      throw new CliError("cli_error", failed[0].message || "删除失败", { failed });
    }
    return { deletedCount: deletes.length, deletes, failed, mode: [...modes].join(",") };
  }
  async function sweepUploads() {
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1e3;
      for (const entry of await readdir(UPLOADS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = path3.join(UPLOADS_DIR, entry.name);
        const info = await stat(full);
        if (info.mtimeMs < cutoff) await rm(full, { recursive: true, force: true });
      }
    } catch {
    }
  }
  async function saveUpload({ name: name2, data } = {}) {
    const buffer = Buffer.from(String(data || "").replace(/^data:[^;]+;base64,/, ""), "base64");
    if (!buffer.length) throw new CliError("bad_request", "附件内容为空");
    void sweepUploads();
    const uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const dir = path3.join(UPLOADS_DIR, uploadId);
    await mkdir2(dir, { recursive: true });
    await writeFile2(path3.join(dir, "file"), buffer);
    await writeFile2(
      path3.join(dir, "meta.json"),
      JSON.stringify({ name: safeFileName(name2 || "attachment"), size: buffer.length }),
      "utf8"
    );
    return { uploadId, name: safeFileName(name2 || "attachment"), size: buffer.length };
  }
  async function downloadAttachment({ messageId, attachmentId, filename } = {}) {
    const msg = attr(messageId);
    const att = attr(attachmentId);
    if (!msg || !att) throw new CliError("bad_request", "缺少邮件或附件 ID");
    await mkdir2(DOWNLOADS_DIR, { recursive: true });
    const data = await cli.data(
      ["attachment", "+download", "--msg", msg, "--att", att, "--output", "."],
      { cwd: DOWNLOADS_DIR, timeoutMs: 12e4 }
    );
    return { savedTo: attr(data && data.saved_to), filename: attr(data && data.filename) || safeFileName(filename) };
  }
  return {
    health,
    authStatus,
    list,
    read,
    search,
    send,
    reply,
    forward,
    remove,
    saveUpload,
    downloadAttachment,
    invalidate: () => {
      healthCache = null;
      healthAt = 0;
    }
  };
}

// src/host/routes.js
var API_PREFIX = "/api/dsh-tc-mail";
var JSON_BODY_LIMIT = 512 * 1024;
var UPLOAD_BODY_LIMIT = 32 * 1024 * 1024;
var LOOPBACK = /* @__PURE__ */ new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);
function isLoopback(req) {
  const address = req.socket && req.socket.remoteAddress;
  if (!address) return true;
  return LOOPBACK.has(address);
}
function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new CliError("bad_request", "请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new CliError("bad_request", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}
function statusFor(code) {
  switch (code) {
    case "bad_request":
      return 400;
    case "not_logged_in":
      return 401;
    case "needs_confirm":
      return 409;
    case "cli_missing":
      return 424;
    default:
      return 500;
  }
}
function registerRoutes({ webServer, mail, cli, settings, logger, runtime }) {
  const log = (level, message) => {
    if (logger && typeof logger[level] === "function") logger[level](message);
  };
  const login = {
    status: "idle",
    url: null,
    log: [],
    startedAt: 0,
    exitCode: null
  };
  const install = {
    status: "idle",
    log: [],
    startedAt: 0,
    exitCode: null,
    npm: null
  };
  function resetLogin() {
    login.status = "idle";
    login.url = null;
    login.log = [];
    login.startedAt = 0;
    login.exitCode = null;
  }
  async function handle(req, res) {
    if (!isLoopback(req)) {
      writeJson(res, 403, { ok: false, code: "forbidden", message: "仅允许本机访问" });
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const sub = url.pathname.slice(API_PREFIX.length) || "/";
    const method = req.method || "GET";
    if (sub === "/health" && method === "GET") {
      const health = await mail.health({ force: url.searchParams.get("force") === "1" });
      writeJson(res, 200, { ok: true, data: { ...health, tools: runtime && runtime.tools || [], toolError: runtime && runtime.toolError || null } });
      return;
    }
    if (sub === "/settings") {
      if (method === "GET") {
        writeJson(res, 200, { ok: true, data: await settings.load() });
        return;
      }
      if (method === "PUT") {
        const patch = await readBody(req, JSON_BODY_LIMIT);
        const next = await settings.save(patch);
        if (patch && patch.advanced) {
          cli.reset();
          mail.invalidate();
        }
        writeJson(res, 200, { ok: true, data: next });
        return;
      }
      writeJson(res, 405, { ok: false, code: "bad_request", message: "方法不允许" });
      return;
    }
    if (sub === "/settings/reset" && method === "POST") {
      const next = await settings.reset();
      cli.reset();
      mail.invalidate();
      writeJson(res, 200, { ok: true, data: next });
      return;
    }
    if (sub === "/setup/install") {
      if (method === "GET") {
        writeJson(res, 200, { ok: true, data: { ...install, log: install.log.slice(-30) } });
        return;
      }
      if (method === "POST") {
        if (install.status === "running") {
          writeJson(res, 200, { ok: true, data: { ...install, log: install.log.slice(-30) } });
          return;
        }
        install.status = "running";
        install.log = ["正在通过 npm 安装 @tencent-qqmail/agently-cli …"];
        install.startedAt = Date.now();
        install.exitCode = null;
        try {
          const started = installCli({
            onLine(line) {
              const trimmed = String(line || "").trimEnd();
              if (!trimmed) return;
              install.log.push(trimmed);
              if (install.log.length > 300) install.log.splice(0, install.log.length - 300);
            },
            onClose(code) {
              install.exitCode = code;
              install.status = code === 0 ? "done" : "failed";
              cli.reset();
              mail.invalidate();
            }
          });
          install.npm = started.npm ? started.npm.source : null;
        } catch (error) {
          install.status = "failed";
          install.exitCode = -1;
          install.log.push(String(error && error.message || error));
        }
        writeJson(res, 200, { ok: true, data: { ...install, log: install.log.slice(-30) } });
        return;
      }
      writeJson(res, 405, { ok: false, code: "bad_request", message: "方法不允许" });
      return;
    }
    if (sub === "/auth/login") {
      if (method === "GET") {
        writeJson(res, 200, { ok: true, data: { ...login, log: login.log.slice(-40) } });
        return;
      }
      if (method === "POST") {
        if (login.status === "waiting") {
          writeJson(res, 200, { ok: true, data: { ...login, log: login.log.slice(-40) } });
          return;
        }
        resetLogin();
        login.status = "waiting";
        login.startedAt = Date.now();
        login.log.push("正在启动 agently-cli auth login …");
        try {
          cli.stream(["auth", "login"], {
            onLine(line) {
              const trimmed = String(line || "").trim();
              if (!trimmed) return;
              login.log.push(trimmed);
              if (login.log.length > 200) login.log.splice(0, login.log.length - 200);
              if (!login.url) {
                const match = /https?:\/\/[^\s"'<>]+/.exec(trimmed);
                if (match) login.url = match[0];
              }
            },
            onClose(code) {
              login.exitCode = code;
              login.status = code === 0 ? "done" : "failed";
              if (code === 0) {
                cli.reset();
                mail.invalidate();
              }
            }
          });
        } catch (error) {
          login.status = "failed";
          login.log.push(String(error && error.message || error));
        }
        writeJson(res, 200, { ok: true, data: { ...login, log: login.log.slice(-40) } });
        return;
      }
      writeJson(res, 405, { ok: false, code: "bad_request", message: "方法不允许" });
      return;
    }
    if (sub === "/messages" && method === "GET") {
      const params = url.searchParams;
      const data = await mail.list({
        dir: params.get("dir") || "inbox",
        limit: Number(params.get("limit")) || 20,
        cursor: params.get("cursor") || null,
        unreadOnly: params.get("unread") === "1"
      });
      writeJson(res, 200, { ok: true, data });
      return;
    }
    if (sub.startsWith("/messages/") && method === "GET") {
      const id = decodeURIComponent(sub.slice("/messages/".length));
      writeJson(res, 200, { ok: true, data: await mail.read(id) });
      return;
    }
    if (sub === "/search" && method === "GET") {
      const params = url.searchParams;
      const data = await mail.search({
        q: params.get("q") || "",
        dir: params.get("dir") || "inbox",
        limit: Number(params.get("limit")) || 20,
        cursor: params.get("cursor") || null
      });
      writeJson(res, 200, { ok: true, data });
      return;
    }
    if (sub === "/send" && method === "POST") {
      writeJson(res, 200, { ok: true, data: await mail.send(await readBody(req, JSON_BODY_LIMIT)) });
      return;
    }
    if (sub === "/reply" && method === "POST") {
      writeJson(res, 200, { ok: true, data: await mail.reply(await readBody(req, JSON_BODY_LIMIT)) });
      return;
    }
    if (sub === "/forward" && method === "POST") {
      writeJson(res, 200, { ok: true, data: await mail.forward(await readBody(req, JSON_BODY_LIMIT)) });
      return;
    }
    if (sub === "/trash" && method === "POST") {
      writeJson(res, 200, { ok: true, data: await mail.trash(await readBody(req, JSON_BODY_LIMIT)) });
      return;
    }
    if (sub === "/delete" && method === "POST") {
      writeJson(res, 200, { ok: true, data: await mail.remove(await readBody(req, JSON_BODY_LIMIT)) });
      return;
    }
    if (sub === "/upload" && method === "POST") {
      writeJson(res, 200, { ok: true, data: await mail.saveUpload(await readBody(req, UPLOAD_BODY_LIMIT)) });
      return;
    }
    if (sub === "/attachment" && method === "GET") {
      const params = url.searchParams;
      const data = await mail.downloadAttachment({
        messageId: params.get("msg"),
        attachmentId: params.get("att"),
        filename: params.get("name")
      });
      writeJson(res, 200, { ok: true, data });
      return;
    }
    writeJson(res, 404, { ok: false, code: "bad_request", message: `未知接口：${sub}` });
  }
  return webServer.register({
    kind: "prefix",
    path: API_PREFIX,
    handler: async (req, res) => {
      try {
        await handle(req, res);
      } catch (error) {
        const code = error instanceof CliError ? error.code : "internal_error";
        const message = error && error.message || "未知错误";
        if (code === "internal_error") log("error", `[dsh-tc-mail] ${message}
${error && error.stack || ""}`);
        if (!res.headersSent) writeJson(res, statusFor(code), { ok: false, code, message });
        else res.end();
      }
    }
  });
}

// src/host/tools.js
var MAIL_PROMPT = [
  "本机已挂载「我的邮箱」（腾讯 Agent Mail，Harness 左侧栏入口），这是用户在 Harness 里最优先的收发邮件通道。",
  "默认路由规则：除非用户在本次对话中明确要求改用其它邮箱或 IMAP 账号（并给出对应的账号与鉴权配置），否则一律用本插件的 mail_* 工具、以本机已授权的 Agent Mail 账号发信。不要自行切换到别的邮件方案，也不需要先问「用哪个邮箱发」——默认就是它。",
  "可用工具：",
  "- mail_health：查询当前发件地址、今日已发数量与额度（不确定地址时先调它）；",
  "- mail_list：列出收件箱或发件箱的邮件摘要；",
  "- mail_read：按 message_id 读取正文与附件；",
  "- mail_search：按关键词搜索邮件；",
  "- mail_send：用已授权账号发送邮件（收件人数组 + 主题 + 纯文本正文）。",
  "发信前必须把收件人、主题、正文回读给用户确认。",
  "删除不可恢复（该邮箱没有回收站），工具层未开放：用户要删邮件时，引导他们在邮件面板里勾选后删除。"
].join("\n");
var textRender = (formatter) => (_args, value) => [{ type: "text", text: formatter(value) }];
function addressSchema() {
  return { type: "array", items: { type: "string" }, description: "邮箱地址数组" };
}
function buildTools({ mail }) {
  return [
    {
      name: "mail_list",
      description: "列出 Agent Mail 邮箱中的邮件摘要。dir 可选 inbox（收件箱）或 sent（发件箱）。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          dir: { type: "string", enum: ["inbox", "sent"], description: "文件夹，默认 inbox" },
          limit: { type: "number", description: "返回条数，1-50，默认 10" },
          unread_only: { type: "boolean", description: "仅返回未读邮件" }
        }
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: true,
          properties: {
            items: { type: "array" },
            hasMore: { type: "boolean" },
            nextCursor: { type: "string", description: "下一页游标，末页时为空" }
          }
        },
        render: textRender((value) => {
          const items = value && value.items || [];
          if (!items.length) return "没有符合条件的邮件。";
          const lines = items.map((item, index) => {
            const flag = item.isRead ? "  " : "● ";
            const from = item.from && (item.from.name || item.from.email) || "未知发件人";
            return `${index + 1}. ${flag}${item.subject || "(无主题)"} — ${from} — ${item.createdAt || ""} — ${item.id}`;
          });
          lines.push(value && value.hasMore ? "（还有更多，可传 cursor 继续翻页）" : "（已到末页）");
          return lines.join("\n");
        })
      },
      async execute(args) {
        return mail.list({
          dir: args && args.dir || "inbox",
          limit: Number(args && args.limit) || 10,
          unreadOnly: Boolean(args && args.unread_only)
        });
      }
    },
    {
      name: "mail_read",
      description: "读取一封邮件的完整正文、收发件人与附件列表。需要 message_id（可从 mail_list 或 mail_search 获得）。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", description: "邮件 ID（msg_ 前缀）" }
        }
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: textRender((value) => {
          if (!value) return "未找到该邮件。";
          const from = value.from && (value.from.name || value.from.email) || "";
          const to = (value.to || []).map((entry) => entry.email).join(", ");
          const attachments = (value.attachments || []).map((entry) => entry.filename).join(", ");
          const body = String(value.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          return [
            `主题：${value.subject || "(无主题)"}`,
            `发件人：${from}`,
            `收件人：${to}`,
            `时间：${value.createdAt || ""}`,
            `格式：${value.bodyFormat}`,
            attachments ? `附件：${attachments}` : "",
            "",
            body.slice(0, 4e3)
          ].filter(Boolean).join("\n");
        })
      },
      async execute(args) {
        return mail.read(args && args.id);
      }
    },
    {
      name: "mail_search",
      description: "按关键词搜索邮箱中的邮件（默认在主题与正文中搜索）。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["q"],
        properties: {
          q: { type: "string", description: "搜索关键词或短语" },
          dir: { type: "string", enum: ["inbox", "sent"], description: "文件夹，默认 inbox" },
          limit: { type: "number", description: "返回条数，1-50，默认 10" }
        }
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: textRender((value) => {
          const items = value && value.items || [];
          if (!items.length) return "没有匹配的邮件。";
          return items.map((item, index) => `${index + 1}. ${item.subject || "(无主题)"} — ${item.from && item.from.email || ""} — ${item.createdAt || ""} — ${item.id}`).join("\n");
        })
      },
      async execute(args) {
        return mail.search({
          q: args && args.q,
          dir: args && args.dir || "inbox",
          limit: Number(args && args.limit) || 10
        });
      }
    },
    {
      name: "mail_send",
      description: "发送一封新邮件。发信前请把收件人、主题与正文回读给用户确认。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["to", "subject", "body"],
        properties: {
          to: addressSchema(),
          subject: { type: "string", description: "邮件主题" },
          body: { type: "string", description: "纯文本正文" },
          cc: addressSchema(),
          bcc: addressSchema()
        }
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: textRender((value) => `已提交发送：${value && value.subject || ""} → ${(value && value.recipients || []).join(", ")}`)
      },
      async execute(args) {
        return mail.send({
          to: args && args.to || [],
          cc: args && args.cc || [],
          bcc: args && args.bcc || [],
          subject: args && args.subject || "",
          body: args && args.body || "",
          bodyFormat: "plain"
        });
      }
    },
    {
      name: "mail_health",
      description: "查询当前 Agent Mail 的授权状态、发件邮箱地址与今日发信额度。发信前不确定用哪个地址时调用。",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: textRender((value) => {
          if (!value || !value.ready) return `尚未就绪：${value && value.reason || "未知原因"}`;
          const account = value.account || {};
          const quota = account.quota || "—";
          const used = Number.isFinite(value.sentToday) ? value.sentToday : "—";
          return `发件账号：${account.email || "未知"}（今日已发 ${used}/${quota}）`;
        })
      },
      async execute() {
        const health = await mail.health();
        return {
          ready: health.ready,
          reason: health.reason,
          email: health.account && health.account.email,
          quota: health.account && health.account.quota,
          sentToday: health.sentToday
        };
      }
    }
  ];
}
function registerTools({ ctx, mail }) {
  const tools = buildTools({ mail });
  const disposers = tools.map((tool) => ctx.tools.register(tool));
  return {
    names: tools.map((tool) => tool.name),
    dispose() {
      for (const dispose of disposers) {
        if (typeof dispose === "function") dispose();
      }
    }
  };
}

// src/host/index.js
var name = "dsh-tc-mail";
var inject = ["webServer", "tools", "systemPrompt"];
function pickLogger(ctx) {
  try {
    const logger = ctx.logger("dsh-tc-mail");
    if (logger && typeof logger.info === "function") return logger;
  } catch {
  }
  return console;
}
function apply(ctx) {
  const logger = pickLogger(ctx);
  const settings = createSettingsStore({ logger });
  void settings.load();
  const cli = createCli({
    logger,
    getOverride: () => settings.peek().advanced.cliPath,
    getWorkspace: () => settings.peek().advanced.workspace
  });
  const mail = createMailService({ cli, settings, logger });
  const runtime = { tools: [], toolError: null };
  ctx.effect(
    () => {
      try {
        return registerRoutes({ webServer: ctx.webServer, mail, cli, settings, logger, runtime });
      } catch (error) {
        logger.warn(`[dsh-tc-mail] 路由注册失败（可能重复安装）：${error && error.message || error}`);
        return () => {
        };
      }
    },
    "dsh-tc-mail: http routes"
  );
  ctx.effect(
    () => {
      try {
        const registration = registerTools({ ctx, mail });
        runtime.tools = registration.names;
        runtime.toolError = null;
        console.log(`[dsh-tc-mail] agent tools registered: ${registration.names.join(", ")}`);
        return () => {
          runtime.tools = [];
          registration.dispose();
        };
      } catch (error) {
        const message = error && error.stack || String(error);
        runtime.toolError = message.slice(0, 400);
        logger.warn(`[dsh-tc-mail] 工具注册失败：${message}`);
        console.error(`[dsh-tc-mail] tool registration failed: ${message}`);
        return () => {
        };
      }
    },
    "dsh-tc-mail: agent tools"
  );
  ctx.effect(
    () => {
      try {
        const dispose = ctx.systemPrompt.section({ name: "tool:dsh-tc-mail", order: 150, text: MAIL_PROMPT });
        return typeof dispose === "function" ? dispose : () => {
        };
      } catch (error) {
        logger.warn(`[dsh-tc-mail] 提示词注入失败：${error && error.message || error}`);
        return () => {
        };
      }
    },
    "dsh-tc-mail: prompt section"
  );
}
export {
  apply,
  inject,
  name
};
