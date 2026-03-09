# Hand-off

Date: 2026-03-03
Repo: `/Users/thinh/projects/.workspaces/PRO-146/aihub-project-detail-page-spec-editor`

## Current Status

- Project detail + subagent workflow is active and stable.
- Most recent work focused on realtime refresh correctness, stop/interrupt UX, and template prompt guardrails.
- Test baseline is green on touched suites.

## Recent Updates (Detailed)

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
