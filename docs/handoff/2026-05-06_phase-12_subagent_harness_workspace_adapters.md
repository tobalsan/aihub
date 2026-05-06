# Phase 12: Subagent Harness and Workspace Adapters

## Summary

Split `spawnSubagent()` harness and workspace responsibilities into adapters.

- `packages/extensions/projects/src/subagents/harness-adapter.ts`
  - Defines `SubagentHarnessAdapter`.
  - Implements Codex, Claude, and Pi args/resolution/session-id extraction.
- `packages/extensions/projects/src/subagents/workspace-adapter.ts`
  - Defines `SubagentWorkspaceAdapter`.
  - Implements `none`, `main-run`, `worktree`, and `clone` setup/cleanup.
  - Owns repo validation, repo resolution, Space lease release, delivery recording, and kill cleanup.
- `packages/extensions/projects/src/subagents/runner.ts`
  - Now orchestrates project summary, run state/config persistence, process lifecycle, logs/history, and adapter calls.
  - Preserves resume delta-only behavior and stdout/stderr logging behavior.
  - Releases `main-run` Space leases on prompt-size rejection.

## Tests

- Added `harness-adapter.test.ts` for args and session-id extraction.
- Added `workspace-adapter.test.ts` for `none` mode and repo validation.
- Focused run passed:
  - `pnpm --filter @aihub/extension-projects exec tsc --noEmit`
  - `pnpm exec vitest run packages/extensions/projects/src/subagents/harness-adapter.test.ts packages/extensions/projects/src/subagents/workspace-adapter.test.ts packages/extensions/projects/src/subagents/runner.test.ts`
