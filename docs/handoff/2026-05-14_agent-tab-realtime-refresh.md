# Agent Tab Realtime Refresh

## Summary

Fixed a regression in `AgentRunChatPanel` where runtime subagent websocket updates were ignored. The panel passed a bare function to `subscribeToSubagentChanges`, but the subscription API expects an object with `onSubagentChanged`.

## Changes

- Updated `apps/web/src/components/AgentRunChatPanel.tsx` to subscribe with `{ onSubagentChanged, onError }`.
- Added a regression test proving a `subagent_changed` event reloads run status/logs and enables the Stop control for a running run.
- Updated `/api/subagents/:runId/resume` so project-backed synthetic ids (`PRO-123:<slug>`) delegate to the project subagent resume path instead of runtime-only storage.
- Updated `docs/llms.md` to document the live refresh dependency.

## Verification

- `pnpm exec vitest run apps/web/src/components/AgentRunChatPanel.test.tsx`
- `pnpm exec vitest run packages/extensions/subagents/src/index.test.ts`
