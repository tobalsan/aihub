## Summary

Investigated sandbox env propagation for agents launched via `AIHUB_HOME=/Users/thinh/code/algodyn/cloudihub/config pnpm dev`.

Findings:
- Existing per-agent `agents[].sandbox.env` already reached the container for the current `config/aihub.json`.
- Live browser verification confirmed:
  - Sally saw `INVOICES_DB_PATH=/mounted/cloudifai-data/invoices.sqlite`
  - Casey saw `CS_WIKI_PATH=/mounted/cs-wiki`
- Real code gap found: top-level `aihub.json.env` was only copied into the gateway process and was not forwarded into sandbox containers.

## Code changes

- `apps/gateway/src/agents/container.ts`
  - `buildContainerArgs()` now accepts top-level config env and merges safe entries into container `--env`.
- `apps/gateway/src/sdk/container/adapter.ts`
  - Passes `config.env` into `buildContainerArgs()`.
- `apps/gateway/src/agents/container.test.ts`
  - Added regression coverage for top-level config env forwarding, secret filtering, and per-agent override precedence.
- `README.md`
  - Documented top-level config env propagation to sandbox containers.
- `docs/llms.md`
  - Documented the same runtime behavior for agent/codebase context.

## Verification

- Tests:
  - `pnpm exec vitest run apps/gateway/src/agents/container.test.ts`
  - `pnpm exec vitest run apps/gateway/src/sdk/container/adapter.test.ts`
  - `pnpm typecheck`
- Live UI check with `agent-browser` on `http://localhost:3003/chat/sally/full`
  - Asked Sally to run `env | sort | rg 'INVOICES_DB_PATH|CS_WIKI_PATH'`
  - Observed `INVOICES_DB_PATH=/mounted/cloudifai-data/invoices.sqlite`

## Notes

- During watch-mode restarts after the patch, `pnpm dev` briefly hit `EADDRINUSE` on port `4003`. A clean restart fixed it.
