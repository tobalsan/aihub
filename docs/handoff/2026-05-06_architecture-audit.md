# AIHub Architecture Audit

**Date**: 2026-05-06  
**Branch**: `refactor/codebase-architecture`  
**Auditor**: Automated (Phase 0)  
**Scope**: Full codebase — `apps/gateway`, `apps/web`, `packages/shared`, `packages/extensions/*`

---

## Executive Summary

The AIHub codebase is a well-structured TypeScript monorepo (~127K lines of TS/TSX) with clear separation between the gateway (Hono API), web frontend (SolidJS), shared types, and 10 extension packages. The architecture follows solid patterns: Zod-validated config, extension-based plugin system, event-driven agent runtime.

Key areas for improvement focus on **code duplication** (especially utilities copied across packages), **large files** that are difficult to navigate and test, **type duplication** between gateway and shared, and **cross-package boundary violations** in tests.

---

## Findings

### F-01: Triple Frontmatter Parser Duplication

- **WHAT**: The frontmatter parser (`parseFrontmatter`, `splitFrontmatter`) is implemented three times with slight variations
- **WHERE**:
  - `apps/gateway/src/util/frontmatter.ts` (93 lines, 2604 chars)
  - `packages/extensions/board/src/frontmatter.ts` (93 lines, 2604 chars) — identical to gateway
  - `packages/extensions/projects/src/util/frontmatter.ts` (103 lines, 2777 chars) — slightly different (`null` vs `undefined`, double-quote JSON parsing)
- **WHY**: Bug fixes and feature additions must be applied in three places. The three versions have already diverged (projects version handles `null` differently), creating subtle behavioral inconsistencies.
- **COMPLEXITY**: S  
- **PRIORITY**: High

### F-02: Duplicated Filesystem Utilities

- **WHAT**: FS utility functions (`ensureDir`, `safeWriteFile`, etc.) are duplicated between gateway and projects extension
- **WHERE**:
  - `apps/gateway/src/util/fs.ts`
  - `packages/extensions/projects/src/util/fs.ts`
- **WHY**: Any FS-related bug fix or enhancement requires changes in two places. Divergence risk is high.
- **COMPLEXITY**: S  
- **PRIORITY**: High

### F-03: Duplicated Path Utilities

- **WHAT**: Path resolution utilities exist in two locations with different levels of completeness
- **WHERE**:
  - `apps/gateway/src/util/paths.ts` (395 chars — minimal)
  - `packages/extensions/projects/src/util/paths.ts` (1.8K chars — full-featured)
- **WHY**: The gateway has a stripped-down version while projects has the complete one. Gateway may be missing functionality or has a stale copy.
- **COMPLEXITY**: S  
- **PRIORITY**: Medium

### F-04: Duplicated Allowlist Logic (Discord vs Slack)

- **WHAT**: User/channel allowlist matching logic exists in both Discord and Slack extensions with different APIs
- **WHERE**:
  - `packages/extensions/discord/src/utils/allowlist.ts` (103 lines — full: users, channels, tags, discriminators)
  - `packages/extensions/slack/src/utils/allowlist.ts` (19 lines — minimal: user ID only)
- **WHY**: The Slack version is a much-simplified copy. If the Discord allowlist gains features (e.g., role-based matching), Slack won't benefit. The core matching logic should be parameterized in shared.
- **COMPLEXITY**: S  
- **PRIORITY**: Medium

### F-05: Duplicated Notification Modules

- **WHAT**: Notification sending logic exists in both shared and gateway CLI
- **WHERE**:
  - `packages/shared/src/notify.ts` (6.5K — full notification dispatcher)
  - `apps/gateway/src/cli/notify.ts` (3K — CLI-specific notification)
- **WHY**: Two separate implementations with overlapping responsibility. Shared should be the single source, gateway CLI should consume it.
- **COMPLEXITY**: S  
- **PRIORITY**: Medium

### F-06: `RunAgentParams` / `RunAgentResult` Type Duplication

- **WHAT**: Both `RunAgentParams` and `RunAgentResult` types are defined in both `@aihub/shared` and gateway's `runner.ts` with different shapes
- **WHERE**:
  - `packages/shared/src/types.ts` lines 667-688 (shared version — simpler, for extension API)
  - `apps/gateway/src/agents/runner.ts` lines 63-91 (gateway version — richer, internal)
