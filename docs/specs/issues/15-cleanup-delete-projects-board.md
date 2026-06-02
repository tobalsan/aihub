---
title: "Orchestrator slice 15: Phase 5 cleanup — extract seams, delete projects + board"
status: needs-triage
type: HITL
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

The final cleanup pass. Marked HITL because the diff is large (estimated tens of thousands of LOC removed) and the human operator must review and approve the delete list before merging.

Sequence:

1. **Extract** any remaining reusable seams from the old extension into stable homes:
   - `packages/extensions/projects/src/subagents/harness-adapter.ts` → a stable location consumable by the orchestrator package without depending on `projects` (typically `packages/extensions/subagents/src/harness-adapter.ts`).
   - Worktree-mode helpers (`createWorktree`, `getGitHead`, cleanup) from `packages/extensions/projects/src/subagents/workspace-adapter.ts` → orchestrator `workspace/layout.ts` (idempotent reuse — slice 03 may have already adopted these).
   - `packages/extensions/projects/src/orchestrator/hitl.ts` → orchestrator package (slice 12 may have already adopted this).
2. **Delete entirely**:
   - `packages/extensions/projects/` whole package.
   - `packages/extensions/board/` whole package.
   - Web: `apps/web/src/extensions/projects/`, `apps/web/src/components/Projects*.tsx`, `Slice*.tsx`, `ProjectDetailPage.tsx`, `SliceDetailPage.tsx`, `SliceKanbanWidget.tsx`, `BoardView.tsx`, `TaskboardOverlay.tsx`, `AreasOverview.tsx`/`AreaCard.tsx`/`AreaEditForm.tsx`/`AreaSummaries.tsx`, plus their tests.
   - Web API: `apps/web/src/api/projects.ts`, `slices.ts`, `space.ts`, `board.ts`.
   - Shared schema: `ProjectsExtensionConfigSchema`, `ProjectsOrchestratorConfigSchema`, `ProjectsConfigSchema`. Drop `projects` from `GatewayConfigSchema`. Drop `getProjectsRoot`, `getProjectsWorktreeRoot` from `packages/shared/src/paths.ts`.
   - Gateway registry: remove `projects` + `board` entries from `apps/gateway/src/extensions/registry.ts`.
   - CLI: drop `aihub projects` / `aihub slices` / `aihub board` from the gateway CLI.
3. **Stale-config tolerance**: when an old `extensions.projects` block is present in `aihub.json`, the gateway logs a one-line warning ("ignored — extension removed") and continues. Do not crash.
4. **Documentation**: update `docs/llms.md` (replace projects section with orchestrator section) and `README.md` (human-facing).

The operator will delete `~/.aihub/projects/` and any local `PRO-*` directories themselves; no migration script ships from this slice.

## Acceptance criteria

- [ ] All seams listed above are extracted and the new orchestrator package depends only on the extracted homes (no remaining imports from `@aihub/extension-projects` or `@aihub/extension-board`).
- [ ] All deletion targets listed above are removed from the repo.
- [ ] `pnpm build` is green.
- [ ] `pnpm test:web && pnpm test:gateway && pnpm test:shared && pnpm test:cli` are all green.
- [ ] Gateway boots with an old `extensions.projects` block in `aihub.json` and emits a single warning, then continues to serve.
- [ ] `git diff --stat main` shows substantial deletions (tens of thousands of lines) with no new files in the deleted areas.
- [ ] `docs/llms.md` no longer mentions projects/slices as live concepts; orchestrator section is current.
- [ ] `README.md` reflects the orchestrator runtime.

## Blocked by

- Slices 01–14 (all replacement functionality must ship before deletion).
