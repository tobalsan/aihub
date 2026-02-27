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
    },
    {
      "id": "openclaw-agent",
      "name": "Cloud",
      "workspace": "~/workspace/cloud",
      "sdk": "openclaw",
      "openclaw": {
        "gatewayUrl": "ws://127.0.0.1:18789",
        "token": "your-openclaw-gateway-token",
        "sessionKey": "agent:main:main"
      },
      "model": { "provider": "openclaw", "model": "claude-sonnet-4" }
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
  cli/        # apm CLI (remote-friendly, API client)
  shared/     # Types & schemas
```

## CLI

```bash
pnpm aihub gateway [--port 4000] [--host 127.0.0.1] [--agent-id <id>]
pnpm aihub agent list
pnpm aihub send -a <agentId> -m "Hello" [-s <sessionId>]

# Projects CLI (apm; uses gateway API)
pnpm apm list [--status <status>] [--owner <owner>] [--domain <domain>]
pnpm apm create --title "My Project" [--domain <domain>] [--owner <owner>] [--execution-mode <mode>] [--appetite <small|big>] [--status <status>]
pnpm apm get <id>
pnpm apm update <id> [--title <title>] [--status <status>] [--content <text>|-]
pnpm apm move <id> <status>

# Override API URL (highest precedence)
AIHUB_API_URL=http://127.0.0.1:4000 pnpm apm list
# Backward-compatible alias
AIHUB_URL=http://127.0.0.1:4000 pnpm apm list
# Config file fallback (~/.aihub/aihub.json): { "apiUrl": "http://127.0.0.1:4000" }

# Global shortcut (apm)
mkdir -p ~/.local/bin
cat > ~/.local/bin/apm <<'EOF'
#!/usr/bin/env sh
exec pnpm --dir /Users/thinh/code/aihub apm "$@"
EOF
chmod +x ~/.local/bin/apm

# Or install apm globally via pnpm link
pnpm --filter @aihub/cli build
cd packages/cli
pnpm link --global

# OAuth authentication (Pi SDK agents)
pnpm aihub auth login           # Interactive provider selection
pnpm aihub auth login anthropic # Login to specific provider
pnpm aihub auth status          # Show authenticated providers
pnpm aihub auth logout <provider>
```

Projects execution modes:

- `subagent`: default coding-agent run mode in monitoring panel.
- `ralph_loop`: iterative Ralph loop monitoring mode.
- unset: no execution mode selected.

## OAuth Authentication

Pi SDK agents can use OAuth tokens instead of API keys. Supported providers: `anthropic`, `openai-codex`, `github-copilot`, `google-gemini-cli`, `google-antigravity`.

```bash
# Login once
pnpm aihub auth login anthropic

# Configure agent to use OAuth
```

```json
{
  "agents": [
    {
      "id": "my-agent",
      "workspace": "~/workspace",
      "auth": { "mode": "oauth" },
      "model": { "provider": "anthropic", "model": "claude-opus-4-5" }
    }
  ]
}
```

**API Key auth (e.g. OpenRouter):**

```json
{
  "env": { "OPENROUTER_API_KEY": "sk-or-..." },
  "agents": [
    {
      "id": "my-agent",
      "workspace": "~/workspace",
      "auth": { "mode": "api_key" },
      "model": {
        "provider": "openrouter",
        "model": "anthropic/claude-sonnet-4"
      }
    }
  ]
}
```

Credentials stored in `~/.aihub/auth.json`. Tokens auto-refresh when expired.

## OpenClaw Connector

Connect to an [OpenClaw](https://github.com/openclaw/openclaw) gateway to use an OpenClaw agent from AIHub. This allows you to interact with OpenClaw agents through the AIHub web UI. 

If you use the `sessionKey: agent:main:main`, then it while share the same conversation context. The first two elements must match the configured agents in OpenClaw, e.g. if you configured a `main` agent, the session key must start with `agent:main:`, otherwise it will create a new agent profile in `~/.openclaw`. The third key is how control the behavior. Using `main` will continue in the OpenClaw main session, while anything else will create a new session id `third_key-openclaw`.

```json
{
  "agents": [
    {
      "id": "cloud",
      "name": "Cloud",
      "workspace": "~/workspace/cloud",
      "sdk": "openclaw",
      "openclaw": {
        "gatewayUrl": "ws://127.0.0.1:18789",
        "token": "your-openclaw-gateway-token",
        "sessionKey": "agent:main:main"
      },
      "model": { "provider": "openclaw", "model": "claude-sonnet-4" }
    }
  ]
}
```

| Field                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `openclaw.gatewayUrl` | WebSocket URL of the OpenClaw gateway (default: `ws://127.0.0.1:18789`) |
| `openclaw.token`      | Gateway authentication token (from your OpenClaw config)                |
| `openclaw.sessionKey` | Target session key to connect to                                        |

**Finding the session key:**

Run `openclaw sessions list` on the OpenClaw side to see available sessions:

```bash
openclaw sessions list
# Output shows session keys like: agent:main:main, agent:main:whatsapp:..., etc.
```

**Notes:**

- The `workspace` and `model` fields are still required for schema validation
- The `model` field doesn't control the actual model (that's configured in OpenClaw) - it's just for display/validation
- Set `OPENCLAW_DEBUG=1` environment variable to log WebSocket frames for debugging

