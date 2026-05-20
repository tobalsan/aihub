# Slack timeout error text

- Added Slack-facing timeout-specific error messages for agent run failures containing `Container idle timed out` or `Container exceeded max runtime`; idle timeout copy avoids hardcoding the timeout duration.
- Kept the generic Slack apology for all other errors; detailed error objects remain log-only.
- Added Slack bot tests for idle timeout, max runtime, and generic fallback behavior.

Validation:
- `pnpm exec vitest run packages/extensions/slack/src/bot.test.ts`
- `pnpm test:shared`
- `pnpm --filter @aihub/shared build && pnpm --filter @aihub/extension-slack build`
