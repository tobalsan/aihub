---
title: "Orchestrator slice 09: Web dashboard /orchestrator (3 panels + drawer)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

A Solid.js runtime control panel at `/orchestrator`, registered through `apps/web/src/extensions/orchestrator/routes.tsx` (discovered by `apps/web/src/lib/web-route-registry.tsx`). Single page, three panels top → bottom:

1. **Daemon header**: status dot, poll cadence, next-tick countdown, rate-limit remaining, last-error toast.
2. **Active runs grid** (card per claim): identifier + title (link out to Linear), state, repo, branch, elapsed, turn N/M, mini event tail (reuse `apps/web/src/components/BoardChatRenderer.tsx` — `buildBoardLogs()` already maps history events to UI rows). Controls: Interrupt / Kill / Open Logs / Open Linear.
3. **Recent runs table** (last 50 from SQLite): identifier, started, duration, outcome, exit code. Click a row to open a drawer with the full event timeline.

Drawer tabs: Logs / Events / Workflow (resolved frontmatter + body) / Chat. Chat is read-only event stream in v1.

Live updates over the existing WS bus from slice 07 (`orchestrator.run.*`, `orchestrator.workflow.changed`). Mobile-friendly enough to be useful over Tailscale on the phone.

## Acceptance criteria

- [ ] Route `/orchestrator` mounted and reachable; sidebar entry added next to existing runtime nav.
- [ ] Daemon header reflects `/health` and updates the next-tick countdown each second.
- [ ] Active runs panel updates within ~1 s of a WS event without refresh.
- [ ] Interrupt / Kill buttons issue the corresponding `POST` routes and reflect new state immediately.
- [ ] Recent runs table loads via `GET /runs?limit=50`; row click opens drawer.
- [ ] Drawer Logs tab streams via `GET /runs/:id/logs?follow=1`; Events tab paginates SQLite events; Workflow tab renders the merged frontmatter + body; Chat tab renders read-only event stream.
- [ ] Reuses `BoardChatRenderer.tsx`, `SubagentRunsPanel.tsx`, and `chat-runtime.ts` rather than reinventing log/event rendering.
- [ ] Lead chat (`/chat/:agentId`) is untouched.

## Blocked by

- Slice 07 (HTTP routes).
