# Hand-off

Date: 2026-04-06
Repo: `/Users/thinh/projects/.workspaces/aihub-harbor-evals-sales-admin`
Branch: `feature/harbor-evals-sales-admin` (worktree; base commit `1fb7bd7`)

## Current Effort: Harbor Evals for AIHub Migration

We are porting legacy Python/LangChain CloudifAI workflows
(`~/agents/cloud/cloudifai-workflows-to-port.md`) to full agent skills +
connectors in this repo, TDD-style, using the Harbor framework
(`~/agents/cloud/.firecrawl/harbor-docs-crawl.json`) as the eval harness.
Starting with the `sales_admin` workflow family.

### Decisions made

- **AIHub as Installed Harbor agent** (not external shim). Three layers:
  1. `aihub eval run` CLI (to be built) — headless, single-turn, writes
     `result.json` + ATIF `trajectory.json`, skips HTTP server / Discord /
     amsg / scheduler / heartbeat / multi-user / web UI.
  2. `aihub-eval-base` Docker image — bakes the CLI, `aihub.json`, uv-managed
     pytest, pnpm, non-root `agent` user, `AIHUB_HOME=/eval`.
  3. Python `BaseInstalledAgent` wrapper (`examples/harbor/agents/aihub_installed.py`).
- **Connector stubbing: Strategy B** (real connector code → fake HTTP
  sidecar via `baseUrl` override). Most realistic/faithful to production.
  Confirmed `cloudifi_admin` already supports `adminApiBase` / `coreApiBase`
  config overrides — no refactor needed.
- **ATIF emitted natively** by `aihub eval run` (skip converter phase).
- **Deterministic clock** injection via `[verifier.env]` + `[agent.env]`
  `EVAL_NOW=2026-04-06`.
- **uv**, not pip, per global CLAUDE.md. Installed at build time in
  `aihub-eval-base` via multi-stage `COPY --from=ghcr.io/astral-sh/uv:latest`
  + `uv tool install pytest==8.4.1`, with `UV_TOOL_DIR=/opt/uv/tools`
  `UV_TOOL_BIN_DIR=/opt/uv/bin` so `/opt/uv/bin` is on PATH for both root
  (build) and `agent` (runtime, offline — `allow_internet = false`).
- **Plan file**: `docs/plans/harbor-evals-for-aihub-migration.md` fully
  rewritten (committed in `a22909b`). 8 impl tasks + 5 sales_admin eval tasks.

### What's scaffolded and green (oracle path)

First task: `examples/harbor/tasks/sales-admin/sales-admin-renewals/`
- `task.toml` — allow_internet=true (forced by sidecar reachability — see below), cpus=1, mem=2048, EVAL_NOW injected.
- `tests/test_outputs.py` — 6 assertions: eval_now check, result.json status,
  finalMessage count=3, `cloudifi_admin.list_companies` was called, no
  forbidden write tools, artifact rows match expected (ids 1001/1002/1003,
  sorted by daysUntilRenewal ascending = 12/19/26).
- `tests/test.sh` — runs pytest, writes `/logs/verifier/reward.json`.
- `solution/solve.sh` — oracle: writes known-good `result.json` +
  `/app/out/renewals.json` (does NOT yet call `aihub eval run`).
- `environment/docker-compose.yaml` — main + fake-cloudifi-admin both
  attached to a `sandbox` network with `internal: true` (no egress, but
  service-to-service DNS works). See "Network gotcha" below.
- Fake sidecar: `examples/harbor/base/fakes/cloudifi-admin/` — FastAPI
  (`server.py`) implementing `/healthz`, `/auth/json`,
  `/api/2/login/refresh`, `/companies`, `/api/2/reports/subscriptions`;
  fixtures in `fixtures/companies.json` (8 companies, expected renewals =
  1001 Acme/2026-04-18, 1002 Globex/2026-04-25, 1003 Initech/2026-05-02;
  1004 Umbrella/2026-05-10 intentionally excluded to exercise the 30-day
  filter).

Oracle `harbor run` → `pass_rate = 1.0`.

### Network gotcha (resolved)

Harbor injects `network_mode: none` on `main` whenever `allow_internet=false`.
That is mutually exclusive with attaching `main` to any compose network,
so the sidecar pattern is **incompatible** with `allow_internet=false`.
Fix: `allow_internet=true` + define an `internal: true` bridge network in
`environment/docker-compose.yaml`. Sandboxing comes from network isolation
rather than from `network_mode: none`. Verified inside the trial container:
healthz/auth/companies on the sidecar all reachable; egress to
`example.com` and `1.1.1.1` blocked.

