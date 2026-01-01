---
name: AIHub v1 PRP - Multi-Agent Gateway, Webchat, Discord, CLI
---

## Goal

**Feature Goal**: Build AIHub v1: a multi-agent gateway that routes messages to the correct agent across Webchat, Discord, and CLI, with Pi SDK agents, browser automation, minimal scheduling, and amsg inbox-triggered wake.

**Deliverable**: A TypeScript codebase containing a gateway service, a mobile-first webchat UI, and a local CLI that all route to the same multi-agent runtime using `~/.aihub/aihub.json`.

**Success Definition**: I can add agents by editing the JSON config, see them in the web UI, chat with any agent from web/Discord/CLI, run scheduled jobs, and have amsg inbox messages trigger the right agent without interrupting in-flight runs.

## User Persona (if applicable)

**Target User**: Solo developer running a private AI assistant platform over Tailscale.

**Use Case**: Spin up multiple Pi agents (each with its own workspace/model/Discord bot), interact via webchat/Discord/CLI, and schedule recurring jobs.

**User Journey**:
1. Edit `~/.aihub/aihub.json` to add agents.
2. Start gateway (multi-agent mode) or `--agent-id` for single-agent local testing.
3. Open mobile webchat, pick an agent, and chat.
4. Send messages from Discord or CLI to the same agent.
5. Create a daily or interval schedule for an agent.
6. amsg watcher detects a new inbox item and posts a normal message to the target agent.

**Pain Points Addressed**:
- Prior webchat UX is weak; this provides a mobile-first UI.
- Single-agent gateway is limiting; multi-agent routing is required.
- Need simple recurring tasks without heavy scheduling infra.
- Need amsg-triggered wake without bespoke queueing.

## Why

- Consolidates multi-agent operations in one gateway while still allowing single-agent mode for local testing.
- Enables consistent routing and queue behavior across webchat, Discord, and CLI.
- Keeps scope small: Pi SDK only, no device control/voice/native app/webhooks.

## What

AIHub v1 includes:
- Multi-agent gateway with `agents[]` config in `~/.aihub/aihub.json`.
- Surfaces: Webchat (mobile-first), Discord (one bot per agent), CLI (send/run).
- Pi SDK agent runtime with skills from `./pi/skills`.
- Queue semantics preserved: if agent is streaming, new messages are queued into the current run; otherwise a new run starts.
- Browser automation available to agents from all surfaces.
- Minimal scheduler: `interval` (every N minutes) and `daily` (local time, default TZ).
- amsg watcher: every minute, check inbox; if new messages, send a normal agent message.

Non-goals (v1): device control, voice, native desktop app, canvas/A2UI, webhooks, skills installer/update system.

### Success Criteria

- [ ] `~/.aihub/aihub.json` supports multiple agents with required fields and validates on startup.
- [ ] Gateway routes messages by agent id for webchat/Discord/CLI.
- [ ] Webchat shows agent list and per-agent chat, works on mobile.
- [ ] Discord bots are isolated per agent.
- [ ] CLI can send a message to a specific agent id.
- [ ] Browser automation works when prompted from any surface.
- [ ] Scheduler supports `interval` and `daily` schedules.
- [ ] amsg watcher detects new inbox items and triggers agent via normal message.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: /Users/thinh/code/playground/clawdis/docs/queue.md
  why: Queue vs interrupt semantics; how streaming queue behaves.
  critical: Queue injects a user message into the current run, not a separate post-run buffer.

- file: /Users/thinh/code/playground/clawdis/docs/agent.md
  why: Streaming queue behavior and when queued messages are checked.
  critical: Queued messages are checked after each tool call; remaining tool calls may be skipped.

- file: /Users/thinh/code/agent-tools/skills/amsg-cli/SKILL.md
  why: Correct amsg CLI usage (inbox/pull/show/ack) and lifecycle.
  critical: Do not pull and show simultaneously; pull then show.

- file: /Users/thinh/code/playground/clawdis/src/agents/pi-embedded-runner.ts
  why: Pi SDK run/queue patterns, isStreaming, and queueMessage behavior.
  pattern: queueEmbeddedPiMessage and isStreaming helpers.

- file: /Users/thinh/code/playground/clawdis/src/cron/service.ts
  why: Reference for a minimal scheduler service and run logging patterns.
  pattern: Jobs list/add/remove/run and scheduler loop.

