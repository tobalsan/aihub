# Telegram Extension

Connects AIHub agents to Telegram over a [grammY](https://grammy.dev)
long-polling bot. This is the walking-skeleton slice: a direct message reaches
an agent's main session and a single plain-text reply is delivered back to the
same chat.

Streaming, typing keep-alive, rich/markdown rendering, multimodal, groups, and
allowlist enforcement are out of this slice — they layer on top later. The
allowlist is currently stubbed open (every sender is permitted).

## Enable / disable

The extension runs in two modes; both can be active at once. Presence of config
is the enable signal.

### Component bot (shared)

One bot shared across agents, configured under `extensions.telegram`:

```json
{
  "extensions": {
    "telegram": {
      "enabled": true,
      "token": "$env:TELEGRAM_TOKEN"
    }
  }
}
```

`enabled: false` is a runtime kill switch: the extension still loads (so agent
tools remain available), but the bot does not start.

### Per-agent bot

An agent can run its own bot with a dedicated token. Add a `telegram` block to
the agent's `agent.yaml`:

```yaml
# <agent-workspace>/agent.yaml
telegram:
  token: "$env:TELEGRAM_TOKEN"
```

The token is a `SecretRef`; use the `$env:` syntax to resolve it from the
environment, matching the discord/slack extensions.

## Behavior

- A DM (`private` chat) resolves to the agent's main session
  (`DEFAULT_MAIN_KEY`) and calls `ctx.runAgent({ source: "telegram", ... })`.
- The agent's reply is posted back as plain text, split to Telegram's
  4096-character message limit.
- The bot starts/stops through the extension lifecycle.

## Agent tools

- `telegram.send_message` — proactively send a plain-text message to a chat by
  numeric chat ID.