Follow-up when we wire the real LLM call: `main` will need a second
network (default bridge) for outbound LLM API access while keeping the
`sandbox` network internal-only. Multi-network attach on a single service
is fine in compose.

### Commits so far (atomic, on feature branch)

- `c60e69b chore: ignore harbor eval job artifacts` — adds `jobs/` to `.gitignore`.
- `a22909b docs(plans): harbor evals plan for strategy B` — plan rewrite.
- `41d5185 feat(evals): scaffold harbor sales-admin-renewals task` — base image,
  fake sidecar, task files, installed-agent wrapper, dataset.toml + metric.py.
- `ed43c11 fix(evals): use internal network for sidecar reachability` —
  task.toml `allow_internet=true`, compose `sandbox` network with
  `internal: true`. Re-runs oracle green (pass_rate=1.0).

### Spike B landed: `aihub eval run` CLI

`apps/gateway/src/evals/{cli,runtime,trajectory}.ts`:

- **`cli.ts`** — `aihub eval run -a <id> -i <instruction-file> [-o ...]
  [-t ...] [-c ...] [-m ...]`. Wired into `apps/gateway/src/cli/index.ts`
  via `registerEvalCommands`.
- **`runtime.ts`** — `runEval()` does the same boot sequence as
  `aihub send`: `loadConfig` → `resolveStartupConfig` →
  `initializeConnectors` → `prepareStartupConfig(rawConfig, [])` →
  `setLoadedConfig` → `runAgent()` with an `EventCollector` `onEvent`
  handler. Empty component list means **no** HTTP server, Discord,
  amsg, scheduler, heartbeat, conversations, projects, multi-user, web.
  Aggregates the stream into `EvalResult` (status, finalMessage,
  toolCalls with id/name/arguments/ok/durationMs/result, metrics,
  artifacts).
- **`trajectory.ts`** — `TrajectoryBuilder` constructs an ATIF-v1.4
  document by ingesting the same `StreamEvent`s. Coalesces consecutive
  `text` events into one `assistant_message` step. Token/cost metrics
  are zero for now (`RunAgentResult.meta` doesn't expose them yet —
  follow-up when we wire token accounting through the SDK adapters).
- **Exit contract**: `0` on a completed runtime path even if the agent
  errored (captured into `result.json`); non-zero only on infra errors
  (missing instruction file, runtime crash before `runEval` returns).
  Matches plan §2.
- **Smoke test**: with a throwaway `aihub.json` at `$AIHUB_HOME=/tmp/...`,
  `aihub eval run -a smoke -i instruction.md` boots through to
  `runAgent()`, fails with `No API key for provider: anthropic`,
  captures the error into a well-formed `result.json` + `trajectory.json`,
  and exits 0. Live LLM smoke deferred until we have an auth path inside
  the eval container.

### Next steps

1. **Fix `examples/harbor/base/aihub-eval/aihub.json`** — current schema
   is wrong (`provider`/`model` flat instead of `model: { provider, model }`,
   missing `workspace`). Trivial fix once we run the CLI inside the image.
2. **Bake the CLI into `aihub-eval-base`** — the Dockerfile currently has
   a placeholder `COPY --from=build` block. Wire it: build the gateway in
   a builder stage, copy `dist/` + `node_modules/` into the runtime stage,
   `ln -s /opt/aihub/cli/index.js /usr/local/bin/aihub`. Or simpler for the
   spike: bind-mount the workspace at run time.
3. **Add a second (external) network** to the task compose so `main` can
   reach the LLM API while still talking to `fake-cloudifi-admin` over the
   `internal: true` `sandbox` network.
4. **Swap `solve.sh`** from hand-written `result.json` to a real
   `aihub eval run --agent sales-admin --instruction-file /app/instruction.md`
   invocation.
5. **Iterate on the sales-admin agent prompt** until the verifier passes
   end-to-end against the fake sidecar.
6. Token/cost metrics: extend `RunAgentResult.meta` (or surface via
   `agentEventBus`) and pipe into `EvalResult.metrics` + ATIF
   `final_metrics`.
7. Scaffold remaining 4 sales_admin tasks.
8. Wire into CI.

## Current Status

