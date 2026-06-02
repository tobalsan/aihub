---
title: "Orchestrator slice 04: ProfileResolver"
status: needs-triage
type: AFK
parent: docs/specs/orchestrator-extension-prd.md
---

## Parent

`docs/specs/orchestrator-extension-prd.md` — Orchestrator extension PRD.

## What to build

`ProfileResolver` chooses which `extensions.subagents.profiles[]` entry to use for a given issue. WORKFLOW frontmatter exposes `agent.profile`. Resolution rules: if `agent.profile` names a configured profile, use it; if missing or unknown, park the issue in `Needs Human` with a comment via `linear_graphql` explaining the reason.

This slice wires the resolver into the dispatch path so profile selection comes from the workflow, not a hardcoded default.

## Acceptance criteria

- [ ] `ProfileResolver.resolve({ workflow, profilesConfig })` returns either `{ profile }` or `{ park: { reason } }`.
- [ ] Pure-function table tests cover: configured profile, missing profile setting → park, unknown profile name → park.
- [ ] Park outcome causes the dispatcher to: post a Linear comment via `linear_graphql` describing the reason, set the issue state to `Needs Human`, and release the claim without starting a worker.
- [ ] Successful resolution flows the selected profile into the `subagents` run start call.
- [ ] Smoke: with `agent.profile: worker` configured, an eligible issue runs with the `worker` profile.

## Blocked by

- Slice 02 (WorkflowLoader).
