---
title: Orchestrator extension — Symphony-inspired Linear runtime
status: needs-triage
owner: thinh
created: 2026-05-31
supersedes: projects-ui-refresh-prd.md, project-shaping-repo-prd.md, kanban-slice-refactor.md
---

# Orchestrator extension

> Superseded for runtime shape by `docs/specs/orchestrator-symphony-alignment-prd.md`. Keep this document as historical context for initial slices; new implementation follows project-scoped `WORKFLOW.md`, Linear `tracker.project_slug`, directory-only workspaces, and no repo label/git-worktree core behavior.

Replace the AIHub `projects` (and `board`) extension with a Symphony-pattern orchestrator that uses Linear as the canonical issue store and AIHub as the runtime that polls, claims, and dispatches CLI subagents into per-issue workspaces.

## Problem Statement

I am a solo developer. My setup is a Mac Studio (`tms`, always-on) plus a MacBook Pro and an iPhone for on-the-go work. About a month ago I built a "projects" extension inside AIHub: a ShapeUp-inspired kanban with projects → slices, double kanban, a mandatory shaping pipeline, and 6-state lifecycles on both project and slice. It orchestrates Codex/Claude/Pi CLI subagents inside git worktrees.

I stopped using it for two reasons:

1. **Orchestration is too complex.** Double kanban + many statuses + per-status rules constantly trip up the CLI agents. They get stuck, forget to advance slice status, or push the work into the wrong column. I end up babysitting every run.
2. **The shape is wrong for my actual work.** Most of my tasks are one-offs — set up a server, configure an app, fix a small bug, write a script. They do not need a shaping pipeline. The existing system forces ceremony on every task regardless.

On top of that, I cannot capture new work from my phone without exposing the AIHub web UI over Tailscale and using a mobile browser — slower than Linear's native iOS app, which I already use elsewhere.

The current extension is also tens of thousands of lines of UI, schema, and per-state plumbing that I am the only person maintaining. Every behavior tweak fights against my own old code.

## Solution

Replace the extension with a thin orchestrator that follows OpenAI's Symphony pattern (https://github.com/openai/symphony/blob/main/SPEC.md): the tracker holds all issue state; the orchestrator only knows "active vs terminal"; the agent itself updates the tracker. Concretely:

- **Linear** becomes the source of truth for issues. The AIHub kanban dies. Mobile capture happens in Linear's iOS app in five seconds; I review and triage from the same app.
- A new `packages/extensions/orchestrator` runs as a daemon inside the gateway on the Mac Studio. Each tick (~30 s ± jitter) it polls Linear for issues in active states, claims unclaimed work up to the configured concurrency limit, prepares a workspace, and starts an AIHub `subagents` run in it.
- A per-repo `WORKFLOW.md` defines polling cadence, active/terminal state names, subagent profile selection, hooks, and the prompt body. `$AIHUB_HOME/WORKFLOW.md` is a fallback/template for no-repo tasks and repos without their own workflow.
- The agent updates Linear by calling a single tool: `orchestrator.linear_graphql({ query, variables? })`. The `LINEAR_API_KEY` lives only in the gateway process and is never injected into the worker environment. The default/fallback workflow ships with a "linear skill" — prose that teaches the agent how to comment, set status, attach files, etc. via raw GraphQL.
- Per-issue workspaces are git worktrees at `extensions.orchestrator.workspacesRoot` (relative paths resolve under `$AIHUB_HOME`; default `$AIHUB_HOME/workspaces/<sanitized-identifier>/`) on branch `aihub/<sanitized-identifier>`, or a plain directory when the issue has no `repo:*` label.
- Runtime state (run history, events, claims, heartbeats) goes to local SQLite at `$AIHUB_HOME/orchestrator/state.db` via `better-sqlite3`. Linear stays the issue board; SQLite is the run log; markdown is workflow config and one-way export only.
- The AIHub web UI gets a new `/orchestrator` route — three-panel runtime dashboard (daemon header, active runs, recent runs) — and the old projects/slice UI is removed.
- AIHub's existing `subagents` extension owns CLI process lifecycle, profiles, logs, resume, interrupt, archive, and realtime run updates. The orchestrator owns tracker/workspace policy and calls `subagents` instead of reimplementing a local worker runtime.

