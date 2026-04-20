#!/usr/bin/env bash
# VibeBreak SessionStart. Boots the `watch` loop in the background so
# unlock events (WS) and gate-open breadcrumbs flow without the user
# having to remember to start a watcher. If the device isn't paired
# yet, prints the QR inline so the user sees it immediately.

PLUGIN_BIN="${CLAUDE_PLUGIN_ROOT}/dist/bin/vibebreak.js"
[ -f "$PLUGIN_BIN" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

CONFIG="${HOME}/.vibebreak/config.json"

# Not paired yet → run pair interactively so the QR prints to the
# user's terminal. Exit non-zero would break CC, so we exit 0 regardless.
if [ ! -f "$CONFIG" ] || ! grep -q '"deviceJwt"[[:space:]]*:[[:space:]]*"[^"]' "$CONFIG" 2>/dev/null; then
  node "$PLUGIN_BIN" pair || true
  exit 0
fi

# Already paired → boot the watcher detached. Stdout/stderr go to a
# rotating log so the CC terminal stays clean. Only one watcher ever:
# the ingest socket is exclusive, so a second launch immediately exits.
LOG="${HOME}/.vibebreak/watch.log"
mkdir -p "${HOME}/.vibebreak"
nohup node "$PLUGIN_BIN" watch >>"$LOG" 2>&1 &
disown || true
exit 0
