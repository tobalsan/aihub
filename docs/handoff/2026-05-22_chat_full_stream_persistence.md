# Chat Full Stream Persistence

- Fixed a Full-mode regression where a completed local assistant response could disappear after the background context-usage refresh.
- Full mode now appends the streamed assistant turn into local `fullMessages` on completion, then clears transient streaming state; the background usage refresh only updates the hidden context snapshot.

Verification:

- `pnpm exec vitest run apps/web/src/components/ChatView.test.tsx`
- `pnpm exec tsc -b`
- Browser reload on `http://localhost:3001/chat/devagent/full` shows persisted assistant responses and updated context usage.
