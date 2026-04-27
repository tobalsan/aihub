# Extension Dependency Audit

## Summary: Gateway-Internal Imports Per Extension

Each extension currently imports from gateway internals. Here's the complete surface area that needs to be resolved before extensions can be self-contained.

---

## 1. Heartbeat

**Files:** `components/heartbeat/index.ts` → `heartbeat/runner.ts`

| Gateway-internal import | Symbol                                | Used for                                                                                  |
| ----------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `config/index.js`       | `getAgent`                            | Agent lookup in route handler                                                             |
| `config/index.js`       | `isAgentActive`                       | Single-agent-mode gating in route handler                                                 |
| `config/index.js`       | `loadConfig`                          | Load agents for `startAllHeartbeats` (in runner.ts)                                       |
| `agents/index.js`       | `runAgent`                            | Execute heartbeat agent run (in runner.ts)                                                |
| `sessions/index.js`     | `getSessionEntry`, `DEFAULT_MAIN_KEY` | Session resolution (in runner.ts)                                                         |
| `util/paths.js`         | `resolveWorkspaceDir`                 | Resolve agent workspace directory (runner.ts:4, used :139)                                |
| `agents/sessions.js`    | `isStreaming`                         | Check if agent is currently streaming, skip heartbeat if so (runner.ts:6, used :227)      |
| `sessions/store.js`     | `restoreSessionUpdatedAt`             | Preserve session idle timer across heartbeat runs (runner.ts:9, used :229/:244/:286/:302) |
| `sessions/store.js`     | `resolveSessionId`                    | Resolve session ID for heartbeat run (runner.ts:12, used :263)                            |

**Assessment: Easy-Medium.** Most dependencies map to ExtensionContext, but three are agent runtime state:

- `getAgent`, `isAgentActive` → context
- `runAgent` → context
- `loadConfig` → `getConfig()` on context
- `getSessionEntry`, `DEFAULT_MAIN_KEY` → context + shared constant
- `resolveWorkspaceDir` → add to context or move to shared (derivable from `getAgent().workspace`)
- `isStreaming` → add to context (`isAgentStreaming(agentId)`)
- `restoreSessionUpdatedAt` → add to context (session lifecycle hook)
- `resolveSessionId` → context already plans `getSessionEntry`; resolveSessionId is the underlying resolver

---

## 2. Scheduler

**Files:** `components/scheduler/index.ts` → `scheduler/service.ts`, `scheduler/store.ts`, `scheduler/schedule.ts`

| Gateway-internal import | Symbol           | Used for                            |
| ----------------------- | ---------------- | ----------------------------------- |
| `config/index.js`       | `loadConfig`     | Read scheduler config in service.ts |
| `config/index.js`       | `getAgent`       | Agent lookup for scheduled runs     |
| `config/index.js`       | `isAgentActive`  | Single-agent-mode gating            |
| `config/index.js`       | `SCHEDULES_PATH` | Persisted schedule storage path     |
| `agents/index.js`       | `runAgent`       | Execute scheduled agent run         |

**Assessment: Easy.** Same as heartbeat minus the runtime state. `SCHEDULES_PATH` derived from `ctx.getDataDir()`.

Note: scheduler also reads top-level `config.scheduler` (tickSeconds, enabled) in `service.ts:26,31` alongside `config.components?.scheduler`. Both config paths need to be consolidated into `extensions.scheduler`.

---

## 3. Langfuse

**Files:** `components/langfuse/index.ts`, `langfuse/tracer.ts`, `langfuse/types.ts`

| Gateway-internal import | Symbol                     | Used for                                       |
| ----------------------- | -------------------------- | ---------------------------------------------- |
| `agents/events.js`      | `agentEventBus`            | Subscribe to stream/history events for tracing |
| `agents/events.js`      | `AgentStreamEvent` (type)  | Event type for handler                         |
| `agents/events.js`      | `AgentHistoryEvent` (type) | Event type for handler                         |

**Assessment: Easy.** The only gateway-internal dependency is the event bus. With `ExtensionContext.subscribe(event, handler)`, this becomes:

```ts
ctx.subscribe("agent.stream", handler);
ctx.subscribe("agent.history", handler);
```

The event types (`AgentStreamEvent`, `AgentHistoryEvent`) need to move to `@aihub/shared`.

---

## 4. Multi-User

**Files:** 10 files in `components/multi-user/`

| Gateway-internal import | Symbol       | Used for                                                 |
| ----------------------- | ------------ | -------------------------------------------------------- |
| `config/index.js`       | `CONFIG_DIR` | Auth DB path in `db.ts`, session paths in `isolation.ts` |
| `config/index.js`       | `getAgent`   | Agent existence check in `admin-routes.ts`               |

