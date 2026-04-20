# Security Best Practices Report

Date: 2026-04-20
Repository: `vibebreak-plugin`

## Executive Summary

This review did not find obvious remote code execution or shell injection paths in the plugin itself. The original risks were around credential handling and trust boundaries in the local hook/watcher architecture, and those issues have now been remediated in the working tree.

Remediated findings:

1. High - the device JWT was placed in the WebSocket URL query string.
2. Medium - hook scripts fell back to executing the first `vibebreak` found on `PATH`.
3. Medium - the Windows ingest channel accepted unauthenticated loopback clients.
4. Low - the `config` command printed the stored bearer token without redaction.

Dependency spot-check outcome:

- Direct runtime dependencies are pinned exactly in [package.json](/Users/flipace/Development/vibebreak-plugin/package.json:26).
- `ws@8.18.0` is newer than the patched `8.17.1` release for GHSA-3h5v-q93c-6h6q / CVE-2024-37890 and newer than the patched lines for GHSA-6fc8-4gx4-v693 / CVE-2021-32640.
- `zod@3.23.8` is newer than the patched `3.22.3` release for GHSA-m95q-7qp3-xv42 / CVE-2023-4316.
- I did not find a GitHub Advisory Database or OSV advisory for `kleur@4.1.5` or `qrcode-terminal@0.12.0` during this spot-check.

Limitations:

- This environment does not have `node`, `npm`, or `pnpm` on `PATH`, so I could not run `npm audit`, build verification, or test execution locally.
- The WebSocket authentication fix now uses an `Authorization` header in the plugin. The deployed backend must accept header-based auth on the upgrade request for the client to connect successfully.

## High Severity

### 1. Device JWT is sent in the WebSocket query string

Affected code:

- [src/ws.ts](/Users/flipace/Development/vibebreak-plugin/src/ws.ts:28)

Status:

- Fixed in the current working tree by moving the JWT to an `Authorization` header and removing the query-string token from the constructed WebSocket URL.

Remediation evidence:

- `buildWsRequest()` now returns a clean `/v1/ws` URL and an `authorization` header in [src/ws.ts](/Users/flipace/Development/vibebreak-plugin/src/ws.ts:28).
- `connectWs()` now passes that header set into the `ws` client constructor in [src/ws.ts](/Users/flipace/Development/vibebreak-plugin/src/ws.ts:42).

Impact:

- Query-string credentials are routinely exposed to reverse-proxy logs, load balancer logs, tracing systems, error reports, and support tooling.
- If that JWT is reusable for device authentication, leakage can let an attacker impersonate the device until the token is revoked or rotated.

Recommendation:

- Move WebSocket auth out of the URL.
- Prefer an `Authorization: Bearer ...` header if the server and client stack support it.
- If URL-based auth is unavoidable, exchange the long-lived JWT for a short-lived, one-time WebSocket ticket over the REST API and use that ticket instead.

## Medium Severity

### 2. Hook scripts execute a `PATH`-resolved binary when the bundled plugin binary is missing

Affected code:

- [hooks/PreToolUse.sh](/Users/flipace/Development/vibebreak-plugin/hooks/PreToolUse.sh:10)
- [hooks/PostToolUse.sh](/Users/flipace/Development/vibebreak-plugin/hooks/PostToolUse.sh:13)

Status:

- Fixed in the current working tree by removing the `PATH` fallback. The hooks now run only the bundled plugin binary, and only when `node` is available.

Remediation evidence:

- `PreToolUse.sh` now invokes only the bundled plugin binary when both the bundle and `node` are available in [hooks/PreToolUse.sh](/Users/flipace/Development/vibebreak-plugin/hooks/PreToolUse.sh:10).
- `PostToolUse.sh` follows the same bundled-binary-only path in [hooks/PostToolUse.sh](/Users/flipace/Development/vibebreak-plugin/hooks/PostToolUse.sh:13).

