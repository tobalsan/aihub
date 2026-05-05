# 2026-05-05 Slice Agent Timeline

Implemented PRO-242-S12.

- Slice Agent tab now mounts `SubagentRunsPanel` scoped by `projectId` + `sliceId` instead of rendering per-run raw JSON links.
- `SubagentRunsPanel` accepts project/slice filters, keeps the existing typed timeline renderer/actions, and offers an optional raw JSON log link.
- `/api/subagents` now understands `projectId`/`sliceId` filters for runtime runs and project-backed subagent sessions. Project-backed run IDs use `PRO-N:slug`, with logs/interrupt/archive/delete routed to the project subagent implementation.
- Project agent websocket events now append logs for expanded project-scoped timelines using the existing cursor path.

Verified with focused web/subagents typechecks and affected Vitest files.