Outcome: substantial project/board code removed, one work unit instead of two, no mandatory pipeline, mobile capture works natively, and the orchestrator is small enough to extend without fear.

## User Stories

1. As a solo developer with a phone, I want to file a new task in Linear's iOS app, so that the orchestrator picks it up on the Mac Studio without me touching a laptop.
2. As a solo developer, I want the orchestrator to only act on Linear issues in states I declare as "active", so that I control exactly which work the agent attempts.
3. As a solo developer, I want a global `$AIHUB_HOME/WORKFLOW.md` fallback to define default polling cadence, subagent profile, and prompt for no-repo tasks, so that non-code work still runs without repo ceremony.
4. As a developer working in multiple repos, I want a per-repo `WORKFLOW.md` to be the canonical workflow for repo-bound tasks, so that repo-specific conventions (profile, hooks, prompt) live with the repo's code.
5. As a developer, I want WORKFLOW.md to support YAML frontmatter for structured config and a markdown body for the prompt template, so that the agent receives a rendered prompt and the daemon receives parseable config in one file.
6. As a developer, I want WORKFLOW.md changes to be hot-reloaded by the daemon, so that I can iterate on the workflow without restarting the gateway.
7. As a developer, I want active runs to keep their original WORKFLOW snapshot, so that mid-run changes don't corrupt in-flight work — the new version applies on the next dispatch only.
8. As a developer, I want to tag a Linear issue with a `repo:<name>` label, so that the orchestrator knows which repo to create a worktree in.
9. As a developer, I want an issue with no `repo:*` label to run in "no-repo mode" (plain directory, no git), so that I can use the orchestrator for tasks that aren't tied to a codebase (e.g. server config, scripts).
10. As a developer, I want each claimed issue to run in its own git worktree on branch `aihub/<sanitized-identifier>`, so that multiple issues against the same repo don't collide.
11. As a developer, I want worktree workspaces to survive across runs by default, so that resuming an issue reuses the same checkout instead of re-cloning state.
12. As a developer, I want the workspace lifecycle to be controllable via `cleanup_on_terminal`, so that I can choose between "keep history" and "always start fresh".
13. As a developer, I want lifecycle hooks (`after_create`, `before_run`, `after_run`, `before_remove`), so that I can run `pnpm install`, lint, format, or cleanup at well-defined points.
14. As a developer, I want hook stdout and stderr appended to the run's event log, so that I can debug what `pnpm install` printed without scraping shell history.
15. As an agent author, I want a single GraphQL tool (`orchestrator.linear_graphql`) instead of a fleet of typed helpers, so that I can express anything Linear's API supports without waiting for AIHub to wrap it.
16. As a security-conscious operator, I want `LINEAR_API_KEY` confined to the gateway process and never injected into the worker environment, so that a compromised agent process cannot steal the key.
17. As a developer, I want the daemon to teach the agent common Linear ops (comment, set status, attach, label) via prose in the default `WORKFLOW.md`, so that I don't need to write a "Linear MCP" or memorize GraphQL myself.
18. As a developer, I want to disable the Linear tool per-workflow (`expose_graphql_tool: false`), so that I can run HITL-only issues where the agent reads but cannot write.
19. As a developer, I want each issue claim to be exclusive across the daemon, so that concurrent ticks or manual `claim` calls never spawn two workers for the same issue.
20. As a developer, I want manual `aihub orchestrator claim <id>` and `release <id>` commands, so that I can force-claim outside the poll cadence or release a stuck claim.
21. As a developer, I want the agent to set the Linear issue to a terminal state (`Done` or `Canceled`) through `orchestrator.linear_graphql`, and I want the daemon to release its claim after observing that terminal state.
22. As a developer, I want a `Needs Human` state that pauses the orchestrator and triggers a notification, so that an agent can park work for me explicitly.
23. As a developer, I want stalled runs (no events for `stall_timeout_ms`) to auto-move to `Needs Human` with a comment and notification, so that hung CLIs surface instead of silently burning workspace.
24. As a developer, I want failed runs to back off exponentially per `(issueId, kind)` with a cap at 30 minutes, so that a broken issue doesn't hammer Linear.
25. As a developer, I want a stable, in-memory authoritative claims map plus an append-only SQLite log, so that the daemon stays fast and `aihub orchestrator status` survives a restart.
26. As a developer, I want gateway restarts to mark orphan runs (`finished_at IS NULL` and `process_alive=0`) as `outcome=orphaned` on startup, so that no double-claim happens after a crash.
27. As a developer, I want notifications to reuse the existing `notifications.channels` config and the burst buffer from the current projects extension, so that I don't configure HITL twice.
28. As a developer, I want a daily digest of orchestrator activity (Phase 4, optional), so that I can review the night's work over morning coffee without scrolling Linear.
29. As an on-the-go user, I want to browse `/orchestrator` from my phone via Tailscale and see active runs at a glance, so that I can decide whether to intervene without a laptop.
30. As a developer, I want a runtime dashboard with three panels (daemon header, active runs, recent runs), so that I see live state, current work, and history in one screen.
31. As a developer, I want to click a run to open a drawer with logs, events, the resolved WORKFLOW, and (later) a chat view, so that debugging a single run doesn't require shell access.
32. As a developer, I want to interrupt (SIGTERM, keep workspace) or kill (interrupt + cleanup) a run from the dashboard, so that runaway agents can be stopped without `ps`.
33. As a developer, I want a `aihub orchestrator logs <id> --follow` command, so that I can tail worker stdout from the terminal.
34. As a developer, I want a `aihub orchestrator workflow [--repo NAME]` command, so that I can print the merged frontmatter and confirm overrides before claiming.
35. As a developer, I want a `aihub orchestrator export [--team KEY]` command, so that I have a one-way Linear → markdown snapshot under `$AIHUB_HOME/exports/` for backup or grep.
36. As a developer, I want a token-bucket rate limiter that respects Linear's `X-RateLimit-*` headers and pauses polling near depletion, so that orchestrator activity doesn't break my own Linear UI.
37. As a developer, I want webhook reception behind a flag (Phase 4) with HMAC verification, so that the dashboard can update without waiting for the next poll while leaving polling as the safe default.
38. As a developer, I want to declare repo paths and an optional default repo in `aihub.json` under `extensions.orchestrator.repos`, so that the orchestrator can resolve labels to actual filesystem paths.
39. As a developer, I want issues with multiple `repo:*` labels to pick the first label alphabetically and emit a warning, so that v1 doesn't block multi-repo support but the limitation is visible.
40. As a developer, I want a "fresh start" migration: archive all `PRO-*` directories under a timestamped `$AIHUB_HOME/.archive/projects/...` path, so that no old data is silently dropped but nothing is auto-imported into Linear.
41. As a developer, I want the migration script to default to dry-run and require `--apply`, so that I can review the archive plan before any `mv` runs.
42. As a developer, I want existing seams (`harness-adapter`, worktree helpers, HITL burst buffer) extracted before the old packages are deleted, so that the orchestrator can adopt proven code without copy-paste rot.
43. As a developer, I want the old `extensions.projects` config to be ignored with a warning (not crash) after deletion, so that stale config in my `aihub.json` doesn't brick the gateway.
44. As a developer, I want the orchestrator extension name to be `orchestrator` (not `linear` or `tracker`), so that future swap-in of GitHub Issues or another tracker doesn't require a rename.
45. As a developer, I want orchestration to use AIHub `subagents` profiles, so that the chosen CLI agent/model/reasoning defaults are configured once in `aihub.json` and selected by workflow or Linear label.
46. As a developer, I want the daemon to expose health (`/api/orchestrator/health`) including last poll time and remaining rate-limit budget, so that I can wire it into existing monitoring.

