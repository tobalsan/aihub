# Chat Full Completion No Flash

- Full-mode stream completion now marks the finalized local assistant message as `no-anim`, matching the Simple-mode no-animation path.
- This preserves the local message persistence fix while preventing the normal `message-in` animation from firing when the streaming DOM is replaced by the finalized message.

Verification:

- `pnpm exec vitest run apps/web/src/components/ChatView.test.tsx`
- `pnpm exec tsc -b`
- Browser reload on `http://localhost:3001/chat/devagent/full` still renders full chat history and context usage.
