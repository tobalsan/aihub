# Hand-off

Date: 2026-01-27 (updated 2026-02-04)
Repo: `/Users/thinh/code/aihub`

---

## Executive Summary: UI v2 Redesign

**Status**: ✅ Implementation complete.

### What Changed

Shifting from **project-centric** to **agent-centric** model:

| Aspect | v1 (Current) | v2 (Planned) |
|--------|--------------|--------------|
| Homepage | Agent list | Kanban board |
| Primary entity | Projects | Agents |
| Project creation | Manual form | Agent-assisted via chat |
| Monitoring | Per-project pane | Unified chat = monitoring |
| Navigation | Drill-down to projects | Agents always visible in sidebar |

### New Layout: Three-Column

```
[Agents Sidebar] [Kanban (primary)] [Context Panel: Feed/Chat]
     250px            flex 1              400px
```

- **Left sidebar**: Lead agents + subagents with status
- **Center**: Kanban board (unchanged, now homepage)
- **Right panel**: Activity feed OR agent chat (mode-switching)
- **Both sidebars collapsible**, auto-collapse on narrow screens
- **Mobile**: Fullscreen overlays for chat/feed

### Agent Model

- **Lead agents** (CTO, PM, etc.): Persistent sessions, can create projects
- **Subagents** (CLI processes): Ephemeral, assigned to projects, killable

### Implementation Phases

1. ~~Kanban as homepage~~ ✓
2. ~~Left sidebar — agents~~ ✓
3. ~~Right panel — context panel (feed/chat)~~ ✓
4. ~~Wire real data~~ ✓
5. ~~Project detail — agent runs list~~ ✓
6. ~~Mobile + polish~~ ✓

**Full spec**: `docs/ui_v2.md`
**Mockup**: `docs/mockups/option-e-three-column.html`

---

## Initial Context
Goal: add a project management/overview system with Kanban and per-project agent sessions. First step: implement Projects API. Projects live in `~/projects` (configurable), flat folder (no status subfolders). Status stored in YAML frontmatter. Status flow: NOT NOW, MAYBE, SHAPING, TODO, IN PROGRESS, REVIEW, DONE. Projects are folders named `PRO-<id>_<slug>` with `README.md` containing YAML frontmatter + markdown body. Additional files (scope/progress/prompt) only for Ralph loops and created ad hoc later.

Kanban UI should mirror Fizzy design choices but basic v1. Route `/projects`. Single-row horizontally scrolling columns. Collapsible columns with up to two expanded at a time. Card click opens near-maximized overlay with details + monitoring pane. No drag/drop in v1; status moves via detail view.

## Decisions (Key)
- Projects root config: `projects.root` in `~/.aihub/aihub.json`. Default `~/projects`.
- Project folder naming: `PRO-<n>_<slug>` (no spaces), slug = lowercase, non-alnum→`_`, collapsed.
- Frontmatter fields: `id, title, status, created, domain, owner, executionMode, appetite`.
- `title` field name (not `name`).
- `status` default on create: `maybe`.
- `domain` values: `life|admin|coding`.
- `executionMode` values: `manual|exploratory|auto|full_auto`.
- `appetite` values: `small|big` (small = 1–2 days, big = full week).
- `owner` is free string (e.g., "Thinh"), not validated.
- Project ID counter stored at `~/.aihub/projects.json` as `{ "lastId": N }`.
- List endpoint returns frontmatter only (for snappy UI). Full README only on `GET /api/projects/:id`.
- Update supports title + frontmatter + README content. If title changes, folder renamed.
- `created` frontmatter uses full ISO timestamp (not date-only).
- API create fields optional except `title` (frontmatter omits missing fields).
- Unset metadata by sending empty string; server deletes frontmatter field.
- CLI should use HTTP API (default), not direct FS; base URL from config + env override.
- CLI output: Markdown tables by default; `--json/-j` for JSON.
- CLI update content supports `--content` string and stdin when `--content -`.
- No `updated` field for now.
- Kanban columns order: Not now → Maybe → Shaping → Todo → In Progress → Review → Done.
- Sort cards by created ascending (oldest first).
- Detail overlay: ESC closes; click backdrop closes.
- Dates shown as: Created today / yesterday / last week / X days ago.
- Markdown rendered in detail; leading YAML frontmatter + H1 stripped to avoid duplicate title.
- Metadata dropdowns for domain/owner/execution mode use custom menus (not native selects) so long owner names don’t reflow layout. Owner options = agents + Thinh.
- Appetite + status now in metadata row (same style + icons).
- Owner + execution mode moved to top of right (monitoring) pane.
- Monitoring pane uses project frontmatter for run config:
  - `runAgent`: `aihub:<agentId>` or `cli:<claude|codex|droid|gemini>`
  - `runMode`: `main-run|worktree` (CLI only)
  - `sessionKeys`: map `{ [agentId]: sessionKey }` for AIHub runs
  - `repo`: required for domain=coding (repo root path)
