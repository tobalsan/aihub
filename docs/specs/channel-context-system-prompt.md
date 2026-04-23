# Channel Context System Prompt Spec

## Problem Statement

Inbound Slack and Discord messages need channel-aware system prompt context so agents know:

- which channel integration delivered the message (`slack` or `discord`)
- where the message came from
- whether it is a direct message, channel message, or thread reply
- who sent it

Today this is inconsistent and partly broken:

- the existing Slack/Discord context machinery does not reliably reach the true system prompt
- some runtime paths prepend rendered context to user text instead of the system prompt
- sandbox/container paths can drop the context entirely
- sender identity and normalized conversation type are not represented
- the applied context is not durably inspectable in canonical history/tracing

This spec replaces the old inbound-message context path with one strict system-prompt mechanism.

## Goals

1. Inject inbound Slack/Discord context into the actual effective system prompt on every supported runtime path.
2. Apply this only to inbound user messages from Slack/Discord extensions.
3. Use one normalized cross-channel context model.
4. Include all required fields with fallback text, never omit fields.
5. Preserve richer channel context too: channel/topic, thread details, and recent history.
6. Make the applied context inspectable in history/debug/tracing.
7. Replace the broken legacy inbound context mechanism rather than layering another parallel path on top.

## Non-Goals

- No changes for slash commands, reactions, heartbeat, web UI, CLI, webhooks, or other non-message sources.
- No workspace/team/server/guild name in the prompt block.
- No broader prompt-system refactor beyond Slack/Discord inbound message context.
- No cleanup spec for stale runtime branches unrelated to this feature.

## Scope

In scope:

- Slack inbound messages
- Discord inbound messages
- non-sandbox runtime paths
- sandbox/container runtime paths
- persisted/debuggable history/tracing of applied channel context

Out of scope:

- slash commands
- reaction-triggered runs
- broadcast-only events
- channel routing policy changes

## User Stories

- As an agent receiving a Slack message, I can tell I am answering from Slack, not Discord.
- As an agent receiving a Discord message, I can tell whether the user spoke in a server channel, a thread, or a DM.
- As an agent replying in a thread, I can see both the parent channel and the thread place name.
- As an agent replying in a DM, I can see the DM peer identity when known.
- As an operator debugging a run, I can inspect the exact channel context that was applied to the system prompt.

## Normalized Context Contract

The replacement contract is a single structured inbound channel-context object for Slack and Discord messages.

Required normalized fields:

- `channel`: `slack | discord`
- `place`: rendered place string with fallback text
- `conversation_type`: `direct_message | channel_message | thread_reply`
- `sender`: best available display name with id fallback

Additional retained context:

- `channel_name`
- `channel_topic`
- `thread_name`
- `thread_starter`
- `recent_history`

All required fields must always render. Unknown values must fall back to stable text, preferably ids when available.

## System Prompt Format

The injected block should be machine-stable key/value text.

Example:

```text
[CHANNEL CONTEXT]
channel: slack
place: #projects / launch-plan
conversation_type: thread_reply
sender: thinh
channel_name: #projects
channel_topic: Roadmap and delivery coordination
thread_name: launch-plan
thread_starter: thinh at 2026-04-23T10:15:00.000Z - We need to finalize launch order.
recent_history:
- [2026-04-23T10:16:00.000Z] alice: I think API first.
- [2026-04-23T10:17:00.000Z] bob: Agreed.
[END CHANNEL CONTEXT]
```

Rules:

- this block is system-prompt content, not user-message content
- it must appear before the current turn user message is sent to the model
- it must be generated only for Slack/Discord inbound user messages
- it must be identical in meaning across runtime paths

## Field Semantics

### `channel`

- `slack` for Slack extension inbound messages
- `discord` for Discord extension inbound messages

### `conversation_type`

Exact normalized set:

- `direct_message`
- `channel_message`
- `thread_reply`

Mapping rules:

- Slack DM -> `direct_message`
- Slack non-DM, non-thread -> `channel_message`
- Slack thread reply -> `thread_reply`
- Discord DM/group DM -> `direct_message`
- Discord guild channel non-thread -> `channel_message`
- Discord thread message -> `thread_reply`

### `sender`

Use the best available display name with id fallback.

Preferred order:

- platform display name / nickname when already available or cheaply resolvable inside the extension flow
- username/global name already present in the event payload
- platform user id
- literal fallback text only if no id is available

Examples:

- Slack: `Thinh`, fallback `U123456`
- Discord: `thinh`, fallback `123456789012345678`

### `place`

Render every time.

Rules:

- channel message: channel name with fallback id
- thread reply: parent channel plus thread name, both with fallback text
- direct message: `direct message / <peer identity>`

Examples:

- Slack channel: `#projects`
- Slack thread: `#projects / launch-plan`
- Slack DM: `direct message / thinh`
- Discord channel: `#projects`
- Discord thread: `#projects / launch-plan`
- Discord DM: `direct message / thinh`

Fallback examples:

- `#C123456`
- `#projects / thread:1713888000.123`
- `direct message / U123456`
- `direct message / 123456789012345678`

### Retained Rich Context

The old useful content stays, but under the replacement contract:

- `channel_name`: visible channel/thread name with fallback text
- `channel_topic`: topic if known, otherwise fallback text
- `thread_name`: thread title/name if known, otherwise fallback text
- `thread_starter`: author, timestamp, and content summary if known, otherwise fallback text
- `recent_history`: bounded recent message list using current extension history behavior

## Platform Mapping

### Slack

Required derivations:

- `channel` -> constant `slack`
- `conversation_type` -> from `channel_type` + `thread_ts`
- `sender` -> best available display name with id fallback
- `place`
  - channel message -> channel name / channel id
  - thread reply -> parent channel name or id + thread name or fallback
  - DM -> `direct message / <peer identity>`

