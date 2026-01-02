---
name: AIHub Multi-SDK Refactor PRP
---

## Goal

**Feature Goal**: Refactor AIHub’s agent runtime to support multiple SDKs per agent (Pi, Claude Agent SDK, Codex SDK) with a clean adapter abstraction, while preserving current Pi behavior and enabling full history across all SDKs.

**Deliverable**: A multi-SDK adapter layer + canonical history store + config schema updates + API/UI normalization, with Pi moved into an adapter and Claude/Codex adapters stubbed or minimally functional.

**Success Definition**: 
- Agents can declare `sdk` in `~/.aihub/aihub.json` and run with Pi/Claude/Codex.
- Full history view works for all SDKs (simple + full).
- Existing Pi-only configs continue to work (backward compatible).

## User Persona (if applicable)

**Target User**: Solo developer running multiple agents locally.

**Use Case**: Running an executive assistant (Pi) and CTO (Claude/Codex) simultaneously, each with its own SDK/runtime.

**User Journey**:
1. User edits `~/.aihub/aihub.json` with per-agent `sdk`.
2. Launches `aihub gateway` and chats via web/CLI/Discord.
3. UI shows streaming + tools + model meta; history view shows full blocks for all SDKs.

**Pain Points Addressed**:
- Avoid SDK lock-in (Pi-only runtime).
- Support CLI-wrapped SDKs (Codex) with limited controls.
- Uniform history UX regardless of SDK.

## Why

- Need to support multiple SDKs (Pi, Claude, Codex) per agent.
- Codex SDK is CLI-backed; system must gracefully handle limited controls.
- Full history is a core UX feature and must be SDK-agnostic.

## What

Introduce a SDK adapter abstraction and canonical history store. The gateway runtime should delegate all SDK-specific behavior to adapters while keeping queue/interrupt orchestration and event broadcasting centralized.

### Success Criteria

- [ ] Per-agent `sdk` field supported with default `"pi"` fallback.
- [ ] Pi runtime moved into `sdk/pi/adapter.ts` with no behavior change.
- [ ] Claude adapter integrated using Claude Agent SDK semantics.
- [ ] Codex adapter integrated using Codex SDK streaming events (CLI JSONL wrapper).
- [ ] History API reads from canonical store and renders full history for all SDKs.
- [ ] Web UI and CLI show model info via normalized adapter output.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this successfully?_ Yes: core runtime files, config schemas, and SDK docs are all referenced below.

### Documentation & References

```yaml
# SDK Docs
- url: https://platform.claude.com/docs/en/agent-sdk/typescript
  why: Claude Agent SDK usage patterns (query generator, interrupt, tool/MCP integration)
  critical: SDK exposes async generator with interrupt(), supports MCP tools, may not read settings by default

- url: https://developers.openai.com/codex/sdk/
  why: Codex SDK top-level usage and SDK packaging expectations
  critical: Codex SDK is CLI-backed with JSONL streaming; limited control surface

- url: https://raw.githubusercontent.com/openai/codex/refs/heads/main/sdk/typescript/README.md
  why: Codex SDK exact TypeScript API (run, runStreamed, startThread, resumeThread, event types)
  critical: Event stream type mapping needed for history + streaming; sessions stored in ~/.codex/sessions

# Core runtime files
- file: apps/gateway/src/agents/runner.ts
  why: Main agent runtime; currently hard-coupled to Pi SDK
  pattern: Queue/interrupt handling, Pi session lifecycle, streaming events -> StreamEvent
  gotcha: Streaming state + abort flow is shared across web/discord/amsg/scheduler

- file: apps/gateway/src/agents/sessions.ts
  why: In-memory session tracking; stores Pi session handle and pending queue
  pattern: isStreaming, abort, setAgentSession, pending queue

- file: apps/gateway/src/agents/workspace.ts
  why: Bootstrap file creation and context file conversion (Pi uses this today)
  pattern: bootstrap file creation and contextFiles shape

- file: apps/gateway/src/server/api.ts
  why: REST endpoints use runAgent + history functions
  pattern: sessionKey resolution, history view handling

- file: apps/gateway/src/server/index.ts
  why: WebSocket streaming + subscription to agentEventBus
  pattern: send events + history_updated

- file: packages/shared/src/types.ts
  why: Config schema + shared types for history and streaming
  pattern: AgentConfigSchema, StreamEvent, FullHistoryMessage

- file: apps/web/src/components/ChatView.tsx
  why: Full history rendering + streaming display
  pattern: ContentBlocks, ModelMetaDisplay

- file: apps/web/src/api/types.ts
  why: Web client types must stay in sync with shared schema
  pattern: FullHistoryMessage, ModelMeta, StreamEvent

# Overall architecture
- docfile: docs/llms.md
  why: Project architecture, session format, runtime flow
  section: Agent Runtime Flow; Session Transcript Format
```