- CLI agents use Subtask-style workspaces: `{projects.root}/.workspaces/PRO-<id>/<slug>`.
- `logs.jsonl` stores raw CLI stdout JSONL (parse for UI); history uses subtask event schema.
- Start prompt prepends project summary + subagent tool doc (see `docs/agent_interfacing_specs.md`).
- Main CLI worktree branch: `PRO-<id>/<slug>`; slug required for worktree, collision errors.
- Base branch selection per run (default main), not persisted.
- Monitoring pane defaults to `Project Manager` when `runAgent` missing and project status = shaping.
- Shaping runs use `/drill-specs <README.md>` as the start prompt (AIHub + CLI). Execution mode selector hidden when status = shaping.
- CLI runs add safety bypass flags: codex `--dangerously-bypass-approvals-and-sandbox`, claude `--dangerously-skip-permissions`.
- Branch listing and repo handling expand `~` to home in gateway.

## Implemented
### 1) Projects API (Gateway)
- Files added:
  - `apps/gateway/src/projects/store.ts`
  - `apps/gateway/src/projects/index.ts`
- API routes added in `apps/gateway/src/server/api.ts`:
  - `GET /api/projects` (list frontmatter)
  - `POST /api/projects` (create)
  - `GET /api/projects/:id` (full README)
  - `PATCH /api/projects/:id` (update, rename on title change)

Create behavior:
- Allocates ID from `~/.aihub/projects.json`.
- Creates `PRO-<n>_<slug>` directory.
- Writes `README.md` with YAML frontmatter + `# <title>` body.
- Frontmatter includes `status=maybe`, `created` ISO timestamp; other fields only if provided.

Update behavior:
- Reads `README.md`, merges fields, optional content update.
- Renames folder if title slug changes.
- Empty string for domain/owner/executionMode/appetite deletes field.

### 2) Shared types (schemas)
- `packages/shared/src/types.ts`:
  - Added `ProjectsConfigSchema` with `root`.
  - Added project schemas: `ProjectStatusSchema`, `ProjectDomainSchema`, `ProjectExecutionModeSchema`, `ProjectAppetiteSchema`.
  - `CreateProjectRequestSchema` only requires `title`.
  - `UpdateProjectRequestSchema` accepts empty string for domain/owner/executionMode/appetite.

### 3) Projects CLI
- New CLI: `apps/gateway/src/cli/projects.ts`.
- Root script: `"projects": "pnpm --filter @aihub/gateway exec tsx src/cli/projects.ts"`.
- Commands: list/create/get/update/move.
- Base URL resolution: env `AIHUB_API_URL` override; else config `gateway.host/bind` + port.

### 4) Tests
- Integration test: `apps/gateway/src/projects/projects.api.test.ts` (temp HOME + temp root; create/update; cleanup). Adjusted to allow sync/async `Hono.request` type.
- `vitest.config.ts` alias `@aihub/shared` → `packages/shared/src/index.ts`.

### 5) Docs
- New: `docs/projects_api.md`.
- `README.md` updated with project API + CLI + `projects.root` config.
- `docs/llms.md` updated for projects config and endpoints.
- README mentions global `apm` shim for `pnpm projects`.

