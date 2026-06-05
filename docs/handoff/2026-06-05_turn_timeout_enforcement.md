# ALG-164: Enforce agent.turn_timeout_ms in orchestrator worker runners

## What changed

`agent.turn_timeout_ms` is now enforced as a real per-turn deadline in all three protocol runners:
- `packages/extensions/orchestrator/src/worker-runner/pi-rpc.ts`
- `packages/extensions/orchestrator/src/worker-runner/claude-rpc.ts`
- `packages/extensions/orchestrator/src/worker-runner/codex-app-server.ts`

Default is `3_600_000` ms (1 hour) when unset, matching Symphony.

## Design

Each session type gained `turnTimeoutMs: number` and `turnTimer?: NodeJS.Timeout`.

**Timer lifecycle:**
- **Start**: `startTurnTimer()` is called after a turn is acknowledged:
  - Pi/Claude: called in `prompt()` after the request returns and `session.active = true`
  - Codex: called in `startTurn()` after the `turn/start` RPC returns
- **Clear**: `clearTurnTimer()` is called at every turn-end point:
  - Pi: `agent_end`, `extension_error`, `handleMessageUpdate` error branch, process exit, `abort()`, `removeSession()`
  - Claude: `agent_end`/`result`, `extension_error`/`error`, process exit, `abort()`, `removeSession()`
  - Codex: `turn/completed` notification, process exit, `abort()`, `removeSession()`

**On timeout:**
1. Set `session.status = { status: "interrupted", raw: { reason: "turn_timeout", turnTimeoutMs } }` immediately
2. Emit `worker.<runner>.turn.timeout` event
3. Send abort/interrupt RPC (`abort` for Pi/Claude, `turn/interrupt` for Codex)
4. Fall back to `SIGTERM` if the RPC doesn't respond within `abortTimeoutMs`/`interruptTimeoutMs`

**Status guard:** Event handlers that set status now check `if (session.status.status === "running")` before overwriting. This prevents abort/interrupt response events from clobbering the `turn_timeout` reason that was set by the timer.

## Tests added

Three new tests in `packages/extensions/orchestrator/src/orchestrator.test.ts`:
- `Codex app-server worker runner > aborts a turn that exceeds turn_timeout_ms`
- `Pi RPC worker runner > aborts a turn that exceeds turn_timeout_ms`
- `Claude RPC worker runner > aborts a turn that exceeds turn_timeout_ms`

Each test uses a "stall" mock mode (the mock process starts the turn but never sends the terminal event) with `turn_timeout_ms: 50` and verifies:
- Status becomes `{ status: "interrupted", raw: { reason: "turn_timeout" } }`
- The `worker.<runner>.turn.timeout` event is emitted

## Docs updated

- `packages/extensions/orchestrator/README.md`: removed "not yet enforced" caveat, updated description
- `docs/llms.md`: updated the ALG-155 protocol runner section to reflect enforcement
