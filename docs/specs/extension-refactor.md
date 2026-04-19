# Extension Refactor Spec

## Problem Statement

AIHub gateway has grown monolithic. Components (discord, slack, heartbeat, scheduler, projects, etc.) are baked into the gateway with tight coupling. The codebase needs a clean extraction into self-contained extensions that can eventually live in separate repos, while maintaining full feature parity.

## Goals

1. ~~Remove unused features (amsg, conversations) and simplify SDK surface (remove Claude SDK adapter; keep Pi + OpenClaw)~~ ✅ **Done**
2. ~~Rename "components" → "extensions" across the entire codebase~~ ✅ **Done**
3. ~~Extract all extensions into `packages/extensions/<name>/` as self-contained packages~~ ✅ **Done**
4. ~~Build an extension loading mechanism modeled after the connector pattern (discovery, validation, lifecycle)~~ ✅ **Done**
5. ~~Support both built-in defaults (heartbeat, scheduler) and external extensions loaded from `$AIHUB_HOME/extensions`~~ ✅ **Done**

## Non-Goals

- Removing OpenClaw SDK adapter (stays)
- Removing subagent CLI "claude" harness (stays — separate concept from Claude SDK adapter)
- Moving extensions to separate repos now (contract must support it from day 1, but they stay in monorepo for now)
- Changing the connector pattern or contract
- Adding new features or extensions

---

## Progress

### ✅ Phase 1: Cleanup — DONE

All three cleanup commits merged. 879 tests pass across all packages (gateway 647, shared 52, CLI 19, web 161).

#### 1a. Remove amsg ✅
- Deleted `apps/gateway/src/amsg/`, `apps/gateway/src/components/amsg/`
- Removed agent-level `AmsgConfigSchema`, component-level `AmsgComponentConfigSchema`
- Removed from registry, events, config defaults, CLI migration, docs
- All test references cleaned

#### 1b. Remove conversations ✅
- Deleted `apps/gateway/src/conversations/`, `apps/gateway/src/components/conversations/`, `apps/web/src/components/conversations/` (6 files)
- Removed `ConversationsComponentConfigSchema`, request schemas, web API functions/types
- Removed web route, sidebar nav, lazy import
- All test references cleaned

#### 1c. Remove Claude SDK adapter ✅
- Deleted `apps/gateway/src/sdk/claude/`, `claude_tools.ts`, `sessions/claude.ts`
- Removed `@anthropic-ai/claude-agent-sdk` dependency
- Removed `clearClaudeSessionId`, Claude history backfill, `getUserClaudeSessionsPath`
- Gateway `SdkId` narrowed to `"pi" | "openclaw"`
- Preserved: container's `claude-runner.ts`, shared `SdkIdSchema` keeps `"claude"`, OpenClaw refinements

### ✅ Phase 2: Semantic Rename — DONE

Systematic rename of all component → extension symbols across the entire codebase.

#### What changed

**Directory:**
- `apps/gateway/src/components/` → `apps/gateway/src/extensions/`

**Type/schema renames (packages/shared):**
- `Component` → `Extension`, `ComponentContext` → `ExtensionContext`
- `ComponentsConfigSchema` → `ExtensionsConfigSchema`
- `ComponentBaseConfigSchema` → `ExtensionBaseConfigSchema`
- All `*ComponentConfigSchema` → `*ExtensionConfigSchema` (Discord, Slack, Scheduler, Heartbeat, Projects, Langfuse)
- `CapabilitiesResponseSchema.components` → `.extensions`

**Config shape change:**
- `components:` key → `extensions:` in `GatewayConfigSchema`
- `multiUser` moved from top-level into `extensions.multiUser`
- `scheduler` moved from top-level into `extensions.scheduler`
- `config-migrate.ts` output key renamed
- CLI migration strings updated

**Symbol renames (gateway):**
- `COMPONENT_REGISTRY` → `EXTENSION_REGISTRY`
- `loadComponents()` → `loadExtensions()`
- `getLoadedComponents()` → `getLoadedExtensions()`
- `isComponentLoaded()` → `isExtensionLoaded()`
- `getKnownComponentRouteMetadata()` → `getKnownExtensionRouteMetadata()`
- All `*Component` export names → `*Extension` (heartbeat, scheduler, discord, slack, multiUser, projects, langfuse)
- `componentRouteMatchers` → `extensionRouteMatchers`
- Error code: `component_disabled` → `extension_disabled`
- Error message strings: "Component" → "Extension"