### Current Codebase Tree (summary)

```bash
apps/gateway/src/
  agents/
    runner.ts
    sessions.ts
    workspace.ts
    events.ts
  server/
    api.ts
    index.ts
  config/
    index.ts
packages/shared/src/types.ts
apps/web/src/
  components/ChatView.tsx
  api/types.ts
```

### Desired Codebase Tree with files to be added and responsibility

```bash
apps/gateway/src/
  sdk/
    types.ts            # SDK adapter interface + capability flags
    registry.ts         # map sdk id -> adapter instance
    pi/adapter.ts       # Pi SDK implementation (moved from runner.ts)
    claude/adapter.ts   # Claude Agent SDK adapter
    codex/adapter.ts    # Codex SDK adapter (CLI-backed)
  history/
    store.ts            # canonical transcript store (SDK-agnostic)
  agents/
    runner.ts           # orchestration + adapter dispatch
    sessions.ts         # generic session handle + pending queue
packages/shared/src/types.ts  # updated config schema + history types
apps/web/src/api/types.ts      # updated to match shared schema
apps/web/src/components/ChatView.tsx  # if rendering needs tweaks
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: Current runtime is Pi-specific; must preserve queue/interrupt semantics.
// CRITICAL: History view expects full content blocks; adapters must emit or map them.
// CRITICAL: sessionKey resolution is external to SDK; don’t move it into adapters.
// CRITICAL: Pi uses ~/.aihub/models.json and auth files; keep this path stable.
// CRITICAL: Web UI expects model meta fields (provider/model/usage) where available.
```

## Implementation Blueprint

### Data models and structure

Define SDK-agnostic interfaces and canonical history events.