- file: /Users/thinh/code/playground/clawdis/src/cli/gateway-cli.ts
  why: CLI pattern for gateway commands and config loading.
  pattern: Commander/yargs layout and error handling.
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
/Users/thinh/code/aihub
└── docs/
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
aihub/
  apps/
    gateway/
      src/
        config/         # config load/validate, defaults, path resolution
        agents/         # Pi SDK runtime adapter and queue helpers
        discord/        # one-bot-per-agent adapter
        scheduler/      # interval + daily scheduler
        amsg/           # inbox watcher
        server/         # HTTP + WS/SSE API, routing
        index.ts        # gateway entry
    web/
      src/
        components/     # SolidJS UI components
        routes/         # agent list + chat views
        state/          # client state (agent list, chat sessions)
        api/            # API client for gateway
        main.tsx
  packages/
    shared/
      src/
        types.ts        # shared types (AgentConfig, Schedule, API payloads)
  docs/
    prp/
      aihub-v1-prp.md
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: Queue semantics - queued messages are injected into the current run after tool calls.
// CRITICAL: amsg CLI lifecycle: inbox -> pull -> show -> ack (do not show before pull).
// CRITICAL: Webchat has no auth; assume private Tailscale-only access.
// CRITICAL: Daily schedules should use local timezone by default to avoid drift.
// CRITICAL: Config path is fixed to ~/.aihub/aihub.json (JSON only).
```

## Implementation Blueprint

### Data models and structure

```typescript
export type ThinkLevel = "off" | "minimal" | "low" | "medium" | "high";

export interface AgentModelConfig {
  provider: string; // e.g. "anthropic" | "openai" | "ollama"
  model: string;    // provider-specific model id
}

export interface DiscordConfig {
  token: string;    // bot token
  applicationId?: string;
  guildId?: string;
  channelId?: string; // optional default channel
}

export interface AmsgConfig {
  id?: string;       // if omitted, default to agent id
  enabled?: boolean; // default true
}

export interface AgentConfig {
  id: string;
  name: string;
  workspaceDir: string; // where ./pi/skills lives
  model: AgentModelConfig;
  discord?: DiscordConfig;
  thinkLevel?: ThinkLevel;
  queueMode?: "queue" | "interrupt"; // default queue
  amsg?: AmsgConfig;
}

export type ScheduleType = "interval" | "daily";

export interface IntervalSchedule {
  type: "interval";
  everyMinutes: number; // >= 1
  startAt?: string;     // ISO date-time
}

export interface DailySchedule {
  type: "daily";
  time: string;         // "HH:mm"
  timezone?: string;    // optional, defaults to server TZ
}

export interface ScheduleJob {
  id: string;
  name: string;
  agentId: string;
  enabled: boolean;
  schedule: IntervalSchedule | DailySchedule;
  payload: {
    message: string; // message sent to agent
    sessionId?: string;
  };
}

