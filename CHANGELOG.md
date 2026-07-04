# AIHub Release Notes

These release notes are retro-created from commit history and handoff docs. Version tags mark product milestones for historical tracking, not npm package versions. Newest releases appear first.

## [Unreleased]

### Added
- Introduced a `superadmin` role above `admin`. The first user of a fresh instance now bootstraps as `superadmin`. Superadmins can promote/demote admins and other superadmins from the User access page; admins and regular users cannot change roles. Both `admin` and `superadmin` count as staff for approval and agent-assignment bypass.

## v0.17.0 — Proactive messaging + scheduler ops

Outbound agent messaging on Discord, agent-scoped notification tokens, on-demand scheduler runs, and orchestrator dashboard polish.

### Highlights
- Added Discord proactive agent tools so agents can initiate messages, not just reply.
- Added a scheduler `run` command to trigger a configured job on demand.
- Added a monitored-projects popover to the orchestrator dashboard.
- Resolved notification bot tokens per agent scope.
- Preserved the `session` param when toggling Simple/Full chat view.

### Upgrade notes
- Discord proactive tools require the bot to have send permissions in target channels.
- Notification tokens now resolve per agent; multi-agent setups should confirm each agent's bot token configuration.

### Known limitations
- Manual scheduler runs reuse the job's configured payload/session semantics.

## v0.16.0 — Orchestrator: Linear runtime + Symphony realignment

Largest cluster: the orchestrator extension gains a first-class Linear runtime, realigns to the Symphony multi-project supervisor model, and ships a redesigned dashboard.

### Highlights
- Added a Linear runtime: polling filtered by Linear project `slugId`, rate-header parsing, and workflow-owned tracker/endpoint/auth/states config.
- Realigned config to `extensions.orchestrator.projects[]` with global + per-project supervisor concurrency and validation settings.
- Each configured project must contain an uppercase `WORKFLOW.md`.
- Added `aihub orchestrator init-project` to scaffold a project end-to-end, with an expanded generated workflow template.
- Stop workers when an issue moves to "Needs Human".
- Redesigned the `/orchestrator` dashboard: live health data, logs rendered as agent turns, filtered/bounded recent runs, pinned/opaque log drawer.
- Hardened live dispatch, parked failed workers, and unblocked Node 26 sandbox validation.

### Upgrade notes
- Orchestrator config moved from dispatch-scope to `projects[]`; existing configs must migrate.
- Each project directory must contain uppercase `WORKFLOW.md`; workflow config now owns Linear `tracker.project_slug`, endpoint/auth, states, workspace root, hooks, and prompt.
- Gateway-owned worker lifetime: startup marks open runs `interrupted_gateway_restart` instead of reattaching live sessions; restart-recovery integrations should adjust.
- Repo-label routing and git/worktree behavior were removed from orchestrator runtime (directory-only workspace layout per issue).

### Known limitations
- SQLite state is observability/history only, not authority.

## v0.15.0 — Slack agent messaging

Agents can send Slack messages as a first-class tool, backed by per-agent bot configuration.

### Highlights
- Added Slack agent tools for sending messages.
- Documented Slack bots, agent tools, and required scopes.
- Resolved secrets correctly on gateway hot reload.

### Upgrade notes
- Slack send tools require bot tokens with the documented scopes.

### Known limitations
- Outbound only; richer Slack interactivity not yet covered.

## v0.14.0 — Lead-agent session resume + chat history hardening

Past agent sessions are now listable and resumable from canonical history, with session-id validation hardening.

### Highlights
- Added `GET /api/agents/sessions` listing visible past sessions from canonical history JSONL (single- and multi-user paths).
- Added session delete/rename via `DELETE`/`PATCH /api/agents/:agentId/sessions/:sessionId`.
- WebSocket `subscribe` accepts an explicit `sessionId` for active-turn replay and stream matching.
- Added a searchable, recency-grouped Sessions sidebar with rename/delete; polls every 3s and on focus.
- Compact resumed sessions and handle legacy session edits while keeping a canonical history path.

### Upgrade notes
- **Security:** session ids are validated and `..`/dot-dot ids are rejected; clients passing arbitrary session ids must conform.
- History fetch with explicit `?sessionId=` skips `sessions.json` pointer resolution.
- New chats come from chat flows (`/new`, idle rotation); the sidebar `+ New` affordance was removed.

### Known limitations
- Sidebar session list refreshes on a 3s poll/focus rather than live push.

## v0.13.0 — Scheduler model overrides + cron agent tools

Per-job model selection for scheduled runs, agent-facing cron tools, plus auth and chat-stream fixes.

### Highlights
- Added optional scheduler job `model: { provider, model }` overrides, threaded through run contract, Pi adapter, container input, and recorded in cron output.
- Added `--provider`/`--model` to scheduler CLI add/update.
- Added agent cron tools for managing schedules from within agent runs.
- Respect manual scroll during streaming instead of force-scrolling.
- Refreshed multi-user pending-approval state and moved the user-sessions storage path.

### Upgrade notes
- Scheduler job `model` requires both `provider` and `model` when set; otherwise the agent default applies.
- User-session storage path moved; multi-user deployments should verify session persistence after upgrade.