```typescript
// New core types (illustrative)
export type SdkCapabilities = {
  queueWhileStreaming: boolean;
  interrupt: boolean;
  toolEvents: boolean;
  fullHistory: boolean;
};

export type SdkRunParams = {
  agentId: string;
  sessionId: string;
  message: string;
  workspaceDir: string;
  thinkLevel?: ThinkLevel;
  onEvent: (event: StreamEvent) => void;          // streaming to UI
  onHistoryEvent: (event: HistoryEvent) => void;  // canonical transcript store
};

export type SdkAdapter = {
  id: string;
  displayName: string;
  capabilities: SdkCapabilities;
  resolveDisplayModel(agent: AgentConfig): { provider?: string; model: string };
  run(params: SdkRunParams): Promise<RunAgentResult>;
  queueMessage?: (handle: unknown, message: string) => Promise<void>;
  abort?: (handle: unknown) => void;
};
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE apps/gateway/src/sdk/types.ts
  - IMPLEMENT: SdkAdapter + capability flags + HistoryEvent types
  - FOLLOW pattern: packages/shared/src/types.ts (Zod + TS types)
  - PLACEMENT: sdk/types.ts

Task 2: CREATE apps/gateway/src/sdk/registry.ts
  - IMPLEMENT: adapter registry (string -> adapter instance) + default 'pi'
  - FOLLOW pattern: simple export map; no DI framework
  - DEPENDENCIES: Task 1

Task 3: CREATE apps/gateway/src/history/store.ts
  - IMPLEMENT: canonical transcript store (JSONL per session or centralized)
  - REQUIRE: getSimpleHistory + getFullHistory read from canonical store
  - DEPENDENCIES: Task 1

Task 4: REFACTOR apps/gateway/src/agents/sessions.ts
  - CHANGE: replace piSession with generic sessionHandle
  - ADD: setSessionHandle/getSessionHandle for adapter use

Task 5: REFACTOR apps/gateway/src/agents/runner.ts
  - IMPLEMENT: adapter resolution + capability-based queue/interrupt
  - MOVE: Pi-specific logic into sdk/pi/adapter.ts
  - INTEGRATE: history store via onHistoryEvent

Task 6: CREATE apps/gateway/src/sdk/pi/adapter.ts
  - MOVE: all Pi SDK setup from runner.ts
  - ENSURE: same behavior (skills, slash commands, tools, prompt, session manager)
  - MAP: Pi stream events + messages -> HistoryEvent

Task 7: CREATE apps/gateway/src/sdk/claude/adapter.ts
  - IMPLEMENT: Claude Agent SDK query() streaming
  - MAP: SDKMessage -> StreamEvent + HistoryEvent
  - NOTE: use MCP tool definitions if needed; keep minimal initially

Task 8: CREATE apps/gateway/src/sdk/codex/adapter.ts
  - IMPLEMENT: Codex SDK runStreamed() for streaming events
  - MAP: Codex event types -> StreamEvent + HistoryEvent
  - HANDLE: thread ID as sessionId; limited interrupt/queue

Task 9: UPDATE packages/shared/src/types.ts
  - ADD: sdk field to AgentConfig (default "pi")
  - ADJUST: model schema for multi-SDK (discriminated union or flexible object)
  - UPDATE: WebSocket/History types if new fields are added

Task 10: UPDATE apps/web/src/api/types.ts + UI
  - SYNC: types with shared schema
  - DISPLAY: model info from adapter-normalized payload

Task 11: UPDATE docs/llms.md
  - DOCUMENT: SDK adapter architecture + canonical history store
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: Orchestrate in runner.ts, keep SDK logic inside adapters
const adapter = getSdkAdapter(agent.sdk ?? "pi");
const capabilities = adapter.capabilities;

// Queue logic
if (isStreaming && agent.queueMode === "queue" && capabilities.queueWhileStreaming) {
  await adapter.queueMessage?.(sessionHandle, message);
} else if (isStreaming && agent.queueMode === "queue") {
  // fallback to buffered queue or interrupt based on policy
}

// History normalization
onHistoryEvent({
  type: "assistant_text",
  text: delta,
  timestamp: Date.now(),
  meta: { provider, model, usage }
});

// Codex adapter: stream events from runStreamed()
for await (const evt of codex.runStreamed(...)) {
  // map item.completed/turn.completed to history + StreamEvent
}
```

### Integration Points

```yaml
CONFIG:
  - add to: packages/shared/src/types.ts AgentConfigSchema
  - pattern: sdk defaults to "pi" if missing

HISTORY:
  - add to: apps/gateway/src/history/store.ts
  - update: apps/gateway/src/agents/runner.ts to call history store

API:
  - update: apps/gateway/src/server/api.ts to use canonical history
  - update: /api/agents output to include sdk + normalized model

WEB:
  - update: apps/web/src/api/types.ts
  - update: apps/web/src/components/AgentList.tsx and ChatView.tsx if needed
```

## Validation Loop

### Level 1: Syntax & Style

```bash
pnpm lint
pnpm -C apps/gateway lint
pnpm -C packages/shared lint
pnpm -C apps/web lint
```

### Level 2: Type Checking

```bash
pnpm -C apps/gateway tsc --noEmit
pnpm -C packages/shared tsc --noEmit
pnpm -C apps/web tsc --noEmit
```

### Level 3: Manual Integration

```bash
pnpm dev:gateway
pnpm dev:web
# Verify:
# - /api/agents returns sdk + model
# - /api/agents/:id/history returns full history
# - Web UI renders full blocks for Pi + Claude + Codex
```

## Final Validation Checklist

### Technical Validation

- [ ] TypeScript builds succeed for gateway/shared/web
- [ ] No lint errors
- [ ] Web UI loads and streams events without runtime errors

### Feature Validation

- [ ] Pi agent runs exactly as before
- [ ] Claude agent runs and streams text
- [ ] Codex agent runs and streams text (even if limited controls)
- [ ] Full history view works for all SDKs

### Code Quality Validation

- [ ] SDK-specific logic lives only in adapter files
- [ ] Runner remains SDK-agnostic
- [ ] History store is canonical and SDK-agnostic

---

## Anti-Patterns to Avoid

- ❌ Don’t keep Pi logic in runner.ts (adapter must own SDK specifics)
- ❌ Don’t fork Web UI per SDK
- ❌ Don’t store history in multiple formats without a single canonical source
- ❌ Don’t break existing Pi-only configs (must default sdk=pi)