- 2026-04-06 harbor evals spike B landed: `aihub eval run` CLI in `apps/gateway/src/evals/{cli,runtime,trajectory}.ts`. Headless single-turn entrypoint reusing the same boot path as `aihub send` (loadConfig → connectors → runAgent) with an empty component list, aggregating `StreamEvent`s into `result.json` + ATIF `trajectory.json`. Smoke-tested end-to-end against a throwaway config.
- 2026-04-06 harbor evals network fix: `sales-admin-renewals` switched to `allow_internet=true` + `internal: true` `sandbox` compose network so `main` can reach the `fake-cloudifi-admin` sidecar. Harbor's `network_mode: none` injection on `allow_internet=false` is mutually exclusive with attaching to compose networks. Oracle still green.
- 2026-04-06 web markdown dedupe follow-up landed: `AgentChat`, `TaskboardOverlay`, `ConversationThreadView` use shared `apps/web/src/lib/markdown.ts`; `SpecEditor` uses it with `breaks: false`; `ProjectsBoard` keeps its wrapper (project-specific rewrites).
- 2026-04-06 test-suite speedup landed: subagent API test seeds one reusable git repo in `beforeAll()` and copies per test; vitest `maxWorkers: 4`. Full `pnpm test` now `57.86s` (95/95 files, 728/728) vs `133.51s` before.
- 2026-04-05 PRO-214 mobile scroll fix landed: `overscroll-behavior: contain`, `touch-action: pan-y`, `-webkit-overflow-scrolling: touch`, `100dvh` mobile sidebar, `flex-shrink: 0` chat input across agents/chat/activity/areas/conversations.
- 2026-04-05 PRO-212 Discord bot dedupe landed: shared `createConfiguredDiscordBot()` factory for legacy + component-routed bots.
- 2026-04-05 PRO-212 code-quality slice landed: shared helpers for Discord flow, session-file resolution, frontmatter, web markdown/history/timestamp, ws dispatch; OpenClaw adapter aligned; session + Claude stores lazy-load via `fs.promises`.
- 2026-04-05 PRO-212 dead-code slice landed: removed `queueOrRun`, deprecated `HistoryMessage` aliases, redundant `getConfig()` / web `fetchHistory()` wrappers, unused `gatewayConfig` arg, Claude `sentTurnEnd` guard.
- 2026-04-05 PRO-212 DRY slice landed: shared `expandPath()`, network bind helpers in `packages/shared/src/network.ts`, shared `getProjectsRoot()`/`dirExists()`/`findProjectDir()`/`isMultiUserLoaded()`; web `api/types.ts` reuses shared types.
- 2026-04-05 session-store save race fix: each save now uses a unique temp file instead of reusing one `.<pid>.tmp` path.
- 2026-04-04 PRO-209 multi-user auth landed: Better Auth + SQLite behind top-level `multiUser`, `/api/auth/*`, `/api/me`, `/api/admin/*`, per-user session/history isolation, web login/admin pages, integration coverage.
- 2026-04-04 PRO-208 cleanup landed: legacy `secrets.provider="onecli"` / `$secret:` vault lookup path removed. Only native top-level `onecli` proxy wiring + `$env:` refs remain.
- 2026-04-04 PRO-208 connector slice landed: `apps/gateway/src/connectors/http-client.ts` OneCLI-aware fetch wrapper with scoped proxy/CA env, default headers/timeouts.
- 2026-04-04 PRO-211 landed: `apm create --area <area>` with validation.
- 2026-04-03 PRO-208 Phase 1 landed: native top-level `onecli` schema + scoped env builder.
- 2026-04-03 follow-ups: `aihub send` initializes connectors; connector discovery follows symlinks and defaults to `$AIHUB_HOME/connectors`; Pi adapter only mounts subagent tools when `projects` loaded; ChatView no longer reloads history on every `isStreaming` transition; all agent run failures now logged from shared runner catch.
- 2026-04-03 PRO-206 scope 1 landed: optional connector-level `systemPrompt` propagated into Pi/Claude system prompts via `getConnectorPromptsForAgent()`.
- 2026-04-03 PRO-199 review fixes + runtime integration + shared foundation landed: connector contracts, registry, loader, external discovery, Pi/Claude tool injection, startup validation.
- 2026-04-02 PRO-198 Phase 5 hardening: component `routePrefixes` metadata, resolved-config threading, static registry for server-side route guards.
- 2026-04-02 PRO-198 `apm config migrate`/`validate` CLI; migration tightened to not auto-add `components.amsg`/`components.conversations` unless legacy implied.
- 2026-04-02 PRO-198 Phase 3+4: `api.core.ts` rename, disabled-component `/api/*` guards, web capabilities store gates sidebar/routes.
- 2026-04-02 PRO-198 Phase 2a: real component wrappers for scheduler/heartbeat/amsg/conversations owning their routes.
- 2026-04-02 PRO-198 Phase 1: component contracts, v2 config schemas, `$env:`/`$secret:` resolution, `GET /api/capabilities`.
- 2026-04-02 main repo: `AgentDirectory` uses ws feed (no 5s polling).
- 2026-03-30 PRO-164 mobile responsive project detail UI landed: `<1199px` compact, `<768px` mobile tabs, touch target sizing, tablet 280px left rail.
- PRO-198 modular architecture is integrated on `space/PRO-198`.
- Local preview entrypoints honor `AIHUB_HOME`; legacy `AIHUB_CONFIG` still falls back.
- Main server `/api` mounting delegates to the live component-mutated router.

