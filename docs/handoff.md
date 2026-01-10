# Discord Enhancement Handoff Document

## Plan Reference
**Full plan:** `~/.claude/plans/glowing-noodling-moonbeam.md`

## Initial Context

AIHub is a lightweight, self-hosted multi-agent gateway at `/Users/thinh/code/aihub`. The goal was to update AIHub's Discord integration to mirror clawdbot's Discord behavior:

- Per-guild/per-channel gating (mention required, allowlists, enabled/disabled, prompt snippets)
- Thread-aware context (thread starter)
- Channel metadata (topic/name) included in context
- Guild history context (configurable, optionally cleared after reply)
- Reaction events as system-style agent inputs
- Native slash commands
- Continuous typing indicator with queue mode support

## Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Extend runAgent() to support context payload | ✅ Complete |
| 1 | Library Migration (Discord.js → Carbon) | ✅ Complete |
| 2 | Core Message Handling (parity gating) | ✅ Complete |
| 3 | Context Enrichment (thread/topic/history) | ✅ Complete |
| 4 | Reactions as System Events | ✅ Complete |
| 5 | Slash Commands | ✅ Complete (but not working - see Current Issue) |
| 6 | Reply + Typing + Chunking | ✅ Complete |
| 7 | Broadcaster hardening | ✅ Complete |
| Tests | Write tests and verify implementation | ✅ Complete (112 tests) |

## What Has Been Done

### Phase 0-3: Previously Completed
See original implementation notes in plan file.

### Phase 4: Reactions as System Events
- Created `apps/gateway/src/discord/handlers/reactions.ts`
- Gating modes: `off` (default), `all`, `own`, `allowlist`
- Reactions trigger `runAgent()` with `context.blocks=[{type:"reaction",...}]`
- Uses same channel session: `discord:${channelId}`

### Phase 5: Slash Commands
- Created `apps/gateway/src/discord/handlers/commands.ts`
- Commands: `/new`, `/abort`, `/help`, `/ping`
- Uses Carbon's `Command` class
- Commands deployed via `client.handleDeployRequest()` on ready
- Added `discord-api-types` dependency

### Phase 6: Reply + Typing + Chunking
- Created `apps/gateway/src/discord/utils/chunk.ts` - code fence preservation
- Created `apps/gateway/src/discord/utils/typing.ts` - 5s keep-alive, 30s TTL
- Implemented `replyToMode`: `off`, `first`, `all`

### Phase 7: Broadcaster
- No changes needed - already used new chunking, isolated sessions, no echo

### Tests
- 112 tests passing across 6 test files
- Unit tests for: allowlist, chunk, context, message handler, reactions
- Integration tests in `bot.test.ts`

### Documentation Updates
1. **`docs/discord.md`** - New comprehensive Discord setup guide
   - Prerequisites, basic setup, configuration examples
   - Group Policy explanation (controls both guilds AND channels)
   - Channel defaults: `enabled: true`, `requireMention` inherits from guild
   - History & Reply settings explained

2. **`docs/llms.md`** - Updated Discord section
   - Changed from discord.js to Carbon
   - Full config schema documented
   - Updated dependencies

3. **`README.md`** - Link to Discord docs, updated example config

### Bug Fixes Applied

1. **applicationId Auto-Fetch**
   - Problem: Carbon requires `clientId`, but config had optional `applicationId`
   - Solution: Fetch from Discord API (`/oauth2/applications/@me`) if not provided
   - Location: `apps/gateway/src/discord/bot.ts:264-282`
   - Made `createDiscordBot` async

2. **Channel Opt-In Model**
   - Problem: Channels were opt-out (all allowed unless `enabled: false`)
   - User wanted opt-in like clawdbot (channels blocked unless listed)
   - Solution: When `groupPolicy: "allowlist"`, channels not in config are rejected
   - Location: `apps/gateway/src/discord/handlers/message.ts:158-168`
   - New rejection reason: `channel_not_in_allowlist`

## Current File Structure

```
apps/gateway/src/discord/
├── bot.ts              # Main bot logic, message/reaction handling, broadcaster
├── client.ts           # Carbon client wrapper with GatewayPlugin
├── index.ts            # Exports startDiscordBots(), stopDiscordBots()
├── handlers/
│   ├── commands.ts     # Slash command handlers (/new, /abort, /help, /ping)
│   ├── message.ts      # Message pipeline with gating logic
│   └── reactions.ts    # Reaction pipeline with gating logic
└── utils/
    ├── allowlist.ts    # Allowlist matching utilities
    ├── channel.ts      # Channel metadata fetching
    ├── chunk.ts        # Message chunking with code fence preservation
    ├── context.ts      # Discord context building/rendering
    ├── history.ts      # Per-channel history ring buffer
    ├── threads.ts      # Thread starter resolution + caching
    └── typing.ts       # Continuous typing indicator controller
```

