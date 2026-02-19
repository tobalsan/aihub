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
│   ├── cli/         # apm CLI package (HTTP client to gateway API)
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

### packages/cli

Standalone `apm` CLI package. It only talks to the gateway API over HTTP.

- Env URL precedence: `AIHUB_API_URL` > `AIHUB_URL` > `~/.aihub/config.json` (`apiUrl`)
- Token precedence: `AIHUB_TOKEN` > `~/.aihub/config.json` (`token`)

## Runtime Data

All stored in `~/.aihub/`:

- `aihub.json` - Main config (agents, server, scheduler)
- `models.json` - Custom model providers (Pi SDK format; read directly by Pi SDK)
- `schedules.json` - Persisted schedule jobs with state
- `projects.json` - Project ID counter (`{ lastId }`)
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
    sdk?: "pi"|"claude"|"openclaw",  // Default: pi
    model: {
      provider?: string,         // Required for Pi SDK; optional for Claude
      model: string,
      base_url?: string,         // API proxy URL (Claude SDK only)
      auth_token?: string        // API auth token (Claude SDK only, overrides env)
    },
    auth?: {                     // Auth config (Pi SDK)
      mode?: "oauth"|"api_key"|"proxy",
      profileId?: string         // e.g. "anthropic:default"
    },
    thinkLevel?: "off"|"minimal"|"low"|"medium"|"high"|"xhigh",
    queueMode?: "queue"|"interrupt",  // Default: queue
    discord?: { token, applicationId?, dm?, groupPolicy?, guilds?, historyLimit?, replyToMode?, broadcastToChannel?, ... },
    heartbeat?: { every?, prompt?, ackMaxChars? },
    amsg?: { id?, enabled? },
    introMessage?: string            // Custom intro for /new (default: "New conversation started.")
  }],
  server?: { host?, port?, baseUrl? },
  gateway?: { host?, port?, bind? },  // bind: loopback|lan|tailnet
  sessions?: { idleMinutes? },        // Default: 360 (6 hours)
  scheduler?: { enabled?, tickSeconds? },
  web?: { baseUrl? },
  projects?: { root? },            // Projects root (default: ~/projects)
  ui?: { enabled?, port?, bind?, tailscale? }  // enabled: default true; bind: loopback|lan|tailnet; tailscale: { mode: off|serve }
  // Note: tailscale.mode=serve requires gateway.bind and ui.bind to be loopback
}
```

## Agent Runtime Flow

1. **Config Load**: `loadConfig()` reads `~/.aihub/aihub.json`, validates via Zod
2. **Model Resolution**: Pi SDK `discoverModels()` reads `~/.aihub/models.json` directly
3. **Session Management**: Per-agent/session state in memory (`sessions.ts`)
4. **Skills**: Auto-discovered via Pi SDK from `{workspace}/.pi/skills`, `~/.pi/agent/skills`, etc.
5. **Slash Commands**: Auto-discovered from `{workspace}/.pi/commands`, `~/.pi/agent/commands`
6. **Bootstrap Files**: On first run, creates workspace files from `docs/templates/`. Injected as contextFiles into system prompt.

### Workspace Bootstrap

Templates in `docs/templates/` are copied to `{workspace}/` on first agent run (using `flag: 'wx'` to avoid overwriting):

| File           | Purpose                                                    |
| -------------- | ---------------------------------------------------------- |
| `AGENTS.md`    | Workspace overview, memory management, safety guidelines   |
| `SOUL.md`      | Agent persona, core behaviors, boundaries                  |
| `IDENTITY.md`  | Agent name, creature type, vibe, emoji                     |
| `USER.md`      | User profile - name, timezone, context                     |
| `TOOLS.md`     | Environment-specific tool notes (SSH hosts, TTS prefs)     |
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
- **idleMinutes**: Sessions expire after 360 minutes (6 hours) of inactivity by default; configurable via `sessions.idleMinutes`
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

Carbon-based Discord integration with per-guild/channel routing, reactions, and slash commands.

**Config schema:**

```typescript
discord: {
  token: string,
  applicationId?: string,           // Required for slash commands

  // DM settings
  dm?: { enabled?, allowFrom?, groupEnabled?, groupChannels? },

  // Guild routing
  groupPolicy?: "open"|"disabled"|"allowlist",  // Default: open
  guilds?: Record<guildId, {
    slug?, requireMention?, reactionNotifications?, reactionAllowlist?,
    users?, systemPrompt?, channels?: Record<channelId, { enabled?, requireMention?, users?, systemPrompt? }>
  }>,

  // Behavior
  historyLimit?: number,            // Default: 20
  clearHistoryAfterReply?: boolean, // Default: true
  replyToMode?: "off"|"all"|"first", // Default: off
  mentionPatterns?: string[],       // Regex patterns to trigger bot
  broadcastToChannel?: string       // Broadcast main session to channel
}
```

**Features:**

- **Message gating**: Bot filter, DM/guild/channel allowlists, mention requirement, user allowlists
- **Context enrichment**: Channel topic, thread starter, message history (ring buffer)
- **Reactions**: `reactionNotifications` modes: off, all, own (bot's messages), allowlist
- **Slash commands**: `/new`, `/abort`, `/help`, `/ping` (when `applicationId` set)
- **Typing indicator**: Starts on inbound, 5s keep-alive, stops on done/error, 30s TTL for queued
- **Chunking**: 2000 char limit with code fence preservation

**Session routing:**

- DMs use `sessionKey: "main"` (shares with web UI)
- Guild messages use `sessionId: discord:${channelId}` (per-channel isolation)

**Live broadcast:** Main-session responses from other sources (web, amsg, scheduler) are broadcast to `broadcastToChannel`. Discord-originated runs are not echoed back (loop prevention via `source` tracking).

### Heartbeat (`src/heartbeat/`)

Periodic agent check-in with Discord alert delivery.

**Config:**

```typescript
heartbeat?: {
  every?: string,      // Duration: "30m", "1h", "0" (disabled). Default: "30m"
  prompt?: string,     // Custom prompt (overrides HEARTBEAT.md)
  ackMaxChars?: number // Max chars after token strip. Default: 300
}
```

**Flow:**

1. Timer fires at `every` interval
2. Prompt resolved: `heartbeat.prompt` > `{workspace}/HEARTBEAT.md` > default
3. Agent runs with `source: "heartbeat"`, `sessionKey: "main"`
4. Reply evaluated:
   - Contains `HEARTBEAT_OK` + content ≤ `ackMaxChars` → status `ok-token`, no delivery
   - Empty reply → status `ok-empty`, no delivery
   - No token or substantial content → status `sent`, delivered to Discord
5. Session `updatedAt` preserved (heartbeat doesn't reset idle timer)

**Token matching:** Strips HTML/Markdown wrappers (`<b>HEARTBEAT_OK</b>`, `**HEARTBEAT_OK**`, etc.)

**Discord delivery:** Requires `discord.broadcastToChannel`. Bot must be ready and gateway connected.

**Skips when:**

- Agent not found
- Heartbeats globally disabled (`setHeartbeatsEnabled(false)`)
- Main session is streaming
- No `broadcastToChannel` configured

**Events:** `onHeartbeatEvent(payload)` for status monitoring. Payload: `{ ts, agentId, status, to?, preview?, alertText?, durationMs?, reason? }`

### Amsg Watcher (`src/amsg/`)

Polls `amsg inbox --new -a <id>` every 60s. Reads amsg ID from `{workspace}/.amsg-info` (JSON with `agent_id` field) - skips agents without this file. Triggers agent with "check inbox" message using `sessionKey: "main"`. Skips if agent is streaming. Agent handles `pull`/`ack` workflow.

## API Endpoints

| Method | Path                       | Description                                                |
| ------ | -------------------------- | ---------------------------------------------------------- |
| GET    | `/api/agents`              | List active agents                                         |
| GET    | `/api/agents/:id/status`   | Agent status                                               |
| POST   | `/api/agents/:id/messages` | Send message (returns result)                              |
| GET    | `/api/agents/:id/history`  | Get session history (query: sessionKey, view=simple\|full) |
| WS     | `/ws`                      | WebSocket streaming (JSON protocol)                        |
| GET    | `/api/schedules`           | List schedules                                             |
| POST   | `/api/schedules`           | Create schedule                                            |
| PATCH  | `/api/schedules/:id`       | Update schedule                                            |
| DELETE | `/api/schedules/:id`       | Delete schedule                                            |
| GET    | `/api/projects`            | List projects                                              |
| POST   | `/api/projects`            | Create project                                             |
| GET    | `/api/projects/:id`        | Get project                                                |
| PATCH  | `/api/projects/:id`        | Update project                                             |

## Projects Execution Modes

- `subagent`: spawn and monitor CLI subagent runs.
- `ralph_loop`: spawn and monitor Ralph loop iterations/logs.
- unset (`""`): no execution mode selected.

## Single-Agent Mode

`aihub gateway --agent-id <id>` filters all services to one agent. Useful for isolated testing.

## Direct OAuth Authentication (Pi SDK)

Pi SDK agents can authenticate via OAuth tokens stored in `~/.aihub/auth.json`. This allows running agents without a separate CLIProxyAPI.

### Supported OAuth Providers

- `anthropic` - Anthropic (Claude Pro/Max)
- `openai-codex` - OpenAI Codex
- `github-copilot` - GitHub Copilot
- `google-gemini-cli` - Google Cloud Code Assist (Gemini CLI)
- `google-antigravity` - Antigravity (Gemini 3, Claude, GPT-OSS)

Note: Run `aihub auth login` to see current available providers (list from Pi SDK).

### CLI Commands

```bash
# Login to a provider (interactive)
pnpm aihub auth login