### 6) Kanban Web UI (Basic v1)
- New component: `apps/web/src/components/ProjectsBoard.tsx`.
- Routes in `apps/web/src/App.tsx`: `/projects`, `/projects/:id`.
- Taskboard button now links to `/projects` (AgentList + ChatView); Cmd/Ctrl+K navigates there.
- API client/types added for projects: `apps/web/src/api/client.ts`, `apps/web/src/api/types.ts`.

Kanban UI details:
- Horizontal scroll single-row board; columns colored and collapsible (2 expanded max).
- Cards show id/title/meta and created relative time.
- Detail overlay: near-maximized, two panes (detail + monitoring placeholder), ESC/backdrop closes.
- Header above panes: ID pill + title.
- Meta row under header: status, created, appetite, domain (icons + dropdowns).
- Owner + execution mode at top of monitoring pane (icons + dropdowns).
- Markdown rendered for body with frontmatter + leading H1 stripped.
- Markdown styling: bullets/spacing, hr spacing, header margins.
- Markdown body container now seamless (no border/background).
- Detail overlay max width: 1920px; detail + monitoring panels are equal width.

### 7) Subagents + Monitoring (Gateway)
- New subagent API + runner:
  - `apps/gateway/src/subagents/index.ts` (list/logs/branches)
  - `apps/gateway/src/subagents/runner.ts` (spawn/interrupt, worktree, resume, logs/history/progress)
- New API routes in `apps/gateway/src/server/api.ts`:
  - `GET /api/projects/:id/subagents`
  - `POST /api/projects/:id/subagents`
  - `POST /api/projects/:id/subagents/:slug/interrupt`
  - `GET /api/projects/:id/subagents/:slug/logs?since=...`
  - `GET /api/projects/:id/branches`
- CLI subagent commands: `apps/gateway/src/cli/subagent.ts` (spawn/status/logs/interrupt).
- Tool integration:
  - Pi: `apps/gateway/src/subagents/pi_tools.ts`
  - Claude: `apps/gateway/src/subagents/claude_tools.ts`
  - Shared handlers: `apps/gateway/src/subagents/tool_handlers.ts`
- Project frontmatter updates wired in `apps/gateway/src/projects/store.ts` (repo/runAgent/runMode/sessionKeys).

### 8) Monitoring UI + client wiring (Web)
- Monitoring pane fully wired in `apps/web/src/components/ProjectsBoard.tsx`.
- API client + types for subagents/branches:
  - `apps/web/src/api/client.ts`
  - `apps/web/src/api/types.ts`
- Prompt helpers: `apps/web/src/components/projectMonitoring.ts`
- Tests: `apps/web/src/api/client.test.ts`, `apps/web/src/components/projectMonitoring.test.ts`
- CLI logs (Codex JSONL) parsed into UI-friendly events; tool calls/output grouped like AIHub.
- Monitoring list now surfaces subagent error state (last_error).

### 9) Docs
- New: `docs/agent_interfacing_decisions.md`
- New: `docs/agent_interfacing_specs.md`

### 10) UI v2 Phase 2 — Agents Sidebar
- Added global subagent list endpoint: `GET /api/subagents`.
- New sidebar component: `apps/web/src/components/AgentSidebar.tsx`.
- Kanban layout now supports left sidebar; main width no longer capped.

### 11) UI v2 Phase 3 — Right Context Panel
- Added context panel with Feed/Chat modes.
- New components: `ContextPanel`, `ActivityFeed`, `AgentChat`.
- Right panel auto-collapses on <1400px, hidden on mobile, and stays open when left sidebar is collapsed.

### 12) UI v2 Phase 4 — Real Data Wiring
- Added `/api/agents/status` and `/api/activity` endpoints.
- Activity feed now polls backend events (simple in-memory tracking).
- Context panel chat wired: AIHub chat uses history + streaming; subagent view is read-only logs.
- Lead agent status dots now reflect streaming state.

