import kleur from "kleur";

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export interface LockHandle {
  release(success?: { message?: string }): void;
  /** True if release() has been called. */
  released: boolean;
}

function pad(line: string, width: number): string {
  if (line.length >= width) return line.slice(0, width);
  return line + " ".repeat(width - line.length);
}

function box(lines: string[], width = 56): string[] {
  const top = `┌${"─".repeat(width)}┐`;
  const bottom = `└${"─".repeat(width)}┘`;
  const body = lines.map((l) => `│${pad(` ${l}`, width)}│`);
  return [top, ...body, bottom];
}

/**
 * Renders a big terminal lock screen. Returns a handle whose `release()`
 * clears the lock visuals, restores the cursor, and prints a success line.
 *
 * V1 note: stdin is consumed elsewhere (the watch loop reads `tokens:N`
 * lines from it), so we don't fight for it here. We do hide the cursor
 * and ensure it gets restored on release / process exit.
 */
export function startLock(opts: {
  exerciseLabel: string;
  thresholdTokens: number;
  gateId?: string;
}): LockHandle {
  process.stdout.write(HIDE_CURSOR);

  const header = kleur.bgRed().black().bold(" PAUSE  VibeBreak ");
  const sub1 = `You just burned ${kleur.bold(opts.thresholdTokens.toLocaleString())} tokens.`;
  const sub2 = `Pick up your phone and do: ${kleur.bold().yellow(opts.exerciseLabel)}`;
  const sub3 = kleur.gray("Terminal will unlock automatically when the gate is completed.");
  const idLine = opts.gateId ? kleur.gray(`gate: ${opts.gateId}`) : "";

  const lines = [
    header,
    "",
    sub1,
    sub2,
    "",
    sub3,
    ...(idLine ? [idLine] : []),
  ];
  const rendered = box(lines);
  process.stdout.write(`\n${rendered.join("\n")}\n\n`);

  const handle: LockHandle = {
    released: false,
    release(success) {
      if (handle.released) return;
      handle.released = true;
      process.stdout.write(SHOW_CURSOR);
      const msg = success?.message ?? "Unlocked. Back to vibing.";
      process.stdout.write(`\n${kleur.bgGreen().black().bold(" UNLOCK ")} ${msg}\n\n`);
    },
  };

  return handle;
}

/**
 * Best-effort cursor restore (call on process exit signals).
 */
export function restoreCursor(): void {
  try {
    process.stdout.write(SHOW_CURSOR);
  } catch {
    // ignore
  }
}
