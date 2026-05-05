# Gateway launchd service commands

Added `aihub gateway install|start|stop|uninstall` for macOS.

## Changes

- **NEW** `apps/gateway/src/cli/service.ts` — launchd lifecycle (`bootstrap`, `bootout`, `kickstart -k`), plist generation, idempotent install, darwin guard.
- **MOD** `apps/gateway/src/cli/index.ts` — capture `gateway` Commander instance, attach subcommands via `registerGatewayServiceCommands(gatewayCmd)`. Parent `.action()` still fires when no subcommand → foreground run unchanged.
- **DOC** `docs/llms.md` — new section "Gateway as a Service (macOS)".

## Service shape

- Plist: `~/Library/LaunchAgents/com.aihub.gateway.plist`, label `com.aihub.gateway`, domain `gui/<uid>`.
- Args: `[process.execPath, <dist/cli/index.js>, "gateway"]`.
- Env: `AIHUB_HOME=CONFIG_DIR`, `HOME`, `PATH`.
- Working dir: `CONFIG_DIR`.
- Logs: `$AIHUB_HOME/logs/gateway.{out,err}.log`.
- `RunAtLoad=true`, `KeepAlive={SuccessfulExit:false}` (restart on crash, not on clean exit).

## Verified

- `pnpm --filter @aihub/gateway exec tsc -p tsconfig.json` clean.
- `aihub gateway --help` lists install/start/stop/uninstall plus default options.
- `aihub gateway install --help` etc. show usage.
- Not run end-to-end yet (would actually register on user machine) — user to invoke when ready.

## Out of scope / follow-ups

- Linux systemd user unit.
- Windows service.
- `aihub gateway status` / `logs` subcommands.
- Web UI as separate service (currently spawned as gateway child — covered by gateway install).
