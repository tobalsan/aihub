# AIHub - LLM Context Document

## Project Goal

AIHub is a lightweight, self-hosted multi-agent gateway. It provides a unified interface to run AI agents across multiple surfaces: web UI, Discord, CLI, scheduled jobs, and amsg inbox. Designed for solo developers managing multiple agents with minimal operational overhead.

## Architecture

```
aihub/
├── apps/
│   ├── gateway/     # Node.js server, CLI, agent runtime
│   └── web/         # Solid.js mobile-first chat UI
├── container/
│   └── agent-runner/ # Standalone Docker entrypoint for sandboxed agents
├── packages/
│   ├── extensions/  # First-party gateway extensions
│   └── shared/      # Zod schemas, shared types
└── ~/.aihub/        # Default AIHUB_HOME runtime config & data
```

### apps/gateway

Core TypeScript/Node.js application. Exports:

- **CLI** (`src/cli/index.ts`): `aihub gateway`, `aihub agent list`, `aihub send`, `aihub projects ...`, `aihub subagents ...`, `aihub eval run`
- **Evals** (`src/evals/`): Headless single-turn runtime for Harbor eval tasks. `aihub eval run --agent <id> --instruction-file <path>` boots config + extensions + `runAgent()` only (no HTTP server, no Discord/amsg/scheduler/heartbeat/conversations/projects/multi-user/web), aggregates the stream into `result.json`, and emits an ATIF `trajectory.json`. See `docs/plans/harbor-evals-for-aihub-migration.md`.
- **Server** (`src/server/`): Hono-based HTTP API + WebSocket streaming
- **Media** (`src/media/`): local upload/download support under `$AIHUB_HOME/media`, with inbound/outbound metadata, `GET /api/media/download/:id`, 25MB server-side upload cap, image/document MIME allowlist, and document text extraction helpers for PDF/docx/xls/xlsx/csv/txt/md
- **Agent Runtime** (`src/agents/`): Pi SDK integration, session management, sandbox container mount/argument helpers in `src/agents/container.ts`, and the Docker-backed container adapter in `src/sdk/container/adapter.ts`
- **Scheduler** (`src/scheduler/`): Interval/daily job execution
- **Discord** (`src/discord/`): Component-owned Discord bot runtime with channel/DM routing in v2 modular config; legacy per-agent config remains migration/back-compat input
- **Slack** (`src/slack/`): Component-owned Slack Bolt Socket Mode runtime with channel/DM routing, thread replies, reactions, `/new`/`/stop` slash commands, `!new`/`!stop` bang commands (detected at start of regular messages — no slash command setup needed, works with multiple bots), optional live thinking thread replies, Slack mrkdwn conversion, inbound file attachment downloads to AIHub media, outbound `file_output` uploads via Slack `files.uploadV2`, and cross-source broadcasts in v2 modular config
- Inbound Slack/Discord message runs now normalize `channel`, `place`, `conversation_type`, and `sender`, render a fallback-filled `[CHANNEL CONTEXT]` block, and append it to the true system prompt. This applies to both in-process and sandbox/container runs. First-party gateway/CLI runs do not get channel context. Web UI runs in multi-user mode pass a name-only `[USER CONTEXT]` block from the authenticated OAuth profile.
- **Amsg** (`src/amsg/`): Inbox watcher for agent-to-agent messaging
- **Components** (`src/components/`): Opt-in wrappers that validate config, mount routes, and own lifecycle for modular features. Phase 2a now moves scheduler, heartbeat, amsg, and conversations behind component wrappers; scheduler/heartbeat/conversations routes are no longer defined in the core API module.
  - `subagents` is a default-enabled first-party extension for project-agnostic CLI subagent runtime. It owns `/api/subagents`, `aihub subagents ...`, process lifecycle, normalized logs, `subagent_changed` websocket broadcasts, run storage under `$AIHUB_HOME/sessions/subagents/runs/<runId>`, and contributes subagent command guidance through `Extension.getSystemPromptContributions()`. Codex/Claude CLI lifecycle chatter remains in raw `logs.jsonl` but is filtered from the logs API and latest-output summaries. Default `/api/subagents` list responses also merge project-backed subagent sessions so orchestrator runs are visible to `aihub subagents list --status running`; runtime-only filters (`cwd`, `parent`, `includeArchived`) keep returning runtime records only.
  - `multiUser` is an auth component that enables Better Auth + SQLite, guards `/api/*` and `/ws`, exposes `/api/auth/*`, `/api/me`, `/api/admin/*`, keeps session/history storage isolated per user, and must finish startup before the HTTP server begins accepting requests.
  - `langfuse` is an optional tracing component. Its registry entry is lazy-loaded, has no routes, validates `publicKey`/`secretKey` from component config or `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`, and subscribes to `agentEventBus` stream/history events. `langfuse/tracer.ts` maps `agentId:sessionId` to traces, honors per-run trace context (`enabled`, explicit `surface`/`name`, metadata), buffers text/thinking into generations, maps HistoryEvent user/meta/tool_call/tool_result data into generation input/model/usage and tool spans, finalizes on `done`/`error`, catches flush/shutdown failures as warnings, and idle-cleans traces after 30 minutes.
  - `system_prompt` history events now capture the harness-assembled prompt text itself. Langfuse generation observations are emitted as chat-style input arrays (`system` + `user`), so the Langfuse UI shows the real system prompt section. `system_context` remains separate metadata for normalized Slack/Discord channel details.
  - `webhooks` is auto-loaded when any agent has `webhooks` config. It registers `/hooks/:agentId/:name/:secret`, stores generated URL secrets in `$AIHUB_HOME/webhook-secrets.json` with `0600` permissions, validates secrets from an mtime-cached file read so rotations take effect without restart, rotates them with `aihub webhooks rotate <agentId> <webhookName>`, resolves inline or workspace-contained `.md`/`.txt` prompts relative to the agent workspace, interpolates `$WEBHOOK_ORIGIN_URL`, `$WEBHOOK_HEADERS`, and `$WEBHOOK_PAYLOAD`, enforces per-webhook `maxPayloadSize` bytes (default 1MB) while streaming request bodies, and runs each invocation in a fresh `webhook:<agentId>:<name>:<requestId>` session with source/surface `webhook`. Optional `verification: { location: "header"|"payload", fieldName }` short-circuits setup requests containing that header or JSON payload key before signature verification or agent invocation; requests without the configured field continue through normal webhook handling. `langfuseTracing: false` disables Langfuse tracing for that webhook; async webhook failures emit traceable `agent.stream` error events when tracing is enabled. Known GitHub, Notion, and Zendesk webhooks verify HMAC-SHA256 signatures when `signingSecret` is configured, with `$env:VAR` resolution.
- **Extensions** (`src/extensions/`): Gateway runtime glue that loads first-party and external extensions, validates config, appends prompt guidance, and exposes agent tools to Pi/container sessions.
  - Tool-style extensions use `packages/shared/src/tool-extension.ts`; root `extensions.<id>` supplies defaults, and `agents[].extensions.<id>` opts an agent in unless `enabled: false`.
  - The `projects` extension owns the project agent tools (`project.create`, `project.get`, `project.update`, `project.comment`). In-process Pi runs and sandbox/container Pi runs both receive these only through the unified extension tool path, so disabling the `projects` extension removes the sanitized `project_*` tools from agent-visible custom tools.

### apps/web

Solid.js SPA with dark/light theme support. Two views:

- `AgentList`: Select agent to chat with
- `ChatView`: WebSocket-based streaming chat with Simple/Full view modes

Features:

- **Simple mode**: Text-only messages (default)
- **Full mode**: Shows thinking blocks (collapsed), tool calls with JSON args, tool results with diffs, model metadata (provider/model/tokens)
- Live tool indicators during streaming
- Collapsible blocks auto-collapse if content >200 chars
- Thinking indicator dots while waiting for response
- `BoardView` chat now uses full lead-agent history per selected agent/session key, renders through `BoardChatRenderer`, streams assistant text plus live tool calls/results over `/ws`, supports file picker and drag-and-drop attachments through chat media uploads, keeps the textarea editable while a run is active, shows separate Send/Stop controls, and keeps queued follow-up user messages separate until the active run picks them up
- `apps/web/src/components/BoardChatRenderer.tsx` now exists as a standalone full-history board log renderer: it exports `BoardLogItem`, `buildBoardLogs()`, and `BoardChatLog` for rendering structured assistant/user text, thinking blocks, tool calls, and inline diffs from `FullHistoryMessage[]`
- Project `AgentChat` virtualizes only larger persisted history/log lists (`>=80` rows) with `@tanstack/solid-virtual`, remeasures visible rows on pane resize, and keeps the bottom row anchored while the live streaming row stays outside the virtualized region
- ChatView preserves optimistic user/error messages on failed runs instead of immediately reloading stale history when streaming ends with an error; interrupted runs also keep any streamed assistant text that arrived before `/abort`/Stop, and full-mode chat renders transport/run errors inline
- Projects board shell uses split sidebars:
  - Left sidebar: AIHub logo + primary nav (`Chats` always; `Projects`/`Conversations` only when enabled by `/api/capabilities`)
  - Right context panel tabs: `Agents` (lead agents + subagents with live status), `Chat`, `Feed`
  - Recent projects live at the bottom of the right context panel
  - Collapsed sidebars hover-expand as overlays above the main pane instead of reflowing it
