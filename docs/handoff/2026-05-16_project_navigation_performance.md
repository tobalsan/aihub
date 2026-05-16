# Project navigation performance fixes

## Changed

- `/api/subagents` now passes `projectId`, `sliceId`, `status`, `cwd`, and `includeArchived` into project subagent listing.
- Project-backed subagent listing uses a project-scoped fast path when `projectId` is present instead of scanning every project.
- Runtime subagents extension passes same filters when merging project-backed synthetic runs.
- `/projects` now renders `BoardLifecycleListPage`, so list open/back uses cached `/api/board/projects` instead of uncached `/api/projects` + global subagent load.
- Board lifecycle metadata scan now has TTL/in-flight cache tied to board project cache invalidation/reset.

## Validation

- `pnpm exec vitest run packages/extensions/projects/src/subagents/subagents.api.test.ts packages/extensions/board/src/projects.test.ts`
- `pnpm exec tsc -b packages/extensions/projects/tsconfig.json packages/extensions/subagents/tsconfig.json packages/extensions/board/tsconfig.json apps/web/tsconfig.json --pretty false`

## Not done

- AgentRunChatPanel lazy transcript/log loading was investigated but not shipped in this pass. It needs careful selection semantics for legacy lead sessions and run visibility.
