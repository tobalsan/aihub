# Orchestrator Worker Integration Branch

PRO-242-S02 changes orchestrator Worker dispatch so Worker `clone`/`worktree`
runs fork from the project integration branch instead of falling through to
`main`.

Changes:

- `packages/extensions/projects/src/orchestrator/dispatcher.ts` now calls
  `ensureProjectIntegrationBranch(repo, projectId)` while building Worker spawn
  input and passes the returned `<projectId>/integration` as `baseBranch`.
- Reviewer dispatch is unchanged and continues to omit `baseBranch`.
- Integration branch setup failures are treated as spawn failures for the
  dispatch decision and cooldown path.
- `packages/extensions/projects/src/orchestrator/index.test.ts` mocks the
  branch helper and covers Worker `baseBranch` plus unchanged Reviewer
  behavior.

Validation:

- `pnpm exec vitest run packages/extensions/projects/src/orchestrator/index.test.ts`
