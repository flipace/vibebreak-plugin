#!/usr/bin/env bash
# VibeBreak PreToolUse hook. Blocks a Claude Code tool call (exit 2 +
# friendly stderr) if a VibeBreak gate is currently open waiting on the
# user. The watcher owns the ~/.vibebreak/active-gate.json breadcrumb;
# we just read it here via `vibebreak check-gate`. When no gate is open,
# we exit 0 and CC proceeds normally.

PLUGIN_BIN="${CLAUDE_PLUGIN_ROOT}/dist/bin/vibebreak.js"

if [ -f "$PLUGIN_BIN" ] && command -v node >/dev/null 2>&1; then
  node "$PLUGIN_BIN" check-gate
  exit $?
fi

# No vibebreak installed at all — don't block CC.
exit 0
