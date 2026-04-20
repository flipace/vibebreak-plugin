import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireWatcherLock } from "./watcher-lock.js";

const tempDirs: string[] = [];

async function makeLockPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "vibebreak-watch-lock-"));
  tempDirs.push(dir);
  return path.join(dir, "watch.lock");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("acquireWatcherLock", () => {
  it("allows only one live watcher to hold the lock", async () => {
    const lockPath = await makeLockPath();

    const first = await acquireWatcherLock({
      lockPath,
      isProcessAlive: () => true,
    });
    const second = await acquireWatcherLock({
      lockPath,
      isProcessAlive: () => true,
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    await first?.release();
  });

  it("replaces a dead owner", async () => {
    const lockPath = await makeLockPath();

    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 999_999,
        acquiredAt: 1,
        token: "stale-owner",
      }),
      { mode: 0o600 },
    );

    const lock = await acquireWatcherLock({
      lockPath,
      isProcessAlive: () => false,
    });

    expect(lock).not.toBeNull();
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
      pid: process.pid,
    });

    await lock?.release();
  });

  it("does not remove a replacement lock when an old owner releases late", async () => {
    const lockPath = await makeLockPath();

    const first = await acquireWatcherLock({
      lockPath,
      isProcessAlive: () => true,
    });
    expect(first).not.toBeNull();

    await first?.release();

    const second = await acquireWatcherLock({
      lockPath,
      isProcessAlive: () => true,
    });
    expect(second).not.toBeNull();

    first?.releaseSync();

    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
      pid: process.pid,
    });

    await second?.release();
  });

  it("waits for a fresh lock file to finish publishing before deciding ownership", async () => {
    const lockPath = await makeLockPath();

    await writeFile(lockPath, "", { mode: 0o600 });

    let sleeps = 0;
    const lock = await acquireWatcherLock({
      lockPath,
      publishGraceMs: 1_000,
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 1) {
          await writeFile(
            lockPath,
            JSON.stringify({
              pid: 4242,
              acquiredAt: Date.now(),
              token: "other-owner",
            }),
            { mode: 0o600 },
          );
        }
      },
      isProcessAlive: (pid) => pid === 4242,
    });

    expect(lock).toBeNull();
    expect(sleeps).toBe(1);
  });
});
