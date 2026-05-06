# Phase 14: Space Git Integration Module

Date: 2026-05-06

## Completed

- Split `packages/extensions/projects/src/projects/space.ts` into internal seams:
  - `space-state.ts`: Space data model, `space.json` normalization/persistence, project context, write leases.
  - `space-git.ts`: git command/worktree helpers and `SpaceGitAdapter`.
  - `space-policy.ts`: `SpaceIntegrationPolicy`, queue transitions, delivery recording, integration, rebase, merge, cleanup.
- Kept `space.ts` as the public facade with existing exports intact.
- Added focused seam tests:
  - `space-state.test.ts`
  - `space-git.test.ts`
  - `space-policy.test.ts`
- Updated `docs/llms.md` Space section with the new module boundaries.

## Verification

- `pnpm exec vitest run packages/extensions/projects/src/projects/space-state.test.ts packages/extensions/projects/src/projects/space-git.test.ts packages/extensions/projects/src/projects/space-policy.test.ts packages/extensions/projects/src/projects/space.test.ts`
- `pnpm exec vitest run apps/gateway/src/server/space-merge.api.test.ts packages/extensions/projects/src/projects/space-state.test.ts packages/extensions/projects/src/projects/space-git.test.ts packages/extensions/projects/src/projects/space-policy.test.ts packages/extensions/projects/src/projects/space.test.ts packages/extensions/projects/src/projects/space-cache.test.ts packages/extensions/projects/src/projects/git.test.ts packages/extensions/projects/src/subagents/workspace-adapter.test.ts`
- `pnpm test:shared`
- `pnpm typecheck`
- `pnpm exec eslint packages/extensions/projects/src/projects/space.ts packages/extensions/projects/src/projects/space-state.ts packages/extensions/projects/src/projects/space-git.ts packages/extensions/projects/src/projects/space-policy.ts packages/extensions/projects/src/projects/space-state.test.ts packages/extensions/projects/src/projects/space-git.test.ts packages/extensions/projects/src/projects/space-policy.test.ts`

## Blocked Verification

- `pnpm test:gateway` failed in this sandbox on tests that bind local listeners (`listen EPERM` on `127.0.0.1`/`0.0.0.0`) plus Docker socket permission hooks. The Space merge API tests passed during that run and again in the targeted run above.
