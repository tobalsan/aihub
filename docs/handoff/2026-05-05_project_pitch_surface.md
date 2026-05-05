# 2026-05-05 Project Pitch Surface

Implemented PRO-248-S01 project pitch surface.

- Project detail loading now exposes `docs.PITCH`, preferring `PITCH.md` and falling back to the stripped `README.md` body for legacy projects.
- Project frontmatter reads now use `README.md` only.
- Board project Pitch tab edits `docKey="PITCH"`, so saves create/update `PITCH.md` and no README tab/selector is shown.
- Added regression tests for PITCH loading, README fallback, and legacy edit behavior.
- Fixed `ProjectListGrouped` cancelled bucket default to match existing web tests.

Validation:

- `pnpm exec vitest run packages/extensions/projects/src/projects/store.test.ts packages/extensions/projects/src/projects/projects.api.test.ts apps/web/src/components/board/BoardProjectDetailPage.test.tsx apps/web/src/components/BoardView.test.tsx`
- `pnpm test:shared`
- `pnpm test:web`