# Login to a specific provider
pnpm aihub auth login anthropic

# Check authentication status
pnpm aihub auth status

# Logout from a provider
pnpm aihub auth logout anthropic
```

### OAuth Agent Config

```json
{
  "agents": [
    {
      "id": "my-agent",
      "name": "My Agent",
      "workspace": "~/agents/my-agent",
      "sdk": "pi",
      "auth": {
        "mode": "oauth"
      },
      "model": {
        "provider": "anthropic",
        "model": "claude-opus-4-5"
      }
    }
  ]
}
```

The `auth.mode` field is optional and can be:

- `oauth` - Require OAuth tokens (fails if not logged in via `aihub auth login`)
- `api_key` - Use only API key credentials or env vars (ignores OAuth tokens)
- `proxy` - Use existing provider config (same as default; for proxy-backed providers in `models.json`)

When `auth.mode` is not set (or `proxy`), Pi SDK's AuthStorage resolves credentials with priority:

1. Runtime override (CLI `--api-key`)
2. API key from `auth.json`
3. OAuth token from `auth.json` (auto-refreshed)
4. Environment variable
5. Fallback resolver (`models.json` custom providers)

The `auth.profileId` field is reserved for future multi-profile support.

**Implementation note:** This feature uses Pi SDK's existing AuthStorage rather than custom credential stores. Migration from legacy `~/.pi/agent/oauth.json` is handled automatically by Pi SDK.

### Storage

Credentials are stored in `~/.aihub/auth.json`:

```json
{
  "anthropic": {
    "type": "oauth",
    "access": "...",
    "refresh": "...",
    "expires": 1767304352803
  },
  "openai": { "type": "api_key", "key": "sk-..." }
}
```

## OpenClaw Connector

The OpenClaw SDK adapter connects AIHub to an [OpenClaw](https://github.com/openclaw/openclaw) gateway via WebSocket, allowing you to interact with OpenClaw agents through the AIHub web UI.

**Config:**

```json
{
  "agents": [
    {
      "id": "cloud",
      "name": "Cloud",
      "workspace": "~/agents/cloud",
      "sdk": "openclaw",
      "openclaw": {
        "gatewayUrl": "ws://127.0.0.1:18789",
        "token": "your-gateway-token",
        "sessionKey": "agent:main:main"
      },
      "model": { "provider": "openclaw", "model": "claude-sonnet-4" }
    }
  ]
}
```

| Field                 | Description                                           |
| --------------------- | ----------------------------------------------------- |
| `openclaw.gatewayUrl` | WebSocket URL (default: `ws://127.0.0.1:18789`)       |
| `openclaw.token`      | Gateway auth token                                    |
| `openclaw.sessionKey` | Target session (use `openclaw sessions list` to find) |

