# Agent-local env startup resolution

- Fixed startup secret resolution so each `agent.yaml` `$env:` reference resolves against that agent's `.env` layered over `$AIHUB_HOME/.env`, `aihub.json env`, and `process.env`.
- Kept global config/extension secret resolution on normal process/global env.
- Added coverage in `apps/gateway/src/config/__tests__/validate.test.ts` for `onecliToken` and Slack refs coming from agent-local `.env`.
- Updated README and `docs/llms.md` with the startup-resolution behavior and Pi process-env caveat.

Validation:
- `pnpm exec vitest run apps/gateway/src/config/__tests__/validate.test.ts`
- `AIHUB_HOME=/Users/thinh/code/algodyn/cloudi-fi/cloudihub/config pnpm --filter @aihub/gateway exec tsx src/cli/index.ts agent list`