- **WHY**: The gateway version has additional fields (`resolvedSession`, `onEvent`, `trace`, `attachments`) that extensions don't need. However, the shared version is used in `ExtensionContext.runAgent()`. This creates confusion about which type to import and whether they're compatible. The gateway type should extend the shared type.
- **COMPLEXITY**: S  
- **PRIORITY**: High

### F-07: DiscordContextBlock / SlackContextBlock Near-Duplication

- **WHAT**: `DiscordContextBlock` and `SlackContextBlock` in shared types are structurally identical (7 variants each) — only the `channel` discriminant differs (`"discord"` vs `"slack"`)
- **WHERE**: `packages/shared/src/types.ts` lines 1425-1491
- **WHY**: Any new context block type (e.g., `thread_replies`, `attachments`) must be added to both. The types are 95% identical and could be generic.
- **COMPLEXITY**: S  
- **PRIORITY**: Low

### F-08: `AgentChat.tsx` — 4053-Line Monolith

- **WHAT**: The `AgentChat` component is the largest file in the codebase at 4053 lines
- **WHERE**: `apps/web/src/components/AgentChat.tsx`
- **WHY**: Extremely difficult to navigate, test, and review. Mixes concerns: message rendering, streaming logic, subagent management, file uploads, virtualization, zen mode, tool call rendering. Changes are risky.
- **COMPLEXITY**: L  
- **PRIORITY**: High

### F-09: `ChatView.tsx` — 3604-Line Component

- **WHAT**: The `ChatView` component is the second-largest file at 3604 lines
- **WHERE**: `apps/web/src/components/ChatView.tsx`
- **WHY**: Similar issues to AgentChat — too many concerns in a single component. Likely duplicates some logic with AgentChat.
- **COMPLEXITY**: L  
- **PRIORITY**: Medium

### F-10: `api/client.ts` — 2163-Line API Client

- **WHAT**: The web API client is a single 2163-line file containing all API calls, WebSocket management, and session state
- **WHERE**: `apps/web/src/api/client.ts`
- **WHY**: Every frontend change that touches API logic modifies this file. WebSocket reconnection, message streaming, history fetching, subagent management, file uploads — all in one file. High merge conflict risk.
- **COMPLEXITY**: M  
- **PRIORITY**: High

### F-11: `api/core.ts` — 524-Line Route File with Repeated Patterns

- **WHAT**: The core API routes file has repeated MIME type maps and file-serving patterns
- **WHERE**: `apps/gateway/src/server/api.core.ts`
- **WHY**: The `mimeMap` Record is defined twice (lines 124-130 and 252-258) with slight differences (avatar includes `.gif`). The file-serving pattern (stat → stream → headers) is repeated 3 times (logo, avatar, media download).
- **COMPLEXITY**: S  
- **PRIORITY**: Medium

### F-12: `history/store.ts` — 16.9K Line History Store with Swallowed Errors

- **WHAT**: The history store has 9 empty `catch {}` blocks that silently swallow errors
- **WHERE**: `apps/gateway/src/history/store.ts`
- **WHY**: Silent error swallowing makes debugging history issues extremely difficult. Failures in history persistence are invisible to both developers and operators.
- **COMPLEXITY**: S  
- **PRIORITY**: High

### F-13: `agents/runner.ts` — 755-Line God Function

- **WHAT**: The `runAgent()` function spans ~540 lines (lines 154-692) handling abort, queue, interrupt, think levels, session resolution, turn buffering, and fallback retry
- **WHERE**: `apps/gateway/src/agents/runner.ts`
- **WHY**: Extremely high cyclomatic complexity. Multiple nested concerns: abort flow, queue management, think level fallback, turn buffering. Each concern is individually testable but currently entangled.
- **COMPLEXITY**: M  
- **PRIORITY**: Medium

### F-14: Cross-Package Boundary Violation in Tests

