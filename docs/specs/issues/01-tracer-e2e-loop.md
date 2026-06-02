---
title: "Orchestrator slice 01: tracer E2E loop (poll → claim → no-repo subagent → release)"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

The thinnest end-to-end orchestration loop. New `packages/extensions/orchestrator` (`@aihub/extension-orchestrator`) registered in the gateway. On each tick (default 30 s ± jitter), the daemon polls Linear for issues in the configured active states, claims unclaimed work in memory, starts an AIHub `subagents` run in a plain (no-repo) workspace with the default profile, and exposes a single `orchestrator.linear_graphql({ query, variables? })` tool so the agent can write back to Linear. The daemon releases its claim only after observing a Linear terminal state (`Done` or `Canceled`) — it does not mark issues terminal itself. `LINEAR_API_KEY` lives in the gateway/daemon process only and is never injected into the worker environment.

This slice has since been superseded by the Symphony-alignment PRD: project folders now require `WORKFLOW.md`, and core orchestration remains directory-only with no git/worktree behavior. It still exists to prove the runtime loop end-to-end against the real Linear API.

## Acceptance criteria

- [ ] `packages/extensions/orchestrator` package exists, builds, and is registered in `apps/gateway/src/extensions/registry.ts` with route prefix `/api/orchestrator`.
- [ ] `OrchestratorExtensionConfigSchema` added to `packages/shared/src/types.ts` and wired into `ExtensionsConfigSchema`; supports `projects[]`, supervisor concurrency, validation mode, webhook, and notification settings.
- [ ] `LinearClient` performs the documented poll query (`project.slugId.eq` + `state.name.in`) and supports `commentCreate` + `issueUpdate` mutations; missing workflow auth disables that project loop.
- [ ] In-memory `ClaimsRegistry` with mutex; concurrent claims for the same issue id resolve to one winner.
- [ ] On claim, a `subagents` run starts with `source: "orchestrator"`, `parent: "orchestrator:<issueId>"`, the default profile, and an inline prompt derived from the issue title + description.
- [ ] Agent tool `orchestrator.linear_graphql({ query, variables? })` is advertised via `Extension.getAgentTools()` and executes via the daemon-held client; errors are returned verbatim.
- [ ] Daemon never auto-mutates a Linear issue to a terminal state. When Linear reports the issue in a terminal state, the daemon releases the claim and stops the worker if still running.
- [ ] `LINEAR_API_KEY` is not present in the spawned subagent process environment (verified by spawn-env snapshot in code review).
- [ ] Smoke test on Mac Studio: file a Linear issue in `Todo`; within 60 s the agent runs and posts a comment via `linear_graphql`; setting the issue to `Done` releases the claim and prevents re-claim on the next tick.

## Blocked by

None — can start immediately.