## API

| Endpoint                   | Method       | Description                                          |
| -------------------------- | ------------ | ---------------------------------------------------- |
| `/api/agents`              | GET          | List agents                                          |
| `/api/agents/:id/messages` | POST         | Send message                                         |
| `/api/agents/:id/history`  | GET          | Session history (?sessionKey=main&view=simple\|full) |
| `/api/schedules`           | GET/POST     | List/create schedules                                |
| `/api/schedules/:id`       | PATCH/DELETE | Update/delete schedule                               |
| `/api/projects`            | GET/POST     | List/create projects                                 |
| `/api/projects/:id`        | GET/PATCH    | Get/update project                                   |
| `/ws`                      | WS           | WebSocket streaming (send + subscribe)               |

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
      "model": {
        "provider": "anthropic",
        "model": "claude-sonnet-4-5-20250929"
      },
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

| Field              | Description                                                                          |
| ------------------ | ------------------------------------------------------------------------------------ |
| `id`               | Unique identifier                                                                    |
| `name`             | Display name                                                                         |
| `workspace`        | Agent working directory                                                              |
| `sdk`              | Agent SDK: `pi` (default), `claude`, or `openclaw`                                   |
| `model.provider`   | Model provider (required for Pi SDK)                                                 |
| `model.model`      | Model name                                                                           |
| `model.base_url`   | API proxy URL (Claude SDK only)                                                      |
| `model.auth_token` | API auth token (Claude SDK only, overrides env)                                      |
| `auth.mode`        | `oauth`, `api_key`, or `proxy` (Pi SDK only)                                         |
| `thinkLevel`       | off, minimal, low, medium, high                                                      |
| `queueMode`        | `queue` (inject into current run) or `interrupt` (abort & restart)                   |
| `discord`          | Discord bot config ([docs](docs/discord.md))                                         |
| `heartbeat`        | Periodic check-in config (see below)                                                 |
| `amsg`             | Amsg inbox watcher config (`enabled` to toggle; ID read from workspace `.amsg-info`) |

### Gateway Options

| Field          | Description                                                                    |
| -------------- | ------------------------------------------------------------------------------ |
| `gateway.port` | Gateway port (default: 4000)                                                   |
| `gateway.bind` | `loopback` (127.0.0.1), `lan` (0.0.0.0), or `tailnet` (auto-detect tailnet IP) |
| `gateway.host` | Explicit host (overrides `bind`)                                               |

### UI Options

| Field                      | Description                                                                    |
| -------------------------- | ------------------------------------------------------------------------------ |
| `ui.enabled`               | Auto-start web UI with gateway (default: true)                                 |
| `ui.port`                  | Web UI port (default: 3000)                                                    |
| `ui.bind`                  | `loopback` (127.0.0.1), `lan` (0.0.0.0), or `tailnet` (auto-detect tailnet IP) |
| `ui.tailscale.mode`        | `off` (default) or `serve` (enable HTTPS via `tailscale serve`)                |
| `ui.tailscale.resetOnExit` | Reset tailscale serve on exit (default: true)                                  |

**Tailscale serve (`ui.tailscale.mode: "serve"`):**

- Requires Tailscale installed and logged in
- Both `gateway.bind` and `ui.bind` must be `loopback` (or omitted)
- UI is served at `https://<tailnet>/aihub/` (base path `/aihub`)
- Serve must map `/aihub` -> `http://127.0.0.1:3000/aihub` and `/api`,`/ws` -> gateway (default `http://127.0.0.1:4000`)
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
  "agents": [
    {
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
    }
  ]
}
```

| Field         | Description                                                            |
| ------------- | ---------------------------------------------------------------------- |
| `every`       | Interval (`30m`, `1h`, `0` to disable). Default: `30m`                 |
| `prompt`      | Custom prompt. Falls back to `HEARTBEAT.md` in workspace, then default |
| `ackMaxChars` | Max chars after token strip to still be "ok". Default: 300             |

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
      "models": [{ "id": "my-model", "displayName": "My Model" }],
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
pnpm dev          # dev mode: auto-finds ports, disables Discord/scheduler/heartbeat
pnpm dev:gateway  # gateway only with hot reload (no --dev flag, all services enabled)
pnpm dev:web      # web UI only
```

### Dev Mode

`pnpm dev` runs with the `--dev` flag, which:

- **Auto-finds free ports** if 4000/3000 are in use (scans up to +50)
- **Disables external services**: Discord, scheduler, amsg watcher, heartbeats
- **Skips Tailscale serve** setup
- **Visual indicators**: console banner, `[DEV :port]` browser title, orange sidebar badge

Run multiple dev instances simultaneously - each gets unique ports.

For production-like testing with all services:

```bash
pnpm aihub gateway  # no --dev flag
```

## Data

- Config: `~/.aihub/aihub.json`
- Auth: `~/.aihub/auth.json` (OAuth/API key credentials)
- Models: `~/.aihub/models.json` (optional)
- Schedules: `~/.aihub/schedules.json`
- Sessions: `~/.aihub/sessions/*.jsonl`
