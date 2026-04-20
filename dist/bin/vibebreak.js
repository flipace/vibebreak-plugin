#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/tsup/assets/esm_shims.js
var init_esm_shims = __esm({
  "node_modules/tsup/assets/esm_shims.js"() {
    "use strict";
  }
});

// src/shared.ts
import { z } from "zod";
var TOKEN_THRESHOLD_DEFAULT, IDLE_PAUSE_MS, PAIR_CODE_LENGTH, EXERCISES, EXERCISE_DEFAULT_TARGET, ExerciseKindSchema, GateCreateInputSchema, GateResponseSchema, PairInitInputSchema, PairInitResponseSchema, PairStatusResponseSchema, MeterHeartbeatInputSchema, MeterHeartbeatResponseSchema, MeProfileResponseSchema, WsServerHelloSchema, WsServerGateUnlockSchema, WsServerPingSchema, WsServerMessageSchema;
var init_shared = __esm({
  "src/shared.ts"() {
    "use strict";
    init_esm_shims();
    TOKEN_THRESHOLD_DEFAULT = 25e4;
    IDLE_PAUSE_MS = 2 * 60 * 1e3;
    PAIR_CODE_LENGTH = 10;
    EXERCISES = ["push_up", "squat", "jumping_jack", "plank", "breathing"];
    EXERCISE_DEFAULT_TARGET = {
      push_up: 10,
      squat: 15,
      jumping_jack: 30,
      plank: 30,
      breathing: 60
    };
    ExerciseKindSchema = z.enum(EXERCISES);
    GateCreateInputSchema = z.object({
      thresholdTokens: z.number().int().positive(),
      sessionId: z.string().uuid().optional()
    });
    GateResponseSchema = z.object({
      id: z.string().uuid(),
      exerciseKind: ExerciseKindSchema,
      repsTarget: z.number().int().positive(),
      triggeredAt: z.string().datetime(),
      thresholdTokens: z.number().int().nonnegative()
    });
    PairInitInputSchema = z.object({
      label: z.string().min(1).max(80),
      platform: z.string().min(1).max(40),
      pluginVersion: z.string().min(1).max(20)
    });
    PairInitResponseSchema = z.object({
      deviceId: z.string().uuid(),
      pairCode: z.string().length(PAIR_CODE_LENGTH),
      expiresAt: z.string().datetime()
    });
    PairStatusResponseSchema = z.object({
      status: z.enum(["pending", "completed", "expired"]),
      deviceJwt: z.string().min(1).nullable()
    });
    MeterHeartbeatInputSchema = z.object({
      current: z.number().int().nonnegative(),
      threshold: z.number().int().positive()
    });
    MeterHeartbeatResponseSchema = z.object({
      ok: z.literal(true),
      threshold: z.number().int().positive()
    });
    MeProfileResponseSchema = z.object({
      id: z.string().uuid(),
      handle: z.string(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
      thresholdTokens: z.number().int().positive(),
      publicProfile: z.boolean()
    });
    WsServerHelloSchema = z.object({
      type: z.literal("hello"),
      deviceId: z.string().uuid()
    });
    WsServerGateUnlockSchema = z.object({
      type: z.literal("gate_unlock"),
      gateId: z.string().uuid()
    });
    WsServerPingSchema = z.object({
      type: z.literal("ping")
    });
    WsServerMessageSchema = z.discriminatedUnion("type", [
      WsServerHelloSchema,
      WsServerGateUnlockSchema,
      WsServerPingSchema
    ]);
  }
});

// src/config.ts
var config_exports = {};
__export(config_exports, {
  clearJwt: () => clearJwt,
  configDir: () => configDir,
  configPath: () => configPath,
  defaults: () => defaults,
  ensureIngestSecret: () => ensureIngestSecret,
  ensureSaved: () => ensureSaved,
  isPaired: () => isPaired,
  load: () => load,
  redactConfig: () => redactConfig,
  save: () => save,
  socketPath: () => socketPath
});
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function configDir() {
  return join(homedir(), ".vibebreak");
}
function configPath() {
  return join(configDir(), "config.json");
}
function socketPath() {
  return join(configDir(), "sock");
}
function defaults() {
  return {
    apiBaseUrl: process.env["VIBEBREAK_API"] ?? DEFAULT_API,
    wsBaseUrl: process.env["VIBEBREAK_WS"] ?? DEFAULT_WS,
    deviceJwt: null,
    deviceId: null,
    thresholdTokens: TOKEN_THRESHOLD_DEFAULT
  };
}
function isPaired(cfg) {
  return Boolean(cfg.deviceJwt && cfg.deviceId);
}
async function load() {
  const base = defaults();
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    const cfg = {
      apiBaseUrl: !parsed.apiBaseUrl || LEGACY_APIS.has(parsed.apiBaseUrl) ? base.apiBaseUrl : parsed.apiBaseUrl,
      wsBaseUrl: !parsed.wsBaseUrl || LEGACY_WS_URLS.has(parsed.wsBaseUrl) ? base.wsBaseUrl : parsed.wsBaseUrl,
      deviceJwt: parsed.deviceJwt ?? null,
      deviceId: parsed.deviceId ?? null,
      thresholdTokens: typeof parsed.thresholdTokens === "number" && Number.isFinite(parsed.thresholdTokens) ? parsed.thresholdTokens : base.thresholdTokens
    };
    if (typeof parsed.ingestPort === "number" && Number.isInteger(parsed.ingestPort) && parsed.ingestPort > 0 && parsed.ingestPort < 65536) {
      cfg.ingestPort = parsed.ingestPort;
    }
    if (typeof parsed.ingestSecret === "string" && parsed.ingestSecret.length > 0) {
      cfg.ingestSecret = parsed.ingestSecret;
    }
    return cfg;
  } catch (err) {
    const e = err;
    if (e && e.code === "ENOENT") {
      return base;
    }
    throw err;
  }
}
async function save(cfg) {
  const dir = configDir();
  const file = configPath();
  await fs.mkdir(dir, { recursive: true, mode: 448 });
  try {
    await fs.chmod(dir, 448);
  } catch {
  }
  const data = `${JSON.stringify(cfg, null, 2)}
`;
  await fs.writeFile(file, data, { mode: 384 });
  try {
    await fs.chmod(file, 384);
  } catch {
  }
}
async function clearJwt() {
  const cfg = await load();
  const cleared = { ...cfg, deviceJwt: null, deviceId: null };
  await save(cleared);
  return cleared;
}
function generateIngestSecret() {
  return randomBytes(24).toString("base64url");
}
async function ensureIngestSecret(cfg) {
  if (typeof cfg.ingestSecret === "string" && cfg.ingestSecret.length > 0) {
    return cfg;
  }
  const next = {
    ...cfg,
    ingestSecret: generateIngestSecret()
  };
  await save(next);
  return next;
}
function redactConfig(cfg) {
  const redacted = {
    ...cfg,
    deviceJwt: cfg.deviceJwt ? "[redacted]" : null
  };
  if (cfg.ingestSecret) {
    redacted.ingestSecret = "[redacted]";
  }
  return redacted;
}
async function ensureSaved() {
  const dir = configDir();
  try {
    await fs.access(join(dir, "config.json"));
    return await load();
  } catch {
    const base = defaults();
    await fs.mkdir(dirname(configPath()), { recursive: true, mode: 448 });
    await save(base);
    return base;
  }
}
var DEFAULT_API, DEFAULT_WS, LEGACY_APIS, LEGACY_WS_URLS;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    init_esm_shims();
    init_shared();
    DEFAULT_API = "https://api.vibebreak.app";
    DEFAULT_WS = "wss://api.vibebreak.app";
    LEGACY_APIS = /* @__PURE__ */ new Set([
      "http://localhost:3001",
      "http://localhost:3501"
    ]);
    LEGACY_WS_URLS = /* @__PURE__ */ new Set([
      "ws://localhost:3001",
      "ws://localhost:3501"
    ]);
  }
});

