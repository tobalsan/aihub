# Chat Context Compaction

- Added `POST /api/agents/:id/compact` for web chat session compaction.
- Compaction runs the same agent/model in a temporary session to summarize older context, then rewrites the target canonical history and Pi runtime session to a compacted summary plus the last 8 user/assistant turns.
- ChatView now supports manual `/compact`, auto-compacts before the next send at 80% estimated usage, blocks the send if compaction fails, and turns the context usage indicator red at 75%.

Verification:

- `pnpm exec vitest run apps/gateway/src/server/api.core.test.ts apps/gateway/src/history/compact.test.ts`
- `pnpm exec vitest run apps/web/src/components/ChatView.test.tsx`
- `pnpm exec tsc -b`