## Implementation Decisions

### Source of truth and integration shape

- Canonical issue store: **Linear**. AIHub kanban and markdown board are removed.
- Single work unit: **Linear issue**. No project/slice hierarchy. Linear's "Project" is treated as prompt context (label/string), not a runtime concept.
- Workflow config: per-repo `WORKFLOW.md` at the repo root is canonical for repo-bound issues. `$AIHUB_HOME/WORKFLOW.md` is the fallback for no-repo issues and repos without a local workflow. Per-repo frontmatter overrides fallback frontmatter field-by-field; per-repo body replaces fallback body wholesale.
- Active states: `Todo`, `In Progress`. Terminal: `Done`, `Canceled`. HITL park: `Needs Human`. Triage/inbox state (not dispatched): `Backlog` or equivalent. State names live in `WORKFLOW.md` frontmatter so they're swappable.
- Default v1 concurrency: `max_concurrent: 3` globally, with room for future per-profile/per-repo limits. One active claim per Linear issue remains mandatory.
- Runner model: v1 is Symphony-inspired via AIHub CLI subagents, not strict Symphony Codex app-server mode. This keeps Codex/Claude/Pi profile choice available while accepting that continuation/session behavior is mediated by the existing `subagents` runtime.
- Migration: archive all `PRO-*` directories under `$AIHUB_HOME/.archive/projects/<YYYY-MM-DD>/`; no data import.

