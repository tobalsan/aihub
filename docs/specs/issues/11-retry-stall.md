---
title: "Orchestrator slice 11: RetryPolicy + StallDetector"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

Two cooperating components.

`RetryPolicy` is a pure module keyed on `(issueId, kind)` where `kind ∈ {"dispatch", "tool_call"}`. Curve: `30 s, 60 s, 120 s, 240 s, …` capped at 30 minutes. Reset on the next successful exit. Failed dispatches register a backoff so the next tick skips the issue until `nextAttempt`. Failed `linear_graphql` tool calls register a per-issue tool-call backoff that the `LinearGraphqlTool` consults before issuing a request.

`StallDetector` runs as part of the tick. For each active claim, if `(now - lastEventAt) > workflow.agent.stall_timeout_ms`, the daemon:

1. Posts a comment via `linear_graphql` describing the stall.
2. Sets the issue state to `Needs Human` (via `linear_graphql`).
3. Kills the worker (interrupt + workspace preserved).
4. Releases the claim and emits `orchestrator.run.stalled`.

The same hard-stop rule applies to any orchestrator-owned `Needs Human` transition for an active run, including terminal worker errors.

## Acceptance criteria

- [ ] `RetryPolicy.register(issueId, kind, failure)` and `RetryPolicy.nextAttempt(issueId, kind)` round-trip; the curve `30 s, 60 s, 120 s, 240 s, …` caps at 30 min (table-tested).
- [ ] `RetryPolicy.reset(issueId, kind)` clears state for that bucket; other buckets are unaffected.
- [ ] Dispatcher consults `RetryPolicy.nextAttempt("dispatch")` and skips issues still on cooldown.
- [ ] `LinearGraphqlTool` consults `RetryPolicy.nextAttempt("tool_call")` and short-circuits with a documented error if still on cooldown.
- [ ] `StallDetector` triggers exactly once per claim once `lastEventAt` exceeds the threshold (no duplicate `Needs Human` writes).
- [ ] Stall handling: comment posted, state set to `Needs Human`, worker SIGTERM'd, claim released, `orchestrator.run.stalled` emitted — all visible end-to-end in the dashboard.
- [ ] Smoke: with `agent.stall_timeout_ms: 10000` overridden in a test WORKFLOW and an agent that sleeps for 60 s, the issue moves to `Needs Human` within ~10 s and the worker dies.

## Blocked by

- Slice 06 (StateStore).
