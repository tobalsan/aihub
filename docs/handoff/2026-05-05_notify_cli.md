# Notify CLI

Added `aihub notify` for configured Discord/Slack notification channels.

- Config: top-level `notifications.channels.<name>` maps to `{ discord?: channelId, slack?: channelId }`.
- CLI: `aihub notify --channel <name> --message <text> [--surface discord|slack|both] [--mention userId]`.
- Shared helper validates runtime surfaces before adapter calls, fans out to configured surfaces, and treats Slack success as HTTP OK plus parseable JSON with `ok: true`.