- **WHAT**: Projects extension tests import directly from gateway source using deep relative paths
- **WHERE**:
  - `packages/extensions/projects/src/projects/watcher.events.test.ts` line 42: `import { agentEventBus } from "../../../../../apps/gateway/src/agents/events.js"`
  - `packages/extensions/projects/src/projects/watcher.fs.test.ts` line 6: same import
- **WHY**: Extensions should not depend on gateway internals. This breaks the package boundary and makes it impossible to build/test extensions independently. The `agentEventBus` should be exported from `@aihub/shared` or a dedicated event package.
- **COMPLEXITY**: S  
- **PRIORITY**: High

### F-15: Web API Types — Local Re-definitions Instead of Shared Imports

- **WHAT**: The web frontend defines ~30 API types locally in `apps/web/src/api/types.ts` that duplicate or re-export shared types with slight differences
- **WHERE**: `apps/web/src/api/types.ts` (511 lines)
- **WHY**: Types like `Agent`, `Message`, `SubagentStatus`, `Area`, `Task` are defined locally instead of importing from `@aihub/shared`. Some are direct aliases (`Area = SharedArea`), others are slightly different (`Agent` has `model: { provider, model }` while shared has `AgentConfig`). This creates drift risk.
- **COMPLEXITY**: M  
- **PRIORITY**: Medium

### F-16: Inconsistent Error Handling in API Routes

- **WHAT**: API routes use inconsistent error response patterns — some use structured errors, others use bare strings, and many silently catch and return 404/500
- **WHERE**: `apps/gateway/src/server/api.core.ts` throughout
- **WHY**: Error responses vary: `{ error: "string" }`, `{ error, allowedTypes }`, `{ error, maxSize }`. No standardized error envelope. Clients must handle different shapes.
- **COMPLEXITY**: S  
- **PRIORITY**: Low

### F-17: `@aihub/shared` Missing Exports for Commonly-Needed Items

- **WHAT**: Several utilities used across multiple packages are not exported from shared, forcing packages to either duplicate or use deep relative imports
- **WHERE**:
  - `agentEventBus` (in `apps/gateway/src/agents/events.ts`) — needed by extensions
  - Frontmatter parser (duplicated 3 times — not in shared)
  - Allowlist utilities (duplicated across Discord/Slack)
- **WHY**: Each missing export leads to duplication. The shared package should be the canonical location for cross-cutting utilities.
- **COMPLEXITY**: M  
- **PRIORITY**: High

### F-18: `projects/index.ts` — 2788-Line Extension Index

- **WHAT**: The projects extension main file is 2788 lines containing all route definitions
- **WHERE**: `packages/extensions/projects/src/index.ts`
- **WHY**: All projects API routes in a single file. Hard to navigate and maintain.
- **COMPLEXITY**: M  
- **PRIORITY**: Medium

### F-19: Config Migration Split Across Packages

- **WHAT**: Config migration logic is split: the implementation lives in `@aihub/shared` but gateway re-exports it
- **WHERE**:
  - `packages/shared/src/config-migrate.ts` (3.8K)
  - `apps/gateway/src/config/migrate.ts` (201 chars — thin re-export)
- **WHY**: This is actually a reasonable pattern (shared owns the logic, gateway re-exports for backward compat), but the naming is inconsistent with other shared exports.
- **COMPLEXITY**: XS  
- **PRIORITY**: Low

### F-20: No Test Coverage for Several Critical Modules

- **WHAT**: Some critical gateway modules lack test files
- **WHERE**:
  - `apps/gateway/src/agents/runner.ts` — no direct test file (tested indirectly via API tests)
  - `apps/gateway/src/server/api.core.ts` — has test but runner logic is hard to test in isolation
  - `apps/gateway/src/sdk/pi/adapter.ts` — adapter tests exist but are integration-heavy
- **WHY**: The entangled nature of `runner.ts` (F-13) makes unit testing difficult. Errors in queue management, abort flow, or think level fallback are caught only by integration tests.
- **COMPLEXITY**: L  
- **PRIORITY**: Medium

### F-21: `dispatcher.ts` — 1923-Line Orchestrator Dispatcher

