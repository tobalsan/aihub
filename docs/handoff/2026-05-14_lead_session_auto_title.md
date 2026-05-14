# Lead Session Auto-Title

- Added `extensions.sessions.autoTitleModel` to shared config.
- Added async one-shot lead-session auto-title generation after the first assistant turn, using configured title model or cheapest available Anthropic Haiku fallback.
- Auto-title refuses Opus/thinking model ids, truncates generated titles at word boundaries, leaves manual renames locked, and writes session metadata through a fresh-read update path to preserve concurrent PATCH changes.
- Scoped validation: `pnpm exec vitest run packages/shared/src/__tests__/session-auto-title-config.test.ts apps/gateway/src/lead-sessions/auto-title.test.ts apps/gateway/src/lead-sessions/routes.auto-title.test.ts`.
