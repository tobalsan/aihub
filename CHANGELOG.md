# AIHub Release Notes

These release notes are retro-created from commit history and handoff docs. Version tags mark product milestones for historical tracking, not npm package versions. Newest releases appear first.

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
