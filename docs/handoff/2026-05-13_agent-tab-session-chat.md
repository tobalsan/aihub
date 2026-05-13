# Agent Tab Session Chat

Implemented the project/slice Agent tab replacement described in `docs/specs/agent-tab-session-chat-prd.md`.

## Changed

- Added `apps/web/src/components/AgentRunChatPanel.tsx`.
- Replaced only the direct project and slice Agent tab surfaces with the new sidebar plus chat panel.
- Left overview/worktree/unassigned `SubagentRunsPanel` usage unchanged.
- Added focused coverage in `AgentRunChatPanel.test.tsx` for default visible-run selection, archived deep links, archive/delete clearing, and queued pending messages.
- Updated slice detail tests to assert the new scoped chat panel instead of raw-log links.

## Notes

- The panel uses runtime subagent APIs and `BoardChatLog` for transcript rendering.
- URL selection is still owned by the project/slice pages, so the reusable panel receives `selectedRunId` and calls `onSelectedRunIdChange`.
- Archived selected runs are expanded automatically when deep-linked.
