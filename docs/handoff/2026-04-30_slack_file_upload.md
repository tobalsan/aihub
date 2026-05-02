# Slack File Upload Support

Implemented PRO-235 Slack file handling in `@aihub/extension-slack`.

## Scope

- Inbound Slack `files[]` are validated against the v1 allowlist, downloaded with the bot token, saved through the gateway media context, and passed to `runAgent({ attachments })`.
- Slack snippets are appended to the prompt as fenced inline text.
- Oversized, unsupported, download, and outbound upload failures post visible threaded Slack replies.
- Agent `file_output` events from Slack-originated runs are read from AIHub media and uploaded back to the originating Slack channel/thread with `files.uploadV2`.
- Slack docs now list `files:read` and `files:write`; workspace re-auth is still required manually.

## Files

- `packages/extensions/slack/src/bot.ts`
- `packages/extensions/slack/src/types.ts`
- `packages/extensions/slack/src/handlers/message.ts`
- `packages/extensions/slack/src/utils/attachments.ts`
- `packages/extensions/slack/src/utils/attachments.test.ts`
- `packages/extensions/slack/src/bot.test.ts`
- `packages/shared/src/types.ts`
- `apps/gateway/src/extensions/context.ts`
- `README.md`
- `docs/llms.md`
