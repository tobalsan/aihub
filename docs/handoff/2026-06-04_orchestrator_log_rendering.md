# Orchestrator log rendering fix

## Context

PR #26 moved orchestrator workers off `/api/subagents` and onto orchestrator-owned protocol runners. Local dashboard logs then appeared empty for Codex app-server, Pi RPC, and Claude RPC runs.

## Cause

Protocol runners were persisting events as `worker.<kind>.*`, but the dashboard transcript renderer still expected old normalized subagent event shapes (`assistant`, `tool_call`, `stdout`, etc.). The logs API returned raw worker event types and JSON text wrappers, so most rows mapped to `null` in `eventToTranscriptItem()`.

## Fix

- `packages/extensions/orchestrator/src/index.ts`
  - Normalize log API event types (`worker.*.message` -> `assistant`, tool/thinking/error families).
  - Preserve `rawType` for debugging.
  - Extract useful text from Codex item payloads, Pi assistant message events, Claude message blocks, and common stderr/error fields.
  - Strip ANSI escape/color artifacts from API log text.
- `packages/extensions/orchestrator/src/worker-runner/codex-app-server.ts`
  - Start Codex threads with `cwd`, `approvalPolicy: never`, and `sandbox: dangerFullAccess` by default.
  - Send matching per-turn `sandboxPolicy: { type: "dangerFullAccess" }` unless `WORKFLOW.md` overrides `agent.settings`.
  - This matches app-server docs: a `thread/start` with `cwd` plus workspace/full sandbox marks the project trusted, so project-local `.codex` config/hooks/policies can load.
- `apps/web/src/extensions/orchestrator/routes.tsx`
  - Render normalized `thinking` rows.
  - Keep fallback parser compatible with nested `{ payload: { item } }` command events.
- `packages/extensions/orchestrator/src/orchestrator.test.ts`
  - Cover Claude, Codex, and Pi persisted log normalization.

## Validation

- `pnpm exec vitest run packages/extensions/orchestrator/src/orchestrator.test.ts apps/web/src/extensions/orchestrator/routes.test.ts`
  - 57 orchestrator tests passed.
- `pnpm exec vitest run packages/extensions/orchestrator/src/orchestrator.test.ts`
  - 57 orchestrator tests passed after ANSI/Codex sandbox follow-up.
- `pnpm --filter @aihub/extension-orchestrator build`
- `git diff --check`
