import kleur from "kleur";

function ts(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export const log = {
  info(msg: string): void {
    process.stdout.write(`${kleur.gray(ts())} ${kleur.cyan("info")}  ${msg}\n`);
  },
  ok(msg: string): void {
    process.stdout.write(`${kleur.gray(ts())} ${kleur.green("ok")}    ${msg}\n`);
  },
  warn(msg: string): void {
    process.stderr.write(`${kleur.gray(ts())} ${kleur.yellow("warn")}  ${msg}\n`);
  },
  err(msg: string): void {
    process.stderr.write(`${kleur.gray(ts())} ${kleur.red("err")}   ${msg}\n`);
  },
  banner(): void {
    const tag = kleur.bgRed().black().bold(" VibeBreak ");
    const tag2 = kleur.gray("- lock your AI session until you move");
    process.stdout.write(`\n${tag} ${tag2}\n\n`);
  },
};