## Commits
- `feat(web): persist column collapse state`
- `feat(web): add new session button for monitoring`
- `fix(web): show aihub messages immediately`
- `fix(web): disable stop when idle`
- `fix(web): align project meta row and panel sizing`
- `fix(gateway): show cli stderr and enable claude stream-json`
- `fix(web): format claude cli logs`
- `feat(projects): add projects API and tests`
- `fix(projects): store created timestamp`
- `docs(projects): document projects API`
- `feat(projects): add projects CLI`
- `feat(web): add projects kanban view`
- `refine project detail metadata layout`
- `style project markdown body`
- `docs: add apm shortcut`
- `feat(web): add subagent api client`
- `feat(web): add monitoring prompt helpers`
- `feat(web): build monitoring pane UI`
- `fix(gateway): align subagent tool typings`
- `feat(web): revamp monitoring logs`
- `style(web): refine project markdown links`
- `feat: format codex cli logs`
- `feat(gateway): bypass cli approvals`
- `feat(web): shaping drill-specs start`
- `fix(web): surface subagent errors`
- `fix(gateway): expand repo path for subagent runs`
- `fix(gateway): handle cli spawn errors early`
- `fix(gateway): expand ~ for branches`
- `feat(web): create project from kanban`
- `fix(web): remove redundant subagents button`
- `fix(web): show repo input for all agents`
- `fix(web): validate repo on input (clear error + toast on valid)`
- `fix(web): allow closing subagent logs`
- `fix(web): keep subagent logs scrollable`
- `fix(web): auto-scroll monitoring logs`
- `feat(web): include repo path in start prompt`
- `feat(web): auto-advance todo to in_progress on start`
- `feat(shared): centralize project start prompt builder`
- `feat(gateway): add /api/projects/:id/start endpoint (UI-parity start)`
- `docs: add apm CLI usage guide`
- `fix(cli): route heartbeat through gateway API`
- `fix(web): tailscale serve base + api/ws mapping`
- `fix(web): link legacy header to kanban`
- `fix(web): improve mobile UX for sidebar and project details`
- `feat(web): add avatar squares with initials to sidebar`
- `fix(tests): stabilize heartbeat and activity client tests`
- `feat(sdk): add OpenClaw connector adapter`
- `fix(openclaw): fix WebSocket protocol handshake`
- `fix(openclaw): enable deliver flag to receive response events`
- `fix(openclaw): extract text from message object format`
- `fix(openclaw): handle cumulative delta text`
- `docs: add OpenClaw connector documentation`
- `feat: add image attachment support to Pi and Claude adapters`
- `feat: HTTP file upload instead of WebSocket base64`
- `feat: show file paths in chat log when attachments are sent`
- `feat(projects): drag and drop file attachments in project detail view`
- `Squash merge PRO-33/streaming-fix into main`
- `feat(projects): better project creation form`
- `feat(web): drag projects between columns`
- `feat: add real-time agent status updates via WebSocket`
- `Replace sidebar status dots with pills`
- `Add markdown spacing and font to agent chat`
- `feat: allow omitting model when sdk is openclaw`
- `Fix heartbeat reschedule tests`
- `feat: add subagent.kill tool`
- `feat(web): add kill button for subagents`
- `fix: ensure worktree is created when spawning subagent`
- `fix: require mode and repo for subagent spawn`
- `Squash merge PRO-36/fix-toast-dismiss into main`
- `feat: add --agent flag to apm move and persist activity`
- `Squash merge PRO-30/project-delete into main`
- `Squash merge PRO-34/multi-file-structure into main`

## Recent Improvements
- Context panel: persisted mode + selected agent across refresh; wider panel on large screens.
- Right chat: optimistic user sends, `/new` reset handling, auto-scroll, subagent resume input, and pending spinner.
- Chat input: textarea with Shift+Enter newline and auto-grow up to 10 lines.
- Activity feed: backend cache + pagination; infinite scroll (20 initial) with 10s polling.

