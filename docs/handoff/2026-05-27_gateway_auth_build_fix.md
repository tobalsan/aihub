# Gateway auth build fix

- Fixed `apps/gateway/src/cli/index.ts` build break from Pi OAuth callback type change.
- Added required `onDeviceCode` and `onSelect` handlers to `authStorage.login(...)` callbacks.
- Verified with `pnpm -C apps/gateway build`.
