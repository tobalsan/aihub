---
title: "Orchestrator slice 14: Linear webhook receiver (flagged off)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

Add an optional Linear webhook receiver so the dashboard updates without waiting for the next poll. Behind `extensions.orchestrator.webhook.enabled` (default `false`). HMAC verification of every payload using the configured `webhook.secret`. On a valid event for an issue we care about (active state name change, comment added on a claimed issue), enqueue a tick so the daemon re-evaluates immediately instead of waiting for the polling interval.

Polling remains the safe default; the webhook is purely an optimization. If verification fails, the request is rejected with 401 and the daemon does nothing.

## Acceptance criteria

- [ ] `POST /api/orchestrator/webhook` mounted at the configurable path (`webhook.path`, default `/api/orchestrator/webhook`); returns 404 when `webhook.enabled=false`.
- [ ] HMAC-SHA256 verification using `webhook.secret`; mismatches return 401 and are logged.
- [ ] Valid events for monitored states / claimed issues enqueue a tick on the daemon's internal channel; off-target events are acknowledged with 200 and dropped.
- [ ] Tick enqueued by webhook does not double-tick with the regular timer (coalesce inside the daemon).
- [ ] Smoke: with the flag on and a tunnel into the gateway, a state change in Linear advances the dashboard within ~1 s, faster than the 30 s poll cadence.

## Blocked by

- Slice 07 (HTTP routes).
