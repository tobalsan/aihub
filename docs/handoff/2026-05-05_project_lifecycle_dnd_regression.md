# 2026-05-05 Project lifecycle DnD regression

PRO-245-S01 fixes:

- `ProjectListGrouped` now renders project cards with `draggable={true}`. Solid's shorthand rendered `draggable=""`, which Chromium exposes as `element.draggable === false`, so live drag never started.
- Lifecycle groups accept drops on the whole bucket, including headers, not just the inner list strip.
- Dragged cards expose a visible grabbed state.
- Board project scans include terminal projects under `.done` correctly:
  - `includeDone=false` still hides `done`.
  - `.done` projects with `cancelled` remain visible in Cancelled.
  - lifecycle counts include `.done`.

Validation:

- `pnpm test:web`
- `pnpm exec vitest run packages/extensions/board/src/projects.test.ts`
- `pnpm build`

Browser notes:

- Worktree preview used `AIHUB_HOME=$(pwd)/.aihub pnpm dev` at `http://127.0.0.1:3001`.
- Playwright CLI confirmed the original DOM bug: before the fix, project card `draggable` attr was `""` and property was `false`; after the fix, both attr/property are `true`.
- Playwright CLI drag attempts produced screenshots under `validation/screenshots/`; while testing, DnD exposed the `.done` scanner edge fixed above.
