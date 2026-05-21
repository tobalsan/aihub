# Hide Agent Private Meta

- Redacted agent `model` and resolved `workspace` from `/api/agents` and `/api/agents/:id` for non-admin multi-user requests.
- Kept single-user mode and admin responses unchanged.
- Updated the web Agent type and AgentList rendering to tolerate missing `model`/`workspace`.
- Verification: `pnpm exec vitest run apps/gateway/src/server/api.core.test.ts` passes.
- Follow-up: `pnpm test:web` currently fails in `apps/web/src/components/ChatView.test.tsx` on the existing full-mode streaming chronology test; no skip/suppression added.