**Web renames:**
- `isComponentEnabled` → `isExtensionEnabled` (all web components)
- `ComponentUnavailable` → `ExtensionUnavailable`
- Capabilities store field: `components` → `extensions`

**Test file renames:**
- `component-types.test.ts` → `extension-types.test.ts`
- `component-routing.api.test.ts` → `extension-routing.api.test.ts`
- `component-disabled.api.test.ts` → `extension-disabled.api.test.ts`

---

## Next: Phases 3–5 (Not Yet Started)

### Dependency Audit

Full audit of every extension's gateway-internal imports is in `docs/specs/extension-dependency-audit.md`. Key findings:

| Extension | Difficulty | Gateway-internal symbols | Notes |
|---|---|---|---|
| Heartbeat | Easy-Medium | 9 | Needs runtime state access (`isStreaming`, `restoreSessionUpdatedAt`, `resolveWorkspaceDir`) |
| Scheduler | Easy | 5 | Same pattern as heartbeat minus runtime state |
| Langfuse | Easy | 1 (event bus) | Replaced by `subscribe()` |
| Multi-user | Easy-Medium | 2 | Config already migrated into `extensions` |
| Discord | Medium | 7 + cross-ext deps | Heartbeat event subscription + Slack context rendering |
| Slack | Medium | 5 | Same pattern as Discord minus heartbeat |
| Projects | Hard | ~50 symbols, 14+ modules | Absorbs projects/, subagents/, areas/, activity/, taskboard/; also **emits** events |

### What needs to move to `@aihub/shared`

| Symbol | Current location | Used by |
|---|---|---|
| `DEFAULT_MAIN_KEY` | `sessions/index.js` | heartbeat, discord, slack, projects |
| `AgentStreamEvent` (type) | `agents/events.ts` | langfuse, discord, slack |
| `AgentHistoryEvent` (type) | `agents/events.ts` | langfuse |
| Event name constants (`agent.stream`, `agent.history`, `heartbeat.event`, etc.) | `agents/events.ts` | all event consumers |

### Cross-extension dependencies

| From | To | Symbol | Resolution |
|---|---|---|---|
| Discord | Heartbeat | `onHeartbeatEvent` | Replace with `ctx.subscribe("heartbeat.event", handler)` |
| Discord | Slack | `renderSlackContext` | Move context rendering utility to `@aihub/shared` |

---

## Phase 3: Prepare Shared Contracts

### Move to `@aihub/shared`

Before extraction can begin, several types and constants must move to the shared package so extensions can import them without depending on gateway internals:

| What | From | To |
|---|---|---|
| `DEFAULT_MAIN_KEY` | `apps/gateway/src/sessions/index.ts` | `@aihub/shared` constants |
| `AgentStreamEvent` type | `apps/gateway/src/agents/events.ts` | `@aihub/shared` types |
| `AgentHistoryEvent` type | `apps/gateway/src/agents/events.ts` | `@aihub/shared` types |
| Event name constants | `apps/gateway/src/agents/events.ts` | `@aihub/shared` constants |
| `renderSlackContext` / `renderDiscordContext` | `apps/gateway/src/discord/utils/context.ts`, `apps/gateway/src/slack/utils/context.ts` | `@aihub/shared` (shared context-rendering utility) |
| `SessionEntry` type | currently inline in sessions | `@aihub/shared` types |

### Define new extension contract

The current `Extension` interface (formerly `Component`) is minimal. For extraction to separate packages, it needs a richer contract:

