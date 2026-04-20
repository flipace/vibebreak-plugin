import { promises as fs } from "node:fs";
import path from "node:path";
import { configDir } from "./config.js";

/**
 * Local breadcrumb for the active (pending) gate. Written by the watcher
 * when a gate is created, read by `vibebreak check-gate` inside the CC
 * PreToolUse hook, and deleted when the gate is completed/skipped.
 *
 * Keeping this state on the local filesystem means the hook never has to
 * make a network call per tool use — the watcher owns the source of truth
 * and keeps the file in sync with reality.
 */
export interface ActiveGate {
  gateId: string;
  exerciseLabel: string;
  triggeredAt: string;
}

function activeGatePath(): string {
  return path.join(configDir(), "active-gate.json");
}

export async function saveActiveGate(gate: ActiveGate): Promise<void> {
  const dir = configDir();
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  } catch {
    // ignore
  }
  await fs.writeFile(activeGatePath(), JSON.stringify(gate, null, 2), { mode: 0o600 });
}

export async function clearActiveGate(): Promise<void> {
  try {
    await fs.unlink(activeGatePath());
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }
}

export async function readActiveGate(): Promise<ActiveGate | null> {
  try {
    const raw = await fs.readFile(activeGatePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as ActiveGate).gateId === "string" &&
      typeof (parsed as ActiveGate).exerciseLabel === "string" &&
      typeof (parsed as ActiveGate).triggeredAt === "string"
    ) {
      return parsed as ActiveGate;
    }
    return null;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    // Malformed file — treat as absent rather than blocking the user.
    return null;
  }
}
