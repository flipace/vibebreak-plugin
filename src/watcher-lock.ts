import { randomUUID } from "node:crypto";
import { promises as fs, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

interface WatcherLockState {
  pid: number;
  acquiredAt: number;
  token: string;
}

export interface WatcherLockHandle {
  readonly path: string;
  release(): Promise<void>;
  releaseSync(): void;
}

interface AcquireWatcherLockOptions {
  lockPath: string;
  isProcessAlive?: (pid: number) => boolean;
  publishGraceMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const LOCK_PUBLISH_GRACE_MS = 500;
const LOCK_RETRY_DELAY_MS = 25;

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return e.code !== "ESRCH";
  }
}

function parseLockState(raw: string): WatcherLockState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<WatcherLockState>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.acquiredAt === "number" &&
      Number.isFinite(parsed.acquiredAt) &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0
    ) {
      return parsed as WatcherLockState;
    }
  } catch {
    // Invalid lock file, treat as stale.
  }
  return null;
}

async function unlinkIfOwned(lockPath: string, expectedContents: string): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(lockPath, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return;
    throw err;
  }
  if (raw !== expectedContents) return;
  try {
    await fs.unlink(lockPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }
}

function unlinkIfOwnedSync(lockPath: string, expectedContents: string): void {
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return;
    throw err;
  }
  if (raw !== expectedContents) return;
  try {
    unlinkSync(lockPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }
}

async function resolveExistingLock(
  lockPath: string,
  isProcessAlive: (pid: number) => boolean,
  publishGraceMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<"retry" | "locked"> {
  let raw: string;
  try {
    raw = await fs.readFile(lockPath, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return "retry";
    throw err;
  }

  const parsed = parseLockState(raw);
  if (parsed && isProcessAlive(parsed.pid)) {
    return "locked";
  }
  if (!parsed) {
    try {
      const stat = await fs.stat(lockPath);
      if (Date.now() - stat.mtimeMs < publishGraceMs) {
        await sleep(LOCK_RETRY_DELAY_MS);
        return "retry";
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return "retry";
      throw err;
    }
  }

  try {
    await fs.unlink(lockPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }
  return "retry";
}

export async function acquireWatcherLock(
  opts: AcquireWatcherLockOptions,
): Promise<WatcherLockHandle | null> {
  await fs.mkdir(path.dirname(opts.lockPath), { recursive: true, mode: 0o700 });

  const isProcessAlive = opts.isProcessAlive ?? defaultIsProcessAlive;
  const publishGraceMs = opts.publishGraceMs ?? LOCK_PUBLISH_GRACE_MS;
  const sleep =
    opts.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const contents = JSON.stringify({
    pid: process.pid,
    acquiredAt: Date.now(),
    token: randomUUID(),
  } satisfies WatcherLockState);

  while (true) {
    try {
      const handle = await fs.open(opts.lockPath, "wx", 0o600);
      try {
        await handle.writeFile(contents);
      } finally {
        await handle.close();
      }
      return {
        path: opts.lockPath,
        async release() {
          await unlinkIfOwned(opts.lockPath, contents);
        },
        releaseSync() {
          unlinkIfOwnedSync(opts.lockPath, contents);
        },
      };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") throw err;
      const status = await resolveExistingLock(
        opts.lockPath,
        isProcessAlive,
        publishGraceMs,
        sleep,
      );
      if (status === "locked") {
        return null;
      }
    }
  }
}