- **WHAT**: The projects orchestrator dispatcher is the largest single logic file
- **WHERE**: `packages/extensions/projects/src/orchestrator/dispatcher.ts`
- **WHY**: Contains worktree management, git operations, prompt building, status transitions, and HITL logic. Complex state machine logic interleaved with I/O.
- **COMPLEXITY**: M  
- **PRIORITY**: Low

### F-22: `subagents.api.test.ts` — 3116-Line Test File

- **WHAT**: The subagents API test file is the largest test file at 3116 lines
- **WHERE**: `packages/extensions/projects/src/subagents.api.test.ts`
- **WHY**: Likely contains many test cases that should be split by concern. Large test files are slow to run and hard to maintain.
- **COMPLEXITY**: S  
- **PRIORITY**: Low

### F-23: Vitest Config Extension Aliases Not Including `@aihub/extension-board` or `@aihub/extension-subagents`

- **WHAT**: The vitest config has aliases for most extensions but is missing `@aihub/extension-board` and `@aihub/extension-subagents`
- **WHERE**: `vitest.config.ts` lines 28-38
- **WHY**: Tests importing these extensions may resolve to `dist/` instead of `src/`, causing singleton/state issues. This could lead to flaky tests.
- **COMPLEXITY**: XS  
- **PRIORITY**: Medium

### F-24: Module Singleton Pattern for Extension Contexts

- **WHAT**: Extensions use module-level singletons for their context (e.g., `projectsCtx` in `projects/src/context.ts`)
- **WHERE**:
  - `packages/extensions/projects/src/context.ts` (16 lines)
  - Similar patterns likely in other extensions
- **WHY**: Module singletons make testing harder (must manually clear between tests) and prevent multiple instances. Not a blocker but worth noting.
- **COMPLEXITY**: S  
- **PRIORITY**: Low

### F-25: Only 1 `TODO` in the Entire Codebase

- **WHAT**: Nearly zero `TODO`/`FIXME` comments across ~127K lines
- **WHERE**: Only `apps/gateway/src/evals/runtime.ts:205` has a TODO
- **WHY**: This is actually positive — the codebase is well-maintained. However, it may also indicate that known issues aren't being tracked in-code.
- **COMPLEXITY**: N/A  
- **PRIORITY**: N/A (informational)

---

## Summary Table

| ID  | Finding                                    | Complexity | Priority |
| --- | ------------------------------------------ | ---------- | -------- |
| F-01 | Triple frontmatter parser duplication      | S          | High     |
| F-02 | Duplicated filesystem utilities            | S          | High     |
| F-03 | Duplicated path utilities                  | S          | Medium   |
| F-04 | Duplicated allowlist logic                 | S          | Medium   |
| F-05 | Duplicated notification modules            | S          | Medium   |
| F-06 | RunAgentParams/Result type duplication     | S          | High     |
| F-07 | DiscordContext/SlackContext near-duplication| S          | Low      |
| F-08 | AgentChat.tsx 4053-line monolith           | L          | High     |
| F-09 | ChatView.tsx 3604-line component           | L          | Medium   |
| F-10 | api/client.ts 2163-line API client         | M          | High     |
| F-11 | api/core.ts repeated MIME maps             | S          | Medium   |
| F-12 | history/store.ts swallowed errors          | S          | High     |
| F-13 | runner.ts 755-line god function            | M          | Medium   |
| F-14 | Cross-package boundary violation           | S          | High     |
| F-15 | Web API types local re-definitions         | M          | Medium   |
| F-16 | Inconsistent API error responses           | S          | Low      |
| F-17 | Missing shared exports                     | M          | High     |
| F-18 | projects/index.ts 2788-line extension      | M          | Medium   |
| F-19 | Config migration split                     | XS         | Low      |
| F-20 | Missing test coverage for critical modules | L          | Medium   |
| F-21 | dispatcher.ts 1923-line orchestrator       | M          | Low      |
| F-22 | subagents.api.test.ts 3116-line test       | S          | Low      |
| F-23 | Missing vitest aliases                     | XS         | Medium   |
| F-24 | Module singleton pattern                   | S          | Low      |
| F-25 | Near-zero TODOs (informational)            | N/A        | N/A      |

**Total findings**: 25 (7 High, 8 Medium, 7 Low, 2 XS, 1 N/A)
