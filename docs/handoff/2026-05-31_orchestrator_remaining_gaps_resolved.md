# Orchestrator remaining gaps resolved

Addressed follow-up TODOs from `2026-05-31_orchestrator_remaining_gaps.md`.

## Completed

- Manual claim now runs full dispatch path:
  - `LinearClient.getIssue(idOrIdentifier)` supports UUID and human identifiers like `ENG-123`.
  - `daemon.claimNow()` fetches issue, preserves 409 active-claim behavior, and uses normal dispatch path.
  - claim route now starts workspace/subagent and stores `subagent_run_id`.

- Dashboard spec completion:
  - Orchestrator sidebar nav entry gated by capability.
  - WS refresh for `orchestrator.*` events plus 5s polling fallback.
  - Drawer tabs now load logs, SQLite events, workflow snapshot/body, and read-only event stream.

- Hook lifecycle:
  - `after_create` on fresh workspace.
  - `before_run` preserved with abort semantics.
  - `after_run` via subagent status observation/fallback release path with `AIHUB_EXIT_CODE`.
  - `before_remove` before terminal cleanup / kill cleanup.

- Rate-limit / webhook / HITL:
  - Linear client tracks remaining/reset, waits on depleted bucket, retries one `429` after reset.
  - Webhook verifies HMAC, filters relevant Linear events, enqueues coalesced tick; payload remains wake-up signal only.
  - HITL burst buffer wired for needs-human/stalled/failed/startup-error notifications.

## Validation

- `pnpm exec vitest run packages/extensions/orchestrator/src/orchestrator.test.ts packages/extensions/orchestrator/src/cli/cli.test.ts` ✅
- `pnpm --filter @aihub/extension-orchestrator build` ✅
- `pnpm build:web` ✅
- `pnpm --filter @aihub/gateway build` ✅
- `pnpm test:shared` ✅
- `pnpm test:gateway` ✅
- `pnpm test:web` ✅
- `pnpm test:cli` ✅

## Remaining intentional non-goal

- Slice 15 cleanup/deletion still not attempted. It remains HITL and requires explicit approval before deleting projects/board.
