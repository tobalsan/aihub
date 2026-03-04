# Hand-off

Date: 2026-03-03
Repo: `/Users/thinh/projects/.workspaces/PRO-146/aihub-project-detail-page-spec-editor`

## Current Status

- Project detail + subagent workflow is active and stable.
- Most recent work focused on realtime refresh correctness, stop/interrupt UX, and template prompt guardrails.
- Test baseline is green on touched suites.

## Recent Updates (Detailed)

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
