# Lead Session Storage/API

- Added shared `LeadSession` and `lead_session_changed` protocol types.
- Added project lead-session storage at `<projectDir>/lead-sessions.json` with lazy `sessionKeys` migration and project-local transcript dirs under `sessions/<transcriptRef>/`.
- Added S01 API routes for list/create/patch/delete/transcript/send and websocket broadcast plumbing.
- Scoped validation: `pnpm exec vitest run packages/shared/src/lead-sessions/types.test.ts apps/gateway/src/lead-sessions/store.test.ts apps/gateway/src/lead-sessions/routes.test.ts apps/gateway/src/server/lead-session-ws.test.ts`.
