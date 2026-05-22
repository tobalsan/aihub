# Chat Context Usage Live Refresh

- ChatView now uses a hidden full-history snapshot for context usage in both simple and full modes.
- After a local stream completes and visible history refresh is intentionally skipped, ChatView still fetches full history in the background to pick up persisted `meta.usage`.
- Removed the redundant simple-mode background history fetch; the normal load path now updates the context snapshot directly.

Verification:

- `pnpm exec vitest run apps/web/src/components/ChatView.test.tsx`
- `pnpm exec tsc -b`
- Browser reload on `http://localhost:3001/chat/devagent/full` still shows the context indicator and correct message order.