## Known Issues / Notes
- Claude SDK runs in Projects monitoring UI can show duplicated/garbled live logs because both local streaming and subscription events update the same live buffer. Fixed by ignoring subscription callbacks while a local stream is active (`apps/web/src/components/ProjectsBoard.tsx`).
- Projects board: column collapse state persisted to localStorage (`aihub:projects:expanded-columns`).
- Projects monitoring: AIHub runs now have a "New" button to reset sessionKey; Start returns after reset.
- Projects monitoring: AIHub user messages show immediately, log auto-scrolls on send/history refresh and when re-expanding main pane.
- Projects monitoring: Stop button disabled when idle; subagent stop disabled unless running.
- Projects detail overlay: meta row aligned and panels fit container (overlay-content flex sizing).
- CLI monitoring: stderr lines streamed into logs; Claude CLI uses `--verbose` for stream-json; Claude stream-json logs are now normalized into user/assistant/tool call/output entries with tool grouping.
- If gateway running old build, API schema might still require domain/owner/executionMode/appetite. Rebuild shared + gateway, restart.
  - `pnpm --filter @aihub/shared build`
  - `pnpm --filter @aihub/gateway build`
- Status/metadata menu close on outside click; may want escape/blur handling later.
- Monitoring UI notes:
  - AIHub runs: logs derived from full history; diffs only for CLI runs.
  - CLI runs: main-run uses slug `main`, worktree uses slug input.
  - Start prompt uses project summary + subagent tool doc for both AIHub/CLI; optional custom prompt appended (not persisted).
  - Shaping runs: `/drill-specs <README.md>` start prompt; execution mode hidden.
  - Main/subagent panes are mutually exclusive; collapsed vertical bar toggles between them.
  - Session input: Enter sends, Shift+Enter newline; auto-expands up to 10 lines.
  - Log UI: single-column, color-coded by role; tool calls collapsed by default with icons; read/write/bash grouped with output; expanded content has darker background; no timestamps.
  - Repo input shown for any agent (domain=coding).
- Stop for AIHub sends `/abort`; CLI uses interrupt API.
- Manual CLI heartbeats now call gateway API; requires gateway + Discord bot running for delivery.
- Start prompt now appends repo path when set.
- Starting a run while status=todo auto-updates status to in_progress.
- Tailscale serve: UI uses base `/aihub` (no trailing slash). Serve config must map `/aihub` -> `http://127.0.0.1:3000/aihub` and `/api`,`/ws` -> gateway port (web dev script now sets these).
- Project start prompt logic now shared between web + gateway.
- `apm` CLI docs now live at `docs/cli-apm.md`.
- OpenClaw connector: Debug with `OPENCLAW_DEBUG=1`; delta events are cumulative (not incremental).
- Image attachments: Subagent CLI spawning doesn't support attachments yet (only lead agents).
- Uploaded files stored in `~/.aihub/media/inbound/`; no cleanup/expiry currently implemented.
- Project deletion is soft delete (moves to `{projects.root}/trash/`).
- Multi-file projects: frontmatter only written to SPECS.md; legacy `readme`/`specs` fields still supported.
- Kill subagent: Worktree mode also deletes the git branch; main-run mode only removes workspace.

### 13) UI v2 Phase 5 — Project Detail Agent Runs
- Replaced monitoring pane with Agent Runs list in project detail overlay.
- Shows active + past runs from subagents and sessionKeys.
- Click run to expand logs; relative timestamps.
- Removed ~600 lines of unused streaming/monitoring logic.

### 14) UI v2 Phase 6 — Mobile & Polish
- Mobile responsive breakpoints (≤768px): right panel hidden, sidebar fixed/collapsed.
- Fullscreen chat overlay when clicking agent on mobile.
- Floating activity button (bottom-right) opens fullscreen feed overlay.
- ESC key closes mobile overlays.
- Added overlay animations (fade + scale), focus-visible states for accessibility.
- Smooth transitions on collapse/expand.

### 15) OpenClaw Connector
- New SDK adapter for OpenClaw gateway integration via WebSocket.
- WebSocket protocol v3 with proper handshake (connect → chat.history → chat.send).
- Supports streaming responses, tool call/result events, full transcript history.
- Config: `gatewayUrl`, `token`, `sessionKey` in agent's `openclaw` field.
- Model field optional when `sdk === "openclaw"` (defaults to `{ provider: "openclaw", model: "unknown" }`).
- File attachments: paths appended to message text (OpenClaw auto-detects).
- Debug mode: `OPENCLAW_DEBUG=1` logs raw frames.
- Files:
  - `apps/gateway/src/sdk/openclaw/adapter.ts`
  - `apps/gateway/src/sdk/openclaw/adapter.test.ts`

