import { hostname } from "node:os";
import qrcode from "qrcode-terminal";
import kleur from "kleur";
import { Api, ApiError } from "./api.js";
import { save, type PluginConfig } from "./config.js";
import { log } from "./log.js";

const PLUGIN_VERSION = "0.0.1";
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderQr(deepLink: string): Promise<void> {
  return new Promise((resolve) => {
    qrcode.generate(deepLink, { small: true }, (rendered) => {
      process.stdout.write(`${rendered}\n`);
      resolve();
    });
  });
}

export interface PairResult {
  ok: boolean;
  status: "completed" | "expired" | "timeout" | "error";
  message?: string;
}

export async function runPair(cfg: PluginConfig): Promise<PairResult> {
  const api = new Api(cfg.apiBaseUrl);
  const label = hostname() || "Computer";

  log.info(`Pairing with ${kleur.cyan(cfg.apiBaseUrl)} as ${kleur.bold(label)}`);

  let init;
  try {
    init = await api.pairInit({
      label,
      platform: process.platform,
      pluginVersion: PLUGIN_VERSION,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.err(`Could not start pairing: ${msg}`);
    if (err instanceof ApiError && err.status === 0) {
      log.warn(
        `Is the VibeBreak API running at ${cfg.apiBaseUrl}? Set VIBEBREAK_API to override.`,
      );
    }
    return { ok: false, status: "error", message: msg };
  }

  const deepLink = `vibebreak://pair?code=${init.pairCode}`;
  process.stdout.write(`\n${kleur.bold("Scan this QR with the VibeBreak app:")}\n\n`);
  await renderQr(deepLink);
  process.stdout.write(
    `${kleur.gray("If the QR doesn't scan, type this code into the app:")}\n\n`,
  );
  // Big mono code in the brand orange — never a red alert background.
  process.stdout.write(`    ${kleur.bold().yellow(init.pairCode)}\n\n`);
  process.stdout.write(`  ${kleur.gray(deepLink)}\n\n`);

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
        const next: PluginConfig = {
          ...cfg,
          deviceJwt: status.deviceJwt,
          deviceId: init.deviceId,
        };
        await save(next);
        log.ok(`Paired! Device id ${kleur.cyan(init.deviceId)}.`);
        process.stdout.write(`\nRun ${kleur.bold("vibebreak watch")} to start the meter.\n\n`);
        return { ok: true, status: "completed" };
      }
      if (status.status === "expired") {
        log.err("Pair code expired before the phone scanned it. Re-run `vibebreak pair`.");
        return { ok: false, status: "expired" };
      }
    } catch (err) {
      // Only log occasionally to avoid spamming the terminal while polling.
      const now = Date.now();
      if (now - lastErrLog > 10_000) {
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
