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
      "workspaceDir": "~/workspace",
      "model": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" }
    }
  ]
}
EOF

# Build & run
pnpm build && pnpm build:web
node apps/gateway/dist/index.js gateway
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
aihub gateway [--port 4000] [--host 127.0.0.1] [--agent-id <id>]
aihub agent list
aihub send -a <agentId> -m "Hello" [-s <sessionId>]
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET | List agents |
| `/api/agents/:id/messages` | POST | Send message |
| `/api/agents/:id/stream` | GET | SSE stream |
| `/api/schedules` | GET/POST | List/create schedules |
| `/api/schedules/:id` | PATCH/DELETE | Update/delete schedule |

## Configuration

`~/.aihub/aihub.json`:

```json
{
  "agents": [
    {
      "id": "agent-1",
      "name": "Agent One",
      "workspaceDir": "~/projects/agent-1",
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
  "scheduler": { "enabled": true, "tickSeconds": 60 }
}
```

### Agent Options

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `name` | Display name |
| `workspaceDir` | Agent working directory |
| `model.provider` | Model provider (anthropic, openai, etc) |
| `model.model` | Model name |
| `thinkLevel` | off, minimal, low, medium, high |
| `queueMode` | `queue` (inject into current run) or `interrupt` (abort & restart) |
| `discord` | Discord bot config |
| `amsg` | Amsg inbox watcher config |

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

## Skills

Place skills in `{workspaceDir}/pi/skills/` - auto-loaded at runtime.

## Development

```bash
pnpm dev:gateway  # Terminal 1
pnpm dev:web      # Terminal 2
```

## Data

- Config: `~/.aihub/aihub.json`
- Schedules: `~/.aihub/schedules.json`
- Sessions: `~/.aihub/sessions/*.jsonl`
