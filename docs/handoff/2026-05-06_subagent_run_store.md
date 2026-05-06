# Subagent Run Store Seam

- Added `packages/extensions/projects/src/subagents/run-store.ts` with a replaceable `SubagentRunStore` interface, filesystem adapter, and in-memory adapter.
- Centralized project subagent run location, listing, detail reads, status derivation, state updates, history appends, archive toggles, delete cleanup, and legacy migration entrypoint.
- Rewired `packages/extensions/projects/src/subagents/index.ts` list/global-list/config/archive/log lookup paths to use the store.
- Rewired `packages/extensions/projects/src/subagents/runner.ts` to use the store for run dir location, atomic state updates, history appends, and session-dir deletion.
- Added `packages/extensions/projects/src/subagents/run-store.test.ts` for the in-memory adapter.
- Verification: focused subagent store/index/runner/API tests, `pnpm test:shared`, and `pnpm exec tsc -b packages/extensions/projects` pass. `pnpm test:gateway` is blocked in this sandbox by local socket binding failures (`listen EPERM` in websocket/OpenClaw tests).