// src/ingest-protocol.ts
import { timingSafeEqual } from "node:crypto";
function secureEquals(a, b) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(aa, bb);
}
function createIngestPayload(tokens, secret) {
  if (!Number.isFinite(tokens) || !Number.isInteger(tokens) || tokens <= 0) {
    throw new Error(`tokens must be a positive integer, got: ${tokens}`);
  }
  const lines = [];
  if (secret) {
    lines.push(`${AUTH_PREFIX}${secret}`);
  }
  lines.push(`tokens:${tokens}`);
  return `${lines.join("\n")}
`;
}
function createSocketLineAuthorizer(secret) {
  const expectedAuthLine = secret ? `${AUTH_PREFIX}${secret}` : null;
  let authorized = expectedAuthLine === null;
  return (rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      return { type: "ignore" };
    }
    if (!authorized && expectedAuthLine !== null) {
      if (secureEquals(line, expectedAuthLine)) {
        authorized = true;
        return { type: "authorized" };
      }
      return { type: "reject" };
    }
    return { type: "data", line };
  };
}
var AUTH_PREFIX;
var init_ingest_protocol = __esm({
  "src/ingest-protocol.ts"() {
    "use strict";
    init_esm_shims();
    AUTH_PREFIX = "auth:";
  }
});

// src/ingest.ts
var ingest_exports = {};
__export(ingest_exports, {
  runIngest: () => runIngest
});
import { createConnection } from "node:net";
import { platform } from "node:os";
import kleur from "kleur";
async function runIngest(cfg, tokens) {
  const isWindows = platform() === "win32";
  const opts = isWindows ? { host: "127.0.0.1", port: cfg.ingestPort ?? 0 } : { path: socketPath() };
  if (isWindows && (!cfg.ingestPort || cfg.ingestPort <= 0)) {
    process.stdout.write(
      `${kleur.gray("vibebreak watch isn't running - no gate will be tracked.")}
`
    );
    return 0;
  }
  return await new Promise((resolve) => {
    const sock = createConnection(opts);
    let settled = false;
    const finish = (code, hint) => {
      if (settled) return;
      settled = true;
      if (hint !== void 0) {
        process.stdout.write(`${kleur.gray(hint)}
`);
      }
      try {
        sock.destroy();
      } catch {
      }
      resolve(code);
    };
    sock.once("error", (err) => {
      if (err.code === "ENOENT" || err.code === "ECONNREFUSED" || err.code === "EACCES" || err.code === "ENOTSOCK") {
        finish(0, "vibebreak watch isn't running - no gate will be tracked.");
        return;
      }
      finish(0, `vibebreak ingest: ${err.message}`);
    });
    sock.once("connect", () => {
      const payload = createIngestPayload(tokens, cfg.ingestSecret ?? null);
      sock.write(payload, () => {
        sock.end();
      });
    });
    sock.once("close", () => {
      finish(0);
    });
  });
}
var init_ingest = __esm({
  "src/ingest.ts"() {
    "use strict";
    init_esm_shims();
    init_config();
    init_ingest_protocol();
  }
});

