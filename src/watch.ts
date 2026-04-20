import { promises as fs, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { platform } from "node:os";
import { createInterface } from "node:readline";
import kleur from "kleur";
import { EXERCISE_DEFAULT_TARGET, type ExerciseKind, type GateResponse } from "./shared.js";
import { clearActiveGate, saveActiveGate } from "./active-gate.js";
import { Api, ApiError } from "./api.js";
import { configDir, ensureIngestSecret, isPaired, save, socketPath, type PluginConfig } from "./config.js";
import { createSocketLineAuthorizer } from "./ingest-protocol.js";
import { log } from "./log.js";
import { startLock, restoreCursor, type LockHandle } from "./lock.js";
import { TokenMeter } from "./meter.js";
import { connectWs, type WsClient } from "./ws.js";

export interface WatchOptions {
  /** Stream of input lines. Defaults to process.stdin. Used for tests. */
  input?: NodeJS.ReadableStream;
}

const EXERCISE_LABEL: Record<ExerciseKind, string> = {
  push_up: "push-ups",
  squat: "squats",
  jumping_jack: "jumping jacks",
  plank: "30s plank",
  breathing: "60s box-breathing",
};

function humanExercise(g: GateResponse): string {
  const reps = g.repsTarget || EXERCISE_DEFAULT_TARGET[g.exerciseKind];
  return `${reps} ${EXERCISE_LABEL[g.exerciseKind]}`;
}

/**
 * Canonical token-ingest line parser. Shared by stdin readline AND the
 * local socket server so both sources go through identical validation.
 *
 * Accepts (case-insensitive): `tokens:1234`
 */
export function ingest(rawLine: string, meter: TokenMeter): void {
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

export async function runWatch(cfg: PluginConfig, opts: WatchOptions = {}): Promise<number> {
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

  const api = new Api(cfg.apiBaseUrl, cfg.deviceJwt);
  const ws: WsClient = connectWs(cfg.wsBaseUrl, cfg.deviceJwt);

  let activeLock: LockHandle | null = null;
  let activeGateId: string | null = null;
  let exiting = false;

  const meter = new TokenMeter({
    threshold: cfg.thresholdTokens,
    onTrigger: () => {
      // Fire-and-track: createGate is async.
      void fireGate();
    },
  });

  async function fireGate(): Promise<void> {
    if (activeLock) return; // already locked, ignore
    log.info(
      `Token threshold hit (${meter.total.toLocaleString()}/${cfg.thresholdTokens.toLocaleString()}). Creating gate...`,
    );
    let gate: GateResponse;
    try {
      gate = await api.createGate({ thresholdTokens: cfg.thresholdTokens });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.err(`Failed to create gate: ${msg}`);
      if (err instanceof ApiError && err.status === 0) {
        log.warn(`Is the API reachable at ${cfg.apiBaseUrl}? Set VIBEBREAK_API to override.`);
      }
      // Reset so the next batch of tokens can retry.
      meter.reset();
      return;
    }
    activeGateId = gate.id;
    activeLock = startLock({
      exerciseLabel: humanExercise(gate),
      thresholdTokens: cfg.thresholdTokens,
      gateId: gate.id,
    });
    // Breadcrumb for the PreToolUse CC hook so it can block further tool
    // calls until the user completes the gate on their phone.
    try {
      await saveActiveGate({
        gateId: gate.id,
        exerciseLabel: humanExercise(gate),
        triggeredAt: gate.triggeredAt,
      });
    } catch {
      // best-effort — the watcher's lock still works even if the file write fails
    }
    // Reset the accumulator so the heartbeat-driven mobile UI doesn't stay
    // pinned near the threshold while the gate is pending. The `fired` flag
    // stays set, but that's fine — fireGate() guards on activeLock anyway.
    meter.reset();
  }

  ws.on("hello", (deviceId) => {
    log.info(`WS hello (deviceId=${deviceId}).`);
  });

  ws.on("unlock", (gateId) => {
    if (activeLock && (activeGateId === gateId || activeGateId === null)) {
      activeLock.release({ message: kleur.green("Nice. Streak preserved.") });
      activeLock = null;
      activeGateId = null;
      meter.reset();
      void clearActiveGate().catch(() => undefined);
    } else {
      log.warn(`Got unlock for gate ${gateId} but no matching active lock; ignoring.`);
    }
  });

  ws.on("error", () => {
    // Already logged inside ws.ts; nothing to do here.
  });

  // Source 1: stdin lines (V1 / tests / manual piping).
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

  // Source 2: local socket — Unix-domain on POSIX, TCP loopback on Windows.
  // CC PostToolUse hooks invoke `vibebreak ingest --tokens N` which writes
  // a single `tokens:N\n` line into this socket and disconnects.
  const isWindows = platform() === "win32";
  const ingestServer: Server = createServer((socket: Socket) => {
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
          // ignore
        }
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      }
    });
    sockRl.on("close", () => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    });
    socket.on("error", () => {
      // Short-lived clients may RST; nothing to do.
    });
  });

  ingestServer.on("error", (err: NodeJS.ErrnoException) => {
    log.warn(`Ingest socket server error: ${err.message}`);
  });

  let socketBindPath: string | null = null;
  let boundIngestPort: number | null = null;

  if (isWindows) {
    // Bind to an ephemeral loopback port and persist it so `vibebreak ingest`
    // can find us. If the user pre-set ingestPort in config, prefer that.
    const desiredPort = typeof cfg.ingestPort === "number" ? cfg.ingestPort : 0;
    await new Promise<void>((resolve, reject) => {
      ingestServer.once("error", reject);
      ingestServer.listen(desiredPort, "127.0.0.1", () => {
        ingestServer.removeListener("error", reject);
        resolve();
      });
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Could not bind ingest TCP server: ${msg}`);
    });

    const addr = ingestServer.address();
    if (addr && typeof addr === "object" && typeof addr.port === "number") {
      boundIngestPort = addr.port;
      if (cfg.ingestPort !== boundIngestPort) {
        const next: PluginConfig = { ...cfg, ingestPort: boundIngestPort };
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
    socketBindPath = sockPath;
    // Make sure ~/.vibebreak exists (config save also does this lazily).
    try {
      await fs.mkdir(configDir(), { recursive: true, mode: 0o700 });
    } catch {
      // ignore — listen() will surface a real error below.
    }
    // Clean up any stale socket file from a prior crashed watcher.
    try {
      await fs.unlink(sockPath);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e && e.code !== "ENOENT") {
        log.warn(`Could not unlink stale socket ${sockPath}: ${e.message}`);
      }
    }
    await new Promise<void>((resolve, reject) => {
      ingestServer.once("error", reject);
      ingestServer.listen(sockPath, () => {
        ingestServer.removeListener("error", reject);
        resolve();
      });
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Could not bind ingest socket at ${sockPath}: ${msg}`);
    });
    // Lock the socket down so only this user can write to it.
    try {
      await fs.chmod(sockPath, 0o600);
    } catch {
      // ignore
    }
    log.info(`Ingest socket listening at ${kleur.gray(sockPath)}.`);
  }

  log.info(`Watching. Threshold: ${kleur.bold(cfg.thresholdTokens.toLocaleString())} tokens.`);
  log.info(
    `Feed me lines on stdin like ${kleur.cyan("tokens:1234")}, or let CC hooks pipe via the socket.`,
  );

  // Heartbeat the current meter to the API so the mobile app can render
  // a live counter on Home. The response carries back the user's canonical
  // threshold — if it differs from what we're using, sync the meter so a
  // change made in the mobile settings takes effect within ~3s without
  // the user needing to restart `vibebreak watch`.
  async function tickHeartbeat(): Promise<void> {
    try {
      const ack = await api.meterHeartbeat({
        current: meter.total,
        threshold: meter.currentThreshold,
      });
      if (ack.threshold !== meter.currentThreshold) {
        log.info(
          `Threshold updated from settings: ${kleur.bold(
            meter.currentThreshold.toLocaleString(),
          )} → ${kleur.bold(ack.threshold.toLocaleString())}`,
        );
        meter.setThreshold(ack.threshold);
        // Persist so the next watch session starts with the right value
        // even if the API is unreachable.
        try {
          await save({ ...cfg, thresholdTokens: ack.threshold });
          cfg.thresholdTokens = ack.threshold;
        } catch {
          // best-effort
        }
      }
    } catch {
      // Never block the watch loop on a heartbeat failure.
    }
  }

  // Pull the canonical threshold once at startup before the first heartbeat
  // so the meter is correct from second one.
  try {
    const me = await api.me();
    if (me.thresholdTokens !== meter.currentThreshold) {
      log.info(
        `Loaded threshold from your account: ${kleur.bold(me.thresholdTokens.toLocaleString())}`,
      );
      meter.setThreshold(me.thresholdTokens);
      try {
        await save({ ...cfg, thresholdTokens: me.thresholdTokens });
        cfg.thresholdTokens = me.thresholdTokens;
      } catch {
        // best-effort
      }
    }
  } catch {
    // Account fetch failed — proceed with the locally configured threshold.
  }

  void tickHeartbeat();
  const heartbeat = setInterval(() => {
    void tickHeartbeat();
  }, 3_000);

  function shutdown(code: number): void {
    if (exiting) return;
    exiting = true;
    log.info("Shutting down...");
    try {
      clearInterval(heartbeat);
    } catch {
      // ignore
    }
    try {
      rl.close();
    } catch {
      // ignore
    }
    try {
      ingestServer.close();
    } catch {
      // ignore
    }
    if (socketBindPath) {
      // Best-effort sync unlink so a quick restart doesn't trip over EADDRINUSE.
      try {
        unlinkSync(socketBindPath);
      } catch {
        // ignore
      }
    }
    try {
      ws.close();
    } catch {
      // ignore
    }
    if (activeLock) {
      activeLock.release({ message: "Aborted by user." });
      activeLock = null;
    }
    meter.dispose();
    restoreCursor();
    // Give the WS close a beat to flush, then exit.
    setTimeout(() => process.exit(code), 50);
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  // Resolve when stdin closes (e.g. piped input ended). Also covers tests.
  return await new Promise<number>((resolve) => {
    rl.on("close", () => {
      if (!exiting) {
        log.info("Input stream closed. Exiting.");
        try {
          ingestServer.close();
        } catch {
          // ignore
        }
        if (socketBindPath) {
          try {
            unlinkSync(socketBindPath);
          } catch {
            // ignore
          }
        }
        try {
          ws.close();
        } catch {
          // ignore
        }
        meter.dispose();
        restoreCursor();
      }
      resolve(0);
    });
  });
}
