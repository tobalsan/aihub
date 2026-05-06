# Optional Orchestrator HITL Notifications

## Summary

Made `extensions.projects.orchestrator.hitl_channel` optional. If omitted, the orchestrator still starts and HITL notification events are disabled. If provided, the channel must still exist under `notifications.channels`.

## Changes

- `packages/extensions/projects/src/orchestrator/index.ts`
  - `resolveHitlNotifyChannel()` now returns `undefined` for missing channel instead of throwing.
  - HITL burst buffer is only created when a channel is configured.
  - Daemon shutdown handles the absent HITL buffer.
- `packages/extensions/projects/src/orchestrator/index.test.ts`
  - Updated tests for optional missing channel and strict validation when explicitly configured.
- `docs/llms.md`
  - Documented optional HITL channel behavior.

## Validation

- `pnpm exec vitest run packages/extensions/projects/src/orchestrator/index.test.ts`
- `pnpm test:gateway`
