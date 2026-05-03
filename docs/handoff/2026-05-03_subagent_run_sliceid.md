# Subagent run slice/project attribution (issue 07)

## Status
Completed.

## Reviewer fix follow-up (2026-05-03)
- Orchestrator dispatcher now passes `sliceId` into worker/reviewer `spawnSubagent()` input via `projectSliceId(project)`.
- Project subagent start route (`POST /projects/:id/subagents`) now parses optional `sliceId` and forwards to `spawnSubagent()`.
- Shared `SubagentGlobalListItem` now carries optional `sliceId` and optional `projectId`.
- Global subagent list now reads/emits `sliceId` (and `projectId` fallback) from `config.json`/`state.json`.
- Added tests for orchestrator spawn slice attribution, project/global list legacy-missing behavior, and attributed slice propagation.

## Changed files
- `packages/shared/src/types.ts`
  - `SubagentRun` includes optional `projectId?: string` and `sliceId?: string`.
- `packages/extensions/subagents/src/runtime.ts`
  - start input + persisted run config handle optional `projectId`/`sliceId`.
  - legacy read path tolerant when fields missing.
- `packages/extensions/subagents/src/index.ts`
  - start route accepts optional `projectId`/`sliceId` and forwards.
- `packages/extensions/subagents/src/runtime.test.ts`
  - covers legacy-missing read, attributed read, new write persistence.
- `packages/extensions/projects/src/subagents/runner.ts`
  - spawn input supports optional `sliceId`.
  - state/config persistence writes `projectId`/`sliceId` (`project_id`/`slice_id` in state).
- `packages/extensions/projects/src/subagents/index.ts`
  - list reader exposes optional `projectId`/`sliceId` with state fallback.
- `packages/extensions/projects/src/orchestrator/index.ts`
  - attempt tracker semantics aligned to slice-key behavior.
- `packages/extensions/projects/src/orchestrator/index.test.ts`
  - covers `isActiveOrchestratorRun` sliceId + cwd fallback and cooldown isolation by slice.
- `packages/extensions/projects/src/orchestrator/dispatcher.ts`
  - fixed `cooldownKey` runtime bug (`ReferenceError`) by computing key in spawn loop.
  - cooldown key now consistent: `sliceId` first, fallback `project.id`.
  - active-run detection in dispatcher passes `sliceId` + cwd fallback for legacy runs.

## Checks run
- `pnpm vitest run packages/extensions/projects/src/orchestrator/index.test.ts packages/extensions/projects/src/subagents/subagents.api.test.ts` ✅
- `pnpm test:shared` ✅
- `pnpm test:gateway` ✅

## Notes
- One atomic commit created for issue 07 scope.