```typescript
// packages/shared/src/extensions/types.ts

// --- Event system ---
export type ExtensionEvent =
  | "agent.stream"
  | "agent.history"
  | "agent.changed"
  | "heartbeat.event"
  | "file.changed";

export type UnsubscribeFn = () => void;
export type EventHandler = (event: unknown) => void;

// --- Logger ---
export interface ExtensionLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// --- Session types ---
export interface SessionEntry {
  sessionId: string;
  updatedAt: number;
}

// --- Extension context (expanded from current ExtensionContext) ---
export interface ExtensionContext {
  // Config
  getConfig(): GatewayConfig;
  getDataDir(): string;                            // $AIHUB_HOME

  // Agent access (pre-filtered for single-agent mode)
  getAgent(id: string): AgentConfig | undefined;
  getAgents(): AgentConfig[];
  isAgentActive(id: string): boolean;

  // Agent runtime state
  isAgentStreaming(agentId: string): boolean;
  resolveWorkspaceDir(agent: AgentConfig): string;

  // Agent execution
  runAgent(params: RunAgentParams): Promise<RunAgentResult>;
  getSubagentTemplates(): SubagentTemplate[];

  // Session management
  resolveSessionId(agentId: string, sessionKey: string): Promise<SessionEntry | undefined>;
  getSessionEntry(agentId: string, sessionKey: string): Promise<SessionEntry | undefined>;
  clearSessionEntry(agentId: string, sessionKey: string, userId?: string): Promise<SessionEntry | undefined>;
  restoreSessionUpdatedAt(agentId: string, sessionKey: string, timestamp: number): void;
  deleteSession(agentId: string, sessionId: string): void;
  invalidateHistoryCache(agentId: string, sessionId: string, userId?: string): Promise<void>;
  getSessionHistory(agentId: string, sessionId: string): Promise<HistoryMessage[]>;

  // Events (subscribe + emit)
  subscribe(event: ExtensionEvent, handler: EventHandler): UnsubscribeFn;
  emit(event: ExtensionEvent, payload: unknown): void;

  // Logging
  logger: ExtensionLogger;
}
```

Key differences from current `ExtensionContext`:
- Added `subscribe()` + `emit()` for event-driven communication
- Added `logger` for namespaced logging
- Added `getDataDir()` for file persistence
- Added `isAgentActive()`, `isAgentStreaming()`, `resolveWorkspaceDir()` for runtime state
- Added `getSubagentTemplates()`, `getSessionHistory()` for domain access
- Added full session management (`resolveSessionId`, `clearSessionEntry`, `restoreSessionUpdatedAt`, `deleteSession`, `invalidateHistoryCache`)
- Dropped `resolveSecret` (deprecated, throws anyway)

### How each gateway-internal dependency resolves

| Gateway-internal import | ExtensionContext method | Extensions affected |
|---|---|---|
| `getAgent()` | `ctx.getAgent()` | heartbeat, scheduler, projects, multi-user |
| `getActiveAgents()` | `ctx.getAgents()` | discord, slack, scheduler, projects/activity |
| `isAgentActive()` | `ctx.isAgentActive()` | heartbeat, scheduler, projects |
| `loadConfig()` | `ctx.getConfig()` | scheduler, projects |
| `runAgent` | `ctx.runAgent()` | heartbeat, scheduler, discord, slack, projects |
| `getSubagentTemplates()` | `ctx.getSubagentTemplates()` | projects |
| `agentEventBus` (subscribe) | `ctx.subscribe("agent.stream/history", ...)` | langfuse, discord, slack |
| `agentEventBus` (emit) | `ctx.emit("file.changed"/"agent.changed", ...)` | projects |
| `onHeartbeatEvent` | `ctx.subscribe("heartbeat.event", ...)` | discord |
| `getSessionEntry()` | `ctx.getSessionEntry()` | heartbeat, discord, slack, projects/activity |
| `resolveSessionId()` | `ctx.resolveSessionId()` | heartbeat |
| `clearSessionEntry()` | `ctx.clearSessionEntry()` | projects |
| `restoreSessionUpdatedAt()` | `ctx.restoreSessionUpdatedAt()` | heartbeat |
| `deleteSession()` | `ctx.deleteSession()` | projects |
| `invalidateResolvedHistoryFile()` | `ctx.invalidateHistoryCache()` | projects |
| `getSessionHistory()` | `ctx.getSessionHistory()` | projects/activity |
| `DEFAULT_MAIN_KEY` | Imported from `@aihub/shared` | heartbeat, discord, slack, projects |
| `CONFIG_DIR` / `SCHEDULES_PATH` | `ctx.getDataDir()` + config-derived paths | scheduler, multi-user, projects/store |
| `resolveWorkspaceDir()` | `ctx.resolveWorkspaceDir()` | heartbeat |
| `isStreaming()` | `ctx.isAgentStreaming()` | heartbeat |
| `AgentStreamEvent` / `AgentHistoryEvent` | Imported from `@aihub/shared` | langfuse |
| `renderSlackContext` / `renderDiscordContext` | Imported from `@aihub/shared` | discord, slack |

---

## Phase 4: Extract to `packages/extensions/`