**Assessment: Easy-Medium.** Only 2 gateway-internal imports. `CONFIG_DIR` → `ctx.getDataDir()`. `getAgent` → `ctx.getAgent()`.

Config migration note: `multiUser` is currently top-level (`config.multiUser`, schema at `types.ts:542`), not nested in `components`. Moving it into `extensions.multiUser` requires:

- Schema change in `GatewayConfigSchema`
- Registry change (currently `getConfig: (config) => config.multiUser`)
- `config-migrate.ts` update
- `aihub projects config migrate` / `aihub projects config validate` update
- User-facing config migration docs

---

## 5. Discord

**Files:** `components/discord/index.ts` → `discord/index.ts` → `discord/bot.ts` + handlers + utils (21 files)

| Gateway-internal import  | Symbol               | Used for                                                          |
| ------------------------ | -------------------- | ----------------------------------------------------------------- |
| `config/index.js`        | `getActiveAgents`    | Iterate agents for per-agent bot startup                          |
| `agents/index.js`        | `runAgent`           | Execute agent run for message/reaction/command                    |
| `agents/events.js`       | `agentEventBus`      | Stream events for typing indicator, broadcast                     |
| `sessions/index.js`      | `getSessionEntry`    | Check main session state for broadcast                            |
| `sessions/index.js`      | `DEFAULT_MAIN_KEY`   | Default session key constant                                      |
| `heartbeat/index.js`     | `onHeartbeatEvent`   | Subscribe to heartbeat alerts for delivery (bot.ts:11, used :343) |
| `slack/utils/context.js` | `renderSlackContext` | Cross-render Slack context (utils/context.ts:2, used :55)         |

**Assessment: Medium.** The `onHeartbeatEvent` cross-extension dependency is notable — Discord delivers heartbeat alerts. This needs to be event-driven instead. The `renderSlackContext` cross-reference between Discord and Slack is a mutual coupling — both can render each other's context type.

**Required context surface:**

- `runAgent` → already on context
- `agentEventBus` → replaced by `subscribe()`
- `getActiveAgents` → `getAgents()` on context
- `getSessionEntry` → add session helper to context or move to shared
- `onHeartbeatEvent` → replace with `subscribe("heartbeat.event", handler)`
- `DEFAULT_MAIN_KEY` → move to shared constants
- `renderSlackContext` → move context rendering to shared or break the mutual dependency

---

## 6. Slack

**Files:** `components/slack/index.ts` → `slack/index.ts` → `slack/bot.ts` + handlers + utils (17 files)

| Gateway-internal import | Symbol             | Used for                                       |
| ----------------------- | ------------------ | ---------------------------------------------- |
| `config/index.js`       | `getActiveAgents`  | Iterate agents for per-agent bot startup       |
| `agents/index.js`       | `runAgent`         | Execute agent run for message/reaction/command |
| `agents/events.js`      | `agentEventBus`    | Stream events for thinking reaction, broadcast |
| `sessions/index.js`     | `getSessionEntry`  | Check main session state for broadcast         |
| `sessions/index.js`     | `DEFAULT_MAIN_KEY` | Default session key constant                   |

**Assessment: Medium.** Same pattern as Discord but without the heartbeat cross-dependency.

**Required context surface:** Same as Discord minus `onHeartbeatEvent`.

---

## 7. Projects (THE BIG ONE)

**Files:** `components/projects/index.ts` (2499 lines) → massive dependency tree

| Gateway-internal import     | Symbols                                                                                                                            | Used for                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `agents/events.js`          | `agentEventBus`                                                                                                                    | **Emit** file/agent change events (emitFileChanged :220, watcher emitFileChanged :69, emitAgentChanged :84) |
| `config/index.js`           | `getActiveAgents`, `getAgent`, `getSubagentTemplates`, `loadConfig`, `isAgentActive`                                               | Config access throughout (getSubagentTemplates at :28, used :525/:772/:928/:1612/:2101)                     |
| `agents/sessions.js`        | `deleteSession`                                                                                                                    | Clear in-memory session state on lead reset                                                                 |
| `agents/index.js` (dynamic) | `runAgent`                                                                                                                         | Execute lead-agent runs                                                                                     |
| `sessions/index.js`         | `clearSessionEntry`, `clearClaudeSessionId`, `DEFAULT_MAIN_KEY`                                                                    | Session cleanup on reset (clearClaudeSessionId at :108, :418, :426)                                         |
| `history/store.js`          | `invalidateResolvedHistoryFile`                                                                                                    | History cache invalidation on reset                                                                         |
| `subagents/index.js`        | 10+ symbols                                                                                                                        | Subagent CRUD, logs, listing, config management                                                             |
| `subagents/runner.js`       | `spawnSubagent`, `spawnRalphLoop`, `interruptSubagent`, `killSubagent`, `isSupportedSubagentCli`, `getUnsupportedSubagentCliError` | Subagent lifecycle                                                                                          |
| `projects/index.js`         | 20+ symbols                                                                                                                        | Project CRUD, git, space, comments, specs                                                                   |
| `projects/watcher.js`       | `startProjectWatcher`, `ProjectWatcher`                                                                                            | File watcher lifecycle                                                                                      |
| `areas/index.js`            | 5 symbols                                                                                                                          | Area CRUD                                                                                                   |
| `activity/index.js`         | 3 symbols                                                                                                                          | Activity feed recording/querying                                                                            |
| `taskboard/index.js`        | 2 symbols                                                                                                                          | Taskboard scanning                                                                                          |
| `taskboard/parser.js`       | `parseMarkdownFile`                                                                                                                | Markdown/frontmatter parsing                                                                                |

