# 2026-05-05 Pitch SPECS Selector

Implemented PRO-245-S04 in `BoardProjectDetailPage`.

- Pitch now has a local README/SPECS selector.
- README remains editable through `DocEditor`.
- SPECS renders read-only markdown and shows `No SPECS yet.` when missing/empty.
- Project detail websocket refresh now includes project-level `SPECS.md` changes.
- `DocEditor` accepts optional header content so the Pitch selector can live in the existing editor header.

Validation:

- `pnpm exec vitest run apps/web/src/components/board/BoardProjectDetailPage.test.tsx`
- `pnpm test:web`
- `pnpm typecheck`
- `pnpm lint`
- Playwright against `AIHUB_HOME=$(pwd)/.aihub pnpm dev` at `http://127.0.0.1:3001/board`.

Playwright screenshots:

- `validation/readme-active.png`
- `validation/specs-active.png`
- `validation/keyboard-focused-specs.png`
- `validation/empty-specs-placeholder.png`
- `validation/readme-editor-smoke.png`
