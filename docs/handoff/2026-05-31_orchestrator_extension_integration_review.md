# Orchestrator extension integration review

Follow-up after slices 01-14 parallel implementation.

## Fixes applied

- Added persisted `subagent_run_id` on orchestrator runs.
- `GET /api/orchestrator/runs/:id` now returns stored run + SQLite events.
- `GET /api/orchestrator/runs/:id/logs` proxies to the backing subagent logs endpoint when a subagent run exists.
- `POST /api/orchestrator/runs/:id/interrupt` proxies to subagents interrupt.
- `POST /api/orchestrator/runs/:id/kill` deletes the backing subagent run and releases the claim.
- Non-health orchestrator routes now return 503 when `LINEAR_API_KEY` is missing.
- Daemon records subagent run id after dispatch.
- Stall handling now interrupts the backing subagent before releasing.
- Linear `Needs Human` transitions now resolve state name to `stateId` before `issueUpdate`.
- Extension shutdown marks unfinished active runs as `process_alive=0` before closing SQLite.

## Validation

- `pnpm exec vitest run packages/extensions/orchestrator/src/orchestrator.test.ts packages/extensions/orchestrator/src/cli/cli.test.ts` ✅
- `pnpm --filter @aihub/extension-orchestrator build` ✅
- `pnpm --filter @aihub/gateway build` ✅
- `pnpm build:web` ✅
- `pnpm test:shared` ✅
- `pnpm test:gateway` ✅
- `pnpm test:web` ✅
- `pnpm test:cli` ✅

## Remaining gaps

- Daemon still starts subagents through local HTTP, not an internal runtime seam.
- Manual claim route still only reserves a claim; it does not run the full dispatch path by issue id.
- Web dashboard still polls and has placeholder drawer tabs; no sidebar entry or WS live updates yet.
- Hook phases beyond `before_run` are not daemon-wired.
- Rate-limit bucket / 429 sleep is still partial.
- Webhook HMAC verification and tick coalescing still not implemented.
- HITL burst buffer exists but notification path still uses direct notify.
- Slice 15 deletion intentionally not attempted.
