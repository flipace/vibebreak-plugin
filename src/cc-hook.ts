import { promises as fs } from "node:fs";
import path from "node:path";
import { configDir } from "./config.js";

const TOTALS_LOCK = path.join(configDir(), "cc-session-totals.lock");
const LOCK_WAIT_MS = 2_000;
const STALE_LOCK_MS = 10_000;

/**
 * Simple cooperative file lock. Keeps parallel PostToolUse hooks (from
 * multiple concurrent CC sessions) from racing on cc-session-totals.json.
 *
 * Protocol: create the lock file exclusively with the owning pid + mtime
 * as the contents. Retry with small sleeps if the lock is held. If the
 * lock is older than STALE_LOCK_MS, assume its owner crashed and steal it.
 */
async function withTotalsLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  await fs.mkdir(configDir(), { recursive: true, mode: 0o700 }).catch(() => undefined);

  while (true) {
    try {
      const handle = await fs.open(TOTALS_LOCK, "wx", 0o600);
      try {
        await handle.writeFile(`${process.pid}:${Date.now()}`);
      } finally {
        await handle.close();
      }
      break;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== "EEXIST") {
        // Any other error → fall through and try work without a lock.
        // The hook is best-effort; never fail the CC session on lock IO.
        return await fn();
      }
      // Look for a stale lock from a crashed hook.
      try {
        const stat = await fs.stat(TOTALS_LOCK);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          await fs.unlink(TOTALS_LOCK).catch(() => undefined);
          continue;
        }
      } catch {
        // lock vanished between open() and stat() — retry immediately
        continue;
      }
      if (Date.now() >= deadline) {
        // Give up waiting and proceed without the lock. Better to risk a
        // one-time race than to drop a hook entirely.
        return await fn();
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.unlink(TOTALS_LOCK).catch(() => undefined);
  }
}

interface PostToolUseEvent {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
}

interface AssistantUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface TranscriptLine {
  type?: string;
  message?: {
    usage?: AssistantUsage;
  };
}

const TOTALS_FILE = path.join(configDir(), "cc-session-totals.json");

/**
 * Read every assistant message in the transcript and sum the tokens
 * that represent NEW work this turn — fresh input not in cache plus
 * generated output. We deliberately skip cache_read_input_tokens (those
 * are replayed context, not new vibing) AND cache_creation_input_tokens
 * (those are huge one-time writes of the system prompt + tools, paid
 * once and amortized — they make cold-start sessions look 50× more
 * intense than they really are). What's left is the per-turn cost
 * the model would have paid without caching: a clean "intensity"
 * signal that grows steadily as the session does real work.
 */
async function sumTranscript(transcriptPath: string): Promise<number> {
  let raw: string;
  try {
    raw = await fs.readFile(transcriptPath, "utf8");
  } catch {
    return 0;
  }
  let total = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (line.length === 0) continue;
    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }
    const u = parsed.message?.usage;
    if (!u) continue;
    total += (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
  }
  return total;
}

async function loadTotals(): Promise<Record<string, number>> {
  try {
    const raw = await fs.readFile(TOTALS_FILE, "utf8");
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === "object") {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
      }
      return out;
    }
  } catch {
    // first run / file missing — empty totals
  }
  return {};
}

async function saveTotals(totals: Record<string, number>): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(TOTALS_FILE, JSON.stringify(totals, null, 2), { mode: 0o600 });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Bridge between Claude Code's PostToolUse hook and the local watcher
 * socket. Reads the event JSON from stdin, totals all assistant usage in
 * the referenced transcript, diffs against per-session high-water marks
 * persisted to ~/.vibebreak/cc-session-totals.json, and forwards any
 * positive delta via `vibebreak ingest --tokens N` (which writes to the
 * Unix-domain socket the watch loop reads).
 *
 * Always exits 0 — never block the user's CC session on a hook failure.
 */
export async function runCcHook(): Promise<void> {
  const raw = await readStdin();
  if (raw.trim().length === 0) return;

  let event: PostToolUseEvent;
  try {
    event = JSON.parse(raw) as PostToolUseEvent;
  } catch {
    return;
  }
  if (!event.session_id || !event.transcript_path) return;

  const total = await sumTranscript(event.transcript_path);
  if (total <= 0) return;

  // Serialize read→mutate→write so parallel CC sessions don't clobber each
  // other's session entries. Without this, the losing write sees prev=0 on
  // its next run and forwards the full session sum, double-counting and
  // potentially firing a gate too early.
  const delta = await withTotalsLock(async () => {
    const totals = await loadTotals();
    const previous = totals[event.session_id as string] ?? 0;
    // Guard against transcript resets (tool rotation, log trims). We only
    // advance the high-water mark, never rewind — a non-monotonic drop
    // would otherwise emit a phantom huge delta on the next real increase.
    const nextTotal = Math.max(previous, total);
    totals[event.session_id as string] = nextTotal;
    await saveTotals(totals);
    return nextTotal - previous;
  });

  if (delta <= 0) return;

  // Forward via in-process call to keep the hook latency tight (no extra
  // process spawn) and to avoid PATH issues when the user hasn't installed
  // the bin globally.
  const { load } = await import("./config.js");
  const { runIngest } = await import("./ingest.js");
  const cfg = await load();
  await runIngest(cfg, delta);
}
