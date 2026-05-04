# Lifecycle Done Lazy Load

Implemented PRO-240-S18.

- `/api/board/projects` now returns lifecycle counts with the project list.
- Board lifecycle cold-load calls `/board/projects` without `include=done`.
- Done cards are cached after first expansion; Hide/Show does not refetch until a realtime refresh happens while Done is expanded.
- Cancelled projects remain in the default cold-load and the Cancelled bucket is expanded by default.
- `scanProjects(..., includeDone=false)` skips full Done project enrichment while the lifecycle metadata scan provides counts.

Validation:

- `pnpm exec vitest run apps/web/src/components/board/BoardLifecycleListPage.test.tsx apps/web/src/components/board/ProjectListGrouped.test.tsx packages/extensions/board/src/projects.test.ts packages/extensions/board/src/index.test.ts`
- `pnpm test:web`
- `pnpm test:gateway`
- `pnpm typecheck`

Cold-load TTI note: no browser TTI run was captured in this headless pass; the server-side cold path now avoids Done enrichment and the web suite verifies no initial `include=done` request.
