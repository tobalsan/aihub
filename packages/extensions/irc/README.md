# IRC extension

IRC supports either a shared gateway connection or one connection per agent.

## Per-agent connection

Configure `irc` at the top level of the agent's `agent.yaml`. Route entries omit `agent` because ownership is implicit:

```yaml
# agents/main/agent.yaml
irc:
  host: irc.example.net
  port: 6697
  tls: true
  nick: main-bot
  nickservPassword: $env:IRC_NICKSERV_PASSWORD
  channels:
    "#team": { mode: mention-only }
  dm: { enabled: true, allowFrom: [alice], debounceMs: 250 }
```

## Shared connection

Legacy shared transport remains supported. Agents routed by shared config must opt in:

```yaml
# agents/main/agent.yaml
extensions:
  irc:
    enabled: true
```

Configure shared connection and routing in `aihub.json`:

```json
{
  "extensions": {
    "irc": {
      "enabled": true,
      "host": "irc.example.net",
      "port": 6697,
      "tls": true,
      "nick": "aihub",
      "nickservPassword": "$env:IRC_NICKSERV_PASSWORD",
      "channels": { "#team": { "agent": "main", "mode": "mention-only" } },
      "dm": { "enabled": true, "agent": "main" },
      "humanNicks": ["alice"],
      "maxA2ATurns": 4
    }
  }
}
```

## Behavior

Mention-only channels respond to `aihub: message`; `reply-all` channels answer every message. Once an accepted channel message or allowed DM dispatches to an agent, the bot first sends a standalone `👀` to the same destination. IRC cannot remove this acknowledgement, so it remains in the conversation. Debounced DMs send one acknowledgement when the coalesced run dispatches; ignored or rejected messages send none.

Channel context is bounded by `historyLimit`. Per-channel A2A cap resets only on configured human nicks. Agent-local `password` and `nickservPassword` `$env:` references resolve from that agent's `.env` using normal gateway secret resolution.
