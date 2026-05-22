# Pi SDK 0.75.4 Scope Migration

Updated AIHub's Pi SDK dependencies from the legacy `@mariozechner/*` packages to the official `@earendil-works/*` packages at `^0.75.4`.

## Notes

- Raised the root Node engine requirement to `>=22.19.0` to match Pi `v0.75.0`'s minimum supported Node.js version.
- Updated gateway, projects extension, and agent-runner package manifests.
- Updated TypeScript imports and Vitest mocks to the new package scope.
- Allowed the new Pi transitive dependency `@google/genai` in pnpm's build allowlist.
- Regenerated `pnpm-lock.yaml`.

## Verification

- `pnpm install`
- `pnpm typecheck`
- `pnpm exec vitest run apps/gateway/src/sdk/pi/__tests__/adapter-onecli.test.ts apps/gateway/src/sdk/pi/__tests__/session-repair.test.ts apps/gateway/src/lead-sessions/auto-title.test.ts container/agent-runner/src/__tests__/runner.test.ts`