// bin/vibebreak.ts
init_esm_shims();
import kleur7 from "kleur";

// src/cc-hook.ts
init_esm_shims();
init_config();
import { promises as fs2 } from "node:fs";
import path from "node:path";
var TOTALS_LOCK = path.join(configDir(), "cc-session-totals.lock");
var LOCK_WAIT_MS = 2e3;
var STALE_LOCK_MS = 1e4;
async function withTotalsLock(fn) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  await fs2.mkdir(configDir(), { recursive: true, mode: 448 }).catch(() => void 0);
  while (true) {
    try {
      const handle = await fs2.open(TOTALS_LOCK, "wx", 384);
      try {
        await handle.writeFile(`${process.pid}:${Date.now()}`);
      } finally {
        await handle.close();
      }
      break;
    } catch (err) {
      const e = err;
      if (e?.code !== "EEXIST") {
        return await fn();
      }
      try {
        const stat = await fs2.stat(TOTALS_LOCK);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          await fs2.unlink(TOTALS_LOCK).catch(() => void 0);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        return await fn();
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  try {
    return await fn();
  } finally {
    await fs2.unlink(TOTALS_LOCK).catch(() => void 0);
  }
}
var TOTALS_FILE = path.join(configDir(), "cc-session-totals.json");
async function sumTranscript(transcriptPath) {
  let raw;
  try {
    raw = await fs2.readFile(transcriptPath, "utf8");
  } catch {
    return 0;
  }
  let total = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (line.length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const u = parsed.message?.usage;
    if (!u) continue;
    total += (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
  }
  return total;
}
async function loadTotals() {
  try {
    const raw = await fs2.readFile(TOTALS_FILE, "utf8");
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
      }
      return out;
    }
  } catch {
  }
  return {};
}
async function saveTotals(totals) {
  await fs2.mkdir(configDir(), { recursive: true, mode: 448 });
  await fs2.writeFile(TOTALS_FILE, JSON.stringify(totals, null, 2), { mode: 384 });
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function runCcHook() {
  const raw = await readStdin();
  if (raw.trim().length === 0) return;
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  if (!event.session_id || !event.transcript_path) return;
  const total = await sumTranscript(event.transcript_path);
  if (total <= 0) return;
  const delta = await withTotalsLock(async () => {
    const totals = await loadTotals();
    const previous = totals[event.session_id] ?? 0;
    const nextTotal = Math.max(previous, total);
    totals[event.session_id] = nextTotal;
    await saveTotals(totals);
    return nextTotal - previous;
  });
  if (delta <= 0) return;
  const { load: load2 } = await Promise.resolve().then(() => (init_config(), config_exports));
  const { runIngest: runIngest2 } = await Promise.resolve().then(() => (init_ingest(), ingest_exports));
  const cfg = await load2();
  await runIngest2(cfg, delta);
}

// src/check-gate.ts
init_esm_shims();
import kleur2 from "kleur";

// src/active-gate.ts
init_esm_shims();
init_config();
import { promises as fs3 } from "node:fs";
import path2 from "node:path";
function activeGatePath() {
  return path2.join(configDir(), "active-gate.json");
}
async function saveActiveGate(gate) {
  const dir = configDir();
  try {
    await fs3.mkdir(dir, { recursive: true, mode: 448 });
  } catch {
  }
  await fs3.writeFile(activeGatePath(), JSON.stringify(gate, null, 2), { mode: 384 });
}
async function clearActiveGate() {
  try {
    await fs3.unlink(activeGatePath());
  } catch (err) {
    const e = err;
    if (e.code !== "ENOENT") throw err;
  }
}
async function readActiveGate() {
  try {
    const raw = await fs3.readFile(activeGatePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.gateId === "string" && typeof parsed.exerciseLabel === "string" && typeof parsed.triggeredAt === "string") {
      return parsed;
    }
    return null;
  } catch (err) {
    const e = err;
    if (e.code === "ENOENT") return null;
    return null;
  }
}

// src/check-gate.ts
async function runCheckGate() {
  const gate = await readActiveGate();
  if (!gate) return 0;
  const ageMinutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(gate.triggeredAt).getTime()) / 6e4)
  );
  const ago = ageMinutes === 0 ? "just now" : `${ageMinutes}m ago`;
  process.stderr.write(
    `${kleur2.red().bold("\u23F8  VibeBreak gate open")}  ${kleur2.gray(`(triggered ${ago})`)}
Pick up your phone and complete: ${kleur2.cyan().bold(gate.exerciseLabel)}
Then this tool call will go through automatically.
`
  );
  return 2;
}

// bin/vibebreak.ts
init_config();
init_ingest();

