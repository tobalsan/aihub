# Web API Client Domain Split

Refactored `apps/web/src/api/client.ts` into domain modules:

- `agents.ts`
- `chat.ts`
- `realtime.ts`
- `board.ts`
- `projects.ts`
- `slices.ts`
- `subagents.ts`
- `space.ts`
- `media.ts`

Added shared internal helpers in `core.ts` and `ws.ts`. Added `index.ts` as the web API barrel and kept `client.ts` as a compatibility re-export.

Updated web imports and API test mocks from `api/client` to the `api` barrel.

Verification:

- `pnpm test:web` passed: 35 files, 290 tests.