- Archived projects section is toggled from the projects header `Archived` button (top-right)
- Board project scanning is cached in-process: `/api/board/projects` uses in-flight dedupe, a 10s stale-while-revalidate endpoint cache, startup warmup, and `README.md` watcher invalidation. Worktree branch discovery reads `.git/HEAD`/`.git/worktrees/*` directly; only dirty/ahead still use git and are TTL-cached with `.git/index` watcher invalidation. Pass `?profile=true` to get `X-Profile-Ms`.
- `/api/board/projects` returns `{ items, lifecycleCounts }`. The lifecycle list cold-loads without `?include=done`, keeps cancelled projects visible, uses `lifecycleCounts.done` for the collapsed Done header, and lazy-loads Done cards only after the user expands that bucket.
- `/api/board/projects` enriches each project with `worktrees[]` from cached Space queue data, convention-attributed git worktrees, explicit project README frontmatter declarations (`worktrees: [{"repo":"~/code/aihub","branch":"feat/example"}]` or path strings), and live subagent runtime state matched by exact `cwd`/worktree path. Git worktree attribution prefers explicit frontmatter, then branch prefixes (`space/<projectId>`, `space/<projectId>/*`, `<projectId>/*`), then active `PRO-*` branch tokens, then active `PRO-*` path tokens. Worktrees that do not match any active project are emitted under the synthetic `__unassigned` board project. Space and git worktrees are deduped by canonical path plus project worker slug, so stale Space paths from older workspace roots still collapse with git-discovered `space/<projectId>/<worker>` entries; set `AIHUB_BOARD_WORKTREE_DIAGNOSTICS=1` to log raw and canonical source paths during the join. Space cache watcher and subagent change events invalidate the board endpoint cache; live run lookup uses the subagents extension's in-memory `getLiveSubagentRunsByCwd()` helper.
- `/` is the board home when the board extension is configured as `capabilities.home`: `BoardView` with persistent lead-agent chat on the left, `Scratchpad` as the default canvas tab, and `Project lifecycle` as the second tab. The lifecycle tab embeds the grouped lifecycle list and opens `BoardProjectDetailPage` inline (Pitch/Slices/Thread/Activity) when a project card is clicked. `/board` remains the standalone lifecycle list route.
- Areas homepage includes a quick-create flow with slugified ids from title and a native color picker
- Area cards show per-status project counts and support inline area editing (`title`, `color`, `order`, `repo`)
- Area title click routes to `/projects?area=<id>`; board header shows selected area + `Back to Areas` link
- Left sidebar nav shell is reused on `/projects`, `/agents`, `/conversations`, and `/chat/:agentId/:view?` routes for consistent navigation
- Web app fetches `/api/capabilities` on boot; if `projects` is disabled, `/` falls back to the core agent list instead of the Areas route
- When `/api/capabilities` reports `multiUser: true`, the app gates protected routes behind Better Auth session checks, exposes `/login`, and shows admin pages for `/admin/users` and `/admin/agents`
- `/board` is Board extension lifecycle home route. It renders grouped project list (`ProjectListGrouped`): active + shaping expanded, done + cancelled collapsed, with search, area chips, drag-move, rich card basics.
- `/board/projects`, `/board/projects/:projectId`, and `/board/projects/:projectId/slices/:sliceId` render inside the Board shell so the left chat pane stays mounted while lifecycle navigation changes. `BoardProjectDetailPage` drives project tabs from `?tab=pitch|slices|thread|activity`; nested board slice URLs keep the project header/tab strip visible, force the project tab to Slices, and pass `?tab=readme|specs|tasks|validation|thread|agent` to the inline `SliceDetailPage`. **Post-refactor model: slices are kanban unit; projects track lifecycle only (`shaping → active → done / cancelled`).** Pitch uses `DocEditor`; Thread renders THREAD.md comments as cards plus an add-comment form, with no free-form doc editor. Slices tab embeds `SliceKanbanWidget` (scoped to project). Legacy `ProjectsBoard`/`ProjectsOverview` replaced for board lifecycle surfaces. Slice blocker UI reads `frontmatter.blocked_by` from `/api/projects/:id/slices`; unresolved blocker IDs remain blocking, matching the orchestrator fail-safe.
- Slice detail routes (`/projects/:projectId/slices/:sliceId`) use the shared board `DocEditor` for README, SPECS, TASKS, and VALIDATION tabs. README is the first tab and saves update only the markdown body while preserving existing YAML frontmatter; Thread is read-only and renders timestamped `THREAD.md` sections as comment cards with markdown bodies. The Recent Runs sidebar shows relative timestamps from `lastActive` or `startedAt` when available.
- Project overview worktree rows combine Space `queueStatus` with live `agentRun.status` into working/failed/conflict/stale/pending/skipped/integrated/idle pills and expand locally to show cwd-filtered runtime subagent runs through `SubagentRunsPanel`. The panel fetches `/api/subagents?cwd=...` only when a worktree is expanded, then lazy-loads normalized logs when a run is expanded and exposes stop/archive/delete controls. The `__unassigned` overview entry is pinned at the bottom, bypasses filters/search, is read-only, and shows active runtime subagents whose `cwd` does not match any real project worktree. Board project overview rows show title/count above area/status. In the Board tab, README/SPECS Edit opens the existing project detail editor inline in the right pane with same-URL history close behavior.
- `SPECS.md` split view includes one checklist toggle in the lower pane header that collapses/expands both Tasks and Acceptance Criteria for more document space
- Right context panel shows last 5 recently viewed projects (from `localStorage`) at the bottom, with truncated titles and relative viewed timestamps
- Projects, Areas, and Conversations route bundles are lazy-loaded and only imported when their owning component is enabled
- Global quick chat is available from a bottom-right floating bubble and opens a route-persistent lead-agent overlay with header agent picker, streaming chat, and image attachment upload support
- Agent `ChatView` file attachments support drag-and-drop with zone feedback on the history pane, composer, and `+` attach button, in addition to the picker button
- Project-detail lead-agent launches persist per-project `sessionKeys`; the UI binds the opened chat to the exact returned project session key instead of the agent's global `main` session
- Fresh project-detail lead-agent launches now show an immediate pending spinner and render subscribed text/tool activity live while the run is in progress, instead of waiting for final history reload
- Project-detail lead-agent rows support reset/remove actions: remove clears the project `sessionKeys` entry, and reset clears the bound session state then reuses the canonical `project:<id>:<agentId>` key
- Lead-agent reset immediately clears visible chat history without a page reload because lead chat identity now keys on `agentId + sessionKey + sessionNonce`
- Project-detail left-panel lead status dots now reflect real runtime state via `fetchAgentStatuses()` + `subscribeToStatus()` instead of a hardcoded online indicator
- Lead-agent spawn form hides the irrelevant CLI command preview; only custom subagent spawns show CLI preview
- Theme: CSS custom properties on `:root` with `[data-theme="light"]` override. Toggle in sidebar footer. Persisted to `localStorage('aihub-theme')`, falls back to `prefers-color-scheme`. Flash-prevention inline `<script>` in `index.html`. Signal in `src/theme.ts`.
- Project detail spawn flow supports lead-agent launch plus config-driven subagent prep in the center panel
- UI-created project agents derive their session folder slug from the displayed agent name, so coordinator/worker/reviewer spawns land under stable name-based session directories instead of random ids
- Project API responses now include `repoValid` on both project detail and project list items; it is `true` only when the resolved repo path exists on disk and contains `.git`
- Project subagent run modes: `clone`, `worktree`, `main-run`, `none` (`none` runs without creating a workspace)
- Project detail center-panel subagent chat follow-ups reuse the selected subagent `runMode` to preserve CLI session cwd continuity (important for Claude CLI resume by `session_id`)
- Subagent resume/follow-up turns are delta-only: only the new user message (+ current-turn attachment marker), without re-prepending project summary context
- Project detail center-panel chat keeps `Send` available while a run is active and also shows `Stop`; lead agents stop via `/abort`, subagents stop via `POST /api/projects/:id/subagents/:slug/interrupt` (codex/claude/pi), and queued follow-up subagent messages flush client-side after the active run exits `running`
- Agent chat shows a red warning below the input when estimated context usage reaches 80%+, suggesting a wrap-up or handoff/new session
- Agent `ChatView` full-mode assistant turns preserve emitted chronology for thinking, text, tool calls, and file blocks. Live streams use a block timeline, tool results attach only to their originating tool call, and successful local stream completion appends the streamed turn without re-fetching/re-sorting history.
- Agent `ChatView` uses a centered transcript layout with quiet assistant text, soft user bubbles, compact single-card tool/result blocks, simplified Simple-mode tool rows, sticky blurred chrome, visible focus states, and reduced-motion fallbacks.
- Subagent config updates are supported post-creation via `PATCH /api/projects/:id/subagents/:slug` (`name`, `model`, `reasoningEffort`, `thinking`); `aihub projects rename` maps to this endpoint and AgentPanel exposes a per-harness model selector when the run is not active.
- Subagent chat polling guards prevent stale interval races on fast panel re-renders/remounts, preserving run-state UI (spinner, Stop visibility, optimistic queued follow-ups, enabled textarea) until meaningful assistant output arrives.
- Project detail center-panel Activity tab intersperses two entry types in one timeline: thread comments (card-style) and synthesized subagent lifecycle events (plain rows). Start rows are concise (`<cli> started.`); completion/error rows can include short outcome snippets from recent subagent logs. Activity rows show compact relative time (`now|Xm|Xh|Xd ago`) appended after the event text.
- Subagent shell tool cards render a warning state when exec/bash output is empty (`No output captured`) instead of appearing as blank success.
- Project UI live refresh is event-driven via `/ws` broadcasts: board project list and slice kanban refetch on project/slice `file_changed` events and subagent lifecycle `subagent_changed` events, project detail refetches on project file changes (`README.md`/`SCOPE_MAP.md`/`THREAD.md`), slice detail refetches on slice file changes, and project subagent panels refetch immediately on `agent_changed` with a 2s polling fallback to recover from missed websocket events. Slice kanban also watches `agent_changed` and `subagent_changed` with a 250ms debounce to keep per-slice green agent-active pills current. Board overview deliberately ignores `agent_changed` because running subagent stream logs can emit it several times per second.
- Slice detail includes a read-only Agent tab. It filters project subagent sessions by `sliceId`, sorts live runs first, shows status/start/duration/branch, links raw logs, copies `projectId:slug`, and interrupts running runs through the project subagent interrupt endpoint.
- Right-sidebar `ACTIVE PROJECTS` refresh is also event-driven now; the old unconditional 5s subagent/project polling loop in `AgentDirectory` was removed to avoid shell-wide rerender churn, and `scripts/verify-sidebar.sh` browser-verifies the path by creating/removing `sessions/<slug>/state.json` under a temp `PRO-*` project while the page is open.
- `subscribeToStatus()` now mirrors `subscribeToFileChanges()`: shared `/ws` socket, 1s reconnect-on-close, and `AgentDirectory` refetches lead-agent statuses on reconnect to recover after gateway/tab/network drops.
- Coordinator prompts include canonical main repo path plus project Space worktree path for planning/delegation context.
- Worker/reviewer prompts stay scoped to their own run workspace (`clone`/`worktree`/`main-run`/`none`).
- SpawnForm worker prompt preview is mode-aware: when run mode is `clone` or `worktree`, `## Implementation Repository` points to `~/projects/.workspaces/<projectId>/<slug>` (not the main repo path).
- Runner repo lookup for subagent non-`none` modes falls back to area repo (`.areas/<id>.yaml`) when project `frontmatter.repo` is not set.
- Project detail left panel agent list uses card rows with muted last-message excerpts and top-right relative elapsed timestamps; `+ Create new agent` is a minimalist text action placed above the list
- Project detail page is responsive: at `<=768px` it switches to a single-column `Overview | Chat | Activity | Changes | Spec` tabbed layout, moving `AgentPanel` into `Overview`; at `769px-1199px` it keeps the merged center/right tabs with a fixed `280px` left rail
- Project detail blocks new agent creation when `repoValid` is false and shows a clear message: `No repo configured` or `Repo path not found: <path>`
- Project detail left panel subagent rows support inline rename (click name, save on Enter/blur; Space is treated as input while editing and does not trigger row selection)
- Project detail Changes tab is Space-first: Space queue dashboard, per-worker contribution drill-down, Integrate Now, Rebase on main, and Space-targeted commit/PR actions
- Changes tab surfaces space-level rebase conflicts via `ProjectSpaceState.rebaseConflict`, with a dashboard-level "Fix rebase conflict" action (`POST /api/projects/:id/space/rebase/fix`) after a rebase attempt (`POST /api/projects/:id/space/rebase`)
- Changes tab branch diff header (`Branch: ... → ...` with aggregate +/- stats) is clickable when pending branch diff files exist, and toggles a compact per-file +/- breakdown list
- Space Commit Log rows include relative elapsed commit time (`now`, `1m`, `2h`, `3d`) next to author metadata
- `SPECS.md` task/acceptance parsing format for project detail is documented in `docs/specs-task-format.md` (use this when agents edit `## Tasks` and `## Acceptance Criteria`; optional `###` subgroup headings are supported inside both sections)
- Coordinator prompt includes a preflight (`command -v aihub && aihub projects --version`), concise `aihub projects start --subagent <name>` delegation examples, a reminder to choose an exact configured subagent name from the injected `## Available Subagent Types` list (or inspect AIHub config first if none are listed), explicit `aihub projects status`/`aihub projects resume` monitoring rules with a foreground poll-loop example, required project status moves (`in_progress` on dispatch, `review` when ready), Space-branch-only integration discipline including `space.json` commit-state updates on manual integration, and a `SPECS.md` formatting reminder for parse-safe Tasks and Acceptance Criteria checklist updates
- Coordinator prompt explicitly forbids self-performing code review; review/verification must be delegated to a reviewer subagent
- Coordinator delegation guidance forbids adding locked flags (`--agent`, `--model`, `--reasoning-effort`, `--thinking`, `--mode`, `--branch`, `--prompt-role`) unless `--allow-overrides` is explicitly set
- Worker prompt explicitly requires committing implementation after checks are green, and post-run comment instructions now use `--author <your name>` (the deprecated Cloud/openclaw follow-up step was removed)

