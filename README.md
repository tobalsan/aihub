# AIHub

Multi-agent gateway for AI agents. Exposes agents via web UI, Discord, CLI, and scheduled jobs.

## Quick Start

```bash
# Install
pnpm install

# Configure
mkdir -p ~/.aihub
cat > ~/.aihub/aihub.json << 'EOF'
{
  "agents": [
    {
      "id": "my-agent",
      "name": "My Agent",
      "workspace": "~/workspace/my-agent",
      "model": { "provider": "anthropic", "model": "claude-sonnet-4-5-20250929" }
    },
    {
      "id": "claude-agent",
      "name": "Claude Agent",
      "workspace": "~/workspace/claude-agent",
      "sdk": "claude",
      "model": {
        "model": "claude-opus-4-5-20251101",
        "base_url": "http://127.0.0.1:8317",
        "auth_token": "sk-dummy"
      }
    }
  ]
}
EOF

# Build & run
pnpm build && pnpm build:web
pnpm aihub gateway
```

Open http://localhost:3000

## Project Structure

```
apps/
  gateway/    # Server, CLI, Discord, scheduler
  web/        # Solid.js chat UI
packages/
  shared/     # Types & schemas
```

## CLI

```bash
pnpm aihub gateway [--port 4000] [--host 127.0.0.1] [--agent-id <id>]
pnpm aihub agent list
pnpm aihub send -a <agentId> -m "Hello" [-s <sessionId>]

# OAuth authentication (Pi SDK agents)
pnpm aihub auth login           # Interactive provider selection
pnpm aihub auth login anthropic # Login to specific provider
pnpm aihub auth status          # Show authenticated providers
pnpm aihub auth logout <provider>
```

## OAuth Authentication

Pi SDK agents can use OAuth tokens instead of API keys. Supported providers: `anthropic`, `openai-codex`, `github-copilot`, `google-gemini-cli`, `google-antigravity`.

```bash
# Login once
pnpm aihub auth login anthropic

# Configure agent to use OAuth
```

```json
{
  "agents": [{
    "id": "my-agent",
    "workspace": "~/workspace",
    "auth": { "mode": "oauth" },
    "model": { "provider": "anthropic", "model": "claude-opus-4-5" }
  }]
}
```

**API Key auth (e.g. OpenRouter):**

```json
{
  "env": { "OPENROUTER_API_KEY": "sk-or-..." },
  "agents": [{
    "id": "my-agent",
    "workspace": "~/workspace",
    "auth": { "mode": "api_key" },
    "model": { "provider": "openrouter", "model": "anthropic/claude-sonnet-4" }
  }]
}
```

Credentials stored in `~/.aihub/auth.json`. Tokens auto-refresh when expired.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET | List agents |
| `/api/agents/:id/messages` | POST | Send message |
| `/api/agents/:id/history` | GET | Session history (?sessionKey=main&view=simple\|full) |
| `/api/schedules` | GET/POST | List/create schedules |
| `/api/schedules/:id` | PATCH/DELETE | Update/delete schedule |
| `/api/projects` | GET/POST | List/create projects |
| `/api/projects/:id` | GET/PATCH | Get/update project |
| `/ws` | WS | WebSocket streaming (send + subscribe) |

Project API details: `docs/projects_api.md`

## Configuration

`~/.aihub/aihub.json`:

```json
{
  "agents": [
    {
      "id": "agent-1",
      "name": "Agent One",
      "workspace": "~/projects/agent-1",
      "model": { "provider": "anthropic", "model": "claude-sonnet-4-5-20250929" },
      "thinkLevel": "off",
      "queueMode": "queue",
      "discord": {
        "token": "...",
        "applicationId": "..."
      },
      "amsg": { "id": "agent-1", "enabled": true }
    }
  ],
  "sessions": { "idleMinutes": 360 },
  "gateway": { "port": 4000, "bind": "tailnet" },
  "scheduler": { "enabled": true, "tickSeconds": 60 },
  "ui": { "port": 3000, "bind": "loopback" },
  "projects": { "root": "~/projects" },
  "env": { "OPENROUTER_API_KEY": "sk-or-..." }
}
```

### Agent Options

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `name` | Display name |
| `workspace` | Agent working directory |
| `sdk` | Agent SDK: `pi` (default) or `claude` |
| `model.provider` | Model provider (required for Pi SDK) |
| `model.model` | Model name |
| `model.base_url` | API proxy URL (Claude SDK only) |
| `model.auth_token` | API auth token (Claude SDK only, overrides env) |
| `auth.mode` | `oauth`, `api_key`, or `proxy` (Pi SDK only) |
| `thinkLevel` | off, minimal, low, medium, high |
| `queueMode` | `queue` (inject into current run) or `interrupt` (abort & restart) |
| `discord` | Discord bot config ([docs](docs/discord.md)) |
| `heartbeat` | Periodic check-in config (see below) |
| `amsg` | Amsg inbox watcher config (`enabled` to toggle; ID read from workspace `.amsg-info`) |

