# AIHUB_CLI Subagent Env

Scope: route orchestrator worker `aihub` CLI calls back to the spawning gateway.

Changes:
- Added root `aihub:dev` script using `tsx apps/gateway/src/cli/index.ts`.
- Subagent runtime now injects `AIHUB_CLI` into spawned processes.
- Orchestrator worker prompts now instruct workers to use `$AIHUB_CLI projects move ... review`.
- Added runtime env coverage and dispatcher prompt coverage.

Verification:
- `pnpm exec vitest run packages/extensions/subagents/src/runtime.test.ts`
- `pnpm exec vitest run packages/extensions/projects/src/orchestrator/index.test.ts`