### Target structure

```
packages/extensions/
├── discord/
│   ├── package.json           # @aihub/extension-discord
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts           # exports discordExtension
│   │   ├── bot.ts
│   │   ├── client.ts
│   │   ├── handlers/
│   │   │   ├── commands.ts
│   │   │   ├── message.ts
│   │   │   └── reactions.ts
│   │   └── utils/
│   │       ├── allowlist.ts
│   │       ├── channel.ts
│   │       ├── chunk.ts
│   │       ├── context.ts
│   │       ├── history.ts
│   │       ├── threads.ts
│   │       └── typing.ts
│   └── dist/
├── heartbeat/
│   ├── package.json           # @aihub/extension-heartbeat
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   └── runner.ts
│   └── dist/
├── langfuse/
│   ├── package.json           # @aihub/extension-langfuse
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── tracer.ts
│   │   └── types.ts
│   └── dist/
├── multi-user/
│   ├── package.json           # @aihub/extension-multi-user
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── auth.ts
│   │   ├── db.ts
│   │   ├── middleware.ts
│   │   ├── admin-routes.ts
│   │   ├── routes.ts
│   │   ├── assignments.ts
│   │   └── isolation.ts
│   └── dist/
├── projects/
│   ├── package.json           # @aihub/extension-projects
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts           # routes + extension definition
│   │   ├── projects/
│   │   │   ├── store.ts
│   │   │   ├── space.ts
│   │   │   ├── git.ts
│   │   │   ├── tasks.ts
│   │   │   └── watcher.ts
│   │   ├── subagents/
│   │   │   ├── runner.ts
│   │   │   └── index.ts
│   │   ├── areas/
│   │   │   ├── index.ts
│   │   │   └── store.ts
│   │   ├── activity/
│   │   │   └── index.ts
│   │   └── taskboard/
│   │       ├── index.ts
│   │       ├── scanner.ts
│   │       └── parser.ts
│   └── dist/
├── scheduler/
│   ├── package.json           # @aihub/extension-scheduler
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── service.ts
│   │   ├── store.ts
│   │   └── schedule.ts
│   └── dist/
└── slack/
    ├── package.json           # @aihub/extension-slack
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts
    │   ├── bot.ts
    │   ├── types.ts
    │   ├── handlers/
    │   │   ├── commands.ts
    │   │   ├── message.ts
    │   │   └── reactions.ts
    │   └── utils/
    │       ├── allowlist.ts
    │       ├── chunk.ts
    │       ├── context.ts
    │       ├── history.ts
    │       ├── mrkdwn.ts
    │       ├── threads.ts
    │       └── typing.ts
    └── dist/
```

Each extension package:
- Depends on `@aihub/shared` for the `Extension` contract, types, constants
- Exports a single default export conforming to `ExtensionDefinitionSchema`
- Is fully self-contained (own dependencies, own tests)
- Compiled to `dist/` for external loading
- Only imports from `@aihub/shared` + npm packages — never from gateway internals
- All gateway-internal calls go through `ExtensionContext` methods

### What stays in gateway core

Gateway `src/extensions/` retains only:
- `registry.ts` — extension registry, loading, topo-sort, metadata
- `registry.test.ts` — registry tests
- No extension implementations (they all move to `packages/extensions/`)

Gateway core still owns:
- `agents/` — agent runner, event bus, sessions
- `sessions/` — session store
- `history/` — history store
- `config/` — config loading
- `sdk/` — Pi + OpenClaw adapters
- `server/` — HTTP server, core API routes
- `connectors/` — connector loading
- `media/` — media upload/download

These are exposed to extensions exclusively through `ExtensionContext`.

### Route registration

Extensions still call `registerRoutes(app: Hono)` — same pattern as today. The gateway passes its Hono app instance during the registration phase. No change to route ownership model.

---

## Phase 5: Extension Loading Mechanism

### Loading categories

1. **Built-in defaults** — always loaded unless explicitly disabled
   - `heartbeat`
   - `scheduler`
2. **Built-in opt-in** — available in `packages/extensions/`, must be enabled in config
   - `discord`, `slack`, `langfuse`, `multi-user`, `projects`
3. **External** — discovered from `$AIHUB_HOME/extensions`, must be enabled in config
   - Any third-party extension following the contract

### Config schema (current shape after Phase 2)

