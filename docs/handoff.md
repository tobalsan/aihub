# Hand-off

Date: 2026-04-02
Repo: `/Users/thinh/projects/.workspaces/PRO-198/_space`

## Current Status

- 2026-04-05 PRO-214 mobile scroll fix landed: mobile shell/content scroll is now isolated in the web UI via `overscroll-behavior: contain`, `touch-action: pan-y`, `-webkit-overflow-scrolling: touch`, `left-nav-main` overflow isolation, chat input `flex-shrink: 0`, and mobile sidebar `100dvh` sizing across agents/chat/activity/areas/conversations.
- 2026-04-05 PRO-212 dead-code slice landed: removed unused `queueOrRun`, deprecated `HistoryMessage` aliases, redundant `config.getConfig()` / web `fetchHistory()` wrappers, the unused `gatewayConfig` arg from `getConnectorPromptsForAgent()`, and the redundant Claude `sentTurnEnd` guard. Verification passed with `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
- 2026-04-04 PRO-209 multi-user auth landed: Better Auth + SQLite is now integrated behind top-level `multiUser`, with `/api/auth/*`, `/api/me`, `/api/admin/*`, per-user session/history isolation under `$AIHUB_HOME/users/<userId>/`, web login/admin pages, integration coverage for enabled/disabled modes, and docs updates across `README.md` + `docs/llms.md`.
- 2026-04-04 PRO-208 cleanup landed: legacy `secrets.provider="onecli"` / `$secret:` vault lookup path is removed. Config/runtime/docs now only support native top-level `onecli` proxy wiring plus `$env:` config refs. Current status: Phase 3 cleanup complete; remaining follow-up is CA file existence validation in schema.
- 2026-04-04 PRO-208 connector slice landed: `apps/gateway/src/connectors/http-client.ts` now provides a OneCLI-aware fetch wrapper for connectors, including scoped proxy/CA env injection plus default header/timeout handling. Connector adoption is still follow-up work.
- 2026-04-03 PRO-208 Phase 1 landed: shared config now has a native top-level `onecli` schema, and `apps/gateway/src/config/onecli.ts` adds a scoped env builder for proxy + CA wiring.
- 2026-04-03 follow-up: `aihub send` now resolves startup config and initializes connectors before running an agent, so connector tools/system prompts are available on the standalone CLI path and connector config errors fail early there too.
- 2026-04-03 follow-up: external connector discovery now follows symlinked connector directories too, which fixes setups that mount built connector bundles into `$AIHUB_HOME/connectors` via symlink.
- 2026-04-03 follow-up: external connector auto-discovery now defaults to `$AIHUB_HOME/connectors` instead of hard-coding `~/.aihub/connectors`, so connector system-prompt/tool injection works when running against a custom config home.
- 2026-04-03 PRO-206 scope 1 landed: connector definitions now support optional `systemPrompt`, gateway exposes `getConnectorPromptsForAgent()`, and both Pi/Claude adapters append enabled connector guidance into their system prompts.
- 2026-04-03 follow-up: Pi adapter now only mounts subagent tools and appends the `Additional tools` system-prompt block when the `projects` component is actually loaded. Non-project setups no longer advertise unavailable subagent capabilities in Pi system prompt/tooling.
- 2026-04-03 follow-up: ChatView no longer reloads history on every `isStreaming` transition. That fixes silent failed sends where the optimistic user message disappeared and no inline error remained; full-mode chat now appends error text on stream failure too.
- 2026-04-03 follow-up: gateway now logs all agent run failures from the shared runner catch, not just Pi post-prompt `stopReason:error` failures. This covers config/model-resolution errors like missing custom provider models.
- PRO-199 review follow-up landed on 2026-04-03: connector startup validation now emits unknown-connector warnings once from `initializeConnectors()`, and shared connector tool params are explicitly object-shaped Zod schemas to match both adapters.
- PRO-199 gateway connector runtime integration is in place on 2026-04-03: startup discovery/validation, per-agent tool loading, and Pi/Claude adapter injection landed in `apps/gateway`.
- PRO-199 shared connector foundation is in place on 2026-04-03: shared connector contracts, registry, loader, discovery, config schema updates, and unit coverage landed in `packages/shared`.
- Main repo follow-up on 2026-04-02: `AgentDirectory` no longer force-refetches projects/subagents every 5s; it now refreshes from the existing file/agent websocket feed to avoid visible shell-wide UI churn.

- PRO-198 modular architecture is integrated on `space/PRO-198`.
- Gateway/runtime now support v2 modular components with resolved-config threading and component-declared disabled-route metadata.
- Recent follow-up work tightened `apm config migrate` so it does not auto-add `components.amsg` or `components.conversations` unless legacy config explicitly implied them.
- Local preview entrypoints now honor `AIHUB_HOME`, so `pnpm dev`/`pnpm dev:web` use the same config home as gateway local-config commands. Legacy `AIHUB_CONFIG` still falls back by deriving the home directory from its parent path.
- Main server `/api` mounting now delegates to the live component-mutated router, fixing dev/runtime 404s where capabilities showed enabled components but their routes were unreachable.

## Recent Updates (Detailed)

### 2026-04-05: PRO-214 mobile web scroll isolation

- `apps/web/src/App.tsx`, `apps/web/src/components/{AgentSidebar,AgentList,ChatView,ActivityFeed,AreasOverview}.tsx`, `apps/web/src/components/conversations/ConversationsPage.tsx`
  - Added scroll isolation on the shared left-nav shell/content and all affected mobile scroll containers with `overscroll-behavior: contain`, `touch-action: pan-y`, and `-webkit-overflow-scrolling: touch`.
  - Switched the mobile sidebar from `100vh` to `height: 100%; height: 100dvh;` to avoid browser-chrome-induced layout shift.
  - Set chat input area `flex-shrink: 0` so the composer stays stable at small viewport heights.
- Verification:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test -- apps/web`
  - `pnpm --filter @aihub/web build`

### 2026-04-05: PRO-212 dead-code cleanup slice

- `apps/gateway/src/agents/runner.ts`, `apps/gateway/src/index.ts`
  - Removed the unused `queueOrRun()` wrapper and the deprecated runner `HistoryMessage` alias.
- `apps/gateway/src/config/index.ts`, `apps/gateway/src/components/conversations/index.ts`, `apps/gateway/src/components/projects/index.ts`, `apps/gateway/src/sdk/*`, `apps/gateway/src/subagents/tool_handlers.ts`
  - Removed the redundant `getConfig()` alias and updated direct callers to use `loadConfig()`.
- `apps/web/src/api/client.ts`, `apps/web/src/api/types.ts`
  - Removed deprecated `fetchHistory()` and the unused web `HistoryMessage` alias.
- `apps/gateway/src/connectors/index.ts`, `apps/gateway/src/connectors/index.test.ts`, `apps/gateway/src/__tests__/connectors.test.ts`, `apps/gateway/src/sdk/claude/adapter.ts`
  - Dropped the unused `gatewayConfig` arg from `getConnectorPromptsForAgent()` and removed the redundant `sentTurnEnd` guard in Claude adapter.
- Verification:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`

### 2026-04-04: PRO-209 multi-user auth integration + docs

- `apps/gateway/src/components/multi-user/*`, `apps/web/src/auth/*`, `apps/web/src/pages/admin/*`
  - Gateway now supports optional Better Auth + SQLite multi-user mode with API/WebSocket auth guards, admin assignment APIs, and per-user file isolation.
  - Web now exposes login, auth guard, sidebar account/logout UI, `/admin/users`, and `/admin/agents`.
- `apps/gateway/src/components/multi-user/integration.test.ts`
  - Added end-to-end component lifecycle coverage for enabled mode (`/api/auth/ok`, SQLite creation, `agent_assignments` table, protected-route 401s) plus disabled-mode regression coverage (no DB, core APIs still unauthenticated).
- Docs:
  - Updated `docs/llms.md` and `README.md` with config, auth flow, API, UI, and fresh-start notes.
- Status:
  - Tasks 1-8 from PRO-209 are implemented.
  - Remaining external validation is a real Google OAuth smoke test with live credentials if needed.

### 2026-04-04: PRO-208 adapter wiring + docs update

- `apps/gateway/src/sdk/claude/adapter.ts`, `apps/gateway/src/sdk/pi/adapter.ts`
  - Claude and Pi runs now apply scoped OneCLI proxy env vars and CA trust env vars from the native `onecli` config and restore prior process env after each run.
- Docs:
  - Updated `README.md` and `docs/llms.md` to describe native `onecli` as the primary gateway/proxy integration path, per-agent gateway tokens, CA trust wiring, adapter support, and connector HTTP client support.
- Status:
  - Phase 1 foundation complete.
  - Phase 2 adapter/runtime plumbing complete.
  - Remaining follow-up: migrate concrete connectors onto the shared HTTP client where needed, then remove the deprecated secret lookup path in Phase 3.

### 2026-04-04: PRO-208 connector HTTP client factory

- `apps/gateway/src/connectors/http-client.ts`
  - Added `createHttpClient()` for connector-scoped `fetch()` calls with optional default headers and timeout handling.
  - OneCLI-enabled clients temporarily inject proxy env vars, embed per-client gateway token into the proxy URL, propagate CA trust env vars, and restore the previous process env after each request.
  - Serialized OneCLI-wrapped requests with a module-level env lock so concurrent connector calls do not cross-contaminate proxy env state.
- `apps/gateway/src/connectors/__tests__/http-client.test.ts`
  - Added coverage for plain fetch passthrough, scoped proxy env mutation/restoration, tokenized proxy URLs, CA env propagation, and header/timeout merging.
- Docs:
  - Updated `README.md` and `docs/llms.md`.
- Verification:
  - `pnpm test -- apps/gateway/src/connectors`
  - `pnpm typecheck`
  - `pnpm exec eslint apps/gateway/src/connectors/http-client.ts apps/gateway/src/connectors/__tests__/http-client.test.ts`

### 2026-04-03: PRO-208 OneCLI Phase 1 foundation

- `packages/shared/src/types.ts`, `apps/gateway/src/config/onecli.ts`
  - Added `OnecliCaConfigSchema`, `OnecliAgentConfigSchema`, `OnecliConfigSchema`, and top-level `GatewayConfigSchema.onecli`.
  - Added `buildOnecliEnv(config, agentId)` to derive proxy env vars plus optional CA trust env vars from resolved gateway config.
- `apps/gateway/src/config/__tests__/onecli.test.ts`
  - Added coverage for env builder null/enabled/token/CA cases and OneCLI schema defaults/validation.
- Docs:
  - Updated `README.md` and `docs/llms.md`.
- Verification:
  - `pnpm test -- apps/gateway/src/config`
  - `pnpm exec vitest run apps/gateway/src/config/__tests__/onecli.test.ts apps/gateway/src/config/__tests__/secrets.test.ts apps/gateway/src/config/__tests__/index.test.ts apps/gateway/src/config/__tests__/validate.test.ts apps/gateway/src/config/config.test.ts apps/gateway/src/config/__tests__/migrate.test.ts`
  - `pnpm typecheck`
  - `pnpm exec eslint packages/shared/src/types.ts apps/gateway/src/config/index.ts apps/gateway/src/config/secrets.ts apps/gateway/src/config/onecli.ts apps/gateway/src/config/__tests__/onecli.test.ts`

### 2026-04-03: PRO-206 connector tool knowledge injection scope 1

- `packages/shared/src/connectors/types.ts`
  - Added optional connector-level `systemPrompt` to the shared connector contract and runtime schema.
- `apps/gateway/src/connectors/index.ts`, `apps/gateway/src/connectors/index.test.ts`
  - Added `getConnectorPromptsForAgent()` and focused coverage for enabled/disabled/no-prompt/no-config cases.
- `apps/gateway/src/sdk/pi/adapter.ts`, `apps/gateway/src/sdk/claude/adapter.ts`
  - Appended enabled connector prompt guidance into both adapter system prompts alongside existing built-in prompt additions.
- Docs:
  - Updated `README.md` and `docs/llms.md`.
- Verification:
  - `pnpm test -- apps/gateway/src/connectors/index.test.ts`
  - `pnpm test -- apps/gateway`
  - `pnpm lint`
  - `pnpm typecheck`

### 2026-04-03: PRO-199 connector review fixes

- `apps/gateway/src/connectors/index.ts`, `apps/gateway/src/config/validate.ts`
  - Centralized connector startup validation in `initializeConnectors()` so unknown connector warnings emit once and config/secret failures still stop startup early.
- `packages/shared/src/connectors/types.ts`
  - Narrowed `ConnectorTool.parameters` from any Zod schema to object-shaped Zod schemas to match Pi JSON Schema conversion and Claude MCP mounting.
- `packages/shared/src/__tests__/connectors.test.ts`, `apps/gateway/src/config/__tests__/validate.test.ts`
  - Added schema coverage for object-only connector params and moved startup missing-secret coverage onto real external discovery instead of in-memory registry state.
- Docs:
  - Updated `README.md` and `docs/llms.md`.
- Verification:
  - `pnpm test -- packages/shared`
  - `pnpm test -- apps/gateway`
  - `pnpm lint`
  - `pnpm typecheck`

### 2026-04-03: PRO-199 gateway connector runtime integration

- `apps/gateway/src/connectors/index.ts`, `apps/gateway/src/config/validate.ts`, `apps/gateway/src/cli/index.ts`
  - Added gateway connector initialization with external discovery, startup validation, missing-connector warnings, and required-secret checks.
  - Wired connector init into gateway startup after secret resolution and before component loading.
- `apps/gateway/src/sdk/pi/adapter.ts`, `apps/gateway/src/sdk/claude/adapter.ts`, `apps/gateway/package.json`
  - Injected connector tools into Pi custom tools and Claude MCP tool mounts.
  - Added Zod-to-JSON-Schema conversion for Pi connector tools.
- `apps/gateway/src/__tests__/connectors.test.ts`, `apps/gateway/src/config/__tests__/validate.test.ts`
  - Added gateway connector loading and startup validation coverage.
- Docs:
  - Updated `README.md` and `docs/llms.md`.
- Verification:
  - `pnpm exec vitest run apps/gateway/src/__tests__/connectors.test.ts apps/gateway/src/config/__tests__/validate.test.ts`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm build`
  - `pnpm test -- apps/gateway`

### 2026-04-03: PRO-199 shared connector foundation

- `packages/shared/src/connectors/*`, `packages/shared/src/types.ts`, `packages/shared/src/index.ts`
  - Added connector contracts plus Zod-backed runtime schemas.
  - Added in-memory connector registry.
  - Added config merge + tool loading helpers with tool-name namespacing.
  - Added external connector discovery from directory subfolders with non-fatal warning logs for invalid modules.
  - Extended shared config schemas with root-level `connectors` and per-agent `agent.connectors`.
- `packages/shared/src/__tests__/connectors.test.ts`
  - Added coverage for registry override behavior, config merge/load flow, validation failures, external discovery, schema acceptance, and migration behavior when `connectors` is absent.
- Docs:
  - Updated `README.md` and `docs/llms.md`.
- Verification:
  - `pnpm test`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm build`

### 2026-04-02: PRO-198 modular architecture Phase 5 hardening

- `packages/shared/src/types.ts`, `apps/gateway/src/components/*`, `apps/gateway/src/components/registry.ts`
  - Extended the shared component contract with `routePrefixes`.
  - Added route metadata to route-owning components and exposed static registry metadata for server-side route guard construction without eager component imports.
- `apps/gateway/src/config/index.ts`, `apps/gateway/src/config/validate.ts`, `apps/gateway/src/cli/index.ts`
  - Added startup preparation that resolves `$env:` / `$secret:` refs once, then stores the resolved config as the runtime config.
  - `ComponentContext.getConfig()` now exposes resolved values during component startup/runtime.
  - Discord component startup no longer performs ad hoc token resolution.
- `apps/gateway/src/server/index.ts`
  - Replaced the hardcoded disabled-component route matcher list with middleware built from static component route metadata.
  - Kept disabled components lazy by avoiding eager component imports during server boot.
- Tests:
  - Added coverage for resolved runtime config and registry route metadata.
  - Updated Discord component tests to assert resolved-config consumption.
- Docs:
  - Updated `README.md` and `docs/llms.md`.
  - Follow-up on 2026-04-02: `README.md` now has a dedicated built-in components section with short explanations for `discord`, `scheduler`, `heartbeat`, `amsg`, `conversations`, and `projects`.
- Verification:
  - `pnpm test -- apps/gateway/src/server/component-disabled.api.test.ts` (repo-wide Vitest run: `71/71` files, `622/622` tests)
  - `pnpm build`
  - `pnpm lint`

### 2026-04-02: PRO-198 apm config migrate/validate CLI

- `packages/shared/src/config-migrate.ts`, `apps/gateway/src/config/migrate.ts`
  - Moved the pure v1 -> v2 migration helper into `@aihub/shared` so gateway and `apm` reuse the same logic.
- `packages/cli/src/local-config.ts`, `packages/cli/src/index.ts`
  - Added local config path resolution with `--config` > `$AIHUB_HOME/aihub.json` (default `~/.aihub/aihub.json`), with deprecated `AIHUB_CONFIG` fallback deriving the home directory from the legacy file path.
  - Added `apm config migrate [--dry-run]` to preview or apply migration with backup creation.
  - Added `apm config validate` to parse current config, auto-migrate legacy v1 in-memory for validation, and print agent/component summary.
  - Follow-up on 2026-04-02: tightened migration so it does not auto-add `components.amsg` when legacy `agent.amsg` is absent, and does not auto-add `components.conversations` by default.
- `packages/cli/src/config.commands.test.ts`
  - Added coverage for dry-run output, persisted migration + backup, and validate output.
- Docs:
  - Updated `README.md` and `docs/llms.md`.
- Verification:
  - `pnpm test -- packages/cli/src/config.commands.test.ts` (repo-wide Vitest run: `71/71` files, `620/620` tests)
  - `pnpm build`
  - `pnpm lint`

### 2026-04-04: PRO-211 apm create area validation

- `packages/cli/src/client.ts`, `packages/cli/src/index.ts`
  - Added `ApiClient.listAreas()` for `GET /api/areas`.
  - Added `apm create --area <area>`.
  - Validates `--area` against current area ids before project creation and prints valid ids on error.
- `packages/cli/src/index.create.test.ts`
  - Added coverage for valid and invalid `apm create --area` flows.
- Docs:
  - Updated `README.md` and `docs/cli-apm.md`.

### 2026-04-02: PRO-198 modular architecture Phase 3 + Phase 4

- `apps/gateway/src/server/api.core.ts`, `apps/gateway/src/server/index.ts`, `apps/gateway/src/cli/index.ts`
  - Renamed the core route module from `api.ts` to `api.core.ts`.
  - Removed the temporary projects compatibility mount from the core API.
  - Added `/api/*` disabled-component guards that return `404 { error: "component_disabled", component }` for known component route prefixes.
- `apps/web/src/lib/capabilities.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/AgentSidebar.tsx`, `apps/web/src/api/client.ts`
  - Added a shared capabilities store fetched from `/api/capabilities` on boot.
  - Sidebar now hides `Projects` and `Conversations` when those components are disabled.
  - `/`, `/projects`, and `/conversations` now gate on capabilities and lazy-load component-owned route bundles only when enabled.
- Tests:
  - Updated API route tests to register component routes explicitly against `api.core`.
  - Added disabled-component server coverage and sidebar/client capabilities coverage.

### 2026-04-02: PRO-198 modular architecture Phase 2a simple components

- `apps/gateway/src/components/scheduler/index.ts`, `apps/gateway/src/components/heartbeat/index.ts`, `apps/gateway/src/components/amsg/index.ts`, `apps/gateway/src/components/conversations/index.ts`
  - Replaced Phase 1 stubs with real component wrappers for scheduler, heartbeat, amsg, and conversations.
  - Scheduler now owns `/schedules` CRUD route registration.
  - Heartbeat now owns `POST /api/agents/:id/heartbeat`.
  - Conversations now own listing/detail/message/attachment/project-creation routes.
- `apps/gateway/src/server/api.ts`
  - Removed extracted scheduler, heartbeat, and conversations route handlers from the core API module.
- `apps/gateway/src/conversations/conversations.api.test.ts`
  - Updated the test harness to use v2 config and explicitly register loaded component routes before exercising conversation endpoints.
- Verification:
  - `pnpm test -- apps/gateway/src/conversations/conversations.api.test.ts` (repo ran broad vitest suite; passing)
  - `pnpm build`
  - `pnpm lint`

### 2026-04-02: PRO-198 modular architecture Phase 1 foundation

- `packages/shared/src/types.ts`, `packages/shared/src/__tests__/component-types.test.ts`, `packages/shared/src/__tests__/config-v2.test.ts`
  - Added component contracts (`Component`, `ComponentContext`, `ValidationResult`).
  - Added v2 config schemas for `version`, `secrets`, `components`, and capabilities response payload.
- `apps/gateway/src/config/index.ts`, `apps/gateway/src/config/secrets.ts`, `apps/gateway/src/config/migrate.ts`, `apps/gateway/src/config/validate.ts`
  - Added legacy v1 -> v2 runtime migration with warnings.
  - Added `$env:` and `$secret:` resolution helpers.
  - Added startup validation for duplicate agent ids, component config validity, agent references, and summary logging.
- `apps/gateway/src/components/*`, `apps/gateway/src/components/registry.ts`
  - Added lazy component registry and Phase 1 stub components for `discord`, `scheduler`, `heartbeat`, `amsg`, `conversations`, `projects`.
  - Moved project watcher ownership out of `server/index.ts` into the projects component stub.
- `apps/gateway/src/server/api.ts`, `apps/gateway/src/server/capabilities.api.test.ts`, `apps/gateway/src/cli/index.ts`
  - Added `GET /api/capabilities`.
  - CLI now loads components, validates startup, registers routes, starts components in order, and stops them in reverse order.
- Verification:
  - `pnpm test -- packages/shared/src/__tests__/component-types.test.ts` (repo runs broad vitest suite; passed)
  - `pnpm build`
  - `pnpm lint`

### 2026-03-30: PRO-164 mobile responsive project detail UI

- `apps/web/src/components/project/ProjectDetailPage.tsx`
  - Added local `isMobile` breakpoint state at `768px` and lowered compact layout activation to `1199px`.
  - Added mobile-only single-column tabs: `Overview`, `Chat`, `Activity`, `Changes`, `Spec`.
  - Moved `AgentPanel` into the mobile `Overview` tab and kept desktop/tablet split behavior intact.
  - Added mobile breadcrumb truncation/scroll handling and touch-target sizing.
  - Added tablet rule for a fixed `280px` left rail between `769px` and `1199px`.
- `apps/web/src/components/project/AgentPanel.tsx`
  - Increased mobile agent row padding and action button size for touch use.
- Tests:
  - Updated `apps/web/src/components/project/ProjectDetailPage.test.tsx` with deterministic breakpoint mocking and mobile layout coverage.
- Docs:
  - Updated `README.md` and `docs/llms.md`
- Verification:
  - `pnpm test -- apps/web/src/components/project/ProjectDetailPage.test.tsx`
  - `pnpm build`
  - `pnpm lint`
  - `pnpm typecheck`

### 2026-03-13: SPECS checklist collapse toggle

- `apps/web/src/components/project/SpecEditor.tsx`
  - Added one lower-pane toggle that collapses/expands both Tasks and Acceptance Criteria together.
  - Collapsed state shrinks the checklist pane to an auto-height summary row so the markdown preview/editor gets more vertical space.
- `apps/web/src/components/project/SpecEditor.test.tsx`
  - Added coverage for the shared collapse/expand behavior.
- Docs:
  - Updated `README.md` and `docs/llms.md`

### 2026-03-13: Areas homepage quick-create + native color picker

- `apps/web/src/components/AreasOverview.tsx`
  - Added quick area creation from the Areas homepage via header/empty-state `Add area`.
  - Creation happens inline as a card with slugified `id` preview from `title`, native color picker, optional repo path, and in-place area list update after success.
- `apps/web/src/components/AreaEditForm.tsx`
  - Replaced the color text input with `input[type="color"]`.
- `apps/web/src/api/client.ts`
  - Added `createArea(payload)` for `POST /api/areas`.
- Tests:
  - Added `apps/web/src/components/AreasOverview.test.tsx`
  - Added `apps/web/src/components/AreaEditForm.test.tsx`
  - Extended `apps/web/src/api/client.test.ts`
- Docs:
  - Updated `README.md` and `docs/llms.md`

### 2026-03-10: Codex `gpt-5.4` added to run preparation + CLI model validation

- `apps/web/src/components/project/SpawnForm.tsx`
  - Added `gpt-5.4` to Codex model options in the run preparation form.
- `apps/web/src/components/project/AgentPanel.tsx`
  - Added `gpt-5.4` to the editable Codex model list for idle subagents.
- `apps/web/src/components/AgentChat.tsx`
  - Added a context window entry for `gpt-5.4`.
- `packages/cli/src/index.ts`
  - Added `gpt-5.4` to `apm start` Codex model validation/mapping.
- `apps/gateway/src/server/api.ts`
  - Added `gpt-5.4` to server-side Codex model validation for subagent/project runs.
- `packages/cli/src/index.start.test.ts`
  - Added CLI mapping coverage for `gpt-5.4`.
- Docs:
  - Updated `docs/llms.md` and `docs/cli-apm.md` Codex model lists.

### 2026-03-09: PRO-162 areas overview homepage + filtered kanban

- `apps/web/src/components/AreasOverview.tsx` (new)
  - Added new homepage grid at `/` with:
    - one card per area
    - aggregate "All Projects" card
    - per-status project count chips (skip zero counts)
    - empty/loading/error states
- `apps/web/src/components/AreaCard.tsx` (new)
  - Added area card UI with:
    - title link to `/projects?area=<id>`
    - repo path display
    - inline edit toggle
- `apps/web/src/components/AreaEditForm.tsx` (new)
  - Added inline edit form for `title`, `color`, `order`, `repo`.
- `apps/web/src/App.tsx`
  - Root route now renders Areas overview shell (`/`).
  - Legacy kanban remains at `/projects/:id?`.
- `apps/web/src/components/ProjectsBoard.tsx`
  - Added `?area=<id>` query filtering.
  - Header now shows area context and `Back to Areas` link when filtered.
- `apps/web/src/api/client.ts`
  - Added `updateArea(id, patch)`.
  - `fetchProjects(area?)` now supports optional area query.
- `apps/gateway/src/server/api.ts`, `apps/gateway/src/projects/store.ts`
  - Added backend support for `GET /api/projects?area=<id>` filtering.
- Tests:
  - `apps/web/src/api/client.test.ts` coverage for area patch + project area query.
  - `apps/gateway/src/projects/projects.api.test.ts` coverage for `?area=` filtering.
  - Updated ProjectsBoard test mocks to include `fetchAreas`.
- Docs:
  - Updated `README.md` + `docs/llms.md` route/navigation notes for Areas homepage and filtered kanban.

### 2026-03-09: PRO-168 active projects in right sidebar Agents tab

- `apps/web/src/components/AgentDirectory.tsx`
  - Kept `LEAD AGENTS` section unchanged.
  - Replaced `SUBAGENTS` section with `ACTIVE PROJECTS`.
  - Added `fetchProjects()` resource and combined it with global subagent status data.
  - Active project criteria:
    - at least one subagent has `status === "running"`
  - Project rows are ordered by most recent `lastActive` timestamp.
  - Each row now shows project id/title, status indicator (running/idle/error), and relative last-activity time.
  - Clicking a project row calls `onOpenProject(projectId)` to navigate to project detail.
- `apps/web/src/components/ContextPanel.tsx`
  - Passed `onOpenProject` through to `AgentDirectory`.
- `apps/web/src/components/AgentDirectory.test.tsx`
  - Reworked tests to cover:
    - lead-agent section/status still rendering
    - active-project filtering (running only, regardless of project status)
    - recency ordering
    - project row click navigation callback

### 2026-03-09: PRO-155 quick lead-agent access overlay

- `apps/web/src/App.tsx`
  - Added app-level quick chat state and mounting in `Layout` so it persists across route navigation.
  - Wired `fetchAgents` default selection + localStorage persistence (`aihub:quick-chat-last-agent`).
  - Added global Escape handling to close overlay.
  - Added background `subscribeToSession` unread tracking for pulse indicator when overlay is closed.
- `apps/web/src/components/QuickChatFAB.tsx`
  - New bottom-right floating trigger (`48x48`, fixed, z-index `800`) with unread pulse/glow state.
- `apps/web/src/components/QuickChatOverlay.tsx`
  - New overlay panel (`~380x520` desktop, full-screen mobile at `<=768px`) with:
    - Header avatar + lead-agent picker dropdown
    - Minimize + close controls
    - Embedded `AgentChat` (lead mode) reusing existing message rendering, SSE streaming, and file/image attachments.
- Tests:
  - Added `apps/web/src/components/QuickChatOverlay.test.tsx`
  - Added `apps/web/src/components/QuickChatFAB.test.tsx`
- Docs:
  - Updated `README.md` and `docs/llms.md` navigation/features notes for the new quick chat overlay.
- Verification:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test` (57 files, 552 tests passed)

### 2026-03-09: Silent `apm exec` diagnostics surfaced for subagents (PRO-169)

- `apps/gateway/src/subagents/index.ts`
  - Added shell-result normalization for `exec_command`/`bash` runs.
  - When a shell tool output payload is structurally empty (`stdout=""`, `stderr=""`, `is_error=false`) and command is known, gateway now emits a `warning` log event with:
    - original command
    - remediation hint (`command -v apm && apm --version`, then retry with `apm ...` or `pnpm apm ...`)
- `packages/shared/src/projectPrompt.ts`
  - Coordinator delegation instructions now include path-agnostic `apm` preflight guidance before template dispatch.
- `apps/web/src/components/AgentChat.tsx`
  - Added warning tone/icon handling for `warning` log events.
  - Shell tool cards now show `No output captured` warning state instead of muted/blank success when output is empty.
- `apps/web/src/components/ProjectsBoard.tsx`
  - Applied same shell-card warning behavior + warning tone/icon mapping in project monitoring logs.
- Tests:
  - Added `apps/gateway/src/subagents/index.test.ts` for empty-shell diagnostic emission and non-empty guard case.
  - Extended `apps/web/src/components/AgentChat.test.tsx` with UI assertion for empty shell output warning callout.
  - Updated `packages/shared/src/projectPrompt.test.ts` to assert preflight instruction and no hardcoded absolute-path guidance in coordinator examples.
- Docs:
  - Updated `docs/llms.md` and `README.md` with preflight + shell warning behavior notes.
- Verification:
  - `pnpm exec prettier --write apps/gateway/src/subagents/index.ts apps/gateway/src/subagents/index.test.ts apps/web/src/components/AgentChat.tsx apps/web/src/components/AgentChat.test.tsx apps/web/src/components/ProjectsBoard.tsx`
  - `pnpm typecheck`
  - `pnpm lint` (passes with existing repository warnings only)
  - `pnpm test` (56 files / 552 tests passing)

### 2026-03-07: Space per-entry skip/integrate + delivery replaces (PRO-174)

- `apps/gateway/src/projects/space.ts`
  - Added `skipSpaceEntries(config, projectId, entryIds)` to mark selected `pending` queue rows as `skipped`.
  - Added `integrateSpaceEntries(config, projectId, entryIds)` to cherry-pick only selected `pending` entries.
  - `RecordWorkerDeliveryInput` now accepts `replaces?: string[]`.
  - `recordWorkerDelivery` now auto-skips matching `pending` entries by `id` or `workerSlug` when `replaces` is provided.
- `apps/gateway/src/server/api.ts`
  - Added:
    - `POST /api/projects/:id/space/entries/skip`
    - `POST /api/projects/:id/space/entries/integrate`
  - Conflict-fix resume path now passes `replaces: [entryId]` to resumed worker spawn metadata.
- `apps/gateway/src/subagents/runner.ts`
  - Subagent persisted config now supports `replaces`.
  - Runner reads `replaces` from persisted config at delivery time and forwards it to `recordWorkerDelivery`.
- Tests:
  - `apps/gateway/src/projects/space.test.ts` adds coverage for skip selected entries, integrate selected entries, and delivery `replaces` auto-skip behavior.
  - `apps/gateway/src/subagents/subagents.api.test.ts` asserts conflict-fix resume writes `replaces` metadata in worker config.
  - Stabilized two Ralph loop API tests with explicit 15s test timeout.
- Docs:
  - Updated `README.md` and `docs/llms.md` Space API/model notes for per-entry actions + `replaces`.
- Verification:
  - `pnpm exec eslint apps/gateway/src/projects/space.ts apps/gateway/src/server/api.ts apps/gateway/src/subagents/runner.ts apps/gateway/src/projects/space.test.ts apps/gateway/src/subagents/subagents.api.test.ts apps/gateway/src/projects/index.ts`
  - `pnpm typecheck`
  - `pnpm test -- apps/gateway/src/projects/space.test.ts` (suite passes in this repo config; 537 tests green)

### 2026-03-07: PRO-174 frontend rebase-on-main controls (worker-rebase-frontend)

- `apps/web/src/api/client.ts`, `apps/web/src/api/types.ts`
  - Added client methods `rebaseSpaceOntoMain(projectId)` and `fixSpaceRebaseConflict(projectId)`.
  - Extended `ProjectSpaceState` with optional `rebaseConflict?: { baseSha: string; error: string }`.
- `apps/web/src/components/project/ChangesView.tsx`
  - Added `Rebase on main` action in Space dashboard (queue-present only, disabled while blocked/in-progress).
  - Added space-level rebase conflict banner + `Fix rebase conflict` action and spawned-agent message.
- Tests:
  - `apps/web/src/api/client.test.ts` coverage for `/space/rebase` and `/space/rebase/fix`.
  - `apps/web/src/components/project/ChangesView.test.tsx` coverage for rebase button, conflict render, and fix action.
- Verification:
  - `pnpm test -- --testTimeout=20000 apps/web/src/components/project/ChangesView.test.tsx`
  - `pnpm test -- --testTimeout=20000 apps/web/src/api/client.test.ts`
  - `pnpm lint`

### 2026-03-04: PRO-170 resume semantics + prompt guardrails (codex/claude/pi)

- `apps/gateway/src/subagents/runner.ts`
  - Resume prompt assembly is now delta-only (`input.prompt` + optional current-turn attachment marker).
  - Resume path no longer loads project markdown corpus or prepends project summary/workspace suffixes.
  - Added prompt-size preflight before CLI spawn:
    - Resume limit default: `32768` bytes (`AIHUB_SUBAGENT_RESUME_MAX_PROMPT_BYTES`).
    - Start/spawn limit default: `262144` bytes (`AIHUB_SUBAGENT_MAX_PROMPT_BYTES`).
  - Oversized prompt returns `ok:false` with explicit byte/limit error.
- `apps/gateway/src/subagents/subagents.api.test.ts`
  - Resume assertions now verify no `Let's tackle the following project:` reinjection for codex/claude.
  - Added Pi resume coverage validating session-file reuse and no summary reinjection.
  - Added conflict-fix resume coverage asserting conflict instruction payload and no summary reinjection.
  - Added guardrail tests for both resume and start/spawn oversized prompt 400s.
- Docs updated:
  - `docs/cli-apm.md`
  - `docs/agent_interfacing_decisions.md`
  - `docs/agent_interfacing_specs.md`
  - `docs/llms.md`
- Verification:
  - `pnpm test -- apps/gateway/src/subagents/subagents.api.test.ts` (passes; repository config runs full vitest suite under this invocation).

### 2026-03-04: Inline rename Space key fix in project agent list

- `apps/web/src/components/project/AgentPanel.tsx`
  - Fixed subagent inline rename keyboard handling: pressing `Space` in the rename input now stops propagation so the parent row does not trigger subagent selection/load.
- `apps/web/src/components/project/AgentPanel.test.tsx`
  - Added regression test: `Space` during rename does not call `onSelectAgent` and keeps rename input active.
- `docs/llms.md`
  - Updated project-detail inline-rename behavior note to include Space-key handling while editing.

### 2026-03-04: Space merge-to-main backend endpoint + cleanup (PRO-167)

- `apps/gateway/src/projects/space.ts`
  - Added `mergeSpaceIntoBase(config, projectId, { cleanup? })`.
  - Merge flow validates queue terminal state (no `pending/conflict/stale_worker`), checks out base branch, runs `git merge --ff-only` with fallback `git merge --no-edit`, and pushes base branch when a remote exists.
  - Added `cleanupSpaceWorktrees(config, projectId)` with best-effort removal of worker worktrees/branches and Space worktree/branch, then clears `space.json` queue + `integrationBlocked`.
  - Added result types: `SpaceMergeResult`, `SpaceCleanupSummary`.
- `apps/gateway/src/server/api.ts`
  - Added `POST /api/projects/:id/space/merge` with body `{ cleanup?: boolean }` (default `true`).
  - Endpoint runs merge, updates project status to `done`, records status activity, and emits README file-changed event.
- `apps/gateway/src/projects/index.ts`
  - Exported new Space merge/cleanup functions and types.
- Tests:
  - Added merge/cleanup coverage in `apps/gateway/src/projects/space.test.ts`.
  - Added API coverage in `apps/gateway/src/server/space-merge.api.test.ts` (queue validation + successful merge/status update).
- Docs:
  - Updated `README.md` and `docs/llms.md` Space API/model notes for `/space/merge`.

### 2026-03-04: Coordinator prompt enforces reviewer dispatch for code review

- `packages/shared/src/projectPrompt.ts`
  - Tightened coordinator role instructions: coordinator must not run code reviews directly and must dispatch a `reviewer` template run for review/verification work.
  - Added explicit delegation bullet for review/test validation responsibilities.
- `packages/shared/src/projectPrompt.test.ts`
  - Added assertion covering the new coordinator instruction text.
- `docs/llms.md`
  - Documented the coordinator prompt constraint that review/verification should flow through `--template reviewer`.

### 2026-03-04: Space conflict-fix resumes original worker (PRO-166)

- `apps/gateway/src/server/api.ts`
  - Changed `POST /api/projects/:id/space/conflicts/:entryId/fix` from spawning a new fixer run to resuming the original worker slug.
  - Handler now aborts any lingering Space cherry-pick state, resolves current Space HEAD SHA, and sends rebase/deliver instructions to the worker.
- `apps/gateway/src/projects/space.ts`
  - `recordWorkerDelivery` now detects existing `conflict` entry for the same worker and updates that entry in place (`startSha/endSha/shas/status/error/staleAgainstSha`) instead of appending.
  - Clears `integrationBlocked` when conflict re-delivery lands.
- `apps/web/src/api/client.ts`, `apps/web/src/components/project/ChangesView.tsx`
  - Renamed client call to `fixSpaceConflict`.
  - Changes tab now uses resume wording (`Resuming…`, `Resumed worker: <slug>`) and no longer implies spawning a new fixer.
- Tests:
  - Added in-place conflict re-delivery coverage in `apps/gateway/src/projects/space.test.ts`.
  - Updated conflict-fix API expectations in `apps/gateway/src/subagents/subagents.api.test.ts` for resume flow.
  - Updated ChangesView client mock naming and preserved suite coverage.

### 2026-03-04: Subagent post-creation model/config updates (PRO-163 Fix 4)

- `apps/gateway/src/server/api.ts`, `apps/gateway/src/subagents/index.ts`
  - Added `PATCH /api/projects/:id/subagents/:slug` for partial config updates (`name`, `model`, `reasoningEffort`, `thinking`).
  - Resume path now reuses saved config values when these fields are omitted from follow-up spawn requests.
- `packages/cli/src/client.ts`, `packages/cli/src/index.ts`
  - Added `apm rename <id> --slug <slug> [--name|--model|--reasoning-effort|--thinking]`.
- `apps/web/src/components/project/AgentPanel.tsx`, `apps/web/src/api/client.ts`
  - Added per-harness model selector in subagent cards (hidden while status is `running`) and PATCH persistence.
- Tests:
  - `apps/gateway/src/subagents/subagents.api.test.ts` (added PATCH model + PATCH name/model + resume-uses-updated-model coverage)
  - `apps/web/src/components/project/AgentPanel.test.tsx` (added model selector visibility/update coverage)

### 2026-03-03: Subagent chat remount + stale poll race hardening

- `apps/web/src/components/project/CenterPanel.tsx`
  - Chat agent selection now flows through a memoized signal (`chatSelectedAgent`) instead of recreating the chat branch with an inline IIFE.
  - Prevents unnecessary `AgentChat` remounts when selected subagent metadata updates (e.g. status/cli sync ticks).
- `apps/web/src/components/AgentChat.tsx`
  - Added setup-token guards around async subagent slug resolution + polling so stale/in-flight callbacks cannot attach orphan pollers after cleanup.
  - Chat runtime reset/setup is now keyed by stable chat identity (`lead:<id>` or `subagent:<projectId>:<slug>`) so status-only prop churn no longer tears down/recreates polling.
  - Centralized poll interval teardown (`clearSubagentPollInterval`) to avoid duplicate poll loops and cursor resets.
  - Reset effect no longer tracks `subagentInfo.status`, preventing unintended full chat resets on running/replied transitions.
  - Removed temporary in-UI debug panel/logging after root cause confirmation.
  - Kept test-only reset hook for module-global transient state to keep unit tests isolated.
- Tests:
  - `apps/web/src/components/AgentChat.test.tsx`
  - `pnpm test -- apps/web/src/components/AgentChat.test.tsx` (passes; repo currently executes broad suite under this command).

### 2026-03-03: Subagent chat loading flicker fix

- `apps/web/src/components/AgentChat.tsx`
  - Subagent awaiting state no longer clears on `session`/`message`/empty assistant log noise.
  - Awaiting state now clears only on first non-empty assistant message, or explicit run-end status transition.
  - Pending user echoes are cleared on first assistant response/run-end to avoid stale spinner state.
  - Loading spinner now persists until meaningful subagent output arrives.
  - Non-UI log noise is filtered from rendered chat events to prevent flashing.
  - Batched log/pending state updates to avoid transient chat history flicker.
- Tests:
  - `apps/web/src/components/AgentChat.test.tsx`
    - Added regressions for `session`/`message` events and empty assistant event handling.

### 2026-03-03: Project detail stale accessor + selection override fix

- `apps/web/src/components/project/ProjectDetailPage.tsx`
  - Removed stale `<Show>` accessor usage in async `onSpawned` callbacks (`detail().id` -> `projectId()`).
  - Saved-subagent restore no longer overrides an already-selected agent after delayed subagent list refresh.
- `apps/web/src/components/project/CenterPanel.tsx`
  - Chat branch no longer uses function-child `<Show>` accessors for selected/spawn mode rendering.
  - Reduces stale accessor runtime risk and tab-state desync when opening spawn templates.

### 2026-03-03: Project detail subagent realtime fallback + chat run-state fix

- `apps/web/src/components/AgentChat.tsx`
  - Subagent chat now treats `awaiting response` as running state.
  - Prevents input/Send from re-enabling right after spawn before status refresh arrives.
  - On successful subagent interrupt, clears local awaiting state immediately.
- `apps/web/src/components/project/AgentPanel.tsx`
  - Added 2s subagent list polling fallback (in addition to websocket `agent_changed` refresh).
  - Keeps project detail agent list/status synchronized even when a ws event is missed.
- Tests:
  - `apps/web/src/components/AgentChat.test.tsx`
  - `apps/web/src/components/project/AgentPanel.test.tsx`

### 2026-03-03: Stop/interrupt UX + realtime status refresh

- `apps/web/src/components/AgentChat.tsx`
  - Stop button now transitions to disabled `Stopping...` while interrupt is in-flight.
  - Added guard to prevent double interrupt clicks.
- `apps/gateway/src/subagents/runner.ts`
  - `interruptSubagent` now writes `interrupt_requested_at` to `state.json` immediately after `SIGTERM`.
  - This triggers watcher-driven `agent_changed` broadcasts so UI refreshes promptly.
- Tests:
  - `apps/web/src/components/AgentChat.test.tsx`
  - `apps/gateway/src/subagents/subagents.api.test.ts`

### 2026-03-03: Project watcher ID mismatch fix

- `apps/gateway/src/projects/watcher.ts`
  - Watcher now normalizes folder names (`PRO-159_slug`) to canonical project IDs (`PRO-159`) before broadcasting.
- Impact:
  - Project detail subagent state now updates in realtime.
  - Center chat state no longer gets stuck on running after completion.
- Tests:
  - `apps/gateway/src/projects/watcher.test.ts`
  - related project-detail web tests updated and passing.

### 2026-03-03: Prompt/template guardrails and docs alignment

- `packages/shared/src/projectPrompt.ts`
  - Coordinator instructions now forbid template-locked overrides unless `--allow-template-overrides` is set.
  - Worker instructions explicitly require commit after green checks.
  - Coordinator examples removed redundant template-locked flags.
- `packages/shared/src/projectPrompt.test.ts` updated.
- Docs synced: `README.md`, `docs/llms.md`.

### 2026-03-03: Spawn form + chat/detail regressions fixed

- `apps/web/src/components/project/SpawnForm.tsx`
  - Worker prompt preview now uses workspace path for `clone/worktree` modes.
- `apps/web/src/components/project/ProjectDetailPage.tsx`
  - Center panel tab wired in controlled mode so selecting template reliably activates Chat tab.
- `apps/web/src/components/AgentChat.tsx` + `apps/web/src/components/project/CenterPanel.tsx`
  - Fixed long-line overflow/cropping that hid Send/Stop controls.
- Tests updated in SpawnForm/ProjectDetail/AgentChat suites.

### 2026-03-03: Realtime web subscriptions + activity/changes UX

- `apps/web/src/api/client.ts`
  - Added shared websocket subscription helper for `file_changed` and `agent_changed` with reconnect + shared lifecycle.
- `ProjectsBoard`, `ProjectDetailPage`, `AgentPanel`, `CenterPanel`
  - Added targeted debounced refetch behavior on relevant events.
- `CenterPanel` activity timeline
  - Real comments stay card-based; synthetic agent lifecycle events render as concise plain rows with relative time.
- `ChangesView`
  - Branch diff header now expands/collapses per-file +/- breakdown.
  - Space commit log rows now show relative commit age.

### 2026-03-03: Routing/sidebar and template lock fixes

- `apps/web/src/App.tsx`, `ProjectsBoard.tsx`
  - Removed duplicate left-sidebar rendering for `/projects/:id?` shell.
- `apps/web/src/components/AgentSidebar.tsx`
  - Recents now come from view history (`aihub:recent-project-views`) instead of project sort fields.
- `packages/cli/src/index.ts`
  - `apm start --template` request body now omits locked profile fields unless `--allow-template-overrides` is set.
- `packages/cli/package.json`
  - Added direct `@aihub/shared` dependency to fix workspace build order/resolution.

## Older History (Compressed)

### 2026-03-02

- Worker template worktrees now default to `space/<projectId>` instead of `main`; server resolves this dynamically and CLI no longer injects `main` when `--allow-template-overrides` is used.
- Added/iterated template-based spawn flow, coordinator/worker/reviewer prompt semantics, and safer template lock behavior.
- Landed project detail chat Stop flow (`/abort` for lead, interrupt API for subagents).
- Added `SPECS.md` parsing/format guidance and subsection support across gateway/web/prompts.
- Improved coordinator context injection (main repo + Space path), plus area-repo fallback in runner.
- Continued UI polish for agent cards, center panel interactions, and prompt preview behavior.

### 2026-03-01

- Delivered Space-first architecture for project changes/integration (`space.ts`, queue/integrate/conflict paths, Space-aware changes API).
- Implemented project-detail spawn templates and run-mode `none`; moved spawn prep into center panel.
- Consolidated CLI harness set to `claude|codex|pi`; removed legacy droid/gemini paths.
- Refined homepage shell/nav/sidebar structure and project detail left/center/right panel behavior.
- Added light/dark theme support with global CSS vars and persisted toggle.

### 2026-02-28 and earlier

- Built Projects API/CLI foundations, Kanban board, project detail page, spec editor, task parsing/updating, agent/subagent monitoring, activity feed/chat integration, and iterative UI/mobile polish.
- Added supporting infra over time: areas/tasks hierarchy, multi-file project docs, attachment support, OpenClaw integration, subagent kill flow, realtime status events, soft-delete, and dev-mode runtime helpers.

## Known Risks / Follow-up

- Vitest invocation still tends to run broad suites in this repo config; keep serial runs to avoid transient test flake.
- Realtime correctness depends on watcher/event consistency; if stale UI appears, verify `state.json` write + websocket `agent_changed` path first.
- Continue enforcing template-lock boundaries to prevent CLI/UI drift.
