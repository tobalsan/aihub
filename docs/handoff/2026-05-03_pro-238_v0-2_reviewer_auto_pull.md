# PRO-238 v0.2 Reviewer Auto-Pull

Implemented reviewer dispatch for configured `review` status bindings and added `ready_to_merge` as the daemon terminal handoff status.

- Shared schema now accepts `ready_to_merge` project status and optional `orchestrator.statuses.review`.
- Orchestrator dispatcher now iterates configured status bindings, keeps `todo` worker lock-to-`in_progress`, and spawns reviewers for `review` without a status lock.
- Reviewer prompts include the most recent orchestrator Worker workspace when available and direct pass/fail moves to `ready_to_merge` or `todo`.
- Project/subagent list items expose `startedAt` so reviewer workspace selection can sort by newest Worker run.
- Web board/status surfaces render `ready_to_merge` between `review` and `done`.

Validation so far:

- `pnpm exec vitest run packages/extensions/projects/src/orchestrator/index.test.ts packages/extensions/board/src/projects.test.ts`
- `pnpm typecheck`
- `pnpm test` passed 1115/1118; remaining 3 failures are the expected `multi-user/*` Better SQLite native binding ABI failures.
- `pnpm build`
