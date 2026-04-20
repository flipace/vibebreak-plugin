import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { TOKEN_THRESHOLD_DEFAULT } from "./shared.js";

export interface PluginConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
  deviceJwt: string | null;
  deviceId: string | null;
  thresholdTokens: number;
  /**
   * Windows-only: TCP loopback port used by the local ingest server.
   * Persisted by `vibebreak watch` on first start and read by `vibebreak ingest`.
   * Omitted entirely on non-Windows platforms (where the Unix-domain socket is used).
   */
  ingestPort?: number;
}

const DEFAULT_API = "https://api.vibebreak.app";
const DEFAULT_WS = "wss://api.vibebreak.app";

// Earlier builds defaulted to localhost ports. Anyone upgrading past the
// monorepo split should land on the production API without reconfiguring.
const LEGACY_APIS = new Set([
  "http://localhost:3001",
  "http://localhost:3501",
]);
const LEGACY_WS_URLS = new Set([
  "ws://localhost:3001",
  "ws://localhost:3501",
]);

export function configDir(): string {
  return join(homedir(), ".vibebreak");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

/**
 * Path to the Unix-domain socket used for token ingest.
 * Note: not used on Windows (we fall back to a TCP loopback port stored in config).
 */
export function socketPath(): string {
  return join(configDir(), "sock");
}

export function defaults(): PluginConfig {
  return {
    apiBaseUrl: process.env["VIBEBREAK_API"] ?? DEFAULT_API,
    wsBaseUrl: process.env["VIBEBREAK_WS"] ?? DEFAULT_WS,
    deviceJwt: null,
    deviceId: null,
    thresholdTokens: TOKEN_THRESHOLD_DEFAULT,
  };
}

export function isPaired(cfg: PluginConfig): boolean {
  return Boolean(cfg.deviceJwt && cfg.deviceId);
}

export async function load(): Promise<PluginConfig> {
  const base = defaults();
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<PluginConfig>;
    const cfg: PluginConfig = {
      apiBaseUrl:
        !parsed.apiBaseUrl || LEGACY_APIS.has(parsed.apiBaseUrl)
          ? base.apiBaseUrl
          : parsed.apiBaseUrl,
      wsBaseUrl:
        !parsed.wsBaseUrl || LEGACY_WS_URLS.has(parsed.wsBaseUrl)
          ? base.wsBaseUrl
          : parsed.wsBaseUrl,
      deviceJwt: parsed.deviceJwt ?? null,
      deviceId: parsed.deviceId ?? null,
      thresholdTokens:
        typeof parsed.thresholdTokens === "number" && Number.isFinite(parsed.thresholdTokens)
          ? parsed.thresholdTokens
          : base.thresholdTokens,
    };
    if (
      typeof parsed.ingestPort === "number" &&
      Number.isInteger(parsed.ingestPort) &&
      parsed.ingestPort > 0 &&
      parsed.ingestPort < 65536
    ) {
      cfg.ingestPort = parsed.ingestPort;
    }
    return cfg;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e && e.code === "ENOENT") {
      return base;
    }
    throw err;
  }
}

export async function save(cfg: PluginConfig): Promise<void> {
  const dir = configDir();
  const file = configPath();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // Best-effort tighten dir permissions if it pre-existed.
  try {
    await fs.chmod(dir, 0o700);
  } catch {
    // ignore on platforms that don't support chmod
  }
  const data = `${JSON.stringify(cfg, null, 2)}\n`;
  await fs.writeFile(file, data, { mode: 0o600 });
  try {
    await fs.chmod(file, 0o600);
  } catch {
    // ignore
  }
}

export async function clearJwt(): Promise<PluginConfig> {
  const cfg = await load();
  const cleared: PluginConfig = { ...cfg, deviceJwt: null, deviceId: null };
  await save(cleared);
  return cleared;
}

/** Make sure config exists on disk; useful for `vibebreak config` first-run. */
export async function ensureSaved(): Promise<PluginConfig> {
  const dir = configDir();
  try {
    await fs.access(join(dir, "config.json"));
    return await load();
  } catch {
    const base = defaults();
    await fs.mkdir(dirname(configPath()), { recursive: true, mode: 0o700 });
    await save(base);
    return base;
  }
}
