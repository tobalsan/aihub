# Context Cache Token Visibility

## Summary

- Full chat model metadata now shows cached input tokens when present, for example `1023+3456 cache→8 tok`.
- Compaction Pi session seeding strips assistant `usage` metadata from retained messages, matching canonical compacted history.

## Verification

- `pnpm exec vitest run apps/web/src/components/ChatView.test.tsx apps/gateway/src/agents/compact.test.ts`
