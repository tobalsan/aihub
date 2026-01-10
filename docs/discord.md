# Discord Integration

Connect your agent to Discord with support for guilds, DMs, reactions, and slash commands.

## Prerequisites

1. Create a Discord application at https://discord.com/developers/applications
2. Create a bot and copy the **Bot Token**
3. Enable **Message Content Intent** under Bot settings
4. Copy the **Application ID** (for slash commands)
5. Invite bot to your server with permissions: Send Messages, Read Message History, Add Reactions

## Basic Setup

Minimal config - bot responds to all messages where it's mentioned:

```json
{
  "agents": [{
    "id": "my-agent",
    "discord": {
      "token": "YOUR_BOT_TOKEN"
    }
  }]
}
```

## Configuration Examples

### Channel-Specific Settings

Configure different behavior per channel:

```json
{
  "discord": {
    "token": "...",
    "groupPolicy": "allowlist",
    "guilds": {
      "GUILD_ID": {
        "requireMention": true,
        "channels": {
          "CHANNEL_1": { "enabled": true, "requireMention": false },
          "CHANNEL_2": { "enabled": true, "users": ["USER_ID"] },
          "CHANNEL_3": { "enabled": false }
        }
      }
    }
  }
}
```

**Channel behavior depends on `groupPolicy`:**
- `allowlist`: Only channels explicitly listed in config are allowed. Unlisted channels are rejected.
- `open`: All channels allowed unless `enabled: false`.

### Multiple Guilds with Different Settings

```json
{
  "discord": {
    "token": "...",
    "guilds": {
      "GUILD_1": {
        "requireMention": true,
        "systemPrompt": "You are helping the engineering team."
      },
      "GUILD_2": {
        "requireMention": false,
        "users": ["USER_ID_1", "USER_ID_2"]
      }
    }
  }
}
```

### DMs Enabled with Allowlist

```json
{
  "discord": {
    "token": "...",
    "dm": {
      "enabled": true,
      "allowFrom": ["USER_ID_1", "USER_ID_2"]
    },
    "groupPolicy": "disabled"
  }
}
```

### Reaction Notifications

Get notified when users react to bot messages:

```json
{
  "discord": {
    "token": "...",
    "guilds": {
      "GUILD_ID": {
        "requireMention": true,
        "reactionNotifications": "own"
      }
    }
  }
}
```

Modes: `off` (default), `all`, `own` (bot's messages only), `allowlist`

### Slash Commands

Enable `/new`, `/abort`, `/help`, `/ping`:

```json
{
  "discord": {
    "token": "...",
    "applicationId": "YOUR_APPLICATION_ID"
  }
}
```

Commands deploy automatically on bot startup.

**Note:** `applicationId` is auto-detected from the bot token if not provided. Set it explicitly to avoid the API call on startup.

### Broadcast Mode

Mirror main session responses to a Discord channel (useful for monitoring):

```json
{
  "discord": {
    "token": "...",
    "broadcastToChannel": "CHANNEL_ID"
  }
}
```

Only broadcasts non-Discord sources (web UI, scheduler, amsg). Discord messages are never echoed back.

## Full Config Reference

```json
{
  "discord": {
    "token": "string (required)",
    "applicationId": "string (enables slash commands)",

    "dm": {
      "enabled": true,
      "allowFrom": ["USER_ID", "username"],
      "groupEnabled": false,
      "groupChannels": ["CHANNEL_ID"]
    },

    "groupPolicy": "open | disabled | allowlist",
    "guilds": {
      "GUILD_ID": {
        "slug": "friendly-name",
        "requireMention": true,
        "reactionNotifications": "off | all | own | allowlist",
        "reactionAllowlist": ["USER_ID"],
        "users": ["USER_ID", "username#1234"],
        "systemPrompt": "Custom prompt for this guild",
        "channels": {
          "CHANNEL_ID": {},
          "CHANNEL_ID_2": {
            "enabled": true,
            "requireMention": false,
            "users": ["USER_ID"],
            "systemPrompt": "Channel-specific prompt"
          }
        }
      }
    },

    "historyLimit": 20,
    "clearHistoryAfterReply": true,
    "replyToMode": "off | first | all",
    "mentionPatterns": ["hey bot", "^!agent"],
    "broadcastToChannel": "CHANNEL_ID"
  }
}
```

## Group Policy

`groupPolicy` controls how the bot handles guild (server) messages at both guild and channel level:

| Value | Guilds | Channels |
|-------|--------|----------|
| `open` (default) | All guilds allowed | All channels allowed (unless `enabled: false`) |
| `disabled` | No guilds allowed (DM-only) | N/A |
| `allowlist` | Only guilds in `guilds` config | Only channels in `channels` config |

Example - restrict to specific guilds:
```json
{
  "discord": {
    "token": "...",
    "groupPolicy": "allowlist",
    "guilds": {
      "GUILD_ID_1": { "requireMention": true },
      "GUILD_ID_2": { "requireMention": false }
    }
  }
}
```

## History & Reply Settings

### historyLimit

Number of recent channel messages included as context for the agent (default: 20). Set to 0 to disable.

### clearHistoryAfterReply

When `true` (default), clears the channel history buffer after the bot replies. This prevents the same messages from being included in subsequent requests.

### replyToMode

Controls whether bot responses use Discord's reply feature:

| Value | Behavior |
|-------|----------|
| `off` (default) | Send as normal message |
| `first` | Reply to triggering message on first chunk only |
| `all` | Reply to triggering message on every chunk |

## Behavior Notes

- **Channel defaults**: `enabled` defaults to `true`; `requireMention` inherits from guild (default `true`). Minimal config: `"CHANNEL_ID": {}`.
- **Session routing**: DMs share `main` session with web UI. Guild channels use isolated sessions (`discord:CHANNEL_ID`).
- **Mention gating**: When `requireMention: true`, bot only responds when @mentioned or `mentionPatterns` match.
- **User allowlists**: Accepts user IDs, usernames, or `username#discriminator`. Prefix with `discord:/user:` for explicit IDs.
- **Typing indicator**: Shows while agent is processing; stops on completion or after 30s timeout.
- **Message chunking**: Long responses split at 2000 chars, preserving code blocks.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/new [session]` | Start new conversation (default: main) |
| `/abort [session]` | Stop current agent run |
| `/help` | Show available commands |
| `/ping` | Bot health check |
