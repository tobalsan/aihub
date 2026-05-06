# Phase 2 Chat Runtime

## Summary

Extracted shared web chat runtime code into `apps/web/src/lib/chat-runtime.ts`.

## Changes

- Added `createChatRuntime()` for reusable lead-agent chat state:
  - full history loading
  - session subscription
  - streaming blocks
  - queued follow-up messages
  - send with attachments
  - abort/stop
- Added `createChatAttachmentRuntime()` for shared pending-file state and validation.
- Updated `BoardView` to use the shared stream runtime while keeping `BoardChatRenderer` as the board-specific renderer.
- Updated `ChatView` to use shared attachment state.
- Updated `AgentChat` to use shared attachment state with image-only validation; lead/subagent send logic remains split because subagent chat uses CLI polling and project subagent APIs.
- Added focused runtime coverage in `apps/web/src/lib/chat-runtime.test.ts`.

## Verification

- `pnpm exec vitest run apps/web/src/lib/chat-runtime.test.ts apps/web/src/components/BoardView.test.tsx apps/web/src/components/ChatView.test.tsx apps/web/src/components/AgentChat.test.tsx`
- `pnpm exec tsc -p apps/web/tsconfig.json --noEmit`
- `pnpm test:web`
