---
title: "Orchestrator Symphony alignment and multi-project runtime"
status: needs-triage
type: PRD
---

## Problem Statement

The orchestrator drifted from the Symphony specification. It currently behaves like a single multi-repo dispatcher: tracker binding lives in AIHub config, repo selection happens through labels/config, workflow policy can fall back to a global file, and workspace behavior includes git/worktree policy.

This makes runtime behavior harder to explain from `WORKFLOW.md` alone. It also splits tracker scope from state policy, even though Symphony expects `WORKFLOW.md` to be the self-contained repository/project contract for tracker selection, runtime settings, workspace settings, hooks, and prompt.

## Solution

Simplify the orchestrator into a Symphony-aligned multi-project supervisor.

AIHub config only lists project folders and supervisor-level limits. Each project folder must contain uppercase `WORKFLOW.md`. Each `WORKFLOW.md` owns tracker config (`tracker.kind`, `tracker.endpoint`, `tracker.api_key`, `tracker.project_slug`), tracker states, workspace root, hooks, agent settings, and prompt.

The gateway may still run one extension process, but internally it runs one independent orchestration loop per configured project. Each loop loads that project's `WORKFLOW.md`, polls Linear issues scoped by `tracker.project_slug`, creates/reuses per-issue workspaces under that project's configured workspace root, and dispatches an AIHub subagent mapped from the workflow's agent config.

Remove repo label routing, repo maps, default repo behavior, global `WORKFLOW.md` fallback, and all built-in git/worktree behavior. Workspace population is not core orchestration: hooks or explicit tooling are preferred for deterministic repo bootstrap; prompt-driven cloning is allowed, but must stay inside the issue workspace. The daemon only requires safe per-issue directories.

## User Stories

1. As an operator, I want AIHub config to list project folders, so that project scope is explicit and easy to audit.
2. As an operator, I want each project folder to require `WORKFLOW.md`, so that missing workflow policy fails loudly.
3. As an operator, I want tracker project slug inside `WORKFLOW.md`, so that tracker binding and state policy live together.
4. As an operator, I want Linear candidate issues filtered by project slug, so that each project loop only sees its own issues.
5. As an operator, I want no team-key dispatcher config, so that the runtime matches Symphony's Linear project-scoped model.
6. As an operator, I want no repo label routing, so that Linear labels do not secretly decide execution directories.
7. As an operator, I want no configured repo map, so that there is no second routing table to keep in sync.
8. As an operator, I want no global workflow fallback, so that every project is self-contained.
9. As an operator, I want uppercase `WORKFLOW.md` only, so that filename behavior is deterministic.
10. As an operator, I want workspace root configured in `WORKFLOW.md`, so that workspace policy is versioned with project policy.
11. As an operator, I want relative workspace roots to resolve relative to the workflow directory, so that project configs are portable.
12. As an operator, I want per-issue workspace directories, so that workers stay isolated without requiring git worktrees.
13. As an operator, I want workspaces preserved across runs by default, so that failed or reviewed attempts remain inspectable.
14. As an operator, I want terminal-state cleanup to follow workflow workspace settings, so that cleanup is deliberate.
15. As an operator, I want the daemon to tick every configured project, so that one gateway can supervise several Symphony-style projects.
16. As an operator, I want each project loop to have independent polling/state settings, so that projects can use different Linear workflows.
17. As an operator, I want startup validation to fail fast when any configured project is invalid, so that misconfigured automation does not run partly by accident.
18. As an operator, I want invalid workflow reloads to keep the last known good config for that project, so that live edits do not crash the daemon.
19. As an operator, I want each project loop to watch its own `WORKFLOW.md`, so that project policy updates apply without gateway restart.
20. As an operator, I want duplicate project slugs detected, so that two loops do not fight over the same Linear issues.
21. As an operator, I want active claims keyed by project and issue, so that run state remains correct across projects.
22. As an operator, I want global duplicate safeguards by Linear issue ID, so that accidental overlapping project scope cannot launch duplicate workers.
23. As an operator, I want gateway-owned worker runs to stop when the gateway stops, so that restart recovery stays tracker/filesystem-driven instead of live-session-driven.
24. As an operator, I want restart recovery to preserve workspaces and run history, then start fresh runs for still-active issues, so that observability remains without reattach complexity.
25. As an operator, I want a global supervisor concurrency cap across project loops, so that N projects cannot oversubscribe one host.
26. As an operator, I want optional per-project concurrency from each workflow, so that busy projects can still be locally bounded.
27. As an operator, I want manual claim to resolve the owning project by project slug or issue lookup, so that manual intervention remains reliable.
28. As an operator, I want dashboard run rows to show project identity, so that I can tell which project owns a run.
29. As an operator, I want events/logs filtered by project, so that multi-project observability stays readable.
30. As a worker agent, I want my cwd to be the issue workspace directory, so that commands cannot spill into unrelated directories.
31. As a worker agent, I want prompt rendering to use the project workflow body, so that instructions match the owning project.
32. As a worker agent, I want tracker tools to use the workflow tracker config, so that issue writes target the correct Linear context.
33. As a project maintainer, I want git behavior out of core orchestration, so that hooks or explicit tooling can deterministically bootstrap repos while prompt-driven cloning remains allowed inside the issue workspace.
34. As a project maintainer, I want existing repo/worktree docs removed or rewritten, so that docs do not describe removed behavior.
35. As a developer, I want small pure modules for workflow config, project registry, tracker filtering, workspace layout, and run reconciliation, so that the cleanup is testable.