## Recent Updates (Detailed — within ~2 weeks)

### 2026-04-06: test-suite speedup

- `apps/gateway/src/subagents/subagents.api.test.ts`, `vitest.config.ts`
  - Seeded `repoTemplateDir` in `beforeAll()` and switched to `createRepoCopy()` so the suite reuses a pre-committed git fixture.
  - Re-enabled file-level parallelism with `maxWorkers: 4`.
  - `pnpm test`: 133.51s → 57.86s. No assertions removed.

### 2026-04-06: web markdown dedupe follow-up

- `AgentChat`, `TaskboardOverlay`, `ConversationThreadView` → shared `apps/web/src/lib/markdown.ts` directly.
- `SpecEditor` uses it with `breaks: false` to preserve rendering.
- `ProjectsBoard` keeps its thin wrapper (project-specific rewrite/strip).

### 2026-04-05: PRO-214 mobile web scroll isolation

- `apps/web/src/App.tsx`, `apps/web/src/components/{AgentSidebar,AgentList,ChatView,ActivityFeed,AreasOverview}.tsx`, `apps/web/src/components/conversations/ConversationsPage.tsx`
  - `overscroll-behavior: contain`, `touch-action: pan-y`, `-webkit-overflow-scrolling: touch`.
  - Mobile sidebar `100%` + `100dvh`.
  - Chat input `flex-shrink: 0`.

### 2026-04-05: PRO-212 Discord bot dedupe

- `apps/gateway/src/discord/bot.ts`: `createDiscordBot()` and `createDiscordComponentBot()` share `createConfiguredDiscordBot()`.
- `bot.test.ts`: component-bot coverage for routed + DM handling.

### 2026-04-05: PRO-212 code-quality slice

- Shared helpers: Discord flow, session file resolution, frontmatter, web markdown/history/timestamp formatting, ws event dispatch.
- OpenClaw matches object-literal adapter pattern; session + Claude stores lazy-load via `fs.promises`.

### 2026-04-05: PRO-212 dead-code cleanup slice

- Removed `queueOrRun()`, deprecated runner `HistoryMessage` alias, `config.getConfig()` / web `fetchHistory()` wrappers, unused `gatewayConfig` arg from `getConnectorPromptsForAgent()`, redundant Claude `sentTurnEnd` guard.

### 2026-04-05: PRO-212 DRY cleanup slice

- Shared `expandPath()`, `pickTailnetIPv4()`, `getTailscaleIP()`, `resolveBindHost()` in `@aihub/shared`.
- Shared gateway `getProjectsRoot()` + `dirExists()`.
- Web `api/types.ts` reuses shared history/stream/taskboard/subagent types.
- Registry mocks updated in `admin-routes.test.ts` + `status-ws.test.ts` for new `isMultiUserLoaded()` export.

### 2026-04-05: Session-store save race fix

- `apps/gateway/src/sessions/{store,claude}.ts`: each save uses a unique temp file. Added concurrent-save coverage.

### 2026-04-04: PRO-209 multi-user auth integration + docs