Slack-specific notes:

- current event payload already exposes `channel`, `user`, `channel_type`, `thread_ts`
- current enrichment already fetches channel metadata and thread parent
- sender display-name resolution may require extra lookup compared with current code
- thread naming must prefer an actual thread title/name when available; otherwise use a stable fallback derived from available thread identity

### Discord

Required derivations:

- `channel` -> constant `discord`
- `conversation_type` -> from DM/guild state plus thread/channel type
- `sender` -> best available display name with id fallback
- `place`
  - channel message -> channel name / channel id
  - thread reply -> parent channel name or id + thread name or fallback
  - DM -> `direct message / <peer identity>`

Discord-specific notes:

- current event payload already exposes `guild_id`, `channel_id`, `author`, mentions
- current enrichment already fetches channel metadata and thread starter
- sender display-name resolution may require richer member/user lookup than current code uses
- thread naming must distinguish thread name from parent channel name

## Architecture

### Replacement Direction

Replace the old “render inbound context and prepend it to the user message” model with:

1. extension builds normalized structured channel context
2. gateway/sdk runtime converts that structure into a system-prompt block
3. runtime appends/injects that block into the effective system prompt for the turn
4. runtime emits/persists a structured inspectability event showing what was applied
5. user message remains only the user message

### Source of Truth

There must be one shared context schema and one shared renderer for Slack/Discord inbound channel context.

Requirements:

- shared types for normalized channel context
- shared renderer for the system-prompt text block
- no separate Slack-only and Discord-only rendering pipelines with divergent output semantics

### Runtime Parity

The same semantic channel-context block must be applied on:

- `pi`
- `openclaw`
- sandbox/container runtime paths

Strict requirement:

- if a runtime path cannot currently inject a real system prompt separately from user text, that is a gap to close before this feature is considered complete

### Legacy Replacement

The prior inbound-message context path should be removed or rewritten so there is only one active mechanism for Slack/Discord message context.

Requirements:

- no duplicate context blocks
- no user-message preamble fallback for normal successful paths
- no partial parity where one runtime path still uses the legacy preamble behavior

## Data Model

Suggested shape:

```ts
type ChannelContext = {
  source: "slack" | "discord";
  place: string;
  conversationType: "direct_message" | "channel_message" | "thread_reply";
  sender: string;
  channelName: string;
  channelTopic: string;
  threadName: string;
  threadStarter: {
    author: string;
    timestamp: string;
    content: string;
  };
  recentHistory: Array<{
    author: string;
    timestamp: string;
    content: string;
  }>;
  raw?: {
    channelId?: string;
    threadId?: string;
    userId?: string;
  };
};
```

Requirements:

- rendered fields always exist
- raw ids may also be retained for debugging even when not rendered directly
- timestamps rendered in ISO format
- recent history remains bounded

## Inspectability

The applied channel context must be inspectable beyond ephemeral stream events.

Requirements:

- emit a structured history/debug event for applied channel context
- persist it in canonical history instead of dropping it
- include the rendered block and structured payload
- make it available to tracing/telemetry so operators can confirm what the model saw

Minimum inspectable payload:

- source channel (`slack|discord`)
- rendered block
- structured normalized fields
- timestamp

## UX / Operator Flow

### Normal Inbound Message

1. user sends inbound Slack/Discord message
2. extension resolves routing and gathers channel metadata
3. extension builds normalized channel context
4. runtime injects rendered channel context into the actual system prompt
5. runtime records inspectable context-applied event
6. runtime sends the raw user message as user content
7. assistant reply proceeds normally

### Debugging a Run

1. operator opens full history/debug trace
2. operator sees a channel-context-applied event for the turn
3. operator can inspect both structured fields and rendered text
4. operator can verify the agent had correct channel/place/type/sender context

## Constraints

- every required field must render with fallback text
- no server/guild/workspace/team name
- inbound messages only
- output must stay compact enough to avoid prompt bloat
- recent history must remain bounded

## Risks

### Runtime Capability Risk

Some runtime paths currently behave as if inbound context is user text or drop it entirely. Achieving strict system-prompt semantics may require runtime-specific changes, especially where a separate system channel is not currently wired.

### Metadata Resolution Cost

Best-available sender display name may need extra platform lookups. This must be bounded so message handling latency does not degrade materially.

### Prompt Size Creep

Adding normalized fields plus retained rich context can grow the prompt. The implementation must bound recent history and keep rendered text compact.

### Drift Risk

If Slack and Discord each keep separate context composition logic, field semantics can drift. Shared schema + shared renderer are required to prevent this.

## Open Questions

- For runtime adapters that do not currently expose a separate system-prompt channel, what is the minimal repo-local change needed to satisfy the strict requirement?
- What is the exact bounded recent-history limit after the new block is added?
- Which sender-display-name lookup path is acceptable per platform without introducing unacceptable latency?

## Acceptance Criteria

1. A Slack inbound message causes the effective system prompt to include a channel-context block with `channel`, `place`, `conversation_type`, and `sender`.
2. A Discord inbound message causes the effective system prompt to include the same normalized fields.
3. The block is in the actual system prompt on every runtime path, including sandbox/container runs.
4. The current turn user message is sent without prepended fake system-context text.
5. Thread replies render both parent channel and thread name, with fallback text if either is unavailable.
6. DMs render `direct message / <peer identity>` with fallback text when the peer name is unavailable.
7. Sender always renders with best available display name and id fallback.
8. The retained rich context (`channel_topic`, `thread_starter`, `recent_history`) is still available via the new mechanism.
9. The applied channel context is persisted and inspectable in history/debug/tracing.
10. Slash commands and reaction-triggered runs do not use this mechanism.