## Current Issue: Slash Commands Not Working

### Symptom
Slash commands like `/new` are sent as regular text messages instead of being handled as Discord interactions. The bot receives `/new` as message content, not as an interaction.

### Root Cause
Carbon's `InteractionCreateListener` is not being used. The gateway receives `INTERACTION_CREATE` events but we weren't listening for them. Commands are registered/deployed, but incoming interactions aren't routed to them.

### Attempted Fix (Incomplete)
Added `InteractionCreateListener` to `client.ts`:

```typescript
import { InteractionCreateListener } from "@buape/carbon";

// In createCarbonClient():
if (config.commands?.length) {
  listeners.push(
    new (class extends InteractionCreateListener {
      async handle(data, client) {
        await client.handleInteraction(data, {});
      }
    })()
  );
}
```

### Build Error
```
src/discord/client.ts(131,34): error TS2322: Type '...' is not assignable to type 'BaseListener[]'.
  Type '(Anonymous class)' is not assignable to type 'BaseListener'.
    Types of property 'handle' are incompatible.
      Type '(data: APIInteraction, client: Client) => Promise<void>' is not assignable to
      type '(data: ListenerEventAdditionalData, client: Client) => Promise<void>'.
```

### Analysis
Carbon has a type inconsistency:
- `InteractionCreateListener.handle()` expects `APIInteraction`
- `BaseListener.handle()` expects `ListenerEventAdditionalData`
- These types are incompatible, so `InteractionCreateListener` doesn't properly extend `BaseListener`

### Next Steps to Fix
Options:
1. **Type assertion** - Use `as unknown as BaseListener` (user rejected as "hack")
2. **Separate listener array** - Pass interaction listener separately if Carbon supports it
3. **Upstream fix** - Check if Carbon has a different way to handle gateway interactions
4. **Manual event handling** - Use raw gateway event handling instead of Carbon's listener system

Need to investigate Carbon's architecture more or check if there's a gateway-specific way to handle interactions.

## Key Design Decisions

1. **groupPolicy controls both guilds AND channels**
   - `open`: all guilds/channels allowed
   - `allowlist`: only configured guilds allowed, AND only configured channels within those guilds
   - `disabled`: no guilds allowed (DM-only)

2. **Channel defaults**
   - `enabled`: defaults to `true`
   - `requireMention`: inherits from guild config, which defaults to `true`
   - Minimal config: `"CHANNEL_ID": {}`

3. **applicationId auto-detection**
   - Fetched from Discord API if not in config
   - Logged if fetch fails: "Failed to get application ID. Set 'applicationId' in config."

4. **Session routing**
   - DMs: `sessionKey: "main"` (shares with web UI)
   - Guild channels: `sessionId: discord:${channelId}` (isolated per channel)

## Config Example (Correct Format)

```json
{
  "discord": {
    "token": "BOT_TOKEN",
    "applicationId": "APP_ID",
    "groupPolicy": "allowlist",
    "guilds": {
      "1456395729663819808": {
        "requireMention": false,
        "channels": {
          "1456399514842959973": {}
        }
      }
    }
  }
}
```

**Common mistake:** Putting channel ID directly in guild config instead of under `channels`:
```json
// WRONG:
"guilds": { "GUILD_ID": { "requireMention": false, "CHANNEL_ID": {} } }

// CORRECT:
"guilds": { "GUILD_ID": { "requireMention": false, "channels": { "CHANNEL_ID": {} } } }
```

## Build & Test Commands

```bash
cd /Users/thinh/code/aihub
pnpm build                                    # Build all
pnpm vitest run src/discord                   # Run Discord tests (in apps/gateway)
```

## Files Modified in This Session

- `apps/gateway/src/discord/bot.ts` - Made async, added applicationId fetch
- `apps/gateway/src/discord/client.ts` - Attempting to add InteractionCreateListener (build broken)
- `apps/gateway/src/discord/handlers/message.ts` - Added channel allowlist check
- `apps/gateway/src/discord/handlers/message.test.ts` - Added channel allowlist tests
- `apps/gateway/src/discord/bot.test.ts` - Added global fetch mock for applicationId
- `docs/discord.md` - Created comprehensive Discord setup guide
- `docs/llms.md` - Updated Discord section
- `README.md` - Added link to Discord docs

## Current Build Status: BROKEN

The build fails due to the TypeScript error in `client.ts` when adding `InteractionCreateListener`. Need to resolve the type incompatibility without using type hacks like `as unknown as X`.