### Known limitations
- Cron job-file edits may still require a gateway restart to take effect.

## v0.12.0 — Context compaction + boot resilience

Context-window compaction, clearer context-usage visibility, and more resilient gateway boot/model-source handling.

### Highlights
- Added context compaction support for long-running chats.
- Surfaced context usage (including cache tokens) in the web UI.
- Refreshed and added fallback model context sources; preserved model data across updates.
- Improved gateway boot resilience and dev-extension loading.
- `/new` and `/reset` bypass the auto-compact pre-send guard even above 80% estimated usage.

### Upgrade notes
- Model context sources changed; custom model definitions should be re-verified after upgrade.

### Known limitations
- Compaction thresholds/heuristics are fixed, not yet user-configurable.

## v0.11.0 — Current reliability + admin/media polish

Current snapshot adds agent-run reliability work, admin impersonation, document upload support, and chat/streaming polish.

### Highlights
- Improved reliability for concurrent, queued, and long-running agent runs.
- Added admin read-only impersonation for multi-user mode.
- Added document upload support for media handling.
- Hid private agent metadata from responses/UI paths.
- Improved sidebar header visibility and streaming/chat flicker behavior.
- Added simple thinking traces in chat.

### Upgrade notes
- Private metadata is less visible; integrations reading private agent meta from API responses may need adjustment.
- Admin impersonation is read-only for writes by design.

### Known limitations
- Latest moving target; future in-app changelog should treat this as current snapshot until next release.

## v0.10.0 — Decentralized agent + scheduler config

Configuration ownership moved out of monolithic `aihub.json`: agents live in per-agent `agent.yaml`, schedules live under agent workspaces in `cron/jobs.json`.

### Highlights
- Added config v3 with agent discovery via root `aihub.json` `agents` globs/paths.
- Added root-only per-agent `agent.yaml` definitions with folder/name validation.
- Added `aihub agents migrate` to split legacy centralized config into agent workspaces.
- Moved scheduler jobs to per-agent `cron/jobs.json` with cron/tz/startAt shape.
- Standardized scheduler output under `<workspace>/cron/output/<jobId>/...`.
- Updated heartbeat to reuse scheduler-style output/routing helpers.
- Simplified agent workspace loading and deferred subagent config loading.
- Decoupled extension routes further from core runtime.

### Upgrade notes
- Legacy centralized `aihub.json` agent definitions must migrate to config v3.
- Agent IDs must match workspace folder/root `agent.yaml` expectations.
- Legacy `interval`/`daily` scheduler shapes migrate to cron-style jobs.
- Scheduler API/storage ownership moved per agent; direct global schedule-file assumptions should be updated.

### Known limitations
- `cron/jobs.json` edits may require gateway restart; no full live watcher yet.
- Malformed per-agent scheduler files are isolated with warnings and ignored for that agent.

## v0.9.0 — Scheduler/auth polish after refactor

Post-refactor release focused on UX polish, opt-in runtime behavior, bearer-token auth, and safer scheduler runs.

### Highlights
- Added lead-agent reasoning config parity and project repo edit affordance.
- Polished project lifecycle UI, project editors, inline project titles, and Agent FAB gating.
- Made scheduler and heartbeat opt-in extensions.
- Added bearer-token API auth for multi-user mode.
- Added scheduler CLI.
- Isolated scheduled job runs into unique scheduler sessions unless `payload.sessionId` is explicitly provided.

### Upgrade notes
- Scheduler/heartbeat must be enabled explicitly via extension config.
- Scheduler jobs no longer share one transcript by default; set `payload.sessionId` to preserve continuity.

### Known limitations
- Scheduler storage still mostly centralized at this point; deeper per-agent config lands in v0.10.0.

## v0.8.0 — Architecture refactor stabilization

Large internal architecture refactor split runtime seams while preserving product behavior, then stabilized board navigation and slice editing.

### Highlights
- Refactored gateway, web, container, projects, subagents, orchestrator, and realtime internals into clearer seams.
- Upgraded Pi SDK and made HITL channel optional.
- Fixed slice thread editing and board canvas/back navigation after refresh.

### Upgrade notes
- Private imports into gateway/web internals may break due to module moves.
- Custom integrations should verify Pi SDK/tool compatibility.

### Known limitations
- Mostly internal; regressions most likely in custom/private integration paths.

## v0.7.0 — Slices + orchestrator reliability

Project work moved to slice-first execution with Worker/Reviewer/Merger orchestration, blockers, HITL notifications, and board lifecycle UX.

### Highlights
- Added slice storage, `aihub slices` CLI, migration helpers, scope map generation, and lifecycle status model.
- Re-keyed orchestrator dispatch from project IDs to slice IDs.
- Added Worker/Reviewer/Merger flow, integration branches, stale-run interrupts, spawn backoff, stall detection, conflict parking, and done-slice pings.
- Added slice blockers, repo overrides/invariants, pitch/specs doc surfaces, and durable reviewer feedback.
- Added board lifecycle views, embedded project/slice navigation, inline doc editing, thread markdown, live slice kanban refresh, activity feed, and run timeline.
- Added `aihub notify` for HITL notifications.

