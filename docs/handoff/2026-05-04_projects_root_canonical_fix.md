# Projects root canonical fix

Date: 2026-05-04

## Context

Validation found `aihub slices add` wrote slice files under real `~/projects` when local config had only `extensions.projects.root`. User clarified this is a bug: top-level `projects.root` is deprecated; `extensions.projects.root` is canonical.

## Inspection findings

- `packages/extensions/projects/src/util/paths.ts` was the shared resolver for project/slice/migration/orchestrator paths, but it preferred deprecated `projects.root` before `extensions.projects.root`.
- `packages/extensions/board/src/index.ts` had its own root lookup and read deprecated `projects.root` directly for project list and area routes.
- `packages/shared/src/config-migrate.ts` already migrates legacy root into `extensions.projects.root`, so extension-only config must work.

## Code changes

- `packages/extensions/projects/src/util/paths.ts`
  - Root precedence is now `extensions.projects.root` → deprecated `projects.root` → `~/projects`.
- `packages/extensions/projects/src/cli/slices.test.ts`
  - Added regression test proving slice CLI writes to canonical root when both canonical and legacy roots exist.
- `packages/extensions/board/src/index.ts`
  - Board project, activity, and area routes now use extension-first root resolution.
  - Worktree root prefers `extensions.projects.worktreeDir`; deprecated `projects.worktrees` remains fallback.
- `packages/extensions/board/src/index.test.ts`
  - Added route tests for `/api/board/projects` and `/api/board/areas` with canonical + legacy roots.
- `packages/extensions/projects/src/cli/slices.ts` and `migrate.ts`
  - Fixed fallback config objects to satisfy `GatewayConfig` typing without casts to invalid session shape.
- `docs/llms.md` and validation doc updated to state `extensions.projects.root` is canonical.

## Validation

- `pnpm exec vitest run packages/extensions/projects/src/cli/slices.test.ts` ✅
- `pnpm exec vitest run packages/extensions/board/src/index.test.ts --exclude '.aihub/**'` ✅
  - Plain exact path picked up copied tests under validation workspaces in `.aihub/`; exclude was needed because those copied workspaces lack deps.
- `pnpm test:gateway` ✅
- `pnpm test:shared` ✅
- `pnpm typecheck` ✅

## Notes

- Static report server from prior validation may still be running on `127.0.0.1:8765`.
- Earlier contaminated real project path remains untouched: `~/projects/PRO-5_select_week_cycle_projects/`.
