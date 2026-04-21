import { promises as fs, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { platform } from "node:os";
import { createInterface } from "node:readline";
import kleur from "kleur";
import { EXERCISE_DEFAULT_TARGET, type ExerciseKind, type GateResponse } from "./shared.js";
import { clearActiveGate, saveActiveGate } from "./active-gate.js";
import { Api, ApiError } from "./api.js";
import {
  configDir,
  ensureIngestSecret,
  isPaired,
  save,
  socketPath,
  watcherLockPath,
  type PluginConfig,
} from "./config.js";
import { createSocketLineAuthorizer } from "./ingest-protocol.js";
import { log } from "./log.js";
import { startLock, restoreCursor, type LockHandle } from "./lock.js";
import { TokenMeter } from "./meter.js";
import { acquireWatcherLock } from "./watcher-lock.js";
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

/**
 * Probe whether a watcher is already listening on the given unix-domain socket.
 * Used to keep the watcher a singleton per device - parallel CC SessionStart
 * hooks would otherwise each spawn their own watcher and the second one would
 * wipe the first off the socket, producing a zombie watcher with a dangling
 * WS connection and duplicated heartbeats.
 */
async function probeUnixSocket(sockPath: string, timeoutMs = 500): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve(alive);
    };
    const sock = createConnection({ path: sockPath });
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

async function probeTcpPort(port: number, timeoutMs = 500): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve(alive);
    };
    const sock = createConnection({ host: "127.0.0.1", port });
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

