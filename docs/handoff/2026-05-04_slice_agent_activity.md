# Slice Agent Activity

Implemented PRO-240-S09.

- Slice kanban cards now show a green `agent active` pill for running runs keyed to `sliceId`, refreshing on project agent and subagent websocket events with a 250ms debounce.
- Slice detail now has an Agent tab with slice-scoped runs, status, start/duration, branch, logs link, copyable `projectId:slug` id, and kill/interrupt for running runs.
- `/api/subagents` now includes project-backed orchestrator runs in default/status-filtered lists; runtime-specific filters (`cwd`, `parent`, archived) stay runtime-only.
- `/api/board/agents` now includes project-backed running orchestrator runs and can interrupt them via the existing board kill endpoint.
- Added focused coverage for slice card pills, Agent tab rows/refresh, project-backed `/subagents` list visibility, and board project-backed list/kill.

Validation run:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:web`
- `pnpm test:gateway`
- `pnpm test:shared`
- `pnpm test:cli`
- `pnpm exec vitest run packages/extensions/subagents/src/index.test.ts packages/extensions/board/src/agents.test.ts packages/extensions/projects/src/subagents/subagents.api.test.ts`
