import kleur from "kleur";
import { readActiveGate } from "./active-gate.js";

/**
 * Called by the Claude Code PreToolUse hook. If there's an active gate
 * waiting on the user, exit 2 with a friendly stderr message — CC treats
 * that as a block, refuses the tool call, and surfaces the stderr text
 * to both the user and the model. Any other exit code (including the 0
 * on "no active gate") lets the tool proceed.
 *
 * We keep this path dead simple: a single local file read. No network,
 * no parsing of transcripts, nothing that can make the hook slow or
 * flaky. The watcher owns keeping active-gate.json in sync with reality.
 */
export async function runCheckGate(): Promise<number> {
  const gate = await readActiveGate();
  if (!gate) return 0;

  const ageMinutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(gate.triggeredAt).getTime()) / 60_000),
  );
  const ago = ageMinutes === 0 ? "just now" : `${ageMinutes}m ago`;

  process.stderr.write(
    `${kleur.red().bold("⏸  VibeBreak gate open")}  ${kleur.gray(`(triggered ${ago})`)}\n` +
      `Pick up your phone and complete: ${kleur.cyan().bold(gate.exerciseLabel)}\n` +
      `Then this tool call will go through automatically.\n`,
  );
  return 2;
}
