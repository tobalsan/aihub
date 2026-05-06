# Phase 8: Run Request Normalization

## Summary

Added `apps/gateway/src/server/run-request.ts` as the transport-neutral normalization seam for agent run requests. REST and WebSocket send handlers now delegate validation, session key defaulting/resolution, auth user context, attachment normalization, and empty reset-trigger intro responses before calling `runAgent()`.

## Changed

- `api.core.ts` uses `normalizeRunRequest()` for `POST /api/agents/:id/messages`.
- `index.ts` uses `normalizeRunRequest()` for WebSocket `send`.
- `run-request.test.ts` covers keyed session resolution, reset immediate response, abort non-resolution, and multi-user context.
- `docs/llms.md` documents the new server seam.

## Verification

- `pnpm exec tsc -p apps/gateway/tsconfig.json --noEmit`
- `pnpm exec vitest run apps/gateway/src/server/run-request.test.ts apps/gateway/src/server/api.core.test.ts`

`pnpm test:gateway` was attempted. It reached unrelated local listener tests, then failed because the sandbox cannot bind `127.0.0.1` / `0.0.0.0` (`listen EPERM`) for WebSocket/OpenClaw tests.