export async function runWatch(cfg: PluginConfig, opts: WatchOptions = {}): Promise<number> {
  if (!isPaired(cfg) || !cfg.deviceJwt || !cfg.deviceId) {
    log.err("This device isn't paired yet. Run `vibebreak pair` first.");
    return 1;
  }
  const watchLock = await acquireWatcherLock({ lockPath: watcherLockPath() });
  if (!watchLock) {
    log.info("Another vibebreak watcher is already starting or running. Exiting.");
    return 0;
  }

  const releaseWatchLock = (): void => {
    try {
      watchLock.releaseSync();
    } catch {
      // ignore
    }
  };
  const releaseWatchLockOnExit = (): void => {
    releaseWatchLock();
  };
  process.once("exit", releaseWatchLockOnExit);

  try {
    // Singleton check before we open any sockets. Parallel CC sessions each
    // invoke SessionStart.sh which nohup-spawns `vibebreak watch`. The file
    // lock elects one startup winner across platforms. We still probe the
    // ingest endpoint here as a safety net for older watchers that predate
    // the lock file and would otherwise keep running beside us.
    const isWindows = platform() === "win32";
    if (!isWindows) {
      const sockPath = socketPath();
      if (await probeUnixSocket(sockPath)) {
        log.info(
          `Another vibebreak watcher is already running (socket ${kleur.gray(sockPath)} is live). Exiting.`,
        );
        return 0;
      }
    } else if (typeof cfg.ingestPort === "number" && cfg.ingestPort > 0) {
      if (await probeTcpPort(cfg.ingestPort)) {
        log.info(
          `Another vibebreak watcher is already running (127.0.0.1:${cfg.ingestPort} is live). Exiting.`,
        );
        return 0;
      }
    }

    try {
      cfg = await ensureIngestSecret(cfg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.err(`Could not initialize the local ingest secret: ${msg}`);
      return 1;
    }

    log.ok("Watcher active. This process is now tracking VibeBreak on this machine.");

    // Narrowed once at entry by the isPaired check above; async awaits below
    // reassign `cfg` so TS loses the narrowing. Re-assert here.
    const deviceJwt = cfg.deviceJwt as string;
    const api = new Api(cfg.apiBaseUrl, deviceJwt);
    const ws: WsClient = connectWs(cfg.wsBaseUrl, deviceJwt);

    let activeLock: LockHandle | null = null;
    let activeGateId: string | null = null;
    let exiting = false;
    let meterSyncOnline = false;

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
        // best-effort - the watcher's lock still works even if the file write fails
      }
      // Reset the accumulator so the heartbeat-driven mobile UI doesn't stay
      // pinned near the threshold while the gate is pending. The `fired` flag
      // stays set, but that's fine - fireGate() guards on activeLock anyway.
      meter.reset();
    }

    ws.on("hello", (deviceId) => {
      log.ok(`Phone sync online. Live unlocks are ready for device ${kleur.gray(deviceId)}.`);
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

    ws.on("close", () => {
      // Reconnect messaging is handled in ws.ts.
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

    // Source 2: local socket - Unix-domain on POSIX, TCP loopback on Windows.
    // CC PostToolUse hooks invoke `vibebreak ingest --tokens N` which writes
    // a single `tokens:N\n` line into this socket and disconnects.
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
        log.ok(
          `Local token ingest ready at ${kleur.gray(`127.0.0.1:${boundIngestPort}`)}.`,
        );
      }
    } else {
      const sockPath = socketPath();
      // Make sure ~/.vibebreak exists (config save also does this lazily).
      try {
        await fs.mkdir(configDir(), { recursive: true, mode: 0o700 });
      } catch {
        // ignore - listen() will surface a real error below.
      }
      // Try to bind. If EADDRINUSE, re-probe: if the existing socket is live
      // another watcher won the race and we should exit. If it's dead (stale
      // file from a crashed process) unlink it and retry ONCE.
      const bindOnce = (): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          const onError = (err: NodeJS.ErrnoException): void => {
            ingestServer.removeListener("listening", onListen);
            reject(err);
          };
          const onListen = (): void => {
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
        const e = err as NodeJS.ErrnoException;
        if (e?.code === "EADDRINUSE" || e?.code === "EEXIST") {
          if (await probeUnixSocket(sockPath)) {
            log.info(
              `Another vibebreak watcher bound ${kleur.gray(sockPath)} while we were starting up. Exiting.`,
            );
            try {
              ws.close();
            } catch {
              // ignore
            }
            meter.dispose();
            return 0;
          }
          // Socket file is stale. Unlink and retry.
          try {
            await fs.unlink(sockPath);
          } catch {
            // ignore
          }
          try {
            await bindOnce();
            socketBindPath = sockPath;
          } catch (err2) {
            const e2 = err2 as NodeJS.ErrnoException;
            log.warn(`Could not bind ingest socket at ${sockPath}: ${e2?.message ?? err2}`);
          }
        } else {
          log.warn(`Could not bind ingest socket at ${sockPath}: ${e?.message ?? err}`);
        }
      }
      // Lock the socket down so only this user can write to it.
      if (socketBindPath) {
        try {
          await fs.chmod(sockPath, 0o600);
        } catch {
          // ignore
        }
        log.ok(`Local token ingest ready at ${kleur.gray(sockPath)}.`);
      }
    }

    log.info(`Break gate armed at ${kleur.bold(cfg.thresholdTokens.toLocaleString())} tokens.`);
    log.info(
      `Claude Code hooks can feed token deltas automatically, or you can send ${kleur.cyan(
        "tokens:1234",
      )} on stdin.`,
    );
    log.info("Phone sync is starting up. You will see an explicit 'Phone sync online' once it is ready.");
    log.info(
      "Normal while idle: VibeBreak stays quiet until sync changes, a gate opens, or you stop the watcher.",
    );

    // Heartbeat the current meter to the API so the mobile app can render
    // a live counter on Home. The response carries back the user's canonical
    // threshold - if it differs from what we're using, sync the meter so a
    // change made in the mobile settings takes effect within ~3s without
    // the user needing to restart `vibebreak watch`.
    async function tickHeartbeat(): Promise<void> {
      try {
        const ack = await api.meterHeartbeat({
          current: meter.total,
          threshold: meter.currentThreshold,
        });
        if (!meterSyncOnline) {
          meterSyncOnline = true;
          log.ok("Live meter sync online. Your phone can see the current token count.");
        }
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
        if (meterSyncOnline) {
          meterSyncOnline = false;
          log.warn("Live meter sync lost. Local token counting still continues.");
        }
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
      log.warn("Could not load account settings at startup. Using the local threshold for now.");
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
      releaseWatchLock();
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
          releaseWatchLock();
        }
        resolve(0);
      });
    });
  } finally {
    process.off("exit", releaseWatchLockOnExit);
    await watchLock.release().catch(() => undefined);
  }
}
