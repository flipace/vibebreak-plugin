import kleur from "kleur";
import { runCcHook } from "../src/cc-hook.js";
import { runCheckGate } from "../src/check-gate.js";
import { clearJwt, configPath, isPaired, load, redactConfig } from "../src/config.js";
import { runIngest } from "../src/ingest.js";
import { log } from "../src/log.js";
import { runPair } from "../src/pair.js";
import { runWatch } from "../src/watch.js";

const HELP = `
${kleur.bold("VibeBreak")} - lock your AI session every N tokens until you move.

${kleur.bold("Usage:")}
  vibebreak                       Run \`watch\` if paired, otherwise \`pair\`.
  vibebreak pair                  One-time QR pairing with the VibeBreak phone app.
  vibebreak watch                 Start the token meter + lock + WS unlock loop.
  vibebreak ingest --tokens N     Forward N tokens to the running \`watch\` process.
  vibebreak cc-hook               Read a Claude Code PostToolUse event from
                                  stdin, diff session token usage from the
                                  transcript, and forward the delta to watch.
                                  (Used by the bundled CC plugin hook.)
  vibebreak check-gate            Exit 2 if a gate is currently open, else 0.
                                  Used by the CC PreToolUse hook to block
                                  tool calls until the user completes.
  vibebreak config                Print the current config JSON.
  vibebreak logout                Clear the saved device JWT.
  vibebreak help                  Show this message.

${kleur.bold("Environment:")}
  VIBEBREAK_API                   Override API base URL (default https://api.vibebreak.app).
  VIBEBREAK_WS                    Override WS base URL  (default wss://api.vibebreak.app).

${kleur.bold("Token sources for `watch`:")}
  1. Stdin lines like \`tokens:1234\` (manual / V1 fallback).
  2. Local socket at ~/.vibebreak/sock fed by \`vibebreak ingest --tokens N\`
     from the bundled Claude Code PostToolUse hook.
`;

type Cmd = "pair" | "watch" | "config" | "logout" | "ingest" | "cc-hook" | "check-gate" | "help";

interface ParsedArgs {
  cmd: Cmd | null;
  tokens?: number;
  error?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const a = argv[2];
  if (a === undefined) return { cmd: null };
  if (
    a === "pair" ||
    a === "watch" ||
    a === "config" ||
    a === "logout" ||
    a === "cc-hook" ||
    a === "check-gate"
  ) {
    return { cmd: a };
  }
  if (a === "help" || a === "--help" || a === "-h") return { cmd: "help" };
  if (a === "ingest") {
    // Accept `--tokens N` and `--tokens=N`.
    let raw: string | undefined;
    for (let i = 3; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--tokens") {
        raw = argv[i + 1];
        i++;
      } else if (arg !== undefined && arg.startsWith("--tokens=")) {
        raw = arg.slice("--tokens=".length);
      }
    }
    if (raw === undefined) {
      return { cmd: "ingest", error: "Missing required flag: --tokens N" };
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      return { cmd: "ingest", error: `--tokens must be a positive integer, got: ${raw}` };
    }
    return { cmd: "ingest", tokens: n };
  }
  return { cmd: null };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv);
  const explicit = parsed.cmd;

  if (explicit === "help") {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  if (explicit === "cc-hook") {
    // Always exit 0 — never block the CC session on a hook glitch.
    try {
      await runCcHook();
    } catch (err) {
      process.stderr.write(`vibebreak cc-hook: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    return 0;
  }

  if (explicit === "check-gate") {
    // Intentionally can exit 2 to block the CC tool call.
    try {
      return await runCheckGate();
    } catch {
      // On any unexpected error, fall open — never block CC because of a glitch.
      return 0;
    }
  }

  if (explicit === "ingest") {
    if (parsed.error !== undefined || parsed.tokens === undefined) {
      log.err(parsed.error ?? "Missing --tokens N");
      process.stderr.write(`${HELP}\n`);
      return 1;
    }
    const cfg = await load();
    return await runIngest(cfg, parsed.tokens);
  }

  const cfg = await load();

  if (explicit === "config") {
    log.banner();
    process.stdout.write(`${kleur.gray(`# ${configPath()}`)}\n`);
    process.stdout.write(`${JSON.stringify(redactConfig(cfg), null, 2)}\n`);
    return 0;
  }

  if (explicit === "logout") {
    log.banner();
    await clearJwt();
    log.ok("Cleared device JWT. Run `vibebreak pair` to re-pair.");
    return 0;
  }

  // Default: watch if paired, otherwise pair.
  const cmd: Cmd = explicit ?? (isPaired(cfg) ? "watch" : "pair");

  if (cmd === "pair") {
    log.banner();
    const result = await runPair(cfg);
    return result.ok ? 0 : 1;
  }

  if (cmd === "watch") {
    log.banner();
    return await runWatch(cfg);
  }

  process.stdout.write(`${HELP}\n`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  });
