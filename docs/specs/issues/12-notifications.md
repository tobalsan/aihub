---
title: "Orchestrator slice 12: Notifications (existing channels + relocated HitlBurstBuffer)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

Wire orchestrator events into the existing notification surface. Reuse `config.notifications.channels` and `packages/shared/src/notify.ts` — no new notification config. WORKFLOW frontmatter `server.notify_channel: <name>` selects the channel; the daemon resolves it at startup (mirror the existing pattern in `packages/extensions/projects/src/orchestrator/index.ts`).

Relocate `createHitlBurstBuffer` (currently at `packages/extensions/projects/src/orchestrator/hitl.ts`) verbatim to the new orchestrator package; the burst buffer dedupes notifications during high-throughput stretches.

Events that notify (via the burst buffer): `run.needs_human`, `run.stalled`, `run.failed` (max_turns exhausted), `daemon.startup_error`. Add an optional daily digest at 09:00 local time behind a simple `setInterval`, off by default — enabled by `digest.enabled: true` in frontmatter.

## Acceptance criteria

- [ ] HitlBurstBuffer code copied to the orchestrator package and used by the notification pipeline; unit tests come with it.
- [ ] WORKFLOW `server.notify_channel` resolves at daemon start; missing channel logs an error but does not crash.
- [ ] `run.needs_human`, `run.stalled`, `run.failed`, and `daemon.startup_error` each fire a notification through the configured channel.
- [ ] Burst buffer collapses duplicate notifications within its existing window (parity with current `projects` extension behavior).
- [ ] Daily digest (when enabled) posts a single message at 09:00 local time summarizing the last 24 h of runs.
- [ ] Smoke: a stalled run posts to the configured channel within one tick of stall detection.

## Blocked by

- Slice 11 (RetryPolicy + StallDetector).
