# Board Worktree Hybrid Association

Implemented PRO-234 bug #3 / Phase 6 for Board project worktree attribution.

- `packages/extensions/board/src/projects.ts` now resolves each discovered git worktree to one active project id before indexing.
- Attribution order is explicit README frontmatter `worktrees`, branch prefix convention, active `PRO-*` branch token, then active `PRO-*` path token.
- Path and branch token extraction only accepts existing active project ids. If the first `PRO-*` token in a path/branch is inactive or nonexistent, it is ignored instead of falling through to later text.
- Added coverage for path-token attribution, branch-token attribution, explicit frontmatter winning over path attribution, and inactive/nonexistent tokens.

Verification:

- `pnpm exec vitest run packages/extensions/board/src/projects.test.ts`
- `pnpm --filter @aihub/extension-board build`
- `pnpm test`