### Gateway Options

| Field | Description |
|-------|-------------|
| `gateway.port` | Gateway port (default: 4000) |
| `gateway.bind` | `loopback` (127.0.0.1), `lan` (0.0.0.0), or `tailnet` (auto-detect tailnet IP) |
| `gateway.host` | Explicit host (overrides `bind`) |

### UI Options

| Field | Description |
|-------|-------------|
| `ui.enabled` | Auto-start web UI with gateway (default: true) |
| `ui.port` | Web UI port (default: 3000) |
| `ui.bind` | `loopback` (127.0.0.1), `lan` (0.0.0.0), or `tailnet` (auto-detect tailnet IP) |
| `ui.tailscale.mode` | `off` (default) or `serve` (enable HTTPS via `tailscale serve`) |
| `ui.tailscale.resetOnExit` | Reset tailscale serve on exit (default: true) |

**Note on `ui.tailscale.mode: "serve"`:**
- Requires Tailscale installed and logged in
- Both `gateway.bind` and `ui.bind` must be `loopback` (or omitted)
- MagicDNS hostname (e.g. `https://machine.tail1234.ts.net`) only works from other devices
- Local access requires `http://127.0.0.1:<port>` (gateway: 4000, ui: 3000 by default)

### Environment Variables

Set env vars in config (applied at load time, only if not already set):

```json
{
  "env": {
    "OPENROUTER_API_KEY": "sk-or-...",
    "GROQ_API_KEY": "gsk-..."
  }
}
```

Shell env vars take precedence over config values.

## Scheduling

Create via API:

```bash
# Every 5 minutes
curl -X POST localhost:4000/api/schedules -H "Content-Type: application/json" -d '{
  "name": "Hourly check",
  "agentId": "my-agent",
  "schedule": { "type": "interval", "everyMinutes": 60 },
  "payload": { "message": "Run hourly check" }
}'

# Daily at 9am
curl -X POST localhost:4000/api/schedules -H "Content-Type: application/json" -d '{
  "name": "Daily standup",
  "agentId": "my-agent",
  "schedule": { "type": "daily", "time": "09:00", "timezone": "America/New_York" },
  "payload": { "message": "Generate standup summary" }
}'
```

## Heartbeat

Periodic agent check-ins with Discord delivery for alerts.

```json
{
  "agents": [{
    "id": "my-agent",
    "heartbeat": {
      "every": "30m",
      "prompt": "Check on your human",
      "ackMaxChars": 300
    },
    "discord": {
      "token": "...",
      "broadcastToChannel": "123456789"
    }
  }]
}
```

| Field | Description |
|-------|-------------|
| `every` | Interval (`30m`, `1h`, `0` to disable). Default: `30m` |
| `prompt` | Custom prompt. Falls back to `HEARTBEAT.md` in workspace, then default |
| `ackMaxChars` | Max chars after token strip to still be "ok". Default: 300 |

**How it works:**
1. Agent is prompted at the interval
2. Agent replies with `HEARTBEAT_OK` token if all is well
3. If no token (or substantial content beyond `ackMaxChars`), the reply is delivered to Discord as an alert
4. Heartbeat runs don't affect session `updatedAt` (preserves idle timeout)

## Custom Models

Add custom providers via `~/.aihub/models.json`:

```json
{
  "providers": {
    "my-provider": {
      "models": [
        { "id": "my-model", "displayName": "My Model" }
      ],
      "baseUrl": "https://api.example.com/v1"
    }
  }
}
```

Synced to Pi SDK's agent dir on each run.

## Skills

Each agent can have their own skills. Skills (and other custom agent resources like commands) should be available to any coding harnesses, therefore, we use a generalized folder name. Therefore, place agent skills in `{agent_workspace}/agent/skills/`

To have them auto-loaded at runtime, they must be placed in the folder expected by the agent harness (currently only Pi). Currently, the process is manual, so for each agent, you need to create a symlink to the `./agent` folder, e.g.:

```bash
# Inside the agent workspace folder
ln -s agent .pi
```

## Development

```bash
pnpm dev          # gateway + web UI (auto-starts if ui.enabled !== false)
pnpm dev:gateway  # gateway only
pnpm dev:web      # web UI only
```

## Data

- Config: `~/.aihub/aihub.json`
- Auth: `~/.aihub/auth.json` (OAuth/API key credentials)
- Models: `~/.aihub/models.json` (optional)
- Schedules: `~/.aihub/schedules.json`
- Sessions: `~/.aihub/sessions/*.jsonl`
