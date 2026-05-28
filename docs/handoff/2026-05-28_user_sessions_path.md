# User sessions path update

Changed multi-user per-user session/history storage from `$AIHUB_HOME/users/<userId>/` to `$AIHUB_HOME/sessions/users/<userId>/`.

Updated:
- `packages/extensions/multi-user/src/isolation.ts`
- `apps/gateway/src/agents/container.ts`
- related tests
- `README.md`
- `docs/llms.md`
- `packages/extensions/multi-user/README.md`

Verification:
- `pnpm exec vitest run packages/extensions/multi-user/src/isolation.test.ts apps/gateway/src/sessions/store.test.ts apps/gateway/src/history/store.test.ts apps/gateway/src/agents/container.test.ts`