### 16) Image/File Attachments
- HTTP file upload via `/api/media/upload` (multipart/form-data).
- Files saved to `~/.aihub/media/inbound/{uuid}.{ext}`.
- Supported types: images (JPEG, PNG, GIF, WebP, SVG), documents (PDF, MD, TXT), office (DOCX, XLSX, PPTX), code/data (JSON, CSV, HTML, CSS, JS).
- UI: paperclip button + drag-and-drop in AgentChat.
- Pending files shown as pills with remove button before send.
- SDK adapters handle attachments differently:
  - Claude/Pi: Read files, convert to base64, build multimodal content.
  - OpenClaw: Append file paths to message text (auto-detected).
- Chat log shows `📎 {path}` for sent attachments.
- Files:
  - `apps/gateway/src/media/upload.ts`
  - `apps/web/src/components/AgentChat.tsx` (attachment UI)
  - `apps/gateway/src/sdk/{claude,pi,openclaw}/adapter.ts`

### 17) Subagent Kill
- Kill tool terminates supervisor process via SIGTERM.
- Worktree mode: removes git worktree, deletes branch, cleans workspace.
- Main-run mode: removes workspace directory only.
- Auto-cleans empty parent folder after last subagent killed.
- API endpoint: `POST /api/projects/:id/subagents/:slug/kill`.
- UI: Kill button in AgentChat header (subagent view) and ProjectsBoard run rows.
- Confirmation dialog before kill; error toast on failure.
- Files:
  - `apps/gateway/src/subagents/runner.ts` (`killSubagent()`)
  - `apps/web/src/components/AgentChat.tsx` (kill button)
  - `apps/web/src/components/ProjectsBoard.tsx` (kill button in run rows)

### 18) Real-Time Agent Status Updates
- WebSocket-based status broadcasting (streaming/idle).
- Event bus emits `AgentStatusChangeEvent` when agent overall status changes.
- Clients subscribe via `subscribeStatus` message.
- Sidebar status pills update in real-time (IDLE: gray, WORKING: green).
- Replaced status dots with styled pills (border-radius 999px, uppercase text).
- Files:
  - `apps/gateway/src/agents/events.ts` (event types)
  - `apps/gateway/src/agents/sessions.ts` (`setSessionStreaming()`)
  - `apps/gateway/src/server/index.ts` (broadcast)
  - `apps/web/src/components/AgentSidebar.tsx` (status pills)

### 19) Project Deletion (PRO-30)
- Soft delete: moves project folder to `{projects.root}/trash/`.
- Returns metadata: `{ id, path, trashedPath }`.
- Error if trash already contains same project name.
- API endpoint: `DELETE /api/projects/:id`.
- UI: Delete button in project detail view with success toast.
- Files:
  - `apps/gateway/src/projects/store.ts` (`deleteProject()`)
  - `apps/web/src/components/ProjectsBoard.tsx`

### 20) Multi-File Document Structure (PRO-34)
- Projects support multiple markdown files beyond README/SPECS.
- `docs` field: `Record<string, string>` mapping filename → content.
- Files without `.md` extension converted to uppercase keys.
- Primary file priority: SPECS.md > README.md > first `.md` file.
- Frontmatter written only to SPECS.md.
- Backward compatible with legacy `readme` and `specs` fields.
- Files:
  - `apps/gateway/src/projects/store.ts` (getProject, createProject, updateProject)
  - `apps/web/src/components/ProjectsBoard.tsx` (doc tabs UI)

### 21) Kanban Drag-and-Drop
- Drag projects between status columns.
- Updates project `status` frontmatter on drop.
- Optimistic UI update before server confirmation.
- Files:
  - `apps/web/src/components/ProjectsBoard.tsx` (drag event handlers)

