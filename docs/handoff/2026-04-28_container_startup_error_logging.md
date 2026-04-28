## Container Startup Error Logging

- Investigated sandbox agent failures with `onecli.sandbox.network=config_onecli`.
- Root cause for the observed Sally failure was a missing host bind mount source from `CLOUDIFAI_DATA_DIR`, but the gateway surfaced `Failed to connect container ... to network config_onecli` because extra-network attach ran before Docker stderr/exit could be observed.
- Updated `apps/gateway/src/sdk/container/adapter.ts` so extra-network attach is asynchronous and checks whether the `docker run` child has exited. If startup fails before the container exists, the adapter now throws the meaningful captured Docker stderr, such as an invalid bind mount error.
- Added focused regression coverage in `apps/gateway/src/sdk/container/adapter.test.ts`.

Verification:

- `pnpm exec vitest run apps/gateway/src/sdk/container/adapter.test.ts`
