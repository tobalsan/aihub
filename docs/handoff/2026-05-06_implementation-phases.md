# AIHub Implementation Phases

**Date**: 2026-05-06  
**Based on**: `2026-05-06_architecture-audit.md`  
**Goal**: Break audit findings into 10 small, standalone phases suitable for one agent session each

---

## Phase 1: Consolidate Frontmatter Parser into `@aihub/shared`

**Findings**: F-01  
**Complexity**: S | **Estimated time**: 45 min

### Scope
- Create `packages/shared/src/frontmatter.ts` using the most complete version (from `projects`)
- Ensure it handles all edge cases from all three versions (`null` vs `undefined`, `"[]"` handling, double-quote JSON)
- Re-export from `packages/shared/src/index.ts`
- Update consumers:
  - `apps/gateway/src/util/frontmatter.ts` → re-export from shared
  - `packages/extensions/board/src/frontmatter.ts` → re-export from shared
  - `packages/extensions/projects/src/util/frontmatter.ts` → re-export from shared

### Success criteria
- `pnpm typecheck` passes
- `pnpm test` passes
- All three original files are now thin re-exports (≤3 lines each)

### File targets
- `packages/shared/src/frontmatter.ts` (NEW)
- `packages/shared/src/index.ts` (add export)
- `apps/gateway/src/util/frontmatter.ts` (replace)
- `packages/extensions/board/src/frontmatter.ts` (replace)
- `packages/extensions/projects/src/util/frontmatter.ts` (replace)

---

## Phase 2: Consolidate FS and Path Utilities into `@aihub/shared`

**Findings**: F-02, F-03  
**Complexity**: S | **Estimated time**: 45 min

### Scope
- Create `packages/shared/src/fs.ts` with the union of both FS utility files
- Create `packages/shared/src/paths.ts` with the full paths utility (from projects)
- Re-export from `packages/shared/src/index.ts`
- Update consumers:
  - `apps/gateway/src/util/fs.ts` → re-export from shared
  - `apps/gateway/src/util/paths.ts` → re-export from shared
  - `packages/extensions/projects/src/util/fs.ts` → re-export from shared
  - `packages/extensions/projects/src/util/paths.ts` → re-export from shared

### Success criteria
- `pnpm typecheck` passes
- `pnpm test` passes
- Original files are thin re-exports

### File targets
- `packages/shared/src/fs.ts` (NEW)
- `packages/shared/src/paths.ts` (NEW)
- `packages/shared/src/index.ts` (add exports)
- `apps/gateway/src/util/fs.ts` (replace)
- `apps/gateway/src/util/paths.ts` (replace)
- `packages/extensions/projects/src/util/fs.ts` (replace)
- `packages/extensions/projects/src/util/paths.ts` (replace)

---

## Phase 3: Move `agentEventBus` to Shared and Fix Boundary Violations

**Findings**: F-14, F-17 (partial)  
**Complexity**: S | **Estimated time**: 30 min

### Scope
- Create `packages/shared/src/events.ts` (or extend existing) with a standalone `AgentEventBus` class
- Move or re-export `agentEventBus` from shared
- Update `apps/gateway/src/agents/events.ts` to import from shared
- Fix test boundary violations:
  - `packages/extensions/projects/src/projects/watcher.events.test.ts`
  - `packages/extensions/projects/src/projects/watcher.fs.test.ts`
- Update vitest aliases if needed

### Success criteria
- `pnpm typecheck` passes
- `pnpm test` passes
- No `import` in `packages/` references `apps/gateway/src/`

### File targets
- `packages/shared/src/events.ts` (extend or create)
- `apps/gateway/src/agents/events.ts` (update to re-export)
- `packages/extensions/projects/src/projects/watcher.events.test.ts` (fix import)
- `packages/extensions/projects/src/projects/watcher.fs.test.ts` (fix import)

---

## Phase 4: Fix History Store Swallowed Errors

**Findings**: F-12  
**Complexity**: S | **Estimated time**: 30 min

### Scope
- Audit all 9 empty `catch {}` blocks in `apps/gateway/src/history/store.ts`
- Add appropriate error logging (`console.warn` or `console.error`) to each
- Classify each catch:
  - **Expected failures** (e.g., file not found during backfill) → `console.warn` with context
  - **Unexpected failures** (e.g., JSON parse error on existing file) → `console.error` with full error
  - **Truly ignorable** (e.g., temp file cleanup) → keep empty but add `// intentionally swallowed: <reason>` comment
- Ensure no behavioral change (still catch and handle gracefully)

