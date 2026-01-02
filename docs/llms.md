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

Solid.js SPA with sleek dark theme. Two views:
- `AgentList`: Select agent to chat with
- `ChatView`: WebSocket-based streaming chat with Simple/Full view modes

Features:
- **Simple mode**: Text-only messages (default)
- **Full mode**: Shows thinking blocks (collapsed), tool calls with JSON args, tool results with diffs, model metadata (provider/model/tokens)
- Live tool indicators during streaming
- Collapsible blocks auto-collapse if content >200 chars
- Thinking indicator dots while waiting for response

Proxies `/api` and `/ws` to gateway (port 4000) in dev mode.

### packages/shared

Zod schemas and TypeScript types:
- Config types: `AgentConfig`, `GatewayConfig`, `Schedule`, `StreamEvent`
- History types: `SimpleHistoryMessage`, `FullHistoryMessage`, `ContentBlock` (thinking/text/toolCall), `ModelMeta`, `ModelUsage`
- API payloads and WebSocket protocol types

## Runtime Data

All stored in `~/.aihub/`:
- `aihub.json` - Main config (agents, server, scheduler)
- `models.json` - Custom model providers (Pi SDK format; read directly by Pi SDK)
- `schedules.json` - Persisted schedule jobs with state
- `sessions.json` - Session key -> sessionId mapping with timestamps
- `sessions/*.jsonl` - Agent conversation history (Pi SDK transcripts, JSONL format)
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
4. **Skills**: Auto-discovered via Pi SDK from `{workspace}/.pi/skills`, `~/.pi/agent/skills`, etc.
5. **Bootstrap Files**: On first run, creates workspace files from `docs/templates/`. Injected as contextFiles into system prompt.

### Workspace Bootstrap

Templates in `docs/templates/` are copied to `{workspace}/` on first agent run (using `flag: 'wx'` to avoid overwriting):

| File | Purpose |
|------|---------|
| `AGENTS.md` | Workspace overview, memory management, safety guidelines |
| `SOUL.md` | Agent persona, core behaviors, boundaries |
| `IDENTITY.md` | Agent name, creature type, vibe, emoji |
| `USER.md` | User profile - name, timezone, context |
| `TOOLS.md` | Environment-specific tool notes (SSH hosts, TTS prefs) |
| `BOOTSTRAP.md` | First-run ritual - guides identity formation, then deleted |

Bootstrap flow:
1. `ensureBootstrapFiles(workspaceDir)` writes missing files from templates
2. `loadBootstrapFiles(workspaceDir)` reads all files
3. `buildBootstrapContextFiles(files)` converts to Pi SDK contextFiles format
4. Passed to `buildSystemPrompt()` and `createAgentSession()`

### Queue Semantics

When agent is already streaming:
- **queue** (default): Inject message via `AgentSession.queueMessage()`. If Pi session not ready, buffer in `pendingMessages` and inject after session creation.
- **interrupt**: Abort current run, wait up to 2s for streaming to end, start new run.

### WebSocket Protocol

Connect to `/ws` endpoint. Supports two modes:

**Send Mode** (request/response):
```typescript
// Client sends:
{ type: "send", agentId: string, sessionKey?: string, sessionId?: string, message: string }

// Server streams back:
{ type: "text", data: string }
{ type: "tool_start", toolName: string }
{ type: "tool_end", toolName: string, isError?: boolean }
{ type: "done", meta?: { durationMs } }
{ type: "error", message: string }
```

**Subscribe Mode** (persistent connection for live updates):
```typescript
// Client subscribes:
{ type: "subscribe", agentId: string, sessionKey: string }

// Server broadcasts events from ALL runs (including background: amsg, discord, scheduler):
{ type: "text", data: string }
{ type: "tool_start", toolName: string }
{ type: "tool_end", toolName: string, isError?: boolean }
{ type: "done", meta?: { durationMs } }
{ type: "history_updated", agentId: string, sessionId: string }  // UI should refetch history
{ type: "error", message: string }

// Client unsubscribes:
{ type: "unsubscribe" }
```

Web UI uses both: `send` for user messages, `subscribe` for live background updates.

### Session Persistence

Sessions are managed via `sessionKey` (logical name) rather than raw `sessionId`:
- **sessionKey**: Logical key (default: "main") stored in `~/.aihub/sessions.json`
- **sessionId**: Raw UUID, bypasses key resolution if provided directly
- **idleMinutes**: Sessions expire after 60 minutes of inactivity (creates new session)
- **resetTriggers**: `/new` or `/reset` force a new session; the trigger is stripped from message

Store format: `{agentId}:{sessionKey}` -> `{ sessionId, updatedAt }`

Web UI persists `sessionKey` per agent in localStorage (default "main"). On mount, fetches history via `GET /api/agents/:id/history?sessionKey=main`. Users can type `/new` to start fresh conversation.

### Session Transcript Format

Sessions stored as JSONL in `~/.aihub/sessions/{agentId}-{sessionId}.jsonl`:

```jsonl
{"type":"session","id":"...","timestamp":"...","cwd":"..."}
{"type":"message","timestamp":"...","message":{"role":"user","content":[{"type":"text","text":"..."}],"timestamp":...}}
{"type":"message","timestamp":"...","message":{"role":"assistant","content":[{"type":"thinking","thinking":"..."},{"type":"toolCall","id":"...","name":"...","arguments":{...}},{"type":"text","text":"..."}],"api":"...","provider":"...","model":"...","usage":{...},"stopReason":"..."}}
{"type":"message","timestamp":"...","message":{"role":"toolResult","toolCallId":"...","toolName":"...","content":[{"type":"text","text":"..."}],"isError":false,"details":{"diff":"..."}}}
```

Content block types:
- `text`: Plain text content
- `thinking`: Model reasoning (with thinkingSignature)
- `toolCall`: Tool invocation with id, name, arguments

The history API parses this into `SimpleHistoryMessage` (text-only) or `FullHistoryMessage` (all blocks + metadata) based on `view` param.

## Services

### Scheduler (`src/scheduler/`)

Two schedule types:
- **interval**: `{ type: "interval", everyMinutes: N, startAt?: ISO8601 }`
- **daily**: `{ type: "daily", time: "HH:MM", timezone?: string }`

Jobs stored in `~/.aihub/schedules.json` with state (nextRunAtMs, lastRunAtMs, lastStatus). Timezone calculation uses `Intl.DateTimeFormat` for proper DST handling.

### Discord (`src/discord/`)

One bot per agent with discord config. When `channelId` is configured, only that channel is handled; messages in other channels are ignored. Uses `sessionKey: "main"` (shares session with web UI). Handles 2000-char chunking.

Live broadcast: Main-session responses from other sources (web, amsg, scheduler) are automatically broadcast to the Discord channel. Discord-originated runs are not echoed back (loop prevention via `source` tracking).

### Amsg Watcher (`src/amsg/`)

Polls `amsg inbox --new -a <id>` every 60s. Reads amsg ID from `{workspace}/.amsg-info` (JSON with `agent_id` field) - skips agents without this file. Triggers agent with "check inbox" message using `sessionKey: "main"`. Skips if agent is streaming. Agent handles `pull`/`ack` workflow.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List active agents |
| GET | `/api/agents/:id/status` | Agent status |
| POST | `/api/agents/:id/messages` | Send message (returns result) |
| GET | `/api/agents/:id/history` | Get session history (query: sessionKey, view=simple\|full) |
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
