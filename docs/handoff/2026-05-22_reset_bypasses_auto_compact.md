# Reset Bypasses Auto Compact

- `/new` and `/reset` now bypass ChatView's auto-compact pre-send guard, even when estimated context usage is above 80%.
- Added ChatView coverage to ensure reset commands send directly and do not call `postCompact`.

Verification:

- `pnpm exec vitest run apps/web/src/components/ChatView.test.tsx`
- `pnpm exec tsc -b`
