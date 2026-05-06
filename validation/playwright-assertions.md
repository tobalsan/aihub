# PRO-251-S01 Playwright Assertions

- `Actions ▾` contains `Edit repo…`; `Edit repo…` is not visible before opening the menu.
- Modal opens centered with dim non-transparent overlay, autofocuses repo input, and pre-fills current repo.
- Escape closes the modal without toast or repo mutation.
- Overlay click closes without toast or repo mutation.
- Panel click does not dismiss.
- Cancel closes without toast or repo mutation.
- Valid save closes modal, persists repo, and shows a top-right success toast.
- Success toast fades after timeout.
- Invalid non-empty repo keeps modal open, shows inline `⚠ Path not found`, emits no toast, and rolls server repo back.
- Empty save clears repo and shows `Repo cleared`.
- No-repo project save persists repo; orchestrator moves `PRO-2-S01` from `todo` to `in_progress`.
- Focus trap cycles input to Cancel to Save to input.
