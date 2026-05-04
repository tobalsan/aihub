# Board Thread comments-only

Updated `BoardProjectDetailPage` Thread tab to remove the THREAD.md `DocEditor`. It now renders comment cards from the project thread, shows `No comments yet.` for an empty thread, and keeps the add-comment form.

Validation:
- `pnpm exec vitest run apps/web/src/components/board/BoardProjectDetailPage.test.tsx`
- `pnpm test:web`
