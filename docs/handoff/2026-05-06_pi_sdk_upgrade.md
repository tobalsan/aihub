# Pi SDK Upgrade

## Summary

Upgraded AIHub's in-process lead agent runtime and container agent runner from Pi SDK `^0.67` to `^0.73.0`.

## Changes

- Updated Pi dependencies in:
  - `apps/gateway/package.json`
  - `container/agent-runner/package.json`
  - `pnpm-lock.yaml`
- Adapted to Pi SDK 0.73's `createAgentSession()` API change: `tools` is now a string allowlist rather than `Tool[]`.
  - Gateway Pi adapter now passes `tools: ["read", "bash", "edit", "write"]`.
  - Container runner now passes the same built-in tool allowlist.
- Updated related unit-test mocks/assertions.
- Updated `docs/llms.md` with the Pi SDK/tooling note.

## Validation

- `pnpm --filter @aihub/gateway build`
- `pnpm --filter @aihub/agent-runner build`
