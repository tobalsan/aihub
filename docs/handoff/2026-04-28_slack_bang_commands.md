# Slack Bang Commands (`!new`, `!stop`)

## What
Added `!new` and `!stop` bang command support to the Slack extension so users can reset sessions and stop runs without needing Slack slash commands (which are global per workspace and break with multiple bots).

## Why
Slack custom slash commands (`/new`, `/stop`) are workspace-global — only one bot can handle each command. With multiple AIHub bots in one workspace, only the most recently configured bot receives the command. Bang commands (`!new`, `!stop`) are sent as regular messages, so each bot independently detects and handles them based on channel routing.

## Changes

### `packages/extensions/slack/src/handlers/message.ts`
- Added `BangCommand` type and `bangCommand`/`bangCommandArg` fields to `PipelineResult`
- Detects `!new` and `!stop` at the **start** of normalized message content (after mention stripping)
- Case-insensitive, word-boundary matching (`!newslater` won't trigger)
- Optional trailing argument: `!new custom-session-key`

### `packages/extensions/slack/src/bot.ts`
- `handleSlackMessage` now checks `result.bangCommand` before the normal agent run flow
- `!new`: clears session via `clearSessionEntry`/`deleteSession`/`invalidateHistoryCache`, responds ephemeral
- `!stop`: runs `/stop` control command via `runAgent`, responds ephemeral
- Both commands reply via `chat.postEphemeral` (only visible to the caller)

### `packages/extensions/slack/src/types.ts`
- Added `postEphemeral` to `SlackWebClient.chat` type

### `packages/extensions/slack/src/handlers/commands.ts`
- Updated help text to mention `!new` and `!stop` as alternatives to `/new` and `/stop`

### Tests
- `message.test.ts`: 9 new cases — detection, case-insensitivity, mention stripping, mid-message rejection, word boundary, unknown commands
- `bot.test.ts`: 7 new integration cases — session clear, abort, custom keys, mid-message passthrough, mention+bang, error handling
- `commands.test.ts`: Updated help text assertions