```typescript
// In GatewayConfig
{
  extensions: {
    heartbeat?: { enabled?: boolean },          // default: true
    scheduler?: { enabled?: boolean, tickSeconds?: number },  // default: true
    discord?: { enabled?: boolean, ... },
    slack?: { enabled?: boolean, ... },
    multiUser?: { enabled?: boolean, ... },
    projects?: { enabled?: boolean, ... },
    langfuse?: { enabled?: boolean, ... },
    [key: string]: unknown,                     // external extension configs
  },
  extensionsPath?: string,                      // default: $AIHUB_HOME/extensions
}
```

- `heartbeat` and `scheduler` are loaded by default. Setting `enabled: false` disables them.
- All other extensions require `enabled: true` (or truthy config) to load.
- External extensions follow same config pattern: `extensions.<extId> = { enabled: true, ...config }`.

### Discovery flow

```
1. Load config, resolve secrets
2. Initialize connectors (unchanged)
3. Load extensions:
   a. Register built-in defaults (heartbeat, scheduler) — skip if disabled
   b. Register built-in opt-ins — only if enabled in config
   c. Discover external extensions from extensionsPath (default: $AIHUB_HOME/extensions)
      - Scan directory subfolders (support symlinks)
      - Load index.js, validate against ExtensionDefinitionSchema
      - Register if enabled in config
4. Validate all registered extension configs
5. Topo-sort by dependencies
6. Register routes
7. Start server
8. Start extensions in topo order
9. On shutdown: stop in reverse order
```

### External extension discovery

Modeled after `packages/shared/src/connectors/discovery.ts`:

```typescript
// packages/shared/src/extensions/discovery.ts

export async function discoverExternalExtensions(
  directoryPath: string
): Promise<void> {
  // Scan directory entries
  // For each subdirectory (or symlink resolving to directory):
  //   Load index.js
  //   Validate against ExtensionDefinitionSchema
  //   Register extension
  //   Warn on invalid modules
}
```

### ExtensionContext implementation

The gateway creates an `ExtensionContext` that wires extension calls back to gateway internals:

```typescript
// apps/gateway/src/extensions/context.ts

function createExtensionContext(resolvedConfig: GatewayConfig, extensionId: string): ExtensionContext {
  return {
    getConfig: () => resolvedConfig,
    getDataDir: () => CONFIG_DIR,
    getAgent,
    getAgents: () => getActiveAgents(),   // pre-filtered for single-agent mode
    isAgentActive,
    isAgentStreaming: (agentId) => isStreaming(agentId),
    resolveWorkspaceDir,
    runAgent,
    getSubagentTemplates: () => getSubagentTemplates(),
    resolveSessionId: (agentId, sessionKey) => resolveSessionId(agentId, sessionKey),
    getSessionEntry: (agentId, sessionKey) => getSessionEntry(agentId, sessionKey),
    clearSessionEntry,
    restoreSessionUpdatedAt,
    deleteSession,
    invalidateHistoryCache: (agentId, sessionId, userId) =>
      invalidateResolvedHistoryFile(agentId, sessionId, userId),
    getSessionHistory: (agentId, sessionId) => getSessionHistory(agentId, sessionId),
    subscribe: (event, handler) => {
      switch (event) {
        case "agent.stream": return agentEventBus.onStreamEvent(handler);
        case "agent.history": return agentEventBus.onHistoryEvent(handler);
        case "heartbeat.event": return onHeartbeatEvent(handler);
        case "agent.changed": return agentEventBus.on("agent_changed", handler);
        case "file.changed": return agentEventBus.on("file_changed", handler);
        default: throw new Error(`Unknown extension event: ${event}`);
      }
    },
    emit: (event, payload) => {
      switch (event) {
        case "file.changed": agentEventBus.emitFileChanged(payload); break;
        case "agent.changed": agentEventBus.emitAgentChanged(payload); break;
        default: throw new Error(`Unknown extension event: ${event}`);
      }
    },
    logger: createExtensionLogger(extensionId),
  };
}
```

---

## Remaining Implementation Order

### ✅ Commit 1: Remove amsg — DONE
### ✅ Commit 2: Remove conversations — DONE
### ✅ Commit 3: Remove Claude SDK adapter — DONE
### ✅ Commit 4: Semantic rename components → extensions — DONE

