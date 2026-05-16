# Agent Tab Thinking State

## Summary

- Fixed the project Agent tab chat body so it mirrors board chat while an agent response is pending.
- `AgentRunChatPanel` now renders the assistant `Thinking...` row when a lead-agent send is in flight or a selected subagent run is still running before visible assistant text arrives.
- Pending Agent tab user messages now include the same user icon as finalized board-chat messages, avoiding the left-padding jump when the stream completes.
- Agent tab message history now uses the same flex column + 24px gap as board chat, so pending and finalized rows keep consistent vertical spacing.
- Agent tab composers now swap Send for the red Stop control while the selected chat is actively running; subagent chats still expose Send while a draft/file is present so follow-ups can be queued.
- Follow-up lead-agent sends now keep showing `Thinking...` even when the existing transcript already contains previous assistant replies.
- Agent tab `Thinking...` now includes the same `thinking-pulse` animation styles as board chat.
- Lead-session creation is now idempotent in the Agent tab sidebar: if the create response or subscription resolves to an existing session id, the row is replaced instead of duplicated, and the New session button is disabled while creation is pending.
- Lead agent badges in the Agent tab now render text only, without avatar images, across the sidebar, selected-session header, and composer picker.
- Editable lead-session composer pickers now show only the agent select, removing the duplicate selected-agent text beside it.
- Lead-session sidebar row actions now use compact icon buttons that appear on row hover or keyboard focus instead of always-visible text links.
- Locked lead-session composer pickers are now hidden entirely because the selected-session header already shows the agent name.

## Verification

- `pnpm exec vitest run apps/web/src/components/AgentRunChatPanel.test.tsx apps/web/src/components/AgentRunChatPanel.lead-sessions.test.tsx`
- `pnpm exec vitest run apps/web/src/components/AgentRunChatPanel.lead-sessions.test.tsx`