### New extension

- New package: `packages/extensions/orchestrator` (`@aihub/extension-orchestrator`).
- Registered in `apps/gateway/src/extensions/registry.ts` with route prefix `/api/orchestrator`.
- Config schema added to `packages/shared/src/types.ts` as `OrchestratorExtensionConfigSchema` (Zod), wired into `ExtensionsConfigSchema`.

### Major modules (deep where marked)

- **WorkflowLoader** (deep): resolves per-repo `WORKFLOW.md` with `$AIHUB_HOME/WORKFLOW.md` fallback, merges YAML frontmatter, renders placeholders (`{{issue.*}}`, `{{repo.*}}`, `{{run.*}}`), maintains mtime cache, watches files via `chokidar`, emits `orchestrator.workflow.changed`. Active runs keep their original snapshot via `runs.workflow_path` + `runs.workflow_sha`.
- **LinearClient** (deep): fetch-based GraphQL client, shared token-bucket reading `X-RateLimit-*`, 429 backoff (sleep until reset + 1 s). Auth via `LINEAR_API_KEY` env var; missing key disables the extension and returns 503 from routes.
- **RepoResolver** (deep, pure): given issue labels + config, returns `{ name, path, baseBranch }` or no-repo. First `repo:*` label alphabetically on multi-repo; emits warning event.
- **WorkspaceLayout** (deep): sanitizes identifiers, creates and removes git worktrees, handles no-repo `mkdir -p`. v1 supports `worktree` and `no-repo` modes only — the old `none`/`main-run`/`clone` modes are dropped.
- **SubagentRunner** (deep): starts and observes AIHub `subagents` runs with `source: "orchestrator"`, `parent: "orchestrator:<issueId>"`, resolved `cwd`, rendered prompt, and selected profile. It does not own CLI lifecycle directly.
- **ProfileResolver** (deep, pure): chooses a configured `extensions.subagents.profiles[]` entry from workflow `agent.profile`. If missing or unknown, park the issue in `Needs Human` with a comment. Any orchestrator-owned `Needs Human` transition while a subagent run exists must interrupt the run before releasing the claim.
- **ConcurrencyLimiter** (deep, pure): enforces global `max_concurrent` defaulting to 3 and one active claim per issue. Future per-profile/per-repo limits are left as schema-compatible extensions.
- **StateStore** (deep, SQLite via `better-sqlite3`): `insertRun / finishRun / appendEvent / listRecent / listEvents / markOrphaned`. Tables: `runs`, `events`, `claims`, `heartbeats`.
- **ClaimsRegistry** (deep): in-memory `Map<issueId, ClaimState>` with a mutex around `set`. First writer wins; second returns HTTP 409 on manual claim race.
- **RetryPolicy** (deep, pure): exponential backoff per `(issueId, kind)` with kinds `dispatch` and `tool_call`, cap 30 minutes, reset on successful exit.
- **StallDetector** (deep): sweeps `claims` by `lastEventAt > stall_timeout_ms`; on stall, agent posts a comment via the tool, daemon sets state to `Needs Human`, kills the worker.
- **HookRunner** (deep): executes `sh -c <cmd>` with env (`AIHUB_ISSUE_ID`, `AIHUB_ISSUE_IDENTIFIER`, `AIHUB_WORKSPACE`, `AIHUB_REPO`, `AIHUB_BRANCH`, `AIHUB_EXIT_CODE` on `after_run` only); stdout/stderr stream into SQLite `events` as `hook.<phase>.stdout|stderr`.
- **HitlBurstBuffer**: relocated verbatim from the current projects extension.
- **LinearGraphqlTool** (deep): single agent tool `orchestrator.linear_graphql({ query, variables? })`. Tool calls are logged to SQLite as `tool_call` events with sanitized payloads (query echoed, oversized variables hashed). Errors are returned verbatim so the agent can self-correct.
- **OrchestratorDaemon**: tick loop wiring the modules. Tick cadence = `polling.interval_ms ± jitter_ms` (default 30 s ± 5 s). It claims eligible issues, starts subagent runs up to concurrency, observes Linear terminal states, and releases claims; it does not mark successful issues `Done` by itself.
- **Exporter**: one-way Linear → markdown writer under `$AIHUB_HOME/exports/linear/<TEAM>-<NUM>.md`.
- **CLI** (commander) and **HTTP routes** (Hono) expose the verbs listed in the user stories.