**Protocol:** Uses OpenClaw WebSocket protocol v3 with `backend` client mode. Streams `chat` events with `state: delta/final` for responses, `agent` events for tool calls.

**Notes:**

- `workspace` and `model` are required for schema validation but `model` doesn't control the actual model (configured in OpenClaw)
- Set `OPENCLAW_DEBUG=1` to log raw WebSocket frames

## Claude SDK Proxy Configuration

For Claude SDK agents, you can configure a proxy URL and auth token directly in the agent config instead of using environment variables:

```json
{
  "agents": [
    {
      "id": "my-agent",
      "name": "My Agent",
      "workspace": "~/agents/my-agent",
      "sdk": "claude",
      "model": {
        "model": "claude-sonnet-4-5-20250929",
        "base_url": "http://127.0.0.1:8317",
        "auth_token": "sk-dummy"
      }
    }
  ]
}
```

This sets `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` for that agent's runs. Runs with proxy config are serialized to prevent env var cross-contamination.

## Environment Variables in Config

You can set environment variables directly in `aihub.json` using the `env` field:

```json
{
  "env": {
    "OPENROUTER_API_KEY": "sk-or-...",
    "GROQ_API_KEY": "gsk-...",
    "ANTHROPIC_API_KEY": "sk-ant-..."
  },
  "agents": [...]
}
```

