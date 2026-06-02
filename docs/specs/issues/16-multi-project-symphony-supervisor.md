---
title: "Orchestrator slice 16: Multi-project Symphony supervisor"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-symphony-alignment-prd.md
---

## Parent

`docs/specs/orchestrator-symphony-alignment-prd.md` — Symphony-aligned project-scoped orchestrator.

## What to build

A single AIHub gateway process supervises multiple independent Symphony-style project loops. AIHub config lists project folders. Each project folder must contain `WORKFLOW.md`, and each workflow owns Linear `tracker.project_slug`, auth/endpoint, states, workspace root, hooks, and agent config.

The supervisor enforces a global host concurrency cap while each project loop also honors its workflow cap. Gateway-owned workers stop with the gateway. Restart recovery marks prior open runs interrupted for history, preserves issue workspaces, polls Linear again, and starts fresh runs for still-active issues. SQLite remains observability/history, not live-session authority.

## Acceptance criteria

- [ ] `extensions.orchestrator.projects[]` is the only dispatch-scope config.
- [ ] Startup fails fast if any configured project is missing or lacks uppercase `WORKFLOW.md`.
- [ ] Duplicate `tracker.project_slug` values are rejected at startup.
- [ ] Each tick polls Linear by workflow `tracker.project_slug` and workflow active/terminal states.
- [ ] A global concurrency cap and workflow project cap are both enforced.
- [ ] Claims/run state include project identity and prevent duplicate workers for the same Linear issue.
- [ ] Gateway shutdown stops active subagent runs and marks active runs stopped.
- [ ] Startup recovery marks old open runs `interrupted_gateway_restart` and does not reattach live sessions as authority.
- [ ] API/CLI/dashboard expose project-aware projects, workflow, runs, logs, claim, release, export, and tick operations.

## Blocked by

Project registry, workflow loader, Linear project-slug polling, and directory-only workspace layout.