### Routes

`GET /api/orchestrator/runs` · `GET /api/orchestrator/runs/:issueId` · `GET /api/orchestrator/runs/:issueId/logs?since=N&follow=1` · `POST /api/orchestrator/runs/:issueId/release` · `POST /api/orchestrator/runs/:issueId/interrupt` · `POST /api/orchestrator/runs/:issueId/kill` · `POST /api/orchestrator/issues/:issueId/claim` · `GET /api/orchestrator/workflow?repo=<name>` · `POST /api/orchestrator/export[?team=KEY]` · `GET /api/orchestrator/health`. Manual release is claim-only by design; operators use interrupt or kill when they also want to stop a worker.

### WebSocket events

`orchestrator.run.claimed | event | finished | stalled | needs_human` · `orchestrator.workflow.changed`.

### SQLite schema (overview, not bound to exact DDL)

- `runs`: one row per dispatched run; tracks workspace, repo, branch, profile snapshot, workflow path + sha, turn, PID, exit info, head shas.
- `events`: append-only worker/hook/tool events keyed to `run_id`.
- `claims`: claim audit trail (issue_id → run_id, claimed_at, released_at).
- `heartbeats`: one row per daemon (PID, last_tick, version) for `aihub orchestrator status`.

### Authority model

In-memory `claims` map is authoritative; SQLite is append-only log + claim-fairness audit. Justification: solo dev, single Mac Studio daemon, no fleet — Symphony exactly.

### Agent tool surface (Symphony-faithful)

Single tool `orchestrator.linear_graphql({ query, variables? })`. No domain helpers (`comment`, `update_status`, etc.) — those live as prose in the default `WORKFLOW.md` ("linear skill"). Auth lives only in the daemon. `LINEAR_API_KEY` in worker env is **not** supported in v1; a future `linear.expose_api_key_to_agent: true` flag would lift this — rejected as default.

### Web UI

New route `/orchestrator` registered via `apps/web/src/lib/web-route-registry.tsx`. Single page, three panels: daemon header, active runs grid, recent runs table. Drawer per run with Logs / Events / Workflow / Chat (Chat deferred to read-only event stream in v1). Reuses `BoardChatRenderer.tsx`, `SubagentRunsPanel.tsx`, `chat-runtime.ts`, `AgentChat.tsx`, `LeftNavShell.tsx`, `QuickChatFAB.tsx`, `QuickChatOverlay.tsx`. Lead chat (`/chat/:agentId`) is untouched.

