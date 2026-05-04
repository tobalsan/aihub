# 2026-05-04 Project Lifecycle DnD Hotfix

Slice: PRO-240-S17.

Implemented the post-merge drag/drop hotfix for `ProjectListGrouped`.

- `dragstart` now writes `text/plain` project id data and sets `effectAllowed = "move"`, which Safari requires to start native HTML5 dragging.
- Drop zones now prevent default on `dragenter`; `dragover` also sets `dropEffect = "move"`.
- Removed the always-visible per-card lifecycle `<select>`.
- Added a compact per-card `…` status menu as the keyboard-accessible fallback.
- Fixed one existing lint failure in `packages/extensions/projects/scripts/strip-deprecated-project-fields.mjs` by removing an unused import.

Validation run:

- `pnpm exec vitest run apps/web/src/components/board/ProjectListGrouped.test.tsx`
- `pnpm test:web`
- `pnpm --filter @aihub/shared build`
- `pnpm build:web`
- `pnpm typecheck`
- `pnpm lint`
