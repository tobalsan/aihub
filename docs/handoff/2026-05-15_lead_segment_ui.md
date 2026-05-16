# 2026-05-15 Lead Segment UI

Implemented the PRO-243-S02 web UI for project/slice lead sessions.

- `AgentRunChatPanel` now has `Lead | Subagents` segments, project/slice-scoped lead session listing, localStorage last-viewed selection, `?lead=` deep links, `+ New session`, empty-session agent picker, rename, archive/unarchive, non-legacy delete, and `lead_session_changed` reconciliation.
- Added `apps/web/src/api/lead-sessions.ts` for the S01 lead-session API shape (`{ items }` list response, transcript, send, patch, delete).
- Board project and slice Agent tabs now pass normalized `lead` and `run` query params into the shared panel and update URLs atomically per selected family.
- Kept subagent run behavior covered with existing panel tests; added focused lead-session API/component tests.

Verification:

- `pnpm exec vitest run apps/web/src/api/lead-sessions.test.ts apps/web/src/components/AgentRunChatPanel.lead-sessions.test.tsx`
- `pnpm exec vitest run apps/web/src/api/lead-sessions.test.ts apps/web/src/components/AgentRunChatPanel.lead-sessions.test.tsx apps/web/src/components/AgentRunChatPanel.test.tsx`
- `pnpm --filter @aihub/web exec tsc --noEmit`