- `apps/gateway/src/components/multi-user/*`, `apps/web/src/auth/*`, `apps/web/src/pages/admin/*`.
- Better Auth + SQLite behind top-level `multiUser`; API/WebSocket auth guards; admin assignment APIs; per-user file isolation under `$AIHUB_HOME/users/<userId>/`.
- Web: login, guard, sidebar account/logout, `/admin/users`, `/admin/agents`.
- Integration tests for enabled/disabled modes.
- Tasks 1-8 from PRO-209 implemented; remaining: real Google OAuth smoke test.

### 2026-04-04: PRO-208 adapter wiring + docs update

- Claude + Pi adapters apply scoped OneCLI proxy/CA env per run and restore after.
- Phase 1 + Phase 2 complete; Phase 3 cleanup complete; legacy `secrets.provider="onecli"` path removed.

### 2026-04-04: PRO-208 connector HTTP client factory

- `apps/gateway/src/connectors/http-client.ts`: `createHttpClient()` with OneCLI-aware fetch, scoped proxy env, tokenized proxy URL, CA trust propagation, module-level env lock for concurrent calls.
- Coverage in `__tests__/http-client.test.ts`.

### 2026-04-04: PRO-211 apm create area validation

- `ApiClient.listAreas()`, `apm create --area <area>`, validated against current ids.

### 2026-04-03: PRO-208 OneCLI Phase 1 foundation

- `OnecliCaConfigSchema`, `OnecliAgentConfigSchema`, `OnecliConfigSchema`, top-level `GatewayConfigSchema.onecli`.
- `buildOnecliEnv(config, agentId)` derives proxy + CA env.

### 2026-04-03: PRO-206 connector tool knowledge injection scope 1

- Optional connector-level `systemPrompt` in shared contract.
- `getConnectorPromptsForAgent()` appended to Pi + Claude system prompts.

### 2026-04-03: PRO-199 connector review fixes + runtime integration + shared foundation

- Shared: connector contracts, Zod runtime schemas, in-memory registry, config merge + tool loader with name namespacing, external discovery.
- Gateway: startup discovery + validation, required-secret checks, Pi custom tools + Claude MCP mounts, Zod → JSON Schema for Pi.
- `ConnectorTool.parameters` narrowed to object-shaped Zod.
- Shared `connectors` + per-agent `agent.connectors` config schemas.

### 2026-04-03: follow-ups

- `aihub send` resolves startup config + initializes connectors before running an agent.
- External connector discovery follows symlinks; defaults to `$AIHUB_HOME/connectors`.
- Pi adapter only mounts subagent tools when `projects` component is loaded.
- `ChatView` no longer reloads history on every `isStreaming` transition.
- Gateway logs all agent run failures from shared runner catch.

### 2026-04-02: PRO-198 modular architecture Phase 5 hardening

- Shared `Component.routePrefixes`, static registry metadata for route guards without eager component imports.
- Startup preparation resolves `$env:` / `$secret:` once; `ComponentContext.getConfig()` exposes resolved values.
- Server `/api` disabled-component matcher rebuilt from static metadata.

### 2026-04-02: PRO-198 `apm config migrate` / `validate` CLI

- Pure v1 → v2 migration helper moved into `@aihub/shared`.
- `apm config migrate [--dry-run]` + `apm config validate`.
- `--config` > `$AIHUB_HOME/aihub.json` (default `~/.aihub/aihub.json`); deprecated `AIHUB_CONFIG` fallback.
- Migration does not auto-add `components.amsg` / `components.conversations` unless implied.

### 2026-04-02: PRO-198 Phase 3 + Phase 4

- `api.ts` → `api.core.ts`; removed temporary projects compat mount.
- `/api/*` disabled-component guards → `404 { error: "component_disabled", component }`.
- Web: capabilities store from `/api/capabilities`, sidebar + routes gate on it; `/`, `/projects`, `/conversations` lazy-load component bundles.

### 2026-04-02: PRO-198 Phase 2a simple components

- Real wrappers for scheduler (`/schedules` CRUD), heartbeat (`/agents/:id/heartbeat`), amsg, conversations (listing/detail/message/attachment/project-creation).

### 2026-04-02: PRO-198 Phase 1 foundation

- Shared component contracts + v2 config schemas.
- v1 → v2 runtime migration with warnings; `$env:` / `$secret:` resolvers.
- Lazy component registry + Phase 1 stubs; projects watcher moved into projects component.
- `GET /api/capabilities`; CLI loads → validates → registers routes → starts/stops components.

### 2026-03-30: PRO-164 mobile responsive project detail UI

