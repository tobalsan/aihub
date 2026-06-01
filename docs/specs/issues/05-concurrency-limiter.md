---
title: "Orchestrator slice 05: ConcurrencyLimiter (global max_concurrent=3 + per-issue exclusivity)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

`ConcurrencyLimiter` enforces a global cap on concurrent active claims (default `max_concurrent: 3`, configurable in WORKFLOW frontmatter / extension config) and preserves the one-active-claim-per-issue invariant. The limiter is queried by the dispatcher before dispatching a new claim; if the cap is reached, the issue is skipped this tick and retried on the next one. Per-issue exclusivity continues to be enforced by `ClaimsRegistry`'s mutex from slice 01.

Schema leaves room for future per-profile / per-repo limits without changing the call sites — the v1 limiter only reads the global cap, but the interface accepts a context object so future fields are additive.

## Acceptance criteria

- [ ] `ConcurrencyLimiter.tryReserve({ issueId, profile, repo })` returns `{ ok: true, release: () => void }` or `{ ok: false, reason: "cap" | "issue-busy" }`.
- [ ] Default cap is 3 when no config value is present; respects an explicit `max_concurrent` override.
- [ ] Pure-function table tests cover: under-cap dispatch succeeds, at-cap dispatch returns `cap`, releasing a reservation frees a slot, second dispatch for the same `issueId` returns `issue-busy` until the first is released.
- [ ] Dispatcher consults the limiter before starting a `subagents` run; rejected dispatches do not appear in the claims map.
- [ ] Smoke: queue 5 eligible Linear issues; exactly 3 enter `In Progress` simultaneously; the remaining 2 dispatch as earlier ones reach a terminal state.

## Blocked by

- Slice 01 (tracer E2E loop).
