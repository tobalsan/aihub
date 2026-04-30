# Board Projects Cache

Implemented:

- `/api/board/projects?profile=true` returns `X-Profile-Ms`.
- `scanProjects()` uses in-flight dedupe plus a 10s in-memory stale-while-revalidate cache keyed by `projectsRoot:worktreesRoot:includeDone`. Cache invalidation also clears matching `inFlightScans` entries.
- Board startup warms the active-project cache.
- Board subscribes to `file.changed` and invalidates project cache on `README.md` changes.
- Worktree branch discovery reads `.git/HEAD` directly, including linked-worktree `.git` files.
- Repo worktree discovery reads `<repo>/.git/worktrees/*` (or `<repo>/worktrees/*` for bare repos detected via `HEAD` + `objects/` at repo root) directly and caches repo worktree paths for 30s.
- Branch and dirty/ahead values are TTL-cached; `.git/index` watchers invalidate dirty/ahead cache entries and the endpoint cache (with mtime fallback).
- Active project IDs are computed before worktree scans; done project IDs and repos are skipped early.

Verified:

- `pnpm exec vitest run packages/extensions/board/src/projects.test.ts`
- `pnpm --filter @aihub/shared build`
- `pnpm --filter @aihub/extension-board build`
- `pnpm --filter @aihub/board test` (no matching package)
- `pnpm exec vitest run packages/extensions/board/src`