Impact:

- If the packaged `dist/bin/vibebreak.js` is absent, broken, or renamed, the hooks will execute whichever `vibebreak` binary appears first on `PATH`.
- Because these hooks run automatically during Claude Code sessions, that fallback creates an avoidable arbitrary-code-execution path via local `PATH` hijacking or accidental shadowing.

Recommendation:

- Remove the `PATH` fallback and execute only the bundled plugin binary.
- If you want a fallback for development, gate it behind an explicit opt-in environment variable and verify the resolved path belongs to the expected installation.

### 3. The Windows ingest channel accepts unauthenticated local clients

Affected code:

- [src/watch.ts](/Users/flipace/Development/vibebreak-plugin/src/watch.ts:159)
- [src/ingest.ts](/Users/flipace/Development/vibebreak-plugin/src/ingest.ts:14)

Status:

- Fixed in the current working tree by adding a local ingest secret, persisting it in config, and requiring an authenticated prelude before token lines are accepted.

Remediation evidence:

- The watcher now creates a per-installation socket authorizer before accepting token lines in [src/watch.ts](/Users/flipace/Development/vibebreak-plugin/src/watch.ts:159).
- The ingest client now sends an authenticated payload rather than a bare token line in [src/ingest.ts](/Users/flipace/Development/vibebreak-plugin/src/ingest.ts:61).

Impact:

- Any local process that can reach loopback can inject `tokens:N` lines and force false thresholds, nuisance locks, or spoofed activity.
- This is an integrity issue rather than a remote compromise, but the POSIX path has stronger protection with a `0600` Unix socket while Windows currently does not.

Recommendation:

- Add an authentication secret to the ingest protocol on Windows.
- Better options are a random per-session token, a named pipe with a restrictive ACL, or another OS-native IPC primitive with user scoping.

## Low Severity

### 4. `vibebreak config` prints the stored bearer token verbatim

Affected code:

- [bin/vibebreak.ts](/Users/flipace/Development/vibebreak-plugin/bin/vibebreak.ts:126)

Status:

- Fixed in the current working tree by redacting `deviceJwt` and the local ingest secret from `vibebreak config` output.

Remediation evidence:

- The `config` subcommand now prints `redactConfig(cfg)` rather than the raw config object in [bin/vibebreak.ts](/Users/flipace/Development/vibebreak-plugin/bin/vibebreak.ts:126).

Impact:

- This makes accidental credential disclosure more likely through screenshots, pasted debug output, screen recordings, or shared terminal sessions.

Recommendation:

- Redact secrets by default in the `config` command.
- If full output is occasionally needed, add an explicit `--show-secrets` flag.

## Notes And Residual Risks

- Gate enforcement is intentionally fail-open in several places. For example, `check-gate` errors return `0` rather than blocking tool execution in [bin/vibebreak.ts](/Users/flipace/Development/vibebreak-plugin/bin/vibebreak.ts:104). That is a product tradeoff for reliability, but it also means the lock is not tamper-resistant against the local user.
- The config directory and primary secret file are stored with restrictive permissions in [src/config.ts](/Users/flipace/Development/vibebreak-plugin/src/config.ts:104), which is a good baseline.
- I did not see uses of `child_process`, `eval`, dynamic code loading, or untrusted shell interpolation in the reviewed source and hooks.

## External Sources Used

- GitHub Advisory Database / OSV for `ws` GHSA-3h5v-q93c-6h6q: https://osv.dev/vulnerability/GHSA-3h5v-q93c-6h6q
- GitHub Advisory Database / OSV for `ws` GHSA-6fc8-4gx4-v693: https://osv.dev/vulnerability/GHSA-6fc8-4gx4-v693
- GitHub Advisory Database / OSV for `zod` GHSA-m95q-7qp3-xv42: https://osv.dev/vulnerability/GHSA-m95q-7qp3-xv42