export interface GatewayConfig {
  agents: AgentConfig[];
  server?: { host?: string; port?: number; baseUrl?: string };
  scheduler?: { enabled?: boolean; tickSeconds?: number };
  web?: { baseUrl?: string };
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: INIT repo structure + tooling
  - IMPLEMENT: pnpm workspace, tsconfig, lint config, build scripts
  - PLACEMENT: /apps/gateway, /apps/web, /packages/shared

Task 2: CREATE packages/shared/src/types.ts
  - IMPLEMENT: TypeScript types and zod schemas for config + API payloads
  - PLACEMENT: packages/shared/src/types.ts

Task 3: CREATE gateway config loader
  - IMPLEMENT: Resolve path ~/.aihub/aihub.json, load JSON, validate with zod
  - ADD: minimal defaults (queueMode = queue, amsg enabled)
  - PLACEMENT: apps/gateway/src/config

Task 4: CREATE Pi SDK agent adapter
  - IMPLEMENT: runAgent({ agentId, message, sessionId, thinkLevel })
  - IMPLEMENT: queue behavior using AgentSession.isStreaming + queueMessage
  - PLACEMENT: apps/gateway/src/agents

Task 5: CREATE gateway server + API
  - IMPLEMENT: HTTP server exposing:
      GET /api/agents (list)
      GET /api/agents/:id/status
      POST /api/agents/:id/messages (send message)
      GET /api/agents/:id/stream (SSE for replies)
      GET /api/schedules (list)
      POST /api/schedules (create)
      PATCH /api/schedules/:id (update)
      DELETE /api/schedules/:id (remove)
  - PLACEMENT: apps/gateway/src/server

Task 6: CREATE Discord adapter (one bot per agent)
  - IMPLEMENT: bot per agent config; route messages to agent runtime
  - DEPENDENCIES: Task 4/5 for routing
  - PLACEMENT: apps/gateway/src/discord

Task 7: CREATE CLI
  - IMPLEMENT: aihub send --agent <id> --message "..."
  - IMPLEMENT: aihub agent list
  - IMPLEMENT: aihub gateway --agent-id <id> (single-agent mode)
  - PLACEMENT: apps/gateway/src/cli

Task 8: CREATE scheduler service
  - IMPLEMENT: in-memory scheduler loop (tickSeconds default 60)
  - IMPLEMENT: interval + daily schedule evaluation
  - STORAGE: JSON file under ~/.aihub/schedules.json
  - PLACEMENT: apps/gateway/src/scheduler

Task 9: CREATE amsg watcher
  - IMPLEMENT: every minute, for each agent with amsg enabled:
      run `amsg inbox --new -a <amsgId>`
      if new items exist: send normal agent message
  - NOTE: Keep queue semantics; do not interrupt in-flight runs
  - PLACEMENT: apps/gateway/src/amsg

Task 10: CREATE mobile-first webchat
  - IMPLEMENT: SolidJS mobile-first UI
  - IMPLEMENT: agent list -> agent chat view
  - IMPLEMENT: message send + streaming display
  - PLACEMENT: apps/web/src

Task 11: TESTS
  - IMPLEMENT: config validation tests
  - IMPLEMENT: scheduler interval/daily evaluation tests
  - IMPLEMENT: routing tests for agent selection
```

### Implementation Patterns & Key Details

```typescript
// Config loading
const CONFIG_PATH = path.join(os.homedir(), ".aihub", "aihub.json");

// Queue behavior (keep existing semantics)
if (session.isStreaming()) {
  session.queueMessage(text); // queued into current run after tool calls
} else {
  runAgentTurn(text); // start new run
}

// Daily schedule evaluation (local timezone default)
// nextRun = today at HH:mm in tz; if already passed, schedule tomorrow

// amsg watcher (minimal)
// 1) amsg inbox --new -a <agent>
// 2) if any, send "You have new messages; check your inbox." as normal message
```

### Integration Points

```yaml
CONFIG:
  - file: ~/.aihub/aihub.json
  - schedules: ~/.aihub/schedules.json
  - pattern: JSON only

ROUTES:
  - api base: /api
  - web app: / (static build)

RUNTIME:
  - Pi SDK uses agent.workspaceDir; skills under ./pi/skills
  - amsg CLI required in PATH
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
pnpm lint
pnpm typecheck
pnpm format
```

### Level 2: Unit Tests (Component Validation)

```bash
pnpm test
pnpm test --filter config
pnpm test --filter scheduler
```

### Level 3: Integration Testing (System Validation)

```bash
pnpm dev:gateway
pnpm dev:web
curl -I http://localhost:4000/api/agents
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Mobile-first UI sanity check
# Open on iPhone/Android browser and verify layout
```

## Final Validation Checklist

### Technical Validation

- [ ] All validation levels completed successfully
- [ ] No linting errors: `pnpm lint`
- [ ] No type errors: `pnpm typecheck`
- [ ] Formatting clean: `pnpm format`

### Feature Validation

- [ ] Agents load from `~/.aihub/aihub.json` and appear in web UI
- [ ] Webchat can send/receive messages per agent
- [ ] Discord routes to correct agent
- [ ] CLI routes to correct agent
- [ ] Scheduler runs interval/daily jobs
- [ ] amsg watcher triggers agent when inbox has new items

### Code Quality Validation

- [ ] Shared types used across gateway/web/cli
- [ ] Single-agent mode works via `--agent-id`
- [ ] Queue semantics preserved

---

## Anti-Patterns to Avoid

- ❌ Don’t add auth or multi-user tenancy in v1
- ❌ Don’t implement webhooks or device control
- ❌ Don’t create a plugin/skills installer (use ./pi/skills only)
- ❌ Don’t change queue semantics (keep queue into current run)
- ❌ Don’t build separate per-agent gateways (single gateway + optional single-agent mode)
