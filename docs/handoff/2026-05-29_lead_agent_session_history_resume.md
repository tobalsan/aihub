# Lead-Agent Session History Resume

Implemented `docs/specs/lead-agent-session-history-resume-prd.md` core slice.

## Changed

- Backend lists visible past agent sessions from user-scoped session JSONL files: single-user `$AIHUB_HOME/sessions/*.jsonl`, multi-user `$AIHUB_HOME/sessions/users/<userId>/history/*.jsonl`; endpoint `GET /api/agents/sessions`.
- Backend supports session delete/rename via `DELETE`/`PATCH /api/agents/:agentId/sessions/:sessionId`.
- History fetch accepts explicit `?sessionId=` and skips `sessions.json` pointer resolution.
- WebSocket `subscribe` accepts optional `sessionId`; active-turn replay and stream broadcast match explicit session ids directly.
- Web sidebar renders searchable recency-grouped `Sessions` section across agents, with configured agent avatars, `MAIN`, rename, and delete. No sidebar `+ New`; new chats come from chat flows (`/new`, idle-session rotation).
- Sidebar polls sessions every 3s and on focus so newly-created chats appear without page refresh.
- Rename title metadata no longer affects session recency ordering.
- `ChatView` reads `/chat/:agentId?session=<sessionId>`, loads/subscribes/sends/stops against explicit session id.
- Shared WS subscribe type now includes optional `sessionId`.

## Validation

- `pnpm test:shared` ✅
- `pnpm exec tsc -p apps/gateway/tsconfig.json --noEmit` ✅
- `pnpm exec tsc -p apps/web/tsconfig.json --noEmit` ✅
- `pnpm test:gateway` ✅
- `pnpm test:web` ✅
- Focused tweak check: `pnpm exec vitest run apps/gateway/src/server/api.core.test.ts apps/web/src/components/AgentSidebar.test.tsx` ✅
