# Phase 6: File Output and History Event Interfaces

## Summary

Clarified the file output boundary between container runner protocol, gateway stream events, and canonical history.

## Changes

- Added shared Zod schemas for `HistoryEvent`, `StreamEvent`, `ContainerRunnerProtocolEvent`, and raw `ContainerFileOutputRequest`.
- Removed `file_output` from canonical `HistoryEvent`; persisted downloadable files now use `assistant_file`.
- Kept media-backed WebSocket `FileOutputEvent` distinct from raw container file output requests.
- Updated the container adapter to validate runner protocol events and final container output at the process seam.
- Updated the agent runner to import shared `HistoryEvent` and emit validated raw file output requests from `send_file`.
- Normalized runner usage metadata into shared `ModelUsage` shape before emitting `meta` history events.
- Added validation tests in shared schemas and runner send-file coverage.

## Verification

- `pnpm test:shared`
- `pnpm exec vitest run apps/gateway/src/sdk/container/adapter.test.ts apps/gateway/src/history/store.test.ts`
- `pnpm --filter @aihub/shared build`
- `pnpm --filter @aihub/gateway build`
- `pnpm --filter @aihub/agent-runner build`
- `pnpm --filter @aihub/agent-runner test`

`pnpm test:gateway` was also run. Non-network gateway suites and the container adapter suite passed, but the full command failed in this sandbox because several WebSocket/OpenClaw tests attempted to bind local ports and hit `listen EPERM` on `127.0.0.1`/`0.0.0.0`.