Proxies `/api` and `/ws` to gateway (port 4000) in dev mode.

### container/agent-runner

Standalone Node 22 package for sandboxed agent containers. It reads `ContainerInput` JSON from stdin, runs Pi SDK turns or Claude CLI turns (`claude --print --output-format json`) inside the container, streams incremental history events on stdout as `---AIHUB_EVENT---<json>`, and writes final `ContainerOutput` JSON between `---AIHUB_OUTPUT_START---` / `---AIHUB_OUTPUT_END---`. Debug logs must go to stderr only. It may import from `@aihub/shared` and Pi SDK packages but must not import gateway source.

Container OneCLI proxy wiring:

- `apps/gateway/src/agents/container.ts` injects `ONECLI_URL`, `ONECLI_CA_PATH`, `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, and `NODE_TLS_REJECT_UNAUTHORIZED=0` when top-level `onecli` is configured.
- Safe top-level `aihub.json.env` entries are also forwarded into sandbox containers; per-agent `sandbox.env` overlays them afterward.
- Anthropic uses `ANTHROPIC_BASE_URL=<onecli url>`; OpenAI uses `OPENAI_BASE_URL=<onecli url>/v1`.
- The OneCLI CA cert is mounted at `/usr/local/share/ca-certificates/onecli-ca.pem`.
- `container/agent-runner/src/index.ts` configures the exported proxy client before the SDK run and forwards IPC follow-ups to the active run (`deliverAs: "steer"` for Pi, queued follow-up text for Claude CLI one-shot).
- Gateway `apps/gateway/src/sdk/container/adapter.ts` serializes extension prompt/tool metadata into `ContainerInput.extensionSystemPrompts` and `ContainerInput.extensionTools` because the container runner cannot access the gateway extension registry directly.
- `ContainerInput.context` carries normalized Slack/Discord channel context into the runner. Both the Pi and Claude container paths append the rendered block to the true system prompt and emit a `system_context` history event before the user turn.
- Container runs bind `$AIHUB_HOME/agents/<agentId>/data` to `/workspace/data` writable and session upload copies to `/workspace/uploads` read-only. `---AIHUB_EVENT---{"type":"file_output","path":"/workspace/data/..."}` copies the file to `$AIHUB_HOME/media/outbound`, registers metadata, emits `file_output`, and persists an assistant `FileBlock`.
- Extension tool calls inside the container route back to the gateway through `/internal/tools`. LLM network egress still uses the OneCLI proxy env when configured; CA trust for HTTPS CONNECT tunneling relies on `NODE_EXTRA_CA_CERTS` (set via container env).
- Container extension tool results larger than 20KB are materialized as JSON files under `/workspace/data/tool-results/`; the model receives a compact pointer plus preview so scripts can consume large results by path instead of reserializing JSON through shell commands.
- Gateway calls `ensureBootstrapFiles(workspaceDir)` on the host before spawning the container, so workspace template files (AGENTS.md, SOUL.md, etc.) are created for new agents even in sandbox mode.
- Orchestration callbacks go to `POST /internal/tools`. `apps/gateway/src/sdk/container/tokens.ts` tracks active per-container tokens, and `apps/gateway/src/server/internal-tools.ts` validates them before dispatching subagent/project operations on the gateway side.
- When `onecli.sandbox.network` is configured, the adapter attaches that extra Docker network asynchronously after `docker run` starts. If Docker rejects startup first (for example a missing bind-mount source), gateway logs now surface the captured `docker run` stderr instead of masking it as a network-connect failure.

### packages/shared

Zod schemas and TypeScript types:

- Config types: `AgentConfig`, `GatewayConfig`, `Schedule`, `StreamEvent`
- Modular runtime types: `Component`, `ComponentContext`, `ValidationResult`
- Extension schemas and the tool-extension helper live under `packages/shared/src/types.ts` and `packages/shared/src/tool-extension.ts`
- Browser consumers must import browser-safe subpaths like `@aihub/shared/types`, `@aihub/shared/model-context`, and `@aihub/shared/projectPrompt` instead of the package root, which also re-exports Node-only helpers
- History types: `SimpleHistoryMessage`, `FullHistoryMessage`, `ContentBlock` (thinking/text/toolCall/file), `ModelMeta`, `ModelUsage`
- API payloads and WebSocket protocol types
  - Projects payloads expose `repoValid` so the UI can block run creation when the resolved repo is missing or not a git repo
  - Coordinator prompts include the canonical repo root as read-only context and explicitly require workers to stay in dedicated worktrees/workspaces, never the main repo, unless explicitly required

### packages/extensions/projects

Projects extension. Owns project APIs, project subagent orchestration, and the gateway-mounted `aihub projects` command.

- Remote project/subagent commands talk to the gateway API over HTTP.
- Local config commands (`aihub projects config migrate`, `aihub projects config validate`) read/write `aihub.json` directly.
- Env URL precedence for HTTP commands: `AIHUB_API_URL` > `AIHUB_URL` > `$AIHUB_HOME/aihub.json` (`apiUrl`, default home `~/.aihub/`)
- Token precedence for HTTP commands: `AIHUB_TOKEN` > `$AIHUB_HOME/aihub.json` (`token`, default home `~/.aihub/`)
- Local config path precedence: `--config` > `$AIHUB_HOME/aihub.json` (legacy fallback: derive home from `AIHUB_CONFIG`)
- Gateway/web dev entrypoints now honor `AIHUB_HOME`, so `pnpm dev` and `pnpm dev:web` preview the same config home as local config commands
- `aihub projects --help` hides deprecated agent-management helpers; project-agnostic runtime run management is documented under `aihub subagents`.
- `aihub projects create --help` only advertises active create flags (`--title`, `--specs`, `--status`, `--area`, `--json`); legacy metadata flags remain hidden for compatibility.
- Project-agnostic subagent runtime commands live under the main gateway CLI: `aihub subagents start|profiles|list|status|logs|resume|interrupt|archive|unarchive|delete`.
- `aihub subagents profiles` reads local config only and lists `extensions.subagents.profiles[]` as `name cli model type runMode`; `--json` prints the raw profiles array.
- Runtime `--profile <name>` resolves `extensions.subagents.profiles[]` first, then top-level `subagents[]` templates. Both config surfaces use `cli` (`codex`/`claude`/`pi`) for the CLI harness; top-level templates keep `reasoning` while runtime profiles can carry `reasoning`/`reasoningEffort`. Unknown profile names fail with a profile-specific 400 error instead of falling through to missing CLI validation.
- Projects orchestrator v0.3 (post kanban-slice-refactor) is opt-in via `extensions.projects.orchestrator`. **Config key is a historical artifact** — the key stays at `extensions.projects.orchestrator` to avoid backward-compat breaks even though the dispatcher now operates on slices, not projects. When enabled, the daemon polls at `poll_interval_ms`, enumerates slices per configured status bindings, and dispatches only against slices whose parent project is `active`. Slices under `shaping`/`done`/`cancelled` projects are visible on the board but not dispatched. Worker spawns move slice `todo → in_progress`; failed Worker spawn attempts revert the slice to `todo` and record cooldown. Cooldown and dedupe are keyed by `sliceId` (not `projectId`) so one failing slice does not block siblings. Slices with `blocked_by` only dispatch when every blocker resolves globally to `done`, `ready_to_merge`, or `cancelled`; missing blocker IDs remain blocking. Reviewer spawns leave slice in `review`, use the most-recent orchestrator Worker workspace for that `sliceId`, and move slice `review → ready_to_merge` (pass) or `review → todo` with a THREAD.md gap comment (fail). Manual subagent runs default to `source: "manual"` and do not count against orchestrator concurrency. Project auto-transitions to `done` when all child slices are terminal (`done`/`cancelled`) and ≥1 is `done`.
- **Slice CLI surface** (`aihub slices <verb>`) — `add --project <PRO-XXX> "<title>"`, `list [--project] [--status]`, `get <sliceId>`, `move <sliceId> <status>`, `rename <sliceId> "<title>"`, `block <sliceId> --on <blockerId>[,<blockerId>...]`, `unblock <sliceId> [--from <blockerId>[,<blockerId>...]]`, `comment <sliceId> "<body>"`, `cancel <sliceId>`. Every mutation regenerates `SCOPE_MAP.md` atomically. Status enum: `todo | in_progress | review | ready_to_merge | done | cancelled`.
- Project root resolution is extension-first: `extensions.projects.root` is canonical; deprecated top-level `projects.root` is fallback only. Slice CLI, board routes, project stores, migration, and orchestrator must discover gateway-created slugged project directories via the canonical root.
- **`aihub projects migrate-to-slices`** — idempotent migration. Wraps each legacy project's `SPECS.md`/`TASKS.md`/`VALIDATION.md` into `slices/<PRO-XXX-S01>/`, generates `SCOPE_MAP.md`, maps legacy project statuses to the new project lifecycle enum + default slice status per spec §10.1. `maybe`/`not_now` projects become `shaping` with no auto-slice. Refuses to run while gateway is detected running.
- **Slice data model** — slices live at `<projectDir>/slices/<PRO-XXX-Snn>/` with `README.md` (YAML frontmatter: `id`, `project_id`, `title`, `status`, optional `blocked_by`, `hill_position`, `created_at`, `updated_at`), `SPECS.md`, `TASKS.md`, `VALIDATION.md`, `THREAD.md`. Per-project counter at `<projectDir>/.meta/counters.json` (`lastSliceId`). `SCOPE_MAP.md` is auto-generated — do not edit by hand.
- **Project lifecycle** (post-refactor) — `shaping → active → done / cancelled`. Projects are containers; they do not sit on a kanban. Orchestrator only dispatches slices for `active` projects. Auto-done fires when all child slices reach terminal status and ≥1 is `done`. Cancellation cascades: non-terminal slices flip to `cancelled`.
- **SubagentRun attribution** — `state.json` gains optional `projectId` and `sliceId`. Legacy run files untouched. New runs always populate both. `isActiveOrchestratorRun` lookup filters by `sliceId` with `cwd` fallback for legacy runs. Worktree path for orchestrated slices: `<worktreeDir>/<PRO-XXX>/<PRO-XXX-Snn>-<slug>/`.

## Runtime Data

All stored under `AIHUB_HOME` (default `~/.aihub/`):

- `aihub.json` - Main config (agents, server, scheduler)
- `models.json` - Custom model providers (Pi SDK format; read directly by Pi SDK)
- `webhook-secrets.json` - Generated per-agent webhook URL secrets
- `schedules.json` - Persisted schedule jobs with state
- `projects.json` - Project ID counter (`{ lastId }`)
- `sessions.json` - Session key -> sessionId mapping with timestamps
- `sessions/*.jsonl` - Agent conversation history (Pi SDK transcripts, JSONL format)
- `auth.db` - Better Auth + multi-user SQLite database; only created when `multiUser.enabled: true`
- `users/<userId>/sessions.json` - Per-user session mapping file when multi-user mode is enabled
- `users/<userId>/claude-sessions.json` - Per-user Claude session map when multi-user mode is enabled
- `users/<userId>/history/` - Per-user conversation history directory when multi-user mode is enabled
- `sessions/subagents/runs/<runId>/` - Project-agnostic CLI subagent run data (`config.json`, `state.json`, `progress.json`, `logs.jsonl`, `history.jsonl`)
- (Pi SDK) auth/settings files under `AIHUB_HOME` (created after a successful agent run)
  - `aihub.json` itself is required and is **not** auto-created
- Repo-local dev helper: `pnpm init-dev-config` writes `./.aihub/aihub.json` from `scripts/config-template.json` using the first free UI port in `3001-3100` and the first free gateway port in `4001-4100`

## Config Schema

```typescript
{
  version?: number,              // absent = legacy v1; startup auto-migrates to v2 in memory
  agents: [{
    id: string,
    name: string,
    description?: string,        // Short agent description for UI
    avatar?: string,             // Emoji, image URL, or path relative to workspace
    workspace: string,           // Agent working directory (~ expanded)
    sdk?: "pi"|"claude"|"openclaw",  // Default: pi
    model: {
      provider?: string,         // Required for Pi SDK; optional for Claude
      model: string,
      base_url?: string,         // API proxy URL (Claude SDK only)
      auth_token?: string        // API auth token (Claude SDK only, overrides env)
    },
    auth?: {                     // Auth config (Pi SDK)
      mode?: "oauth"|"api_key"|"proxy",
      profileId?: string         // e.g. "anthropic:default"
    },
    thinkLevel?: "off"|"minimal"|"low"|"medium"|"high"|"xhigh",
    queueMode?: "queue"|"interrupt",  // Default: queue
    discord?: { token, applicationId?, dm?, groupPolicy?, guilds?, historyLimit?, replyToMode?, broadcastToChannel?, ... },
    webhooks?: Record<string, { prompt: string, langfuseTracing?: boolean, signingSecret?: string, verification?: { location: "header"|"payload", fieldName: string }, maxPayloadSize?: number }>,
    heartbeat?: { every?, prompt?, ackMaxChars? },
    amsg?: { id?, enabled? },
    introMessage?: string,           // Custom intro for /new (default: "New conversation started.")
    extensions?: Record<string, {
      enabled?: boolean
      // extension-specific per-agent overrides
    }>,
    sandbox?: {
      enabled?: boolean,             // Default: false
      image?: string,                // Default: aihub-agent:latest
      network?: string,              // Inherits top-level sandbox.network.name
      memory?: string,               // Default: 2g
      cpus?: number,                 // Default: 1
      timeout?: number,              // Default: 300 seconds
      workspaceWritable?: boolean,   // Default: false
      env?: Record<string, string>,
      mounts?: Array<{ host: string, container: string, readonly?: boolean }>
    }
  }],
  sandbox?: {
    sharedDir?: string,
    network?: { name?: string, internal?: boolean },  // Defaults: aihub-agents, true
    onecli?: { enabled?: boolean, url: string, caPath?: string },
    mountAllowlist?: {
      allowedRoots: string[],
      blockedPatterns?: string[]      // Default: .ssh, .gnupg, .aws, .env
    }
  },
  extensions?: Record<string, unknown>, // extension-specific config; use extensions.projects.root for project storage
  extensionsPath?: string,              // external extension directory; default $AIHUB_HOME/extensions
  server?: { host?, port?, baseUrl? },
  gateway?: { host?, port?, bind? },  // bind: loopback|lan|tailnet
  sessions?: { idleMinutes? },        // Default: 360 (6 hours)
  onecli?: {
    enabled?: boolean,                // Default: false
    mode?: "proxy",                   // Default: "proxy"
    dashboardUrl?: string,
    gatewayUrl: string,
    ca?: { source: "file", path: string } | { source: "system" },
  },
  components?: {
    discord?: { enabled?, token, channels?, dm?, historyLimit?, replyToMode? },
    scheduler?: { enabled?, tickSeconds? },
    heartbeat?: { enabled? },
    amsg?: { enabled? },
    conversations?: { enabled? },
    projects?: { enabled?, root? },
    langfuse?: { enabled?, baseUrl?, publicKey?, secretKey?, flushAt?, flushInterval?, debug? }
  },
  scheduler?: { enabled?, tickSeconds? },
  multiUser?: {
    enabled: boolean,
    oauth?: {
      google: {
        clientId: string,
        clientSecret: string
      }
    },
    allowedDomains?: string[],
    sessionSecret?: string
  },
  web?: { baseUrl? },
  projects?: { root? },            // Deprecated fallback; prefer extensions.projects.root
  ui?: { enabled?, port?, bind?, tailscale? }  // enabled: default true; bind: loopback|lan|tailnet; tailscale: { mode: off|serve }
  // Note: tailscale.mode=serve requires gateway.bind and ui.bind to be loopback
}
```

OneCLI notes:

- Use top-level `onecli` for native gateway/proxy wiring.
- Native OneCLI mode routes traffic through the OneCLI gateway with `HTTP_PROXY`/`HTTPS_PROXY`.
- Per-agent OneCLI tokens are set via `agent.onecliToken` (usually `$env:...`).
- `onecli.ca` controls CA trust propagation for TLS interception.

## Multi-User Mode

- Enable with top-level `multiUser.enabled: true`. When disabled, gateway skips Better Auth setup, SQLite creation, auth middleware, and per-user storage paths.
- Better Auth mounts on `/api/auth/*` with Google OAuth and cookie sessions. `GET /api/me` returns the current user plus assigned agent IDs. Admin-only APIs live under `/api/admin/users` and `/api/admin/agents`.
- Startup flow:
  1. Gateway loads config and checks `multiUser.enabled`
  2. If enabled, it creates `$AIHUB_HOME/auth.db`, runs Better Auth migrations, creates the custom `agent_assignments` table, and initializes the auth runtime before binding the HTTP listener
  3. `/api/*` requests require a valid approved session except `/api/auth/*`; `/ws` upgrades are rejected without a valid session
  4. First OAuth user is promoted to `admin`; later allowed-domain users start as unapproved `user`
- Per-user file isolation:

```text
$AIHUB_HOME/
├── auth.db
├── aihub.json
└── users/
    └── <userId>/
        ├── sessions.json
        ├── claude-sessions.json
        └── history/
```

- Web UI changes in multi-user mode:
  - `/login` shows the Google sign-in entrypoint
  - `AuthGuard` redirects unauthenticated users away from protected routes
  - Sidebar shows account metadata + logout action
  - Admin users get `/admin/users` and `/admin/agents`
- There is no migration path from an existing single-user data directory into per-user ownership. Enabling multi-user mode is a fresh start for auth-owned state.

## Agent Runtime Flow

1. **Config Load**: `loadConfig()` reads `--config`/explicit file paths when provided, else `$AIHUB_HOME/aihub.json` (default `~/.aihub/aihub.json`), validates via Zod
   - If `version` is absent, gateway auto-migrates legacy config into v2-style `components` in memory and logs warnings for ambiguous Discord migrations
   - Top-level `env` is copied into the gateway process when unset there already; safe entries are also forwarded into sandbox containers

- Startup then loads extensions via `apps/gateway/src/extensions/registry.ts` and enabled components via `apps/gateway/src/components/registry.ts`
  - `aihub projects config migrate` now uses the same shared `migrateConfigV1toV2()` helper to preview or persist the v1 -> v2 rewrite locally
  - Migration is intentionally conservative: it only adds component entries when legacy config explicitly implied them, so `amsg`/`conversations` are not auto-added merely because agents exist
  - `README.md` now includes a dedicated built-in components section listing `discord`, `scheduler`, `heartbeat`, `amsg`, `conversations`, and `projects`

2. **Model Resolution**: Pi SDK `discoverModels()` reads `AIHUB_HOME/models.json`
3. **Extension Init**: Extension registry is rebuilt from first-party extensions plus external `extensionsPath` or `$AIHUB_HOME/extensions`, then configured extension mounts are validated for missing ids/config/secrets.
4. **Session Management**: Per-agent/session state in memory (`sessions.ts`)
5. **Skills**: Auto-discovered via Pi SDK from `{workspace}/.pi/skills`, `~/.pi/agent/skills`, etc.
6. **Slash Commands**: Auto-discovered from `{workspace}/.pi/commands`, `~/.pi/agent/commands`
7. **Bootstrap Files**: On first run, creates workspace files from `docs/templates/`. Injected as contextFiles into system prompt.

- Tool-style extensions are injected at agent session start when `agents[].extensions.<id>` is present and not `enabled: false`.
- If `extensionsPath` is unset, external extensions are discovered from `$AIHUB_HOME/extensions` (default `~/.aihub/extensions`).
- External extension discovery accepts both real directories and symlinked directories.
- Tool-extension parameter schemas are object-only Zod schemas.
- Pi adapter converts extension Zod parameter schemas to JSON Schema custom tools.
- Loaded extensions can append agent system-prompt guidance through optional `Extension.getSystemPromptContributions(agent, { config })`. Gateway collection lives in `apps/gateway/src/extensions/prompts.ts`; in-process Pi runs append the returned strings directly, while sandbox/container runs serialize them through `ContainerInput.extensionSystemPrompts` for the runner to append.
- Loaded extensions can expose callable agent tools through optional `Extension.getAgentTools(agent, { config })`. Gateway collection/dispatch lives in `apps/gateway/src/extensions/tools.ts`; in-process Pi runs mount them as `customTools`, while sandbox/container runs serialize definitions through `ContainerInput.extensionTools` and execute them through `/internal/tools`. Model-facing custom tool names are sanitized with `packages/shared/src/tool-names.ts` so providers that reject punctuation see aliases like `scratchpad_read`; gateway dispatch still uses the original extension/tool names.
- Pi lead agents override the Pi SDK default system prompt with AIHub-specific gateway guidance while preserving SDK-appended project context, extension guidance, skills, date, and working directory sections.
- Pi subagent tools and their appended `Additional tools` system-prompt block are only mounted when the `projects` component is actually loaded.
- Sandbox Claude currently fails loudly when extension tools are present; Pi supports extension tool execution in and out of containers.
- When native `onecli` is enabled for an agent, Claude and Pi runs apply scoped `HTTP_PROXY`/`HTTPS_PROXY` plus CA env vars before the run and restore process env afterward.
- Sandbox container manager helpers in `apps/gateway/src/agents/container.ts` build Docker bind mounts, shadow workspace `.env` with `/dev/null`, validate custom mounts against the sandbox allowlist/blocklist, build `docker run -i --rm` args, and provide Docker network/orphan cleanup helpers. `apps/gateway/src/sdk/container/adapter.ts` now spawns ephemeral Docker containers, writes `ContainerInput` to stdin, parses `---AIHUB_OUTPUT_START---`/`---AIHUB_OUTPUT_END---` output, queues follow-ups through `$AIHUB_HOME/ipc/<agentId>/input/*.json`, and stops/kills containers on abort or timeout.
- `apps/gateway/src/server/internal-tools.ts` handles container-to-gateway orchestration callbacks for `project.create`, `project.update`, `project.comment`, and `project.get` (subagent orchestration is CLI-driven via `aihub projects start`).
- Any adapter/run failure that reaches the shared runner catch is logged to gateway stderr before the error event/HTTP 500 is returned. Pi-only post-prompt `stopReason:error` logging remains in the Pi adapter for extra context.

### Modular foundation status

- Phase 1 modular foundation is in place:
  - shared component contracts + v2 config schemas
  - secret resolution for `$env:` and `$secret:`
  - v1 to v2 runtime migration
  - component registry + startup lifecycle wiring
  - `GET /api/capabilities`
- Startup now resolves config secrets once and stores the resolved config as the runtime config exposed by `ComponentContext.getConfig()`.
- Route-owning components now declare `routePrefixes`, and disabled-component 404 middleware is built from static registry metadata instead of a hardcoded list or eager component imports.
- Core routes now live in `apps/gateway/src/server/api.core.ts`.
- Disabled component route requests return `404 { error: "component_disabled", component }`.
- The main server forwards `/api/*` requests into the live `api.core` router instead of snapshot-mounting it at module load, so component routes registered during startup are reachable in dev/prod.

### Workspace Bootstrap

Templates in `docs/templates/` are copied to `{workspace}/` on first agent run (using `flag: 'wx'` to avoid overwriting):

| File           | Purpose                                                    |
| -------------- | ---------------------------------------------------------- |
| `AGENTS.md`    | Workspace overview, memory management, safety guidelines   |
| `SOUL.md`      | Agent persona, core behaviors, boundaries                  |
| `IDENTITY.md`  | Agent name, creature type, vibe, emoji                     |
| `USER.md`      | User profile - name, timezone, context                     |
| `TOOLS.md`     | Environment-specific tool notes (SSH hosts, TTS prefs)     |
| `BOOTSTRAP.md` | First-run ritual - guides identity formation, then deleted |

Bootstrap flow:

1. `ensureBootstrapFiles(workspaceDir)` writes missing files from templates
2. `loadBootstrapFiles(workspaceDir)` reads all files
3. `buildBootstrapContextFiles(files)` converts to Pi SDK contextFiles format
4. Passed to `buildSystemPrompt()` and `createAgentSession()`

### Queue Semantics

When agent is already streaming:

- **queue** (default): Inject message via `AgentSession.queueMessage()`. If Pi session not ready, buffer in `pendingMessages` and inject after session creation.
- **interrupt**: Abort current run, wait up to 2s for streaming to end, start new run.

### WebSocket Protocol

Connect to `/ws` endpoint. Supports two modes:

**Send Mode** (request/response):

```typescript
// Client sends:
{ type: "send", agentId: string, sessionKey?: string, sessionId?: string, message: string }

// Server streams back:
{ type: "text", data: string }
{ type: "tool_start", toolName: string }
{ type: "tool_end", toolName: string, isError?: boolean }
{ type: "done", meta?: { durationMs } }
{ type: "error", message: string }
```

**Subscribe Mode** (persistent connection for live updates):

```typescript
// Client subscribes:
{ type: "subscribe", agentId: string, sessionKey: string }

// Server broadcasts events from ALL runs (including background: amsg, discord, scheduler):
{ type: "text", data: string }
{ type: "tool_start", toolName: string }
{ type: "tool_end", toolName: string, isError?: boolean }
{ type: "done", meta?: { durationMs } }
{ type: "history_updated", agentId: string, sessionId: string }  // UI should refetch history
{ type: "error", message: string }

// Client unsubscribes:
{ type: "unsubscribe" }
```

Web UI uses both: `send` for user messages, `subscribe` for live background updates.

### Session Persistence

Sessions are managed via `sessionKey` (logical name) rather than raw `sessionId`:

- **sessionKey**: Logical key (default: "main") stored in `AIHUB_HOME/sessions.json`
- **sessionId**: Raw UUID, bypasses key resolution if provided directly
- **idleMinutes**: Sessions expire after 360 minutes (6 hours) of inactivity by default; configurable via `sessions.idleMinutes`
- **resetTriggers**: `/new` or `/reset` force a new session; the trigger is stripped from message

Store format: `{agentId}:{sessionKey}` -> `{ sessionId, updatedAt }`

Web UI persists `sessionKey` per agent in localStorage (default "main"). On mount, fetches history via `GET /api/agents/:id/history?sessionKey=main`. Users can type `/new` to start fresh conversation.

### Session Transcript Format

Sessions stored as JSONL in `AIHUB_HOME/sessions/{agentId}-{sessionId}.jsonl`:

```jsonl
{"type":"session","id":"...","timestamp":"...","cwd":"..."}
{"type":"message","timestamp":"...","message":{"role":"user","content":[{"type":"text","text":"..."}],"timestamp":...}}
{"type":"message","timestamp":"...","message":{"role":"assistant","content":[{"type":"thinking","thinking":"..."},{"type":"toolCall","id":"...","name":"...","arguments":{...}},{"type":"text","text":"..."}],"api":"...","provider":"...","model":"...","usage":{...},"stopReason":"..."}}
{"type":"message","timestamp":"...","message":{"role":"toolResult","toolCallId":"...","toolName":"...","content":[{"type":"text","text":"..."}],"isError":false,"details":{"diff":"..."}}}
```

Content block types:

- `text`: Plain text content
- `thinking`: Model reasoning (with thinkingSignature)
- `toolCall`: Tool invocation with id, name, arguments

The history API parses this into `SimpleHistoryMessage` (text-only) or `FullHistoryMessage` (all blocks + metadata) based on `view` param.
`FullHistoryMessage` can now also include `role: "system"` entries for injected channel context, and the web full/log views surface those rows as `System Context`.

## Services

### Scheduler (`src/scheduler/`)

Two schedule types:

- **interval**: `{ type: "interval", everyMinutes: N, startAt?: ISO8601 }`
- **daily**: `{ type: "daily", time: "HH:MM", timezone?: string }`

Jobs stored in `AIHUB_HOME/schedules.json` with state (nextRunAtMs, lastRunAtMs, lastStatus). Timezone calculation uses `Intl.DateTimeFormat` for proper DST handling.

### Discord (`src/discord/`)

Carbon-based Discord integration with per-guild/channel routing, reactions, and slash commands.

**Config schema:**

```typescript
discord: {
  token: string,
  applicationId?: string,           // Required for slash commands

  // DM settings
  dm?: { enabled?, allowFrom?, groupEnabled?, groupChannels? },

  // Guild routing
  groupPolicy?: "open"|"disabled"|"allowlist",  // Default: open
  guilds?: Record<guildId, {
    slug?, requireMention?, reactionNotifications?, reactionAllowlist?,
    users?, systemPrompt?, channels?: Record<channelId, { enabled?, requireMention?, users?, systemPrompt? }>
  }>,

  // Behavior
  historyLimit?: number,            // Default: 20
  clearHistoryAfterReply?: boolean, // Default: true
  replyToMode?: "off"|"all"|"first", // Default: off
  mentionPatterns?: string[],       // Regex patterns to trigger bot
  broadcastToChannel?: string       // Broadcast main session to channel
}
```

**Features:**

- **Message gating**: Bot filter, DM/guild/channel allowlists, mention requirement, user allowlists
- **Context enrichment**: Channel topic, thread starter, message history (ring buffer)
- **Reactions**: `reactionNotifications` modes: off, all, own (bot's messages), allowlist
- **Slash commands**: `/new`, `/abort`, `/help`, `/ping` (when `applicationId` set)
- **Typing indicator**: Starts on inbound, 5s keep-alive, stops on done/error, 30s TTL for queued
- **Chunking**: 2000 char limit with code fence preservation

**Session routing:**

- DMs use `sessionKey: "main"` (shares with web UI)
- Guild messages use `sessionId: discord:${channelId}` (per-channel isolation)

**Live broadcast:** Main-session responses from other sources (web, amsg, scheduler) are broadcast to `broadcastToChannel`. Discord-originated runs are not echoed back (loop prevention via `source` tracking).

### Heartbeat (`src/heartbeat/`)

Periodic agent check-in with Discord alert delivery.

**Config:**

```typescript
heartbeat?: {
  every?: string,      // Duration: "30m", "1h", "0" (disabled). Default: "30m"
  prompt?: string,     // Custom prompt (overrides HEARTBEAT.md)
  ackMaxChars?: number // Max chars after token strip. Default: 300
}
```

**Flow:**

1. Timer fires at `every` interval
2. Prompt resolved: `heartbeat.prompt` > `{workspace}/HEARTBEAT.md` > default
3. Agent runs with `source: "heartbeat"`, `sessionKey: "main"`
4. Reply evaluated:
   - Contains `HEARTBEAT_OK` + content ≤ `ackMaxChars` → status `ok-token`, no delivery
   - Empty reply → status `ok-empty`, no delivery
   - No token or substantial content → status `sent`, delivered to Discord
5. Session `updatedAt` preserved (heartbeat doesn't reset idle timer)

**Token matching:** Strips HTML/Markdown wrappers (`<b>HEARTBEAT_OK</b>`, `**HEARTBEAT_OK**`, etc.)

**Discord delivery:** Requires `discord.broadcastToChannel`. Bot must be ready and gateway connected.

**Skips when:**

- Agent not found
- Heartbeats globally disabled (`setHeartbeatsEnabled(false)`)
- Main session is streaming
- No `broadcastToChannel` configured

**Events:** `onHeartbeatEvent(payload)` for status monitoring. Payload: `{ ts, agentId, status, to?, preview?, alertText?, durationMs?, reason? }`

### Amsg Watcher (`src/amsg/`)

Polls `amsg inbox --new -a <id>` every 60s. Reads amsg ID from `{workspace}/.amsg-info` (JSON with `agent_id` field) - skips agents without this file. Triggers agent with "check inbox" message using `sessionKey: "main"`. Skips if agent is streaming. Agent handles `pull`/`ack` workflow.

## API Endpoints

| Method | Path                                             | Description                                                                                                                 |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/agents`                                    | List active agents                                                                                                          |
| GET    | `/api/agents/:id/status`                         | Agent status                                                                                                                |
| POST   | `/api/agents/:id/messages`                       | Send message (returns result)                                                                                               |
| GET    | `/api/agents/:id/history`                        | Get session history (query: sessionKey, view=simple\|full)                                                                  |
| WS     | `/ws`                                            | WebSocket streaming (JSON protocol)                                                                                         |
| GET    | `/api/schedules`                                 | List schedules                                                                                                              |
| POST   | `/api/schedules`                                 | Create schedule                                                                                                             |
| PATCH  | `/api/schedules/:id`                             | Update schedule                                                                                                             |
| DELETE | `/api/schedules/:id`                             | Delete schedule                                                                                                             |
| GET    | `/api/projects`                                  | List projects                                                                                                               |
| POST   | `/api/projects`                                  | Create project                                                                                                              |
| GET    | `/api/projects/:id`                              | Get project                                                                                                                 |
| PATCH  | `/api/projects/:id`                              | Update project                                                                                                              |
| GET    | `/api/projects/:id/subagents`                    | List project subagents                                                                                                      |
| POST   | `/api/projects/:id/subagents`                    | Spawn project subagent                                                                                                      |
| PATCH  | `/api/projects/:id/subagents/:slug`              | Rename project subagent run                                                                                                 |
| GET    | `/api/subagents`                                 | List runtime runs plus project-backed runs for default/status views; runtime-only filters support parent/status/cwd/archive |
| POST   | `/api/subagents`                                 | Start project-agnostic CLI subagent run                                                                                     |
| GET    | `/api/subagents/:runId`                          | Get runtime subagent run                                                                                                    |
| POST   | `/api/subagents/:runId/resume`                   | Resume completed/interrupted runtime run                                                                                    |
| POST   | `/api/subagents/:runId/interrupt`                | Interrupt runtime run                                                                                                       |
| POST   | `/api/subagents/:runId/archive`                  | Archive runtime run                                                                                                         |
| POST   | `/api/subagents/:runId/unarchive`                | Unarchive runtime run                                                                                                       |
| DELETE | `/api/subagents/:runId`                          | Delete runtime run record                                                                                                   |
| GET    | `/api/subagents/:runId/logs`                     | Read normalized runtime run logs                                                                                            |
| GET    | `/api/projects/:id/space`                        | Get project Space state                                                                                                     |
| POST   | `/api/projects/:id/space/integrate`              | Resume Space integration queue                                                                                              |
| POST   | `/api/projects/:id/space/entries/skip`           | Mark selected pending Space entries as skipped                                                                              |
| POST   | `/api/projects/:id/space/entries/integrate`      | Integrate only selected pending Space entries                                                                               |
| POST   | `/api/projects/:id/space/rebase`                 | Rebase Space branch onto base and refresh pending workers                                                                   |
| POST   | `/api/projects/:id/space/rebase/fix`             | Spawn Space-level rebase fixer agent in main-run mode                                                                       |
| POST   | `/api/projects/:id/space/merge`                  | Merge Space branch into base + optional cleanup                                                                             |
| GET    | `/api/projects/:id/space/commits`                | Get Space commit log                                                                                                        |
| GET    | `/api/projects/:id/space/contributions/:entryId` | Get per-entry contribution diff/log                                                                                         |
| POST   | `/api/projects/:id/space/conflicts/:entryId/fix` | Resume original conflicted worker                                                                                           |
| GET    | `/api/projects/:id/space/lease`                  | Get Space write lease (feature-flagged)                                                                                     |
| POST   | `/api/projects/:id/space/lease`                  | Acquire Space write lease (feature-flagged)                                                                                 |
| DELETE | `/api/projects/:id/space/lease`                  | Release Space write lease (feature-flagged)                                                                                 |
| GET    | `/api/projects/:id/changes`                      | Get project changes (Space-first source resolution)                                                                         |
| POST   | `/api/projects/:id/commit`                       | Commit project changes in resolved source                                                                                   |
| GET    | `/api/projects/:id/pr-target`                    | Get PR compare target for current resolved branch                                                                           |

### Space-First Workspace Model

- Project Space branch: `space/<projectId>`
- Project Space worktree: `<projectsRoot>/.workspaces/<projectId>/_space`
- Persisted state and queue: `<projectDir>/space.json`

Behavior:

- `main-run` subagents execute in the Space worktree.
- `worktree` and `clone` subagents remain isolated sandboxes.
- Worker commit ranges are derived from `start_head_sha..end_head_sha` and queued.
- Worker deliveries remain `pending` until explicit integration (`POST /api/projects/:id/space/integrate`).
- Per-entry queue control is available via:
  - `POST /api/projects/:id/space/entries/skip` (pending -> skipped for selected IDs)
  - `POST /api/projects/:id/space/entries/integrate` (cherry-pick only selected pending IDs)
- Gateway cherry-picks queued SHAs into Space (`git cherry-pick -x`) only during explicit integrate flow.
- `POST /api/projects/:id/space/rebase` rebases Space onto latest base HEAD and rebases each `pending` worker commit range onto new Space HEAD (updates `startSha`/`shas`; worker rebase conflicts become `status=conflict`).
- If Space rebase itself conflicts, Space stores `rebaseConflict` context and leaves rebase in progress for `POST /api/projects/:id/space/rebase/fix` to spawn `space-rebase-fixer` in `main-run`.
- When queue is fully terminal (`integrated`/`skipped` only), `POST /api/projects/:id/space/merge` merges Space into base (`--ff-only` first, fallback regular merge), pushes base when remote exists, and can clean up worker/Space worktrees+branches.
- Merge flow updates project frontmatter status to `done`.
- On conflict, Space queue is blocked (`integrationBlocked=true`) until the worker resolves and re-delivers.
- `POST /api/projects/:id/space/conflicts/:entryId/fix` resumes the original worker with a rebase prompt against current Space HEAD.
- When that worker re-delivers, gateway updates the same conflict entry in place (new SHAs, status reset, `integrationBlocked=false`) instead of appending a new queue row.
- Worker deliveries can include `replaces: string[]` (entry IDs or worker slugs); matching `pending` entries are auto-marked `skipped`.
- Queue statuses include: `pending`, `integrated`, `conflict`, `skipped`, `stale_worker`.
- Stale worker handling:
  - Clone workers are marked `stale_worker` when their base diverges from Space HEAD.
  - Worktree workers can auto-rebase onto Space HEAD when `AIHUB_SPACE_AUTO_REBASE=true` (default).
- Optional Space write lease (`AIHUB_SPACE_WRITE_LEASE=true`):
  - Persists lease at `<projectDir>/space-lease.json`.
  - Enforced for `main-run` workers (acquire on spawn, release on exit/kill).

### Subagent CLI Harnesses

- Supported subagent CLIs: `claude`, `codex`, `pi`.
- Legacy subagent CLIs `droid` and `gemini` are rejected by API validation.
- Runtime split:
  - Lead agents (`sdk: "pi"`) use embedded Pi SDK sessions.
  - Project subagents run as external CLI processes.
- Pi subagent harness uses JSON event mode:
  - Spawn: `pi --mode json --session <session_file> "<prompt>"`
  - Resume: reuses the same `--session <session_file>`.
- Harness-specific model/reasoning flags:
  - Codex: `-m <model>` and `-c reasoning_effort=<xhigh|high|medium|low>` where `<model>` is one of `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.2`
  - Claude: `--model <model>` and `--effort <high|medium|low>`
  - Pi: `--model <id>` and `--thinking <off|low|medium|high|xhigh>`
- Spawn payload supports optional `name` (custom run label). If omitted, UI/CLI fall back to slug/CLI naming.
- Project-detail UI spawn form derives the slug from the displayed run name and de-dupes against existing project subagent slugs (`coordinator`, `worker-2`, etc.).
- `aihub projects start` supports these fields directly:
  - `--agent <cli|aihub:id>`
  - `--subagent <name>`
  - `--name <run-name>`
  - `--model <id>`
  - `--reasoning-effort <level>`
  - `--thinking <level>`
  - `--prompt-role <coordinator|worker|reviewer|legacy>`
  - `--allow-overrides`
  - `--include-default-prompt|--exclude-default-prompt`
  - `--include-role-instructions|--exclude-role-instructions`
  - `--include-post-run|--exclude-post-run`
- `aihub projects start --subagent <name>` sends the selected config subagent name; server resolves `cli`/model/reasoning/runMode/type from `aihub.json`.
- If `--allow-overrides` is set, CLI also sends the resolved defaults client-side and allows explicit override flags.
- Locked fields can be overridden only with `--allow-overrides`.
- Lead-agent launches use `--agent aihub:<id>` and run in project-scoped sessions keyed as `project:<projectId>:<agentId>`.
- `aihub projects status <projectId> --list` prints the existing project subagent session slugs (including archived runs); `--json` returns the slug array.

## Single-Agent Mode

`aihub gateway --agent-id <id>` filters all services to one agent. Useful for isolated testing.

## Gateway as a Service (macOS)

`aihub gateway install|start|stop|status|uninstall` manages a launchd user agent at `~/Library/LaunchAgents/com.aihub.gateway.plist` (label `com.aihub.gateway`, domain `gui/<uid>`). Implementation in `apps/gateway/src/cli/service.ts`. Plist runs `<process.execPath> <abs dist/cli/index.js> gateway` with `WorkingDirectory`/`AIHUB_HOME` set to `CONFIG_DIR`, logs to `$AIHUB_HOME/logs/gateway.{out,err}.log`, `RunAtLoad=true`, `KeepAlive={SuccessfulExit:false}` (restart on crash). Uses modern `launchctl bootstrap`/`bootout`/`kickstart -k`. `install` is idempotent (boots out existing first). `status` parses `launchctl print` for pid/state/last-exit-code and reads `gateway.port`/`ui.port` from config to render an info box. Non-darwin platforms exit with a "macOS launchd only" message — Linux/systemd not yet implemented.

## Direct OAuth Authentication (Pi SDK)

Pi SDK agents can authenticate via OAuth tokens stored in `AIHUB_HOME/auth.json`. This allows running agents without a separate CLIProxyAPI.

### Supported OAuth Providers

- `anthropic` - Anthropic (Claude Pro/Max)
- `openai-codex` - OpenAI Codex
- `github-copilot` - GitHub Copilot
- `google-gemini-cli` - Google Cloud Code Assist (Gemini CLI)
- `google-antigravity` - Antigravity (Gemini 3, Claude, GPT-OSS)

Note: Run `aihub auth login` to see current available providers (list from Pi SDK).

### CLI Commands

```bash
# Login to a provider (interactive)
pnpm aihub auth login

# Login to a specific provider
pnpm aihub auth login anthropic

# Check authentication status
pnpm aihub auth status

# Logout from a provider
pnpm aihub auth logout anthropic
```

### OAuth Agent Config

```json
{
  "agents": [
    {
      "id": "my-agent",
      "name": "My Agent",
      "workspace": "~/agents/my-agent",
      "sdk": "pi",
      "auth": {
        "mode": "oauth"
      },
      "model": {
        "provider": "anthropic",
        "model": "claude-opus-4-5"
      }
    }
  ]
}
```

The `auth.mode` field is optional and can be:

- `oauth` - Require OAuth tokens (fails if not logged in via `aihub auth login`)
- `api_key` - Use only API key credentials or env vars (ignores OAuth tokens)
- `proxy` - Use existing provider config (same as default; for proxy-backed providers in `models.json`)

When `auth.mode` is not set (or `proxy`), Pi SDK's AuthStorage resolves credentials with priority:

1. Runtime override (CLI `--api-key`)
2. API key from `auth.json`
3. OAuth token from `auth.json` (auto-refreshed)
4. Environment variable
5. Fallback resolver (`models.json` custom providers)

The `auth.profileId` field is reserved for future multi-profile support.

**Implementation note:** This feature uses Pi SDK's existing AuthStorage rather than custom credential stores. Migration from legacy `~/.pi/agent/oauth.json` is handled automatically by Pi SDK.

### Storage

Credentials are stored in `AIHUB_HOME/auth.json`:

```json
{
  "anthropic": {
    "type": "oauth",
    "access": "...",
    "refresh": "...",
    "expires": 1767304352803
  },
  "openai": { "type": "api_key", "key": "sk-..." }
}
```

## OpenClaw SDK

The OpenClaw SDK adapter connects AIHub to an [OpenClaw](https://github.com/openclaw/openclaw) gateway via WebSocket, allowing you to interact with OpenClaw agents through the AIHub web UI.

**Config:**

```json
{
  "agents": [
    {
      "id": "cloud",
      "name": "Cloud",
      "workspace": "~/agents/cloud",
      "sdk": "openclaw",
      "openclaw": {
        "gatewayUrl": "ws://127.0.0.1:18789",
        "token": "your-gateway-token",
        "sessionKey": "agent:main:main"
      },
      "model": { "provider": "openclaw", "model": "claude-sonnet-4" }
    }
  ]
}
```

| Field                 | Description                                           |
| --------------------- | ----------------------------------------------------- |
| `openclaw.gatewayUrl` | WebSocket URL (default: `ws://127.0.0.1:18789`)       |
| `openclaw.token`      | Gateway auth token                                    |
| `openclaw.sessionKey` | Target session (use `openclaw sessions list` to find) |

**Protocol:** Uses OpenClaw WebSocket protocol v3 with `backend` client mode. Streams `chat` events with `state: delta/final` for responses, `agent` events for tool calls.

**Notes:**

- `workspace` and `model` are required for schema validation but `model` doesn't control the actual model (configured in OpenClaw)
- Set `OPENCLAW_DEBUG=1` to log raw WebSocket frames

## Claude SDK Proxy Configuration

For Claude SDK agents, you can configure a proxy URL and auth token directly in the agent config instead of using environment variables:

```json
{
  "agents": [
    {
      "id": "my-agent",
      "name": "My Agent",
      "workspace": "~/agents/my-agent",
      "sdk": "claude",
      "model": {
        "model": "claude-sonnet-4-5-20250929",
        "base_url": "http://127.0.0.1:8317",
        "auth_token": "sk-dummy"
      }
    }
  ]
}
```

This sets `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` for that agent's runs. Runs with proxy config are serialized to prevent env var cross-contamination.

## Environment Variables in Config

You can set environment variables directly in `aihub.json` using the `env` field:

```json
{
  "env": {
    "OPENROUTER_API_KEY": "sk-or-...",
    "GROQ_API_KEY": "gsk-...",
    "ANTHROPIC_API_KEY": "sk-ant-..."
  },
  "agents": [...]
}
```

**Behavior:**

- Env vars are applied at config load time (before any agent runs)
- Only applied if not already set in `process.env` (shell env takes precedence)
- Supports any env var recognized by Pi SDK (provider API keys, etc.)

**Common env vars for Pi SDK providers:**

- `ANTHROPIC_API_KEY` - Anthropic
- `OPENAI_API_KEY` - OpenAI
- `OPENROUTER_API_KEY` - OpenRouter
- `GROQ_API_KEY` - Groq
- `GEMINI_API_KEY` - Google Gemini

## Key Dependencies

- **Pi SDK** (`@mariozechner/pi-coding-agent`): Agent runtime, tools, skills, model registry
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`): Claude SDK integration
- **Hono**: HTTP server framework
- **Carbon** (`@buape/carbon`): Discord bot integration (Gateway + REST)
- **Zod**: Schema validation
- **Commander**: CLI framework

## Development

```bash
pnpm install
pnpm dev          # gateway + web UI in dev mode
pnpm dev:gateway  # gateway + shared + web UI with hot reload (production mode)
pnpm dev:web      # web UI only (Vite dev server)
pnpm build        # TypeScript compile
pnpm aihub <cmd>  # Run CLI
```

Set `ui.enabled: false` in config to disable automatic web UI startup.

Dev gateway entrypoints set `NODE_OPTIONS=--conditions=development`, so workspace packages with a development export (`packages/extensions/*` and `packages/shared`) resolve to `src/*.ts` during `pnpm dev`/`pnpm dev:gateway`. This lets extension and shared source edits take effect in dev without rebuilding `dist/`; production imports still use `dist/`.

### Dev Mode (`--dev` flag)

`pnpm dev` runs the gateway with the `--dev` flag, enabling:

- **Auto port discovery**: If ports 4000/3000 are in use, automatically finds free ports (up to +50)
- **Service isolation**: Discord, scheduler, amsg watcher, and heartbeats are disabled
- **Tailscale skip**: No tailscale serve setup (avoids overwriting production routes)
- **Visual identification**:
  - Console banner showing active ports and disabled services
  - Browser tab title: `[DEV :3001] AIHub`
  - Orange `DEV` badge in sidebar

Multiple dev instances can run simultaneously, each auto-discovering unique ports.

To run gateway in production mode for testing:

```bash
pnpm aihub gateway  # No --dev flag, starts all services
```