### Success criteria
- `pnpm typecheck` passes
- `pnpm test` passes
- Every `catch` block has either logging or an explicit comment explaining why it's empty

### File targets
- `apps/gateway/src/history/store.ts`

---

## Phase 5: Deduplicate RunAgentParams/RunAgentResult Types

**Findings**: F-06  
**Complexity**: S | **Estimated time**: 45 min

### Scope
- Keep `RunAgentParams` in `packages/shared/src/types.ts` as the base/extension-facing type
- In `apps/gateway/src/agents/runner.ts`, rename gateway-specific params to `InternalRunAgentParams` that extends the shared type:
  ```ts
  import type { RunAgentParams as SharedRunAgentParams } from "@aihub/shared";
  export type InternalRunAgentParams = SharedRunAgentParams & {
    resolvedSession?: { ... };
    onEvent?: (event: StreamEvent) => void;
    trace?: AgentTraceContext;
  };
  ```
- Similarly for `RunAgentResult` — shared has the extension-facing shape, gateway extends it
- Update all internal gateway references to use `InternalRunAgentParams`

### Success criteria
- `pnpm typecheck` passes
- `pnpm test` passes
- No duplicate type definition — gateway type explicitly extends shared type

### File targets
- `packages/shared/src/types.ts` (keep as-is)
- `apps/gateway/src/agents/runner.ts` (refactor type)
- Any files importing from runner that need updated types

---

## Phase 6: Deduplicate MIME Map and File-Serving in API Core

**Findings**: F-11  
**Complexity**: S | **Estimated time**: 30 min

### Scope
- Extract a shared `IMAGE_MIME_MAP` constant (union of logo + avatar maps)
- Extract a `serveImageFile(c, filePath)` helper that handles stat → content-type → stream → response
- Use the helper in 3 locations:
  - `/api/branding/logo` route
  - `/api/agents/:id/avatar` route
  - `/api/media/download/:id` route (slightly different, may need minor adaptation)

### Success criteria
- `pnpm typecheck` passes
- `pnpm test` passes
- No duplicate `mimeMap` definitions

### File targets
- `apps/gateway/src/server/api.core.ts`

---

## Phase 7: Unify Allowlist Utilities

**Findings**: F-04  
**Complexity**: S | **Estimated time**: 45 min

### Scope
- Create `packages/shared/src/allowlist.ts` with parameterized allowlist matching:
  ```ts
  export function matchesAllowlist(
    target: string,
    aliases: string[],
    allowlist: AllowlistEntry[]
  ): boolean
  ```
- Discord version adds username/tag matching — keep as a thin wrapper
- Slack version becomes a thin wrapper
- Both packages import core logic from shared

### Success criteria
- `pnpm typecheck` passes
- `pnpm test` passes (including existing allowlist tests)
- Core matching logic is in shared, extensions wrap it

### File targets
- `packages/shared/src/allowlist.ts` (NEW)
- `packages/extensions/discord/src/utils/allowlist.ts` (refactor)
- `packages/extensions/slack/src/utils/allowlist.ts` (refactor)

---

## Phase 8: Split `api/client.ts` into Domain Modules

**Findings**: F-10  
**Complexity**: M | **Estimated time**: 90 min

### Scope
- Split the 2163-line client into focused modules:
  - `api/agent.ts` — agent CRUD and status
  - `api/history.ts` — history fetching
  - `api/messaging.ts` — sendMessage, streamMessage, abort
  - `api/ws.ts` — WebSocket connection, reconnection, subscription
  - `api/media.ts` — file upload/download
  - `api/projects.ts` — project CRUD, spaces, slices
  - `api/subagents.ts` — subagent management
  - `api/schedules.ts` — schedule CRUD
  - `api/client.ts` — re-exports everything for backward compat
- Maintain exact same public API surface
- Move shared constants (`API_BASE`, `SESSION_KEY_PREFIX`) to a `api/constants.ts`

### Success criteria
- `pnpm typecheck` passes
- `pnpm test:web` passes
- `api/client.ts` is a re-export barrel ≤50 lines
- All existing imports continue to work

### File targets
- `apps/web/src/api/client.ts` (become barrel)
- `apps/web/src/api/agent.ts` (NEW)
- `apps/web/src/api/history.ts` (NEW)
- `apps/web/src/api/messaging.ts` (NEW)
- `apps/web/src/api/ws.ts` (NEW)
- `apps/web/src/api/media.ts` (NEW)
- `apps/web/src/api/projects.ts` (NEW)
- `apps/web/src/api/subagents.ts` (NEW)
- `apps/web/src/api/schedules.ts` (NEW)
- `apps/web/src/api/constants.ts` (NEW)

