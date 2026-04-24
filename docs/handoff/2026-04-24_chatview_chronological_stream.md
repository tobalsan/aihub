# ChatView Chronological Stream

## Summary

- Updated `ChatView` full-mode streaming to render assistant thinking, text, tool calls, tool results, and file outputs in emitted order.
- Tool results now attach to the matching live tool-call card instead of appearing as separate reordered rows.
- Successful local stream completion now appends the already-rendered streamed turn and avoids the end-of-turn history refresh that caused visible re-sorting.
- Gateway history buffering now stores assistant content blocks chronologically, so persisted full history keeps text/tool ordering across reloads.
- Follow-up fix: ChatView auto-scroll uses smooth container scrolling while pinned, with a delayed bottom correction after streaming quiets down so the latest response is not cropped.
- UI polish pass: ChatView now uses a centered coding-agent transcript, quieter assistant text, soft accent user bubbles, compact command/result cards, sticky blurred header/composer surfaces, visible keyboard focus states, and `prefers-reduced-motion` animation fallbacks.
- Follow-up UI compaction: tool calls and results now render as one collapsible card, completed tools collapse to a 44px row by default, and per-tool timestamps/wrapper result cards were removed.
- Simple view now derives from full content blocks so it can show non-expandable `Ran <tool>` rows without output, while assistant timestamps align to a consistent text column.

## Files

- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/ChatView.test.tsx`
- `apps/gateway/src/history/store.ts`
- `docs/llms.md`