### Deletion plan (Phase 5)

Extract only the pieces still needed by the new package, primarily HITL burst notification and any small worktree helpers not already covered by `subagents`. Then delete `packages/extensions/projects` and `packages/extensions/board` whole; web components (`ProjectsBoard`, `SliceDetailPage`, `ProjectDetailPage`, `SliceKanbanWidget`, `BoardView`, `TaskboardOverlay`, area components); web API (`projects`, `slices`, `space`, `board`); shared schema (`ProjectsExtensionConfigSchema`, `ProjectsOrchestratorConfigSchema`, `ProjectsConfigSchema`, `getProjectsRoot`, `getProjectsWorktreeRoot`); gateway registry entries; CLI subcommands (`aihub projects`, `aihub slices`, `aihub board`). Estimated removal: tens of thousands of LOC across backend + frontend.

### Phased execution

1. **Phase 1 — thinnest E2E loop** (~1 day): orchestrator skeleton, LinearClient query, poll one team, in-memory claim, global concurrency cap defaulting to 3, no-repo workspace, start an AIHub `subagents` run with the default profile, expose `orchestrator.linear_graphql`, and release the claim only after Linear reaches a terminal state.
2. **Phase 2 — workflow + repo mode + profile selection**: WORKFLOW.md frontmatter + fallback merge + template substitution; repo discovery via `repo:<name>`; git worktree create/teardown; `agent.profile` selection from `extensions.subagents.profiles[]`; default `$AIHUB_HOME/WORKFLOW.md` ships with the linear-skill prompt section.
3. **Phase 3 — persistence + dashboard**: SQLite state + schema + run/event persistence; HTTP routes; `/orchestrator` Solid.js dashboard; CLI `runs`/`events`/`logs --follow`.
4. **Phase 4 — hooks, retry/backoff, stall, notifications, optional webhook**: lifecycle hooks; stall detection → auto `Needs Human` + notify; backoff trio on failed exits; notifications via existing `notifications.channels` + relocated HITL burst buffer; optional webhook receiver behind flag.
5. **Phase 5 — cleanup**: extract reusable seams, delete old packages, run migration archive script on Mac Studio, update `docs/llms.md` and `README.md`.

## Testing Decisions

A good test in this codebase exercises external behavior — what callers see when they invoke a public function or hit a route — and avoids asserting on private fields, log strings, or specific log formats. Tests run with `pnpm test:web | test:gateway | test:shared | test:cli` (per `CLAUDE.md`), and Vitest is the framework. We follow the existing pattern in `packages/extensions/projects/src/**/*.test.ts` for unit tests and `apps/gateway/src/**/*.test.ts` for HTTP/extension wiring.

### Modules with unit tests in v1

- **WorkflowLoader** — frontmatter merge (per-repo wins field-by-field, body wholesale), placeholder rendering, mtime cache invalidation, chokidar invalidation event. Prior art: extension config loaders under `packages/extensions/projects/src/projects/document-store.ts` tests.
- **LinearClient** — token-bucket bookkeeping driven by mocked `X-RateLimit-*` headers, 429 backoff sleep computation, error pass-through. Prior art: any fetch-mocking patterns already used in shared tests; use `vi.fn()` for `fetch`.
- **RepoResolver** — pure function table tests over (labels, config) → `{path, baseBranch}` or `null` (no-repo) or `{name, warning}` (multi-repo).
- **ProfileResolver** — default profile, exact one label mapping, multiple matching labels → Needs Human, missing mapped profile → Needs Human.
- **ConcurrencyLimiter** — default cap of 3, one active claim per issue, no dispatch above cap.
- **StateStore** — schema bootstrap on a temp DB file; insert/finish/append round-trips; `markOrphaned` clears `process_alive=0` runs with `finished_at IS NULL`. Prior art: existing `better-sqlite3` tests in the repo (search `state.db` callers).
- **ClaimsRegistry** — `tryClaim` is exclusive across concurrent callers (simulate via `Promise.all`); `release` frees; `forceClaim` overrides only when no live worker; HTTP 409 surface on race.
- **RetryPolicy** — backoff curve (`30s, 60s, 120s, ... cap 30min`), reset on success, independent buckets per kind.
- **WorkspaceLayout** — sanitizer table tests; against a temp `git init` repo, `createWorktree` produces the expected branch; teardown removes both worktree and branch idempotently; no-repo mode produces a plain dir with no `.git`.
- **SubagentRunner** — starts a run through the subagents API/runtime with expected `cwd`, `parent`, `source`, profile, and rendered prompt; forwards interrupt/kill to subagents.
- **HookRunner** — env wiring (env vars present), exit-code capture, stdout/stderr piped as `hook.<phase>.stdout|stderr` events; failure does not abort the run unless the hook is `before_run`.