---

## Phase 9: Standardize API Error Responses

**Findings**: F-16  
**Complexity**: S | **Estimated time**: 30 min

### Scope
- Create a helper in gateway for consistent error responses:
  ```ts
  function errorResponse(c: Context, status: number, error: string, details?: Record<string, unknown>)
  ```
- Update all API routes to use the helper
- Standardize error shape: `{ error: string, ...details? }`
- No breaking changes to existing error shapes (additive only)

### Success criteria
- `pnpm typecheck` passes
- `pnpm test` passes
- All error responses use the helper

### File targets
- `apps/gateway/src/server/api.core.ts`
- `apps/gateway/src/server/errors.ts` (NEW)

---

## Phase 10: Add Missing Vitest Extension Aliases

**Findings**: F-23  
**Complexity**: XS | **Estimated time**: 15 min

### Scope
- Add aliases for `@aihub/extension-board` and `@aihub/extension-subagents` to `vitest.config.ts`:
  ```ts
  { find: "@aihub/extension-board", replacement: extSrc("board") },
  { find: "@aihub/extension-subagents", replacement: extSrc("subagents") },
  ```
- Verify no other extensions are missing

### Success criteria
- `pnpm test` passes
- All extension imports resolve to `src/` in tests

### File targets
- `vitest.config.ts`

---

## Phase 11: Refactor Web API Types to Maximize Shared Imports

**Findings**: F-15  
**Complexity**: M | **Estimated time**: 60 min

### Scope
- Audit `apps/web/src/api/types.ts` and replace local type definitions with shared imports where possible
- For types that differ from shared (e.g., `Agent` has a different shape), document why and consider adding a shared API response type
- Remove type aliases that are pure re-exports (`Area = SharedArea`, etc.)
- Create API-specific response types in shared where they're missing (e.g., `AgentApiResponse`)

### Success criteria
- `pnpm typecheck` passes
- `pnpm test:web` passes
- `apps/web/src/api/types.ts` reduced by at least 30%

### File targets
- `apps/web/src/api/types.ts`
- `packages/shared/src/types.ts` (potentially add API response types)

---

## Phase 12: Extract `runAgent()` Sub-Flows from `runner.ts`

**Findings**: F-13  
**Complexity**: M | **Estimated time**: 90 min

### Scope
- Extract the abort flow (lines 170-251) into `handleAbort(params): Promise<RunAgentResult>`
- Extract the queue/interrupt flow (lines 400-456) into `handleConcurrentMessage(params): Promise<RunAgentResult | undefined>`
- Extract the think level directive handling (lines 299-376) into `handleThinkDirective(params): Promise<{ level, message, handled }>`
- Keep the main `runAgent()` function as an orchestrator that calls these sub-flows
- Add unit tests for each extracted function

### Success criteria
- `pnpm typecheck` passes
- `pnpm test` passes
- `runAgent()` reduced to ~150 lines of orchestration
- Each sub-flow has at least basic unit test coverage

### File targets
- `apps/gateway/src/agents/runner.ts` (refactor)
- `apps/gateway/src/agents/runner.abort.ts` (NEW)
- `apps/gateway/src/agents/runner.queue.ts` (NEW)
- `apps/gateway/src/agents/runner.think.ts` (NEW)
- `apps/gateway/src/agents/runner.test.ts` (NEW)

---

## Phase Ordering Recommendation

Phases are designed to be **independent** and can be applied in any order. However, this is the recommended sequence based on risk and impact:

| Order | Phase | Rationale |
| ----- | ----- | --------- |
| 1     | Phase 10 | Trivial, zero-risk, immediate test reliability improvement |
| 2     | Phase 3  | Fixes boundary violation — architectural correctness |
| 3     | Phase 4  | Low-risk observability improvement |
| 4     | Phase 1  | Highest-value deduplication (3-way copy) |
| 5     | Phase 2  | Second deduplication pass |
| 6     | Phase 5  | Type safety improvement |
| 7     | Phase 6  | Small API cleanup |
| 8     | Phase 7  | Allowlist unification |
| 9     | Phase 9  | Error standardization |
| 10    | Phase 8  | Largest refactor — API client split |
| 11    | Phase 11 | Web types cleanup |
| 12    | Phase 12 | Runner decomposition (most complex) |

**Phases 8, 11, and 12** are the largest and can be deferred to later sessions if needed.
