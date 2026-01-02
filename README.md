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
      "workspace": "~/workspace",
      "model": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" }
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
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET | List agents |
| `/api/agents/:id/messages` | POST | Send message |
| `/api/agents/:id/history` | GET | Session history (?sessionKey=main&view=simple\|full) |
| `/api/schedules` | GET/POST | List/create schedules |
| `/api/schedules/:id` | PATCH/DELETE | Update/delete schedule |
| `/ws` | WS | WebSocket streaming (send + subscribe) |

## Configuration

`~/.aihub/aihub.json`:

```json
{
  "agents": [
    {
      "id": "agent-1",
      "name": "Agent One",
      "workspace": "~/projects/agent-1",
      "model": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" },
      "thinkLevel": "off",
      "queueMode": "queue",
      "discord": {
        "token": "...",
        "guildId": "...",
        "channelId": "..."
      },
      "amsg": { "id": "agent-1", "enabled": true }
    }
  ],
  "server": { "host": "127.0.0.1", "port": 4000 },
  "scheduler": { "enabled": true, "tickSeconds": 60 },
  "ui": { "port": 3000, "bind": "loopback" }
}
```

### Agent Options

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `name` | Display name |
| `workspace` | Agent working directory |
| `model.provider` | Model provider (anthropic, openai, etc) |
| `model.model` | Model name |
| `thinkLevel` | off, minimal, low, medium, high |
| `queueMode` | `queue` (inject into current run) or `interrupt` (abort & restart) |
| `discord` | Discord bot config |
| `amsg` | Amsg inbox watcher config (`enabled` to toggle; ID read from workspace `.amsg-info`) |

### UI Options

| Field | Description |
|-------|-------------|
| `ui.port` | Web UI port (default: 3000) |
| `ui.bind` | `loopback` (127.0.0.1), `lan` (0.0.0.0), or `tailnet` (auto-detect tailnet IP) |

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
pnpm dev:gateway  # Terminal 1
pnpm dev:web      # Terminal 2
```

## Data

- Config: `~/.aihub/aihub.json`
- Models: `~/.aihub/models.json` (optional)
- Schedules: `~/.aihub/schedules.json`
- Sessions: `~/.aihub/sessions/*.jsonl`
