import { promises as fs } from "node:fs";
import path from "node:path";
import { configDir } from "./config.js";

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

  const totals = await loadTotals();
  const previous = totals[event.session_id] ?? 0;
  const delta = total - previous;
  totals[event.session_id] = total;
  await saveTotals(totals);

  if (delta <= 0) return;

  // Forward via in-process call to keep the hook latency tight (no extra
  // process spawn) and to avoid PATH issues when the user hasn't installed
  // the bin globally.
  const { load } = await import("./config.js");
  const { runIngest } = await import("./ingest.js");
  const cfg = await load();
  await runIngest(cfg, delta);
}
