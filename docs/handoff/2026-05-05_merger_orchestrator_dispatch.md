# 2026-05-05 Merger orchestrator dispatch

- Added `ready_to_merge` orchestrator dispatch for Merger profiles.
- Merger runs spawn from `<projectId>/integration`, use `Merger` author attribution, and leave slices unchanged on spawn failure.
- `ready_to_merge` status bindings default to `max_concurrent: 2`.
- Dev config now includes Worker, Reviewer, and Merger runtime profiles plus the `ready_to_merge` binding.
