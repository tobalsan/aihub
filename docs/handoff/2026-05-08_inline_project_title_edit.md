# Inline project title edit

- Added inline title editing to `apps/web/src/components/board/BoardProjectDetailPage.tsx`.
- Header title now shows a discreet hover/focus edit icon, swaps to a prefilled input plus check icon, saves with check/Enter, validates non-empty titles, and cancels with Escape.
- Scoped test run: `pnpm exec vitest run apps/web/src/components/board/BoardProjectDetailPage.test.tsx` (17 passed, 3 failed in existing slice-tab tests that could not find `.bpd-add-slice-btn`).
