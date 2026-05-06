# Phase 9: Session Run Lifecycle

## Summary

Extracted gateway session run state management from `apps/gateway/src/agents/runner.ts` into `apps/gateway/src/agents/run-lifecycle.ts`.

## Changed

- Added `SessionRunLifecycle` as the seam for:
  - streaming begin/finish state
  - adapter handle storage and queued-message injection
  - queue vs interrupt handling while a run is active
  - active-run aborts, including stuck streaming cleanup
  - history event buffering, turn completion, pending user-only turns, and flush ordering
- Kept `runAgent()` responsible for:
  - agent lookup and adapter selection
  - `/abort` session lookup
  - session key resolution
  - `/think` directives and thinking-level fallback retries
  - SDK invocation
  - recursive drain of non-native queued messages
- Added focused lifecycle tests in `apps/gateway/src/agents/run-lifecycle.test.ts`.
- Updated `docs/llms.md` with the new lifecycle seam.

## Verification

- `pnpm exec vitest run apps/gateway/src/agents/run-lifecycle.test.ts`
- `pnpm exec tsc -p apps/gateway/tsconfig.json --noEmit`
- Attempted `pnpm test:gateway` and `pnpm exec vitest run --dir apps/gateway/src --fileParallelism=false`; both were blocked by sandbox listener permissions (`listen EPERM` on `127.0.0.1` / `0.0.0.0`) in WebSocket/OpenClaw tests plus Docker socket permission errors. Non-listener gateway tests, including the new lifecycle tests, passed before the run failed.