### ✅ Commit 5: Prepare shared contracts — DONE
### ✅ Commit 6: Extract easy extensions (heartbeat, scheduler, langfuse, multi-user) — DONE
### ✅ Commit 7: Extract medium extensions (discord, slack) — DONE
### ✅ Commit 8: Extract projects extension — DONE
### ✅ Commit 9: Extension loading mechanism — DONE

---

## Risks & Mitigations — All Resolved

| # | Risk | Resolution |
|---|---|---|
| 1 | Projects coupling (~50 symbols) | `ExtensionContext` is the contract boundary. All domain modules moved into the extension package. |
| 2 | Multi-user middleware injection | `registerRoutes()` mounts routes + middleware on Hono app. Pattern preserved. |
| 3 | Cross-extension deps | `ctx.subscribe()` / `ctx.emit()` decouples. Context rendering in `@aihub/shared`. |
| 4 | Circular imports | Intra-extension imports fine within same package. No cycles at extension boundary. |
| 5 | Dev mode (pnpm dev) | `packages/extensions/*` in `pnpm-workspace.yaml`. TS project refs resolve sources directly. |
| 6 | Test strategy | Tests moved with extensions. Gateway mocks replaced with `ExtensionContext` mocks. |
| 7 | Heartbeat runtime coupling | `isStreaming`, `restoreSessionUpdatedAt`, `resolveWorkspaceDir` → `ExtensionContext` methods. |
| 8 | Config migration | Top-level `multiUser`/`scheduler` moved into `extensions` key. Users update manually or via `apm config migrate`. |

---

## Refactor Summary

### Commits (9 + docs cleanup)

| # | Commit | Files | Δ Lines |
|---|---|---|---|
| 1 | `e5882e7` Remove amsg | 5 | -183 |
| 2 | `68bf1b8` Remove conversations | 10 | -2,548 |
| 3 | `406b09e` Remove Claude SDK adapter | 12 | +5 / -1,311 |
| 4 | `c7a43e2` Rename components → extensions | 77 | +1,688 / -1,324 |
| 5 | `0b01b8b` Prepare shared contracts | 7 | +451 / -151 |
| 6 | `b67f49c` Extract heartbeat, scheduler, langfuse, multi-user | 55 | +706 / -527 |
| 7 | `e444d32` Extract discord and slack | 63 | +670 / -574 |
| 8 | `c39ed53` Extract projects | 49 | +649 / -106 |
| 9 | `eefed14` Extension loading mechanism | 15 | +308 / -121 |

**Total:** 226 files changed, +4,297 / -6,704 (net -2,407 lines)

### Deleted from gateway

29 directories removed from `apps/gateway/src/`:
- `amsg/`, `conversations/`, `components/` (entire dir)
- `sdk/claude/`, `sessions/claude.ts`
- `heartbeat/`, `scheduler/`, `discord/`, `slack/`
- `projects/`, `subagents/`, `areas/`, `activity/`, `taskboard/`
- `server/component-*.test.ts` (renamed)

### New packages

7 extension packages in `packages/extensions/`:

| Package | Source files | Lines |
|---|---|---|
| `@aihub/extension-heartbeat` | 6 | 2,559 |
| `@aihub/extension-scheduler` | 10 | 713 |
| `@aihub/extension-langfuse` | 8 | 1,148 |
| `@aihub/extension-multi-user` | 23 | 2,484 |
| `@aihub/extension-discord` | 44 | 4,931 |
| `@aihub/extension-slack` | 48 | 3,747 |
| `@aihub/extension-projects` | 58 | 17,896 |
| **Total** | **197** | **33,478** |

New shared modules:
- `packages/shared/src/events.ts` — event payload types
- `packages/shared/src/context-rendering.ts` — Discord/Slack context rendering
- `packages/shared/src/extensions/discovery.ts` — external extension discovery

### Gateway after refactor

- **47 source files** remain in gateway core (down from ~140)
- Gateway owns: agents, sessions, history, config, SDK adapters, server, connectors, media
- All extension access through `ExtensionContext` — zero gateway-internal imports in extension packages

### Tests

| Suite | Tests |
|---|---|
| Gateway | 161 |
| Extensions | 485 |
| Shared | 52 |
| CLI | 19 |
| Web | 161 |
| **Total** | **878** |

### Config changes (breaking)

Users must update `aihub.json`:
- `components` → `extensions`
- `multiUser` → `extensions.multiUser`
- `scheduler` → `extensions.scheduler`