**Behavior:**

- Env vars are applied at config load time (before any agent runs)
- Only applied if not already set in `process.env` (shell env takes precedence)
- Supports any env var recognized by Pi SDK (provider API keys, etc.)

**Common env vars for Pi SDK providers:**

- `ANTHROPIC_API_KEY` - Anthropic
- `OPENAI_API_KEY` - OpenAI
- `OPENROUTER_API_KEY` - OpenRouter
- `GROQ_API_KEY` - Groq
- `GEMINI_API_KEY` - Google Gemini

## Key Dependencies

- **Pi SDK** (`@mariozechner/pi-coding-agent`): Agent runtime, tools, skills, model registry
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`): Claude SDK integration
- **Hono**: HTTP server framework
- **Carbon** (`@buape/carbon`): Discord bot integration (Gateway + REST)
- **Zod**: Schema validation
- **Commander**: CLI framework

## Development

```bash
pnpm install
pnpm dev          # gateway + web UI in dev mode
pnpm dev:gateway  # gateway + shared + web UI with hot reload (production mode)
pnpm dev:web      # web UI only (Vite dev server)
pnpm build        # TypeScript compile
pnpm aihub <cmd>  # Run CLI
```

Set `ui.enabled: false` in config to disable automatic web UI startup.

### Dev Mode (`--dev` flag)

`pnpm dev` runs the gateway with the `--dev` flag, enabling:

- **Auto port discovery**: If ports 4000/3000 are in use, automatically finds free ports (up to +50)
- **Service isolation**: Discord, scheduler, amsg watcher, and heartbeats are disabled
- **Tailscale skip**: No tailscale serve setup (avoids overwriting production routes)
- **Visual identification**:
  - Console banner showing active ports and disabled services
  - Browser tab title: `[DEV :3001] AIHub`
  - Orange `DEV` badge in sidebar

Multiple dev instances can run simultaneously, each auto-discovering unique ports.

To run gateway in production mode for testing:

```bash
pnpm aihub gateway  # No --dev flag, starts all services
```
