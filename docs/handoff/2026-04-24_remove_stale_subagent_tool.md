# 2026-04-24 — Remove stale subagent internal tool wiring

## What changed
- Removed stale Pi subagent tool module and tests:
  - `packages/extensions/projects/src/subagents/pi_tools.ts`
  - `packages/extensions/projects/src/subagents/pi_tools.test.ts`
- Removed stale subagent internal tool handlers module:
  - `packages/extensions/projects/src/subagents/tool_handlers.ts`
- Removed Pi adapter subagent tool injection and appended `subagent.*` system prompt block.
- Removed gateway internal-tools routing for:
  - `subagent.spawn`
  - `subagent.status`
  - `subagent.logs`
  - `subagent.interrupt`
- Removed container agent-runner orchestration prompt/tool registrations for stale `subagent.*` tools; kept `project.*` tools.
- Updated package/vitest exports/aliases that referenced deleted modules.
- Updated docs that still documented stale `subagent.*` internal tools to reflect CLI-driven orchestration (`apm start`).

## Explicit non-changes
- Kept `spawnSubagent()` in `packages/extensions/projects/src/subagents/runner.ts`.
- Kept `/projects/:id/start` handling and subagent REST endpoints under `/projects/:id/subagents/:slug/*`.
- Kept `spawnRalphLoop`.
- Kept `apps/gateway/src/cli/subagent.ts` because it is still used by `apps/gateway/src/cli/index.ts` (not orphaned).

## Validation
- `pnpm install --lockfile-only`
- `pnpm exec tsc --noEmit`
- Result: pass (no type errors).
