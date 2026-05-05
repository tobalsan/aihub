# Project integration branch helper

Added `ensureProjectIntegrationBranch(repo, projectId)` in `packages/extensions/projects/src/projects/branches.ts`.

- Branch name is exactly `<projectId>/integration`.
- First call creates the local branch from `refs/heads/main`.
- Later calls are no-ops and do not move the branch when `main` advances.
- No remote fetch/push/tracking behavior.

Validation:

- `pnpm exec vitest run packages/extensions/projects/src/projects/branches.test.ts`
- `pnpm exec vitest run packages/extensions/projects/src`
- `pnpm typecheck`
- `pnpm lint`