### Upgrade notes
- Orchestrator state and concurrency became slice-keyed, not project-keyed.
- Project-level docs shifted toward `PITCH.md`; slice specs shifted toward `SPECS.md`.
- Automation must account for slice statuses and blocker resolution.

### Known limitations
- Missing/stale blockers can intentionally block dispatch.
- Human intervention still required for some merge/conflict paths.

## v0.6.0 — Board, scratchpad, runtime subagents

Board became the central home: lead chat, scratchpad, runtime subagents, projects/worktrees overview, and extension tools.

### Highlights
- Added Board extension home route, persistent board chat, stop/queue controls, and full-history renderer.
- Added scratchpad API, internal tools, prompt contribution, editor UI, and line tools.
- Added project-agnostic subagents runtime and CLI/API surface.
- Added extension prompt/tool model, sanitized tool names, and large tool-result spooling.
- Added `/board/projects` scanning, project panels, worktree discovery, Space cache, and worktree/run state enrichment.
- Added webhooks extension and Slack/thread improvements.

### Upgrade notes
- Board/subagents flows depend on extensions being configured.
- Some legacy internal subagent tool wiring was removed in favor of extension tools.

### Known limitations
- Board project scan/perf behavior was still actively tuned.

## v0.5.0 — Extension extraction

Core gateway features were extracted into first-party extensions, making optional surfaces explicit and reducing core coupling.

### Highlights
- Moved optional capabilities out of core and into first-party extensions.
- Extracted heartbeat, scheduler, Langfuse, multi-user, Discord, Slack, and projects into extension packages.
- Added shared extension contracts and extension loading.

### Upgrade notes
- Built-ins became extension-shaped; deployments need explicit extension config where applicable.
- Custom integrations importing private component paths likely need updates.

### Known limitations
- Extension ecosystem still young; follow-up build/runtime fixes landed after this cut.

## v0.4.0 — Components, auth, containers, media

Runtime platform matured: modular components, connectors, multi-user auth, Langfuse, sandbox containers, evals, and file exchange.

### Highlights
- Added modular component foundation and extracted simple gateway components.
- Added connector framework, OneCLI integration, `$AIHUB_HOME`, env resolution, and skill/tool filtering.
- Added multi-user auth startup flow and protected web/API paths.
- Added Langfuse tracing over history/stream events.
- Added Docker-backed agent runner, container adapter, internal tool dispatch, OneCLI proxy wiring, and sandbox mounts.
- Added media/file upload/download foundation and agent file output support.
- Added eval runner and Harbor eval scaffolding.

### Upgrade notes
- Config/runtime paths changed around `$AIHUB_HOME`, connectors, and component enablement.
- `--template` usage moved toward `--subagent`.
- Containerized agents changed attachment/tool/file-output expectations.

### Known limitations
- Component extraction not yet full extension packaging.

## v0.3.0 — Project UI, Space, and worktree workflow

AIHub grew into a project operating surface: UI v2/v3, project agent panels, Space/worktree workflow, and richer realtime state.

### Highlights
- Added kanban homepage, agents sidebar, context panel, project detail tabs, mobile polish, and command/search flows.
- Added project agent panel/chat, spawn templates, role prompts, and run-mode controls.
- Added Space-first workspace core, branch diffs, integration controls, and worktree-aware prompts.
- Added realtime project file refresh, activity/comment separation, status indicators, and context usage warnings.
- Added areas, SPECS task parsing, checklist support, and repo validation.

### Upgrade notes
- Project documents moved beyond README-only assumptions toward SPECS/tasks/structured metadata.
- CLI/template flows changed; automation should align with newer project spawn/start semantics.

### Known limitations
- Slice/orchestrator model not yet present.

## v0.2.0 — Projects + subagent loop

Projects and subagents became usable together: create work, spawn agents, monitor logs, resume/kill runs.

### Highlights
- Added Projects API, CLI, kanban UI, project detail surfaces, and project creation flows.
- Added subagent list/logs/spawn/interrupt/resume/kill APIs and CLI commands.
- Added project-aware prompts, repo-path handling, worktree mode, and live monitoring panel.
- Added heartbeat runner/CLI and richer web run controls.

### Upgrade notes
- Project/subagent command behavior changed from ad hoc runs toward project IDs and resolved repo/worktree paths.
- Scripts should prefer explicit project IDs and run metadata.

### Known limitations
- Orchestration still manual; recovery from conflicts/stalls remained best-effort.

## v0.1.0 — Initial gateway foundation

First usable AIHub shape: gateway, web chat, sessions, WebSocket streaming, and early multi-SDK preparation.

### Highlights
- Added gateway/web baseline with WebSocket streaming and session persistence.
- Added full-history chat view, thinking indicators, markdown rendering, and live subscription plumbing.
- Added AMSG/Discord basics and workspace bootstrap/session key support.
- Prepared multi-SDK architecture and config surfaces.

### Upgrade notes
- Early internal config/runtime paths changed quickly; no stable migration contract yet.

### Known limitations
- Pre-projects, pre-board, pre-extensions.