**Transitive gateway-internal imports** (via domain modules that move with projects):
| Module | Import | Symbols |
|---|---|---|
| `activity/index.ts` | `config/index.js` | `getActiveAgents` (:7), `getSessionEntry` (:8), `DEFAULT_MAIN_KEY` (:8) |
| `activity/index.ts` | `history/store.js` | `getSessionHistory` (:9) |
| `projects/store.ts` | `config/index.js` | `CONFIG_DIR` (:12) |

**Assessment: HARD.** This is by far the deepest coupling. The projects extension pulls in ~50 symbols from 14 gateway-internal modules. It also **emits** events (not just subscribes), and uses `getSubagentTemplates` which is not on the current context design.

---

## Consolidated Gateway-Internal Surface Area

### What needs to be on `ExtensionContext` (or moved to shared)

**Already planned on context:**

- `getConfig()` ✓
- `getAgent(id)` ✓
- `getAgents()` ✓ (replaces `getActiveAgents` — single-agent filtering can happen in gateway)
- `runAgent(params)` ✓
- `subscribe(event, handler)` ✓
- `logger` ✓

**Needs adding to context:**
| Symbol | Current location | Used by | Proposal |
|---|---|---|---|
| `isAgentActive(id)` | `config/index.js` | heartbeat, projects, scheduler | Add to context |
| `isAgentStreaming(agentId)` | `agents/sessions.js` | heartbeat | Add to context (runtime state check) |
| `resolveWorkspaceDir(agent)` | `util/paths.js` | heartbeat | Add to context, or derive from `getAgent().workspace` |
| `restoreSessionUpdatedAt(agentId, sessionKey, ts)` | `sessions/store.js` | heartbeat | Add to context (session lifecycle hook) |
| `resolveSessionId(agentId, sessionKey)` | `sessions/store.js` | heartbeat | Context already plans `getSessionEntry` which wraps this |
| `getSessionEntry(agentId, key)` | `sessions/index.js` | heartbeat, discord, slack | Add to context as session accessor |
| `clearSessionEntry(agentId, key)` | `sessions/index.js` | projects | Add to context as session mutator |
| `deleteSession(agentId, sessionId)` | `agents/sessions.js` | projects | Add to context as session cleanup |
| `invalidateResolvedHistoryFile(agentId, sessionId)` | `history/store.js` | projects | Add to context as history invalidation |
| `getSessionHistory(agentId, sessionId)` | `history/store.js` | projects (via activity) | Add to context for history retrieval |
| `getSubagentTemplates()` | `config/index.js` | projects | Add to context |
| `clearClaudeSessionId(agentId, sessionId)` | `sessions/claude.ts` | projects | **Remove entirely** (Claude SDK is being removed) |
| `DEFAULT_MAIN_KEY` | `sessions/index.js` | heartbeat, discord, slack, projects | Move to `@aihub/shared` constants |
| `CONFIG_DIR` / `SCHEDULES_PATH` | `config/index.js` | scheduler, multi-user, projects/store | Derive from `getDataDir()` or add data dir helper to context |

**Event publishing — extensions must be able to emit events too:**
| Symbol | Current location | Used by | Proposal |
|---|---|---|---|
| `agentEventBus.emitFileChanged(...)` | `agents/events.ts` | projects (component + watcher) | Add `emit(event, payload)` to context |
| `agentEventBus.emitAgentChanged(...)` | `agents/events.ts` | projects (watcher) | Same `emit()` |

**Needs moving to `@aihub/shared`:**
| Symbol | Current location | Used by | Proposal |
|---|---|---|---|
| `AgentStreamEvent` (type) | `agents/events.ts` | langfuse | Move to shared |
| `AgentHistoryEvent` (type) | `agents/events.ts` | langfuse | Move to shared |
| `agentEventBus` event names/contract | `agents/events.ts` | all event consumers | Define event name constants in shared |

### What CANNOT go on context (domain logic)

These are the hard cases — large domain modules that extensions call into directly:

| Module                 | Symbols                                                                | Used by            | Problem                        |
| ---------------------- | ---------------------------------------------------------------------- | ------------------ | ------------------------------ |
| `projects/store.ts`    | 20+ CRUD functions                                                     | projects extension | Domain logic, not gateway core |
| `projects/space.ts`    | 15+ space operations                                                   | projects extension | Domain logic, git operations   |
| `projects/watcher.ts`  | File watcher                                                           | projects extension | Domain logic, chokidar         |
| `subagents/runner.ts`  | `spawnSubagent`, `spawnRalphLoop`, `interruptSubagent`, `killSubagent` | projects extension | CLI process management         |
| `subagents/index.ts`   | 10+ metadata functions                                                 | projects extension | Subagent persistence           |
| `areas/store.ts`       | Area CRUD                                                              | projects extension | Domain logic                   |
| `activity/index.ts`    | Activity recording                                                     | projects extension | Domain logic                   |
| `taskboard/scanner.ts` | Taskboard scanning                                                     | projects extension | Domain logic                   |

**Resolution:** These modules MOVE WITH the extension. They are part of the projects extension package, not gateway core. The projects extension is not just a thin wrapper — it's a large domain that brings its own modules along.

### Cross-extension dependencies

| From     | To        | Symbol                                                         | Resolution                                       |
| -------- | --------- | -------------------------------------------------------------- | ------------------------------------------------ |
| Discord  | Heartbeat | `onHeartbeatEvent`                                             | Replace with `subscribe("heartbeat.event", ...)` |
| Discord  | Slack     | `renderSlackContext`                                           | Move context rendering to shared utility         |
| Projects | Heartbeat | `heartbeat/index.js` (not direct, but uses `DEFAULT_MAIN_KEY`) | Via shared constant                              |
| Projects | Scheduler | Uses scheduler implicitly (heartbeat depends on scheduler)     | Via topo-sort                                    |

---

## Extension Context Final Design

```typescript
interface ExtensionContext {
  // Config
  getConfig(): GatewayConfig;
  getDataDir(): string; // $AIHUB_HOME

  // Agent access (pre-filtered for single-agent mode)
  getAgent(id: string): AgentConfig | undefined;
  getAgents(): AgentConfig[];
  isAgentActive(id: string): boolean;

  // Agent runtime state
  isAgentStreaming(agentId: string): boolean;
  resolveWorkspaceDir(agent: AgentConfig): string;

  // Agent execution
  runAgent(params: RunAgentParams): Promise<RunAgentResult>;
  getSubagentTemplates(): SubagentTemplate[]; // configured subagent definitions

  // Session management
  resolveSessionId(
    agentId: string,
    sessionKey: string
  ): Promise<SessionEntry | undefined>;
  getSessionEntry(
    agentId: string,
    sessionKey: string
  ): Promise<SessionEntry | undefined>;
  clearSessionEntry(
    agentId: string,
    sessionKey: string,
    userId?: string
  ): Promise<SessionEntry | undefined>;
  restoreSessionUpdatedAt(
    agentId: string,
    sessionKey: string,
    timestamp: number
  ): void;
  deleteSession(agentId: string, sessionId: string): void;
  invalidateHistoryCache(
    agentId: string,
    sessionId: string,
    userId?: string
  ): Promise<void>;
  getSessionHistory(
    agentId: string,
    sessionId: string
  ): Promise<HistoryMessage[]>;

  // Events
  subscribe(event: ExtensionEvent, handler: EventHandler): UnsubscribeFn;
  emit(event: ExtensionEvent, payload: unknown): void;

  // Logging
  logger: ExtensionLogger;
}
```

## What Moves With Each Extension (beyond the component wrapper)

| Extension  | Domain modules that move into the package                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| heartbeat  | `heartbeat/runner.ts`, `heartbeat/index.ts`                                                                                                      |
| scheduler  | `scheduler/service.ts`, `scheduler/store.ts`, `scheduler/schedule.ts`, `scheduler/index.ts`                                                      |
| langfuse   | `langfuse/tracer.ts`, `langfuse/types.ts` (already co-located)                                                                                   |
| multi-user | All 8 files already in `components/multi-user/`                                                                                                  |
| discord    | `discord/` (21 files) — the entire discord module                                                                                                |
| slack      | `slack/` (17 files) — the entire slack module                                                                                                    |
| projects   | `projects/` (store, space, git, tasks, watcher), `subagents/` (runner, index), `areas/`, `activity/`, `taskboard/` — **~30 files, ~8000+ lines** |

The projects extension is the 800-lb gorilla — it absorbs the majority of gateway domain modules. This is actually fine architecturally (those modules only serve projects), but it means the projects package will be large and have significant surface area on `ExtensionContext` for session/agent management.
