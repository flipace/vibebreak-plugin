#!/usr/bin/env bash
# VibeBreak PostToolUse hook. CC's event JSON has no token counts, but it
# does include `transcript_path` pointing at the session's .jsonl. We hand
# the event to `vibebreak cc-hook`, which sums all assistant `usage` blocks
# in the transcript, diffs against the per-session high-water mark in
# ~/.vibebreak/cc-session-totals.json, and forwards the delta via the
# local socket (~/.vibebreak/sock) to the running `vibebreak watch`. If
# the watcher isn't running, the call is a silent no-op. We never block
# the CC session on a hook failure.

PLUGIN_BIN="${CLAUDE_PLUGIN_ROOT}/dist/bin/vibebreak.js"

if [ -f "$PLUGIN_BIN" ] && command -v node >/dev/null 2>&1; then
  node "$PLUGIN_BIN" cc-hook >/dev/null 2>&1 || true
fi

exit 0
