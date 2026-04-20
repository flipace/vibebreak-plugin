import { createConnection, type NetConnectOpts } from "node:net";
import { platform } from "node:os";
import kleur from "kleur";
import { socketPath, type PluginConfig } from "./config.js";
import { createIngestPayload } from "./ingest-protocol.js";

/**
 * Send a single `tokens:N\n` line to the running `vibebreak watch` process.
 *
 * If the watcher isn't running (socket missing/refused), exit silently with 0
 * after printing a one-line dim hint. We never error here - CC hooks must
 * never block a session because of a missing watcher.
 */
export async function runIngest(cfg: PluginConfig, tokens: number): Promise<number> {
  const isWindows = platform() === "win32";
  const opts: NetConnectOpts = isWindows
    ? { host: "127.0.0.1", port: cfg.ingestPort ?? 0 }
    : { path: socketPath() };

  // Bail early on Windows if we don't have a port to talk to.
  if (isWindows && (!cfg.ingestPort || cfg.ingestPort <= 0)) {
    process.stdout.write(
      `${kleur.gray("vibebreak watch isn't running - no gate will be tracked.")}\n`,
    );
    return 0;
  }

  return await new Promise<number>((resolve) => {
    const sock = createConnection(opts);
    let settled = false;
    const finish = (code: number, hint?: string): void => {
      if (settled) return;
      settled = true;
      if (hint !== undefined) {
        process.stdout.write(`${kleur.gray(hint)}\n`);
      }
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve(code);
    };

    sock.once("error", (err: NodeJS.ErrnoException) => {
      // ENOENT (no socket file), ECONNREFUSED (no listener), EACCES, etc.
      // All mean: watcher isn't running. Be silent-ish; never error.
      if (
        err.code === "ENOENT" ||
        err.code === "ECONNREFUSED" ||
        err.code === "EACCES" ||
        err.code === "ENOTSOCK"
      ) {
        finish(0, "vibebreak watch isn't running - no gate will be tracked.");
        return;
      }
      // Any other error: still don't fail the CC hook.
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
