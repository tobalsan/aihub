---
title: "Orchestrator slice 07: HTTP routes + WS events (/api/orchestrator/*)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

Expose the full HTTP surface and WebSocket event stream documented in the PRD. Routes (Hono, mounted via `Extension.registerRoutes()`): `GET /runs`, `GET /runs/:issueId`, `GET /runs/:issueId/logs?since=N&follow=1`, `POST /runs/:issueId/release`, `POST /runs/:issueId/interrupt`, `POST /runs/:issueId/kill`, `POST /issues/:issueId/claim`, `GET /workflow?repo=<name>` (already shipped in slice 02 — extend with structured response), `POST /export[?team=KEY]` (stub forwarding to slice 13 once available), `GET /health`. WebSocket events broadcast through `ExtensionContext.emit()`: `orchestrator.run.{claimed, event, finished, stalled, needs_human}` and `orchestrator.workflow.changed`.

Interrupt = SIGTERM the worker but keep the workspace. Kill = interrupt + workspace cleanup via `WorkspaceLayout.remove`. Manual claim mirrors the dispatcher path but bypasses the poll cadence and returns 409 on race.

## Acceptance criteria

- [ ] All listed routes registered under `/api/orchestrator`; missing `LINEAR_API_KEY` returns 503 on every route except `/health`.
- [ ] `GET /runs` returns the join of in-memory claims + SQLite `runs`; `GET /runs/:issueId` returns run detail + recent events.
- [ ] `GET /runs/:issueId/logs?follow=1` streams worker stdout from the `subagents` runtime as a chunked HTTP response.
- [ ] `POST /runs/:issueId/release` removes the in-memory claim and writes `released_at` to SQLite `claims`; safe to call when no claim is active.
- [ ] `POST /runs/:issueId/interrupt` sends SIGTERM to the worker; workspace stays on disk.
- [ ] `POST /runs/:issueId/kill` interrupts then removes the workspace via `WorkspaceLayout.remove`.
- [ ] `POST /issues/:issueId/claim` force-claims; second concurrent claim returns 409.
- [ ] `GET /health` returns `{ status, lastTickAt, rateLimitRemaining }` and stays available even when the daemon is paused.
- [ ] WS events fire on each lifecycle transition; verified via an integration test that subscribes through `ExtensionContext`.

## Blocked by

- Slice 06 (StateStore).
