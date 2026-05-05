# Orchestrator HITL bursts

- Added `packages/extensions/projects/src/orchestrator/hitl.ts`, an in-memory burst buffer for HITL events. It flushes after 60s by default or immediately at 5 queued events.
- Wired the orchestrator daemon to S07's shared `notify()` helper, sending burst messages to notification channel `default`.
- Dispatcher now emits HITL events when a reviewer has returned a slice to `todo` and when the existing S06 stall-comment path writes a stall comment.
- Covered buffer behavior, reviewer-fail emission, and stall duplicate/status-reset behavior in orchestrator tests.
