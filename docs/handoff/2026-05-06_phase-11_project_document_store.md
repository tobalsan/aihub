# Phase 11: Project Document Store

Added `packages/extensions/projects/src/projects/document-store.ts` as the central project/slice document model.

Covered:

- project/slice layout constants
- Markdown/frontmatter formatting
- project thread parsing and edits
- active/`.done`/`.archive` project location
- project lifecycle status validation
- repo inheritance invariant helpers
- slice counter locks and atomic writes
- generated `SCOPE_MAP.md`

`store.ts` and `slices.ts` now delegate those document-model rules while preserving existing public CRUD function signatures.

Verification so far:

- `pnpm exec vitest run packages/extensions/projects/src/projects/document-store.test.ts packages/extensions/projects/src/projects/slices.test.ts packages/extensions/projects/src/projects/store.test.ts`