## Implementation Decisions

- Replace tracker binding in AIHub config with a project-folder registry.
- AIHub orchestrator config owns only supervisor-level settings, global concurrency, validation mode, and project paths.
- Startup validation is fail-fast by default: any invalid configured project prevents daemon startup. A future explicit degraded mode may allow invalid projects to be parked, but it is not default behavior.
- Project paths may be absolute or relative to AIHub home; the effective path is normalized before use.
- Each project must contain uppercase `WORKFLOW.md`; lowercase fallback is not supported.
- Each project loop watches its own `WORKFLOW.md`; invalid reloads keep the last known good config for that project and emit operator-visible errors.
- `WORKFLOW.md` owns `tracker.kind`, `tracker.endpoint`, `tracker.api_key`, `tracker.project_slug`, tracker active states, terminal states, workspace root, hooks, agent settings, and prompt body.
- `tracker.api_key` supports literal tokens and `$VAR` indirection, with `$LINEAR_API_KEY` as the canonical shared default. Different projects may use different env vars or endpoints.
- Linear polling must filter candidates by `tracker.project_slug`, mapped to Linear project `slugId`.
- Remove `teamKey` as dispatch scope.
- Remove repo labels, repo maps, default repo, repo warnings, and repo-based workflow overrides.
- Remove built-in git worktree creation/removal and any required git behavior from core dispatch.
- Workspace layout becomes directory-only: sanitize issue identifier, place directory under workflow `workspace.root`, ensure cwd stays inside root.
- Relative `workspace.root` resolves relative to the directory containing the selected `WORKFLOW.md`.
- The extension process may supervise multiple project loops, but each project loop should behave like an independent Symphony orchestrator.
- Supervisor concurrency has a global host-level cap. Each project loop may also apply its workflow-level cap; effective availability is the smaller of remaining global capacity and project capacity.
- State store records must include project identity for runs, claims, events, and dashboard/API filtering. SQLite remains an AIHub observability/history store, not the authority for restart correctness.
- Duplicate or overlapping tracker scope should be rejected at startup when project slugs collide, and guarded before dispatch by Linear issue ID during a live process.
- Gateway-owned workers must be terminated on gateway shutdown; on startup, stale owned PIDs from persisted state should be killed best-effort before polling.
- Restart recovery follows Symphony semantics: poll tracker, reuse filesystem workspaces, mark prior active runs interrupted/orphaned for history, and start fresh runs for still-active issues.
- Manual claim must be updated for project-scoped dispatch instead of repo/label dispatch.
- Symphony has no profile concept. AIHub keeps profiles only as a runner adapter: workflow `agent.profile` selects one configured subagent profile, while future closer-Symphony fields such as command, approval policy, sandbox, and max turns may map directly into a generated subagent profile.
- `Needs Human` remains an exceptional park state, not a normal review state.
- Synchronous reviewer, if added later, should remain worker-visible substep/events, not a second daemon stage in this PRD.

## Testing Decisions

- Tests should assert external behavior: config accepted/rejected, Linear queries scoped correctly, dispatch cwd selected correctly, duplicate dispatch prevented, and docs/examples matching runtime behavior.
- Workflow config tests should cover required project slug, endpoint/api-key resolution, active/terminal defaults, workspace root resolution, dynamic reload last-known-good behavior, and uppercase-only workflow discovery.
- Project registry tests should cover absolute paths, AIHub-home-relative paths, missing folders, missing `WORKFLOW.md`, duplicate paths, duplicate project slugs, and fail-fast startup validation.
- Linear client tests should verify project-slug query variables and candidate filtering shape.
- Workspace layout tests should verify sanitized per-issue directories, path containment, reuse, and no git invocation.
- Daemon tests should cover multi-project tick, global plus per-project concurrency, gateway shutdown worker termination, tracker/filesystem restart recovery, terminal cleanup, and overlapping-scope duplicate guard.
- CLI/API tests should cover project-aware health, runs, events, logs, claim, release, and dashboard payloads.
- Documentation checks should ensure removed repo/worktree/team-key behavior is not advertised.

## Out of Scope

- Deleting the old projects/board extension remains out of scope and still requires explicit HITL approval.
- Building a two-stage reviewer daemon is out of scope.
- Reintroducing label-to-profile or state-to-profile routing is out of scope.
- Implementing git clone/worktree population is out of scope for core orchestration.
- Building a full Symphony Codex app-server compatible runner is out of scope; AIHub subagents remain the execution backend.
- Migrating existing live operator config automatically is out of scope unless separately requested.

## Further Notes

Official Symphony `SPEC.md` confirms the relevant alignment targets: `WORKFLOW.md` should be self-contained, `tracker.project_slug` is required for Linear dispatch, candidate issue queries filter by Linear project `slugId`, `workspace.root` lives in workflow config, relative workspace roots resolve relative to the workflow file directory, and git tooling is optional implementation-defined workspace population.

This PRD intentionally keeps one gateway extension process for AIHub operational convenience while changing its internal model to independent project loops. That preserves multi-project support without keeping the current multi-repo dispatcher drift.

Restart behavior intentionally follows Symphony: the gateway owns worker lifetimes, workers stop with the gateway, and recovery is driven by Linear plus preserved workspace directories. SQLite remains useful for dashboard/history, but not for live-session reattachment authority.
