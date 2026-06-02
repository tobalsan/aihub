# Orchestrator extension slices 01-14 handoff

Implemented partial replacement foundation, not Phase 5 deletion.

Done:
- New `@aihub/extension-orchestrator` package and gateway registry entry.
- Shared `OrchestratorExtensionConfigSchema` with team/repo/poll/notify/webhook basics.
- Linear GraphQL client, poll query, comment/update helpers, daemon-held `orchestrator.linear_graphql` tool.
- Workflow loader: global default, per-repo merge, placeholder render, default Linear skill file.
- Repo resolver, workspace layout, profile resolver, concurrency limiter, claims registry, retry policy.
- SQLite state store, hook runner, HITL burst buffer copy, exporter helper.
- Basic `/api/orchestrator/*` routes: health, workflow, runs, release, manual claim, export, webhook stub.
- Unit tests for core pure/IO modules.

Known gaps / blockers:
- No real poll daemon dispatch loop yet; subagent start helper exists but not tick-wired.
- Interrupt/kill/log-follow are stubs, not forwarded to subagents runtime.
- WebSocket lifecycle events minimal (`claimed` only).
- Chokidar hot-reload not implemented.
- Profile park logic module exists but not dispatch-wired.
- Rate-limit token bucket/header sleep not complete.
- Stall detector and notification pipeline not daemon-wired.
- Dashboard and CLI verbs not implemented.
- Linear webhook HMAC validation not implemented; route is flag-gated stub.
- Projects/board intentionally not deleted.