### Integration tests

- One Vitest integration test under `apps/gateway` that boots the extension with a mocked `LinearClient` and fake subagents runtime, drives a single tick, and asserts: poll query issued, claim recorded, subagent run started, no daemon-driven terminal mutation issued, then a mocked terminal Linear state releases the claim and finalizes the run row in SQLite.
- One CLI smoke test invoking `aihub orchestrator status` against a temp `$AIHUB_HOME` to verify state-file initialization and heartbeat row.

### Out-of-scope tests in v1

- No SSH worker tests (no implementation).
- No webhook handler tests beyond Phase 4 (flagged off by default).
- No browser-level Solid.js component tests for the dashboard; rely on existing component test patterns when added incrementally.
- No load tests on the rate-limit bucket — covered by header-driven unit tests only.

## Out of Scope

- **Markdown import of historical `PRO-*` data into Linear.** Fresh start. The migration script only archives.
- **Multi-user / multi-tenant operation.** Single `LINEAR_API_KEY` per gateway. Single operator.
- **Real multi-repo issues.** v1 picks the first `repo:*` label alphabetically and warns. The DDL leaves room (`runs.repo_path`) for a future `run_workspaces(run_id, repo_path, branch)` table.
- **SSH worker implementation.** Interface ships; no impl.
- **Codex app-server strictness.** v1 uses AIHub CLI-backed `subagents`, not the exact Symphony Codex app-server runner. The PRD documents this as an intentional implementation difference.
- **Per-repo/per-profile concurrency limits.** v1 has only one global `max_concurrent` defaulting to 3, plus one active claim per issue. Slot-based per repo/profile limits are future work.
- **Disk-usage GC of workspaces.** Manual `git worktree remove` for now; `aihub orchestrator gc --older-than 30d` is Phase 4 or later.
- **Direct Linear MCP / Linear CLI access from the worker.** Blocked by the auth boundary. Opt-in flag is documented but rejected as v1 default.
- **GitHub Issues as a tracker.** The extension is named `orchestrator` precisely so it can be swapped, but only Linear is implemented in v1.
- **Replacing or modifying lead chat (`/chat/:agentId`).** Orthogonal feature.

## Further Notes

- The `subagents` profile contract and the `WORKFLOW.md` schema are the two extension points where the team should resist scope creep — both are designed to stay stable while implementations swap underneath.
- The `LINEAR_API_KEY` boundary (daemon-only, never in worker env) is the single most important invariant in this design. Every code review of the worker spawn path should explicitly verify the env diff.
- The default `$AIHUB_HOME/WORKFLOW.md` body is the "linear skill" — it is the primary integration surface the agent reads at dispatch time. Investing in this prompt pays off more than wrapping new typed helpers.
- `extensions.projects` config in `aihub.json` should be ignored with a one-line warning post-deletion (Phase 5 acceptance test). Do not crash the gateway on stale config.
- Documentation updates land in `docs/llms.md` (LLM-facing) and `README.md` (human-facing) per `CLAUDE.md`; this PRD lives alongside other extension specs under `docs/specs/`.
- Plan source-of-truth for execution: `~/.claude/plans/i-created-the-projects-parallel-sphinx.md` (also kept in sync until Phase 1 lands).
