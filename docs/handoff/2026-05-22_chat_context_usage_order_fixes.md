# Chat Context Usage And Ordering Fixes

- ChatView now always renders the context usage indicator, showing `0% context used` before the first model usage snapshot exists.
- Canonical simple/full history reads are sorted by message timestamp with stable file-order tie-breaking, fixing refreshes where assistant messages could appear before their user message after `/new`.
- Verified the live devagent full chat reload renders the user message before the assistant response.

Verification:

- `pnpm exec vitest run apps/gateway/src/server/api.core.test.ts apps/gateway/src/history/compact.test.ts apps/web/src/components/ChatView.test.tsx scripts/update-models.test.ts`
- `pnpm exec tsc -b`
