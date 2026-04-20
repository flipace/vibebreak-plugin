# VibeBreak — Claude Code plugin

Lock your Claude Code sessions every N tokens until you move. Your phone
counts reps with the accelerometer and posts a BeReal-style dual-cam snap
to friends. Terminal unlocks.

> Home: [vibebreak.app](https://vibebreak.app)

## Install

Inside a Claude Code session, run these two slash commands:

```
/plugin marketplace add flipace/vibebreak-plugin
/plugin install vibebreak@vibebreak
```

Then open the VibeBreak mobile app and scan the QR code the plugin prints
to pair your computer.

## How it works

1. `SessionStart` hook boots a background watcher that tails your token
   usage from Claude Code's transcript.
2. At your threshold (default 250k tokens, configurable on the phone) the
   watcher POSTs `/v1/gates` to the VibeBreak API.
3. `PreToolUse` hook reads a local breadcrumb the watcher writes. Every
   tool call exits with code 2 until the gate is resolved — your
   terminal hard-locks.
4. Phone picks an exercise, counts reps, snaps, posts. WebSocket unlock
   clears the breadcrumb. Claude resumes.

## Subcommands

| Command | What it does |
|---|---|
| `vibebreak` | Runs `watch` if paired, otherwise `pair`. |
| `vibebreak pair` | One-time QR pairing with the phone app. |
| `vibebreak watch` | Token meter + lock + WS unlock loop + local ingest server. |
| `vibebreak ingest --tokens N` | Forward N tokens to the running watcher (used by the CC PostToolUse hook). |
| `vibebreak cc-hook` | Read a CC hook event from stdin, diff token usage, forward delta to the watcher. |
| `vibebreak check-gate` | Exit 2 if a gate is currently open (used by the PreToolUse hook). |
| `vibebreak config` | Print the resolved config JSON. |
| `vibebreak logout` | Clear the saved device JWT. |

## Environment overrides

| Variable | Default | Purpose |
|---|---|---|
| `VIBEBREAK_API` | `https://api.vibebreak.app` | API base URL (REST). |
| `VIBEBREAK_WS`  | `wss://api.vibebreak.app` | WebSocket base URL for unlock events. |

## Files on disk

| Path | Purpose |
|---|---|
| `~/.vibebreak/config.json` | Device JWT, base URLs, threshold, optional `ingestPort`. |
| `~/.vibebreak/sock` | Unix-domain socket for the local ingest server (POSIX only). |
| `~/.vibebreak/active-gate.json` | Breadcrumb consumed by `check-gate` — present while a gate is waiting on the user. |

## Layout

```
.claude-plugin/
├── marketplace.json   # marketplace catalog (this repo IS the catalog)
└── plugin.json        # plugin manifest
bin/vibebreak.ts       # CLI entry
src/                   # watcher, meter, WS, pair flow
  shared.ts            # vendored API contracts (zod schemas + consts)
hooks/
├── SessionStart.sh    # spawn watcher on CC session start
├── PreToolUse.sh      # read active-gate breadcrumb; exit 2 if locked
├── PostToolUse.sh     # forward token deltas into ingest
└── hooks.json         # CC hook registration
```

## Scripts

| | |
| --- | --- |
| `pnpm dev` | tsx watch on the CLI entry |
| `pnpm build` | tsup → `dist/bin/vibebreak.js` |
| `pnpm typecheck` | tsc --noEmit |

## License

UNLICENSED — personal project.
