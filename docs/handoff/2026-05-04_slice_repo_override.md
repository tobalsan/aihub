# Slice Repo Override

Implemented PRO-240-S10.

- Slice README frontmatter supports optional `repo`.
- `updateSlice()` trims, clears empty repo, and validates absolute git repo paths.
- Subagent runner resolves repo as slice `repo` first, then project `repo`.
- Worktree/clone cleanup uses persisted `slice_id` to resolve the same repo.

Validation:

- `pnpm exec vitest run packages/extensions/projects/src/projects/slices.test.ts packages/extensions/projects/src/subagents/runner.test.ts`
- `pnpm --filter @aihub/extension-projects test`
- `pnpm --filter @aihub/shared build`
- `pnpm --filter @aihub/extension-projects build`