- `apps/web/src/components/project/ProjectDetailPage.tsx`: `isMobile` @ 768px; compact layout @ 1199px; mobile tabs `Overview/Chat/Activity/Changes/Spec`; `AgentPanel` in mobile Overview; breadcrumb truncation; tablet 280px left rail.
- `AgentPanel.tsx`: mobile row padding + touch targets.

## Older History (Compressed — >2 weeks old)

### 2026-03-13 → 2026-03-22

- SPECS checklist collapse toggle landed (one shared Tasks + Acceptance Criteria collapse).
- Areas homepage quick-create + native color picker; `createArea()` client method.
- Codex `gpt-5.4` added across run-prep UI, CLI validation, gateway server validation.

### 2026-03-09 → 2026-03-12

- PRO-162: Areas overview homepage at `/` with per-area cards, per-status counts, filtered kanban at `/projects?area=<id>`.
- PRO-168: right sidebar `ACTIVE PROJECTS` (replaces `SUBAGENTS`), sorted by recent activity.
- PRO-155: Quick lead-agent chat overlay (FAB + overlay) with unread pulse and persisted last-agent.
- PRO-169: silent `apm exec` diagnostics surfaced — empty shell outputs now emit warning with remediation hint; coordinator prompt got preflight `apm` guidance.

### 2026-03-07 → 2026-03-08

- PRO-174 Space per-entry skip/integrate + delivery `replaces` auto-skip; conflict-fix resume path uses `replaces`.
- PRO-174 frontend: `Rebase on main` + `Fix rebase conflict` space-level controls.

### 2026-03-04 → 2026-03-06

- PRO-170: resume semantics delta-only (no project corpus reinjection), resume/start prompt-size guardrails (32KB / 256KB).
- Space merge-to-main backend + cleanup (`POST /api/projects/:id/space/merge`).
- PRO-166: conflict-fix resumes original worker (in-place conflict entry update).
- PRO-163 Fix 4: subagent post-creation model/config PATCH + `apm rename` + UI selector.
- Coordinator prompt: must dispatch `reviewer` template for review work.
- Inline rename Space-key fix in project agent list.

### 2026-03-03

- Subagent chat remount + stale-poll race hardening; loading flicker fix; realtime fallback polling; Stop/interrupt UX (disabled `Stopping...` + `interrupt_requested_at`).
- Project watcher ID normalization (`PRO-159_slug` → `PRO-159`).
- Project detail stale accessor + selection override fix.
- Prompt/template guardrails: template-locked overrides require `--allow-template-overrides`; worker commits required.
- Spawn form + chat/detail regressions (worktree path preview, controlled tab, long-line overflow).
- Realtime web subscriptions for `file_changed` / `agent_changed`; activity timeline compression; branch diff per-file expand.
- Routing/sidebar fixes; recents from view history; `apm start --template` omits locked fields unless override.

### 2026-03-02

- Worker template worktrees default to `space/<projectId>`.
- Template-based spawn flow + coordinator/worker/reviewer prompt semantics.
- Project detail chat Stop flow (`/abort` lead, interrupt API subagents).
- `SPECS.md` parsing + subsection support.
- Coordinator context injection (main repo + Space path); area-repo fallback.

### 2026-03-01

- Space-first architecture (`space.ts`, queue/integrate/conflict paths, Space-aware changes API).
- Project-detail spawn templates + run-mode `none`; spawn prep moved into center panel.
- CLI harness set consolidated to `claude|codex|pi`.
- Homepage shell/nav/sidebar structure; project detail left/center/right.
- Light/dark theme with global CSS vars.

### 2026-02-28 and earlier

- Projects API/CLI foundations, Kanban board, project detail page, spec editor, task parsing, agent/subagent monitoring, activity feed/chat integration.
- Supporting infra: areas/tasks hierarchy, multi-file project docs, attachments, OpenClaw integration, subagent kill flow, realtime status events, soft-delete, dev helpers.

## Known Risks / Follow-up

- Vitest invocation still tends to run broad suites in this repo config; keep serial runs to avoid transient test flake.
- Realtime correctness depends on watcher/event consistency; if stale UI appears, verify `state.json` write + websocket `agent_changed` path first.
- Continue enforcing template-lock boundaries to prevent CLI/UI drift.
- Harbor eval sandbox has no docker — always ask the user to run `harbor run` and share `jobs/<latest>/.../oracle.txt` output.
