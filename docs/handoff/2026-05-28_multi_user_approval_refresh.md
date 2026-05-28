# Multi-user approval refresh

## Summary
- Fixed stale pending-approval UI after admin approval.
- `AuthGuard` and `Login` now poll authoritative `/api/me` while session user is pending.
- Poll runs every 3 seconds and on window focus, then allows/redirects once approved.

## Files touched
- `apps/web/src/auth/approval.ts`
- `apps/web/src/auth/AuthGuard.tsx`
- `apps/web/src/pages/Login.tsx`
- `apps/web/src/components/ImpersonationBanner.tsx` (typecheck fix required by web tsc)
- `docs/llms.md`

## Validation
- `pnpm exec tsc -p apps/web/tsconfig.json --noEmit`
- `pnpm test:web`