// src/log.ts
init_esm_shims();
import kleur3 from "kleur";
function ts() {
  const d = /* @__PURE__ */ new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
var log = {
  info(msg) {
    process.stdout.write(`${kleur3.gray(ts())} ${kleur3.cyan("info")}  ${msg}
`);
  },
  ok(msg) {
    process.stdout.write(`${kleur3.gray(ts())} ${kleur3.green("ok")}    ${msg}
`);
  },
  warn(msg) {
    process.stderr.write(`${kleur3.gray(ts())} ${kleur3.yellow("warn")}  ${msg}
`);
  },
  err(msg) {
    process.stderr.write(`${kleur3.gray(ts())} ${kleur3.red("err")}   ${msg}
`);
  },
  banner() {
    const tag = kleur3.bgRed().black().bold(" VibeBreak ");
    const tag2 = kleur3.gray("- lock your AI session until you move");
    process.stdout.write(`
${tag} ${tag2}

`);
  }
};

// src/pair.ts
init_esm_shims();
import { hostname } from "node:os";
import qrcode from "qrcode-terminal";
import kleur4 from "kleur";

// src/api.ts
init_esm_shims();
init_shared();
var ApiError = class extends Error {
  status;
  body;
  constructor(status, body, message) {
    super(message ?? `API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
};
var Api = class {
  baseUrl;
  deviceJwt;
  constructor(baseUrl, deviceJwt = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.deviceJwt = deviceJwt;
  }
  setDeviceJwt(jwt) {
    this.deviceJwt = jwt;
  }
  async request(path3, schema, init = {}) {
    const url = `${this.baseUrl}${path3}`;
    const headers = new Headers(init.headers);
    if (!headers.has("content-type") && init.body !== void 0 && init.body !== null) {
      headers.set("content-type", "application/json");
    }
    if (this.deviceJwt && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${this.deviceJwt}`);
    }
    let res;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new ApiError(0, "", `Network error calling ${url}: ${cause}`);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new ApiError(res.status, text, `${res.status} ${res.statusText} from ${path3}`);
    }
    if (text.length === 0) {
      throw new ApiError(res.status, "", `Empty response from ${path3}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, text, `Invalid JSON from ${path3}`);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new ApiError(
        res.status,
        text,
        `Unexpected response from ${url}. Is this really the VibeBreak API? (Set VIBEBREAK_API to override the host. First validation issue: ${result.error.issues[0]?.message ?? "unknown"})`
      );
    }
    return result.data;
  }
  pairInit(input) {
    return this.request("/v1/pair/init", PairInitResponseSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }
  pairStatus(code) {
    const q = new URLSearchParams({ code });
    return this.request(`/v1/pair/status?${q.toString()}`, PairStatusResponseSchema, {
      method: "GET"
    });
  }
  createGate(input) {
    return this.request("/v1/gates", GateResponseSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }
  meterHeartbeat(input) {
    return this.request("/v1/meter/heartbeat", MeterHeartbeatResponseSchema, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }
  me() {
    return this.request("/v1/me", MeProfileResponseSchema, { method: "GET" });
  }
};

// src/pair.ts
init_config();
var PLUGIN_VERSION = "0.0.1";
var POLL_INTERVAL_MS = 2e3;
var POLL_TIMEOUT_MS = 5 * 60 * 1e3;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function renderQr(deepLink) {
  return new Promise((resolve) => {
    qrcode.generate(deepLink, { small: true }, (rendered) => {
      process.stdout.write(`${rendered}
`);
      resolve();
    });
  });
}
async function runPair(cfg) {
  const api = new Api(cfg.apiBaseUrl);
  const label = hostname() || "Computer";
  log.info(`Pairing with ${kleur4.cyan(cfg.apiBaseUrl)} as ${kleur4.bold(label)}`);
  let init;
  try {
    init = await api.pairInit({
      label,
      platform: process.platform,
      pluginVersion: PLUGIN_VERSION
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.err(`Could not start pairing: ${msg}`);
    if (err instanceof ApiError && err.status === 0) {
      log.warn(
        `Is the VibeBreak API running at ${cfg.apiBaseUrl}? Set VIBEBREAK_API to override.`
      );
    }
    return { ok: false, status: "error", message: msg };
  }
  const deepLink = `vibebreak://pair?code=${init.pairCode}`;
  process.stdout.write(`
${kleur4.bold("Scan this QR with the VibeBreak app:")}

`);
  await renderQr(deepLink);
  process.stdout.write(
    `${kleur4.gray("If the QR doesn't scan, type this code into the app:")}

`
  );
  process.stdout.write(`    ${kleur4.bold().yellow(init.pairCode)}

`);
  process.stdout.write(`  ${kleur4.gray(deepLink)}

`);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastErrLog = 0;
  while (Date.now() < deadline) {
    try {
      const status = await api.pairStatus(init.pairCode);
      if (status.status === "completed") {
        if (!status.deviceJwt) {
          log.err("Pairing reported completed but no device JWT was returned.");
          return { ok: false, status: "error", message: "missing deviceJwt" };
        }
        const next = {
          ...cfg,
          deviceJwt: status.deviceJwt,
          deviceId: init.deviceId
        };
        await save(next);
        log.ok(`Paired! Device id ${kleur4.cyan(init.deviceId)}.`);
        process.stdout.write(`
Run ${kleur4.bold("vibebreak watch")} to start the meter.

`);
        return { ok: true, status: "completed" };
      }
      if (status.status === "expired") {
        log.err("Pair code expired before the phone scanned it. Re-run `vibebreak pair`.");
        return { ok: false, status: "expired" };
      }
    } catch (err) {
      const now = Date.now();
      if (now - lastErrLog > 1e4) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`Polling pair status failed (will retry): ${msg}`);
        lastErrLog = now;
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  log.err("Timed out waiting for the phone to pair (5 min). Try again with `vibebreak pair`.");
  return { ok: false, status: "timeout" };
}

// src/watch.ts
init_esm_shims();
init_shared();
import { promises as fs4, unlinkSync } from "node:fs";
import { createConnection as createConnection2, createServer } from "node:net";
import { platform as platform2 } from "node:os";
import { createInterface } from "node:readline";
import kleur6 from "kleur";
init_config();
init_ingest_protocol();

// src/lock.ts
init_esm_shims();
import kleur5 from "kleur";
var HIDE_CURSOR = "\x1B[?25l";
var SHOW_CURSOR = "\x1B[?25h";
function pad(line, width) {
  if (line.length >= width) return line.slice(0, width);
  return line + " ".repeat(width - line.length);
}
function box(lines, width = 56) {
  const top = `\u250C${"\u2500".repeat(width)}\u2510`;
  const bottom = `\u2514${"\u2500".repeat(width)}\u2518`;
  const body = lines.map((l) => `\u2502${pad(` ${l}`, width)}\u2502`);
  return [top, ...body, bottom];
}
function startLock(opts) {
  process.stdout.write(HIDE_CURSOR);
  const header = kleur5.bgRed().black().bold(" PAUSE  VibeBreak ");
  const sub1 = `You just burned ${kleur5.bold(opts.thresholdTokens.toLocaleString())} tokens.`;
  const sub2 = `Pick up your phone and do: ${kleur5.bold().yellow(opts.exerciseLabel)}`;
  const sub3 = kleur5.gray("Terminal will unlock automatically when the gate is completed.");
  const idLine = opts.gateId ? kleur5.gray(`gate: ${opts.gateId}`) : "";
  const lines = [
    header,
    "",
    sub1,
    sub2,
    "",
    sub3,
    ...idLine ? [idLine] : []
  ];
  const rendered = box(lines);
  process.stdout.write(`
${rendered.join("\n")}

`);
  const handle = {
    released: false,
    release(success) {
      if (handle.released) return;
      handle.released = true;
      process.stdout.write(SHOW_CURSOR);
      const msg = success?.message ?? "Unlocked. Back to vibing.";
      process.stdout.write(`
${kleur5.bgGreen().black().bold(" UNLOCK ")} ${msg}

`);
    }
  };
  return handle;
}
function restoreCursor() {
  try {
    process.stdout.write(SHOW_CURSOR);
  } catch {
  }
}

// src/meter.ts
init_esm_shims();
init_shared();
var TokenMeter = class {
  threshold;
  onTrigger;
  idlePauseMs;
  clock;
  acc = 0;
  lastEmit = 0;
  fired = false;
  disposed = false;
  constructor(opts) {
    this.threshold = opts.threshold;
    this.onTrigger = opts.onTrigger;
    this.idlePauseMs = opts.idlePauseMs ?? IDLE_PAUSE_MS;
    this.clock = opts.now ?? (() => Date.now());
  }
  get total() {
    return this.acc;
  }
  get triggered() {
    return this.fired;
  }
  get currentThreshold() {
    return this.threshold;
  }
  /**
   * Update the threshold mid-flight (e.g. user changed it from the mobile
   * app). Preserves the running accumulator so the user doesn't lose
   * progress they've already racked up. If the new threshold is already
   * crossed by the current acc, fire immediately.
   */
  setThreshold(n) {
    if (this.disposed) return;
    if (!Number.isFinite(n) || n <= 0 || n === this.threshold) return;
    this.threshold = n;
    if (!this.fired && this.acc >= this.threshold) {
      this.fired = true;
      try {
        this.onTrigger();
      } catch {
      }
    }
  }
  add(n) {
    if (this.disposed) return;
    if (!Number.isFinite(n) || n <= 0) return;
    const now = this.clock();
    if (this.lastEmit !== 0 && now - this.lastEmit > this.idlePauseMs) {
      this.lastEmit = now;
      this.acc += n;
    } else {
      this.lastEmit = now;
      this.acc += n;
    }
    if (!this.fired && this.acc >= this.threshold) {
      this.fired = true;
      try {
        this.onTrigger();
      } catch {
      }
    }
  }
  /** Reset accumulator + trigger flag (e.g. after a gate is unlocked). */
  reset() {
    this.acc = 0;
    this.fired = false;
    this.lastEmit = 0;
  }
  dispose() {
    this.disposed = true;
  }
};

// src/ws.ts
init_esm_shims();
init_shared();
import WebSocket from "ws";
var MIN_BACKOFF_MS = 1e3;
var MAX_BACKOFF_MS = 3e4;
function buildWsRequest(baseUrl, deviceJwt) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/ws`;
  url.searchParams.set("token", deviceJwt);
  return {
    url: url.toString(),
    headers: {
      authorization: `Bearer ${deviceJwt}`
    }
  };
}
function connectWs(baseUrl, deviceJwt) {
  const request = buildWsRequest(baseUrl, deviceJwt);
  const listeners = {
    open: /* @__PURE__ */ new Set(),
    close: /* @__PURE__ */ new Set(),
    hello: /* @__PURE__ */ new Set(),
    unlock: /* @__PURE__ */ new Set(),
    ping: /* @__PURE__ */ new Set(),
    message: /* @__PURE__ */ new Set(),
    error: /* @__PURE__ */ new Set()
  };
  let ws = null;
  let backoff = MIN_BACKOFF_MS;
  let reconnectTimer = null;
  let closedByUser = false;
  function emit(event, ...args) {
    const set = listeners[event];
    for (const cb of set) {
      try {
        cb(...args);
      } catch (err) {
        log.warn(`WS listener for ${event} threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  function scheduleReconnect() {
    if (closedByUser) return;
    if (reconnectTimer) return;
    const wait = backoff;
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    log.warn(`WS disconnected. Reconnecting in ${(wait / 1e3).toFixed(0)}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, wait);
  }
  function open() {
    if (closedByUser) return;
    let socket;
    try {
      socket = new WebSocket(request.url, { headers: request.headers });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      emit("error", e);
      scheduleReconnect();
      return;
    }
    ws = socket;
    socket.on("open", () => {
      backoff = MIN_BACKOFF_MS;
      log.ok(`WS connected to ${baseUrl}`);
      emit("open");
    });
    socket.on("message", (data) => {
      let raw;
      if (typeof data === "string") {
        raw = data;
      } else if (Buffer.isBuffer(data)) {
        raw = data.toString("utf8");
      } else if (Array.isArray(data)) {
        raw = Buffer.concat(data).toString("utf8");
      } else {
        raw = Buffer.from(data).toString("utf8");
      }
      let parsedJson;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        log.warn(`WS got non-JSON frame, ignoring: ${raw.slice(0, 80)}`);
        return;
      }
      const result = WsServerMessageSchema.safeParse(parsedJson);
      if (!result.success) {
        log.warn(`WS got message that failed schema validation: ${result.error.message}`);
        return;
      }
      const msg = result.data;
      emit("message", msg);
      switch (msg.type) {
        case "hello":
          emit("hello", msg.deviceId);
          break;
        case "gate_unlock":
          emit("unlock", msg.gateId);
          break;
        case "ping":
          emit("ping");
          try {
            socket.send(JSON.stringify({ type: "pong" }));
          } catch {
          }
          break;
      }
    });
    socket.on("error", (err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      log.warn(`WS error: ${e.message}`);
      emit("error", e);
    });
    socket.on("close", () => {
      ws = null;
      emit("close");
      scheduleReconnect();
    });
  }
  open();
  return {
    on(event, cb) {
      listeners[event].add(cb);
    },
    off(event, cb) {
      listeners[event].delete(cb);
    },
    close() {
      closedByUser = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {
        }
        ws = null;
      }
    },
    get closed() {
      return closedByUser;
    }
  };
}

// src/watch.ts
var EXERCISE_LABEL = {
  push_up: "push-ups",
  squat: "squats",
  jumping_jack: "jumping jacks",
  plank: "30s plank",
  breathing: "60s box-breathing"
};
function humanExercise(g) {
  const reps = g.repsTarget || EXERCISE_DEFAULT_TARGET[g.exerciseKind];
  return `${reps} ${EXERCISE_LABEL[g.exerciseKind]}`;
}
function ingest(rawLine, meter) {
  const line = rawLine.trim();
  if (!line) return;
  const m = /^tokens:(\d+)$/i.exec(line);
  if (!m) {
    log.warn(`Unrecognized input. Send lines like \`tokens:1234\`. Got: ${line.slice(0, 40)}`);
    return;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return;
  meter.add(n);
}
async function probeUnixSocket(sockPath, timeoutMs = 500) {
  return await new Promise((resolve) => {
    let settled = false;
    const done = (alive) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
      }
      resolve(alive);
    };
    const sock = createConnection2({ path: sockPath });
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}
async function probeTcpPort(port, timeoutMs = 500) {
  return await new Promise((resolve) => {
    let settled = false;
    const done = (alive) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
      }
      resolve(alive);
    };
    const sock = createConnection2({ host: "127.0.0.1", port });
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}
async function runWatch(cfg, opts = {}) {
  if (!isPaired(cfg) || !cfg.deviceJwt || !cfg.deviceId) {
    log.err("This device isn't paired yet. Run `vibebreak pair` first.");
    return 1;
  }
  try {
    cfg = await ensureIngestSecret(cfg);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.err(`Could not initialize the local ingest secret: ${msg}`);
    return 1;
  }
  const isWindows = platform2() === "win32";
  if (!isWindows) {
    const sockPath = socketPath();
    if (await probeUnixSocket(sockPath)) {
      log.info(
        `Another vibebreak watcher is already running (socket ${kleur6.gray(sockPath)} is live). Exiting.`
      );
      return 0;
    }
  } else if (typeof cfg.ingestPort === "number" && cfg.ingestPort > 0) {
    if (await probeTcpPort(cfg.ingestPort)) {
      log.info(
        `Another vibebreak watcher is already running (127.0.0.1:${cfg.ingestPort} is live). Exiting.`
      );
      return 0;
    }
  }
  const deviceJwt = cfg.deviceJwt;
  const api = new Api(cfg.apiBaseUrl, deviceJwt);
  const ws = connectWs(cfg.wsBaseUrl, deviceJwt);
  let activeLock = null;
  let activeGateId = null;
  let exiting = false;
  const meter = new TokenMeter({
    threshold: cfg.thresholdTokens,
    onTrigger: () => {
      void fireGate();
    }
  });
  async function fireGate() {
    if (activeLock) return;
    log.info(
      `Token threshold hit (${meter.total.toLocaleString()}/${cfg.thresholdTokens.toLocaleString()}). Creating gate...`
    );
    let gate;
    try {
      gate = await api.createGate({ thresholdTokens: cfg.thresholdTokens });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.err(`Failed to create gate: ${msg}`);
      if (err instanceof ApiError && err.status === 0) {
        log.warn(`Is the API reachable at ${cfg.apiBaseUrl}? Set VIBEBREAK_API to override.`);
      }
      meter.reset();
      return;
    }
    activeGateId = gate.id;
    activeLock = startLock({
      exerciseLabel: humanExercise(gate),
      thresholdTokens: cfg.thresholdTokens,
      gateId: gate.id
    });
    try {
      await saveActiveGate({
        gateId: gate.id,
        exerciseLabel: humanExercise(gate),
        triggeredAt: gate.triggeredAt
      });
    } catch {
    }
    meter.reset();
  }
  ws.on("hello", (deviceId) => {
    log.info(`WS hello (deviceId=${deviceId}).`);
  });
  ws.on("unlock", (gateId) => {
    if (activeLock && (activeGateId === gateId || activeGateId === null)) {
      activeLock.release({ message: kleur6.green("Nice. Streak preserved.") });
      activeLock = null;
      activeGateId = null;
      meter.reset();
      void clearActiveGate().catch(() => void 0);
    } else {
      log.warn(`Got unlock for gate ${gateId} but no matching active lock; ignoring.`);
    }
  });
  ws.on("error", () => {
  });
  const input = opts.input ?? process.stdin;
  const rl = createInterface({ input, terminal: false });
  rl.on("line", (raw) => {
    const line = raw.trim();
    if (line === "quit" || line === "exit") {
      shutdown(0);
      return;
    }
    ingest(line, meter);
  });
  const ingestServer = createServer((socket) => {
    const authorize = createSocketLineAuthorizer(cfg.ingestSecret ?? null);
    const sockRl = createInterface({ input: socket, terminal: false });
    sockRl.on("line", (raw) => {
      const result = authorize(raw);
      if (result.type === "data") {
        ingest(result.line, meter);
        return;
      }
      if (result.type === "reject") {
        log.warn("Rejected unauthenticated local ingest client.");
        try {
          sockRl.close();
        } catch {
        }
        try {
          socket.destroy();
        } catch {
        }
      }
    });
    sockRl.on("close", () => {
      try {
        socket.destroy();
      } catch {
      }
    });
    socket.on("error", () => {
    });
  });
  ingestServer.on("error", (err) => {
    log.warn(`Ingest socket server error: ${err.message}`);
  });
  let socketBindPath = null;
  let boundIngestPort = null;
  if (isWindows) {
    const desiredPort = typeof cfg.ingestPort === "number" ? cfg.ingestPort : 0;
    await new Promise((resolve, reject) => {
      ingestServer.once("error", reject);
      ingestServer.listen(desiredPort, "127.0.0.1", () => {
        ingestServer.removeListener("error", reject);
        resolve();
      });
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Could not bind ingest TCP server: ${msg}`);
    });
    const addr = ingestServer.address();
    if (addr && typeof addr === "object" && typeof addr.port === "number") {
      boundIngestPort = addr.port;
      if (cfg.ingestPort !== boundIngestPort) {
        const next = { ...cfg, ingestPort: boundIngestPort };
        try {
          await save(next);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`Could not persist ingestPort to config: ${msg}`);
        }
      }
      log.info(`Ingest TCP server listening on 127.0.0.1:${boundIngestPort}.`);
    }
  } else {
    const sockPath = socketPath();
    try {
      await fs4.mkdir(configDir(), { recursive: true, mode: 448 });
    } catch {
    }
    const bindOnce = () => new Promise((resolve, reject) => {
      const onError = (err) => {
        ingestServer.removeListener("listening", onListen);
        reject(err);
      };
      const onListen = () => {
        ingestServer.removeListener("error", onError);
        resolve();
      };
      ingestServer.once("error", onError);
      ingestServer.once("listening", onListen);
      ingestServer.listen(sockPath);
    });
    try {
      await bindOnce();
      socketBindPath = sockPath;
    } catch (err) {
      const e = err;
      if (e?.code === "EADDRINUSE" || e?.code === "EEXIST") {
        if (await probeUnixSocket(sockPath)) {
          log.info(
            `Another vibebreak watcher bound ${kleur6.gray(sockPath)} while we were starting up. Exiting.`
          );
          try {
            ws.close();
          } catch {
          }
          meter.dispose();
          return 0;
        }
        try {
          await fs4.unlink(sockPath);
        } catch {
        }
        try {
          await bindOnce();
          socketBindPath = sockPath;
        } catch (err2) {
          const e2 = err2;
          log.warn(`Could not bind ingest socket at ${sockPath}: ${e2?.message ?? err2}`);
        }
      } else {
        log.warn(`Could not bind ingest socket at ${sockPath}: ${e?.message ?? err}`);
      }
    }
    if (socketBindPath) {
      try {
        await fs4.chmod(sockPath, 384);
      } catch {
      }
      log.info(`Ingest socket listening at ${kleur6.gray(sockPath)}.`);
    }
  }
  log.info(`Watching. Threshold: ${kleur6.bold(cfg.thresholdTokens.toLocaleString())} tokens.`);
  log.info(
    `Feed me lines on stdin like ${kleur6.cyan("tokens:1234")}, or let CC hooks pipe via the socket.`
  );
  async function tickHeartbeat() {
    try {
      const ack = await api.meterHeartbeat({
        current: meter.total,
        threshold: meter.currentThreshold
      });
      if (ack.threshold !== meter.currentThreshold) {
        log.info(
          `Threshold updated from settings: ${kleur6.bold(
            meter.currentThreshold.toLocaleString()
          )} \u2192 ${kleur6.bold(ack.threshold.toLocaleString())}`
        );
        meter.setThreshold(ack.threshold);
        try {
          await save({ ...cfg, thresholdTokens: ack.threshold });
          cfg.thresholdTokens = ack.threshold;
        } catch {
        }
      }
    } catch {
    }
  }
  try {
    const me = await api.me();
    if (me.thresholdTokens !== meter.currentThreshold) {
      log.info(
        `Loaded threshold from your account: ${kleur6.bold(me.thresholdTokens.toLocaleString())}`
      );
      meter.setThreshold(me.thresholdTokens);
      try {
        await save({ ...cfg, thresholdTokens: me.thresholdTokens });
        cfg.thresholdTokens = me.thresholdTokens;
      } catch {
      }
    }
  } catch {
  }
  void tickHeartbeat();
  const heartbeat = setInterval(() => {
    void tickHeartbeat();
  }, 3e3);
  function shutdown(code) {
    if (exiting) return;
    exiting = true;
    log.info("Shutting down...");
    try {
      clearInterval(heartbeat);
    } catch {
    }
    try {
      rl.close();
    } catch {
    }
    try {
      ingestServer.close();
    } catch {
    }
    if (socketBindPath) {
      try {
        unlinkSync(socketBindPath);
      } catch {
      }
    }
    try {
      ws.close();
    } catch {
    }
    if (activeLock) {
      activeLock.release({ message: "Aborted by user." });
      activeLock = null;
    }
    meter.dispose();
    restoreCursor();
    setTimeout(() => process.exit(code), 50);
  }
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  return await new Promise((resolve) => {
    rl.on("close", () => {
      if (!exiting) {
        log.info("Input stream closed. Exiting.");
        try {
          ingestServer.close();
        } catch {
        }
        if (socketBindPath) {
          try {
            unlinkSync(socketBindPath);
          } catch {
          }
        }
        try {
          ws.close();
        } catch {
        }
        meter.dispose();
        restoreCursor();
      }
      resolve(0);
    });
  });
}

// bin/vibebreak.ts
var HELP = `
${kleur7.bold("VibeBreak")} - lock your AI session every N tokens until you move.

${kleur7.bold("Usage:")}
  vibebreak                       Run \`watch\` if paired, otherwise \`pair\`.
  vibebreak pair                  One-time QR pairing with the VibeBreak phone app.
  vibebreak watch                 Start the token meter + lock + WS unlock loop.
  vibebreak ingest --tokens N     Forward N tokens to the running \`watch\` process.
  vibebreak cc-hook               Read a Claude Code PostToolUse event from
                                  stdin, diff session token usage from the
                                  transcript, and forward the delta to watch.
                                  (Used by the bundled CC plugin hook.)
  vibebreak check-gate            Exit 2 if a gate is currently open, else 0.
                                  Used by the CC PreToolUse hook to block
                                  tool calls until the user completes.
  vibebreak config                Print the current config JSON.
  vibebreak logout                Clear the saved device JWT.
  vibebreak help                  Show this message.

${kleur7.bold("Environment:")}
  VIBEBREAK_API                   Override API base URL (default https://api.vibebreak.app).
  VIBEBREAK_WS                    Override WS base URL  (default wss://api.vibebreak.app).

${kleur7.bold("Token sources for `watch`:")}
  1. Stdin lines like \`tokens:1234\` (manual / V1 fallback).
  2. Local socket at ~/.vibebreak/sock fed by \`vibebreak ingest --tokens N\`
     from the bundled Claude Code PostToolUse hook.
`;
function parseArgs(argv) {
  const a = argv[2];
  if (a === void 0) return { cmd: null };
  if (a === "pair" || a === "watch" || a === "config" || a === "logout" || a === "cc-hook" || a === "check-gate") {
    return { cmd: a };
  }
  if (a === "help" || a === "--help" || a === "-h") return { cmd: "help" };
  if (a === "ingest") {
    let raw;
    for (let i = 3; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--tokens") {
        raw = argv[i + 1];
        i++;
      } else if (arg !== void 0 && arg.startsWith("--tokens=")) {
        raw = arg.slice("--tokens=".length);
      }
    }
    if (raw === void 0) {
      return { cmd: "ingest", error: "Missing required flag: --tokens N" };
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      return { cmd: "ingest", error: `--tokens must be a positive integer, got: ${raw}` };
    }
    return { cmd: "ingest", tokens: n };
  }
  return { cmd: null };
}
async function main() {
  const parsed = parseArgs(process.argv);
  const explicit = parsed.cmd;
  if (explicit === "help") {
    process.stdout.write(`${HELP}
`);
    return 0;
  }
  if (explicit === "cc-hook") {
    try {
      await runCcHook();
    } catch (err) {
      process.stderr.write(`vibebreak cc-hook: ${err instanceof Error ? err.message : String(err)}
`);
    }
    return 0;
  }
  if (explicit === "check-gate") {
    try {
      return await runCheckGate();
    } catch {
      return 0;
    }
  }
  if (explicit === "ingest") {
    if (parsed.error !== void 0 || parsed.tokens === void 0) {
      log.err(parsed.error ?? "Missing --tokens N");
      process.stderr.write(`${HELP}
`);
      return 1;
    }
    const cfg2 = await load();
    return await runIngest(cfg2, parsed.tokens);
  }
  const cfg = await load();
  if (explicit === "config") {
    log.banner();
    process.stdout.write(`${kleur7.gray(`# ${configPath()}`)}
`);
    process.stdout.write(`${JSON.stringify(redactConfig(cfg), null, 2)}
`);
    return 0;
  }
  if (explicit === "logout") {
    log.banner();
    await clearJwt();
    log.ok("Cleared device JWT. Run `vibebreak pair` to re-pair.");
    return 0;
  }
  const cmd = explicit ?? (isPaired(cfg) ? "watch" : "pair");
  if (cmd === "pair") {
    log.banner();
    const result = await runPair(cfg);
    return result.ok ? 0 : 1;
  }
  if (cmd === "watch") {
    log.banner();
    return await runWatch(cfg);
  }
  process.stdout.write(`${HELP}
`);
  return 0;
}
main().then((code) => process.exit(code)).catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`${msg}
`);
  process.exit(1);
});