### 22) Project Attachments
- Drag-and-drop file attachments in project detail view.
- View mode: upload immediately, append links to docs.
- Edit mode: queue files for upload on save.
- Files stored in `{projectDir}/attachments/`.
- Max file size: 20MB; auto-generates unique names on collision.
- IndexedDB stores pending files during editing.
- API endpoints:
  - `POST /api/projects/:id/attachments` (upload)
  - `GET /api/projects/:id/attachments/:name` (fetch)
- Files:
  - `apps/gateway/src/projects/store.ts` (`saveAttachments()`, `resolveAttachmentFile()`)
  - `apps/web/src/components/ProjectsBoard.tsx` (drag-drop handlers)

### 23) Project Creation Form Redesign
- Enhanced form with title, description, and drag-and-drop file uploads.
- Multiple files supported; stored in IndexedDB during editing.
- On submit, files uploaded to `attachments/` and links added to README.
- Form state persisted to localStorage.
- Files:
  - `apps/web/src/components/ProjectsBoard.tsx` (create form)

### 24) Project Thread/Comments
- Comments stored in `THREAD.md` file per project.
- Format: frontmatter + sections separated by `---\n---\n`.
- Each entry: `[author:X]\n[date:Y]\n{body}`.
- Auto-created on project create/update if missing.
- API endpoints:
  - `POST /api/projects/:id/comments` (append comment)
  - `PATCH /api/projects/:id/comments/:index` (update comment)
- Files:
  - `apps/gateway/src/projects/store.ts` (`appendComment()`, `updateComment()`)

### 25) UI/UX Polish
- **Avatar squares**: Agent initials in colored squares (28×28px); green when running.
- **Mobile sidebar**: Slide-out with hamburger toggle; click-outside dismisses.
- **Mobile project details**: Scrollable panel with tab switcher (Details/Agent Runs).
- **Legacy header link**: "AIHub" h1 now links to `/projects`.
- **Toast dismiss**: Escape key or click dismisses success toast.
- **Chat markdown**: Rich text with proper typography (system fonts, code blocks, spacing).
- **Streaming tool calls**: Visual feedback for read/bash/write tools as they execute.
- **Agent chat font**: 0xProto Nerd Font Mono for log text.
- Files:
  - `apps/web/src/components/AgentSidebar.tsx`
  - `apps/web/src/components/AgentChat.tsx`
  - `apps/web/src/components/AgentList.tsx`
  - `apps/web/src/components/ProjectsBoard.tsx`

### 26) Dev Mode (`--dev` flag)
- Enables fast iteration by running dev instances alongside production.
- Auto port discovery: scans from base port +50 if default ports (4000/3000) are in use.
- Service isolation: Discord, scheduler, amsg watcher, heartbeats all disabled in dev mode.
- Tailscale skip: no `tailscale serve` setup (avoids overwriting production routes).
- Visual identification:
  - Console banner showing active ports and disabled services
  - Browser tab title: `[DEV :port] AIHub`
  - Orange `DEV` badge in sidebar header
- Multiple dev instances can run simultaneously with unique ports.
- `pnpm dev` always passes `--dev`; `pnpm dev:gateway` runs without it for production-like testing.
- Files:
  - `apps/gateway/src/server/ports.ts` (new: `findFreePort()`, `isPortFree()`)
  - `apps/gateway/src/cli/index.ts` (`--dev` flag, conditional service startup, banner)
  - `scripts/dev.ts` (port discovery, passes `--dev` + ports to subprocesses)
  - `apps/web/vite.config.ts` (reads `AIHUB_GATEWAY_PORT`, injects `__AIHUB_DEV__`)
  - `apps/web/scripts/dev.ts` (skips Tailscale when `AIHUB_DEV=1`)
  - `apps/web/src/globals.d.ts` (new: TypeScript declarations for Vite globals)
  - `apps/web/src/App.tsx` (dynamic document title)
  - `apps/web/src/components/AgentSidebar.tsx` (DEV badge)

## Next (Not Done)

### UI v2 — Complete ✓
All 6 phases implemented. See `docs/ui_v2.md` for full spec.

### Deferred
- Quick create (floating button / keyboard shortcut)
- Notifications (agent needs attention, task finished)
- File upload cleanup/expiry (currently no auto-cleanup of `~/.aihub/media/inbound/`)
