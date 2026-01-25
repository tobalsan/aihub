# Hand-off

Date: 2026-01-25
Repo: `/Users/thinh/code/aihub`

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
- Appetite + status selects live in a header above the two-pane layout.

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

### 6) Kanban Web UI (Basic v1)
- New component: `apps/web/src/components/ProjectsBoard.tsx`.
- Routes in `apps/web/src/App.tsx`: `/projects`, `/projects/:id`.
- Taskboard button now links to `/projects` (AgentList + ChatView); Cmd/Ctrl+K navigates there.
- API client/types added for projects: `apps/web/src/api/client.ts`, `apps/web/src/api/types.ts`.

Kanban UI details:
- Horizontal scroll single-row board; columns colored and collapsible (2 expanded max).
- Cards show id/title/meta and created relative time.
- Detail overlay: near-maximized, two panes (detail + monitoring placeholder), ESC/backdrop closes.
- Header above panes: ID pill + title, appetite + status dropdowns.
- Meta row under header: created + editable domain/owner/execution mode (custom dropdown menus) with muted icons.
- Markdown rendered for body with frontmatter + leading H1 stripped.

## Commits
- `feat(projects): add projects API and tests`
- `fix(projects): store created timestamp`
- `docs(projects): document projects API`
- `feat(projects): add projects CLI`
- `feat(web): add projects kanban view`

## Known Issues / Notes
- If gateway running old build, API schema might still require domain/owner/executionMode/appetite. Rebuild shared + gateway, restart.
  - `pnpm --filter @aihub/shared build`
  - `pnpm --filter @aihub/gateway build`
- Detail overlay status/appetite changes are immediate; no optimistic UI beyond local signals.

## Next (Not Done)
- Wire monitoring pane to live agent session view.
- Implement project creation UI in Kanban.
- Optional: drag/drop status moves, filters, search.
- Persist column collapse state (localStorage) if desired.

