# AIHub - LLM Context Document

## Project Goal

AIHub is a lightweight, self-hosted multi-agent gateway. It provides a unified interface to run AI agents across multiple surfaces: web UI, Discord, CLI, scheduled jobs, and amsg inbox. Designed for solo developers managing multiple agents with minimal operational overhead.

## Architecture

```
aihub/
├── apps/
│   ├── gateway/     # Node.js server, CLI, agent runtime
│   └── web/         # Solid.js mobile-first chat UI
├── packages/
│   └── shared/      # Zod schemas, shared types
└── ~/.aihub/        # Runtime config & data
```

### apps/gateway

Core TypeScript/Node.js application. Exports:
- **CLI** (`src/cli/index.ts`): `aihub gateway`, `aihub agent list`, `aihub send`
- **Server** (`src/server/`): Hono-based HTTP API + WebSocket streaming
- **Agent Runtime** (`src/agents/`): Pi SDK integration, session management
- **Scheduler** (`src/scheduler/`): Interval/daily job execution
- **Discord** (`src/discord/`): Per-agent Discord bot integration
- **Amsg** (`src/amsg/`): Inbox watcher for agent-to-agent messaging

### apps/web

Solid.js SPA. Two views:
- `AgentList`: Select agent to chat with
- `ChatView`: WebSocket-based streaming chat interface

Proxies `/api` and `/ws` to gateway (port 4000) in dev mode.

### packages/shared

Zod schemas for all types: `AgentConfig`, `GatewayConfig`, `Schedule`, `StreamEvent`, API payloads.

## Runtime Data

All stored in `~/.aihub/`:
- `aihub.json` - Main config (agents, server, scheduler)
- `models.json` - Custom model providers (Pi SDK format; read directly by Pi SDK)
- `schedules.json` - Persisted schedule jobs with state
- `sessions.json` - Session key -> sessionId mapping with timestamps
- `sessions/*.jsonl` - Agent conversation history (Pi SDK transcripts)
- (Pi SDK) auth/settings files under `~/.aihub/` (created after a successful agent run)
  - `aihub.json` itself is required and is **not** auto-created

## Config Schema

```typescript
{
  agents: [{
    id: string,
    name: string,
    workspace: string,           // Agent working directory (~ expanded)
    model: { provider, model },  // Pi SDK model reference
    thinkLevel?: "off"|"minimal"|"low"|"medium"|"high",
    queueMode?: "queue"|"interrupt",  // Default: queue
    discord?: { token, applicationId?, guildId?, channelId? },
    amsg?: { id?, enabled? }
  }],
  server?: { host?, port?, baseUrl? },
  scheduler?: { enabled?, tickSeconds? },
  web?: { baseUrl? }
}
```

## Agent Runtime Flow

1. **Config Load**: `loadConfig()` reads `~/.aihub/aihub.json`, validates via Zod
2. **Model Resolution**: Pi SDK `discoverModels()` reads `~/.aihub/models.json` directly
3. **Session Management**: Per-agent/session state in memory (`sessions.ts`)
4. **Skills**: Auto-loaded from `{workspace}/.pi/skills/` via Pi SDK

### Queue Semantics

When agent is already streaming:
- **queue** (default): Inject message via `AgentSession.queueMessage()`. If Pi session not ready, buffer in `pendingMessages` and inject after session creation.
- **interrupt**: Abort current run, wait up to 2s for streaming to end, start new run.

### WebSocket Streaming

Connect to `/ws` endpoint. Client sends:
```typescript
{ type: "send", agentId: string, sessionKey?: string, sessionId?: string, message: string }
```

Server streams back:
```typescript
{ type: "text", data: string }
{ type: "tool_start", toolName: string }
{ type: "tool_end", toolName: string, isError?: boolean }
{ type: "done", meta?: { durationMs } }
{ type: "error", message: string }
```
Connection closes after `done` or `error`.

### Session Persistence

Sessions are managed via `sessionKey` (logical name) rather than raw `sessionId`:
- **sessionKey**: Logical key (default: "main") stored in `~/.aihub/sessions.json`
- **sessionId**: Raw UUID, bypasses key resolution if provided directly
- **idleMinutes**: Sessions expire after 60 minutes of inactivity (creates new session)
- **resetTriggers**: `/new` or `/reset` force a new session; the trigger is stripped from message

Store format: `{agentId}:{sessionKey}` -> `{ sessionId, updatedAt }`

Web UI persists `sessionKey` per agent in localStorage (default "main"). On mount, fetches history via `GET /api/agents/:id/history?sessionKey=main`. Users can type `/new` to start fresh conversation.

## Services

### Scheduler (`src/scheduler/`)

Two schedule types:
- **interval**: `{ type: "interval", everyMinutes: N, startAt?: ISO8601 }`
- **daily**: `{ type: "daily", time: "HH:MM", timezone?: string }`

Jobs stored in `~/.aihub/schedules.json` with state (nextRunAtMs, lastRunAtMs, lastStatus). Timezone calculation uses `Intl.DateTimeFormat` for proper DST handling.

### Discord (`src/discord/`)

One bot per agent with discord config. Listens to configured guild/channel (or all if not specified). Session ID: `discord:{channelId}`. Handles 2000-char chunking.

### Amsg Watcher (`src/amsg/`)

Polls `amsg inbox --new -a <id>` every 60s. Tracks seen message IDs (JSON mode) or uses 5-min throttle (fallback). Triggers agent with "check inbox" message. Skips if agent is streaming.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List active agents |
| GET | `/api/agents/:id/status` | Agent status |
| POST | `/api/agents/:id/messages` | Send message (returns result) |
| GET | `/api/agents/:id/history` | Get session history (query: sessionKey) |
| WS | `/ws` | WebSocket streaming (JSON protocol) |
| GET | `/api/schedules` | List schedules |
| POST | `/api/schedules` | Create schedule |
| PATCH | `/api/schedules/:id` | Update schedule |
| DELETE | `/api/schedules/:id` | Delete schedule |

## Single-Agent Mode

`aihub gateway --agent-id <id>` filters all services to one agent. Useful for isolated testing.

## Key Dependencies

- **Pi SDK** (`@mariozechner/pi-coding-agent`): Agent runtime, tools, skills, model registry
- **Hono**: HTTP server framework
- **Discord.js**: Discord bot integration
- **Zod**: Schema validation
- **Commander**: CLI framework

## Development

```bash
pnpm install
pnpm dev:gateway  # tsx watch on CLI entry
pnpm dev:web      # Vite dev server
pnpm build        # TypeScript compile
pnpm aihub <cmd>  # Run CLI
```
