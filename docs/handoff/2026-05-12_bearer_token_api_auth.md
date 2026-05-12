# Bearer-token API auth (PRO-253)

Adds `Authorization: Bearer <token>` support to every `/api/*` route when
`multiUser.enabled: true`. Cookie sessions keep working unchanged. Tokens are
per-user, hashed at rest, manageable via a new `aihub user token` CLI, and
follow the same authorization rules as cookies (no admin bypass).

## Motivation

Before this change, `createAuthMiddleware`
(`packages/extensions/multi-user/src/middleware.ts`) only validated Better
Auth session cookies. Headless callers — curl, CI, the scheduler hitting
`/api/schedules` — had no way in without scraping a browser cookie. Bearer
tokens close that gap while keeping the cookie path the default for the web
UI.

## Three slices

- **S01 — Token storage + `aihub user token` CLI.** Bump
  `better-auth` 1.5.6 → 1.6.10, add `@better-auth/api-key` 1.6.10, register
  the plugin in `auth.ts` (`apiKey({ rateLimit: { enabled: false } })`),
  extend `MultiUserAuth.api` with `verifyApiKey` / `createApiKey` /
  `listApiKeys` / `deleteApiKey`. The plugin's migrations auto-create the
  `apikey` table on next boot. New CLI at
  `apps/gateway/src/cli/user-token.ts` with hybrid auth: bootstrap path
  opens the auth DB in-process and calls `auth.api.createApiKey` directly
  (caching the plaintext at `~/.aihub/user-token.json`, mode `0600`); HTTP
  path uses the cached bearer to talk to `/api/auth/api-key/*` and the
  audit wrapper.
- **S02 — Bearer-auth path in `createAuthMiddleware`.** Add
  `getBearerToken(headers)` and a `verifyBearer` helper that calls
  `runtime.auth.api.verifyApiKey`, resolves the owning user via direct DB
  lookup, synthesizes a `RequestAuthContext` of the same shape as cookie
  sessions, and runs `refreshApprovalFromDb` before deciding 200 / 403.
  Invalid bearers short-circuit to 401 without consulting the cookie path
  (matches OAuth/Bearer norms). `validateWebSocketRequest` reuses the same
  helper so WS upgrades get bearer auth for free. A thin
  `DELETE /api/user/token/:id` wrapper in `routes.ts` is the audit-logged
  revoke seam; the plugin's `/api/auth/api-key/delete` stays available
  silently.
- **S03 — E2E verification + docs.** Integration test in
  `packages/extensions/multi-user/src/integration.test.ts` boots the
  extension, seeds an approved user directly in `auth.db`, mints a token
  via `auth.api.createApiKey`, hits `/api/me` and `/api/agents` with the
  raw plaintext token, then exercises `DELETE /api/user/token/:id` and
  asserts the same bearer is 401 afterwards. Also fixes two
  `agentFab: false` capabilities-shape assertions that drifted from
  `91969f9 feat(web): gate agent FAB by config`.

## Key files

| Path | Role |
|---|---|
| `packages/extensions/multi-user/package.json` | dep bumps |
| `packages/extensions/multi-user/src/auth.ts` | `apiKey()` plugin + extended `MultiUserAuth.api` type |
| `packages/extensions/multi-user/src/middleware.ts` | bearer branch in `getValidatedAuthContext` + `createAuthMiddleware` |
| `packages/extensions/multi-user/src/routes.ts` | `/me` honors forwarded auth ctx; `DELETE /user/token/:id` audited wrapper |
| `packages/extensions/multi-user/src/middleware.test.ts` | bearer unit tests |
| `packages/extensions/multi-user/src/integration.test.ts` | end-to-end bearer test |
| `apps/gateway/src/cli/user-token.ts` | `aihub user token create|list|revoke` |
| `apps/gateway/src/cli/user-token.test.ts` | bootstrap-path unit test |
| `apps/gateway/src/cli/index.ts` | registers the new command group |
| `docs/llms.md`, `README.md` | docs |

## Upgrade caveat — better-auth 1.5.6 → 1.6.10

The bump touches the `admin` plugin and the `databaseHooks.user.create.before`
hook that AIHub relies on to set the custom `approved` field (and to
auto-promote the first user to `admin`). 1.6.10 keeps both APIs compatible.
Verified by running `auth.test.ts` and the cookie-path branches of
`integration.test.ts` against the upgrade alone before layering the bearer
changes on top.

## Design decisions worth flagging

- **`@better-auth/api-key` is a separate npm package**, not in core. We pull
  it in explicitly. The plugin does **not** auto-intercept the
  `Authorization` header — our middleware explicitly calls
  `auth.api.verifyApiKey` and synthesizes the request context. This is
  intentional: it lets us run the same `refreshApprovalFromDb` /
  `isApproved` gate the cookie path uses.
- **Hybrid CLI auth.** The first `aihub user token create` has no cached
  bearer to use, so it opens the auth DB in-process and calls
  `createApiKey` directly. Every later command (`list`, `revoke`, and
  subsequent `create`) goes over HTTP with the cached bearer. The cache
  file is `~/.aihub/user-token.json` at mode `0600`.
- **Audited revoke uses a direct DB delete, not the plugin endpoint.** The
  plugin's `/api/auth/api-key/delete` requires a Better-Auth session
  cookie via its `sessionMiddleware`; bearer callers have no session.
  Our wrapper validates ownership (caller is admin or owns the key) using
  a direct `SELECT userId|referenceId FROM apikey WHERE id = ?`, then
  performs the delete itself and emits a `user_token.revoked` log line.
  The audit signal is the wrapper's only reason to exist — the plugin
  endpoint stays available for cookie-based clients and is silent.
- **`/me` now honors `x-aihub-auth-context`.** Previously it called
  `auth.api.getSession(headers)` directly, which only reads cookies — so
  bearer callers got 401 even though the parent middleware had already
  validated them. The route now reads the forwarded context first and
  falls back to `getSession` only when it's missing.

## Verification

Per the slice plan, run serially:

```
pnpm exec vitest run packages/extensions/multi-user/src/integration.test.ts
pnpm exec vitest run packages/extensions/multi-user/src/admin-routes.test.ts
pnpm exec vitest run packages/extensions/multi-user/src/middleware.test.ts
pnpm exec vitest run packages/extensions/multi-user/src/auth.test.ts
pnpm --filter @aihub/gateway exec tsc --noEmit
```

Manual smoke (with a multi-user gateway running):

```
aihub user token create --user me@example.com --name ci   # prints plaintext once
T=<token>
curl -H "Authorization: Bearer $T" http://127.0.0.1:4000/api/me      # 200
curl -H "Authorization: Bearer $T" http://127.0.0.1:4000/api/agents  # 200
aihub user token revoke <token-id>                          # audit log line emitted
curl -H "Authorization: Bearer $T" http://127.0.0.1:4000/api/me      # 401
```

## Known pre-existing drift (not caused by this work)

The `keeps auth modules unloaded in single-user mode` case in
`integration.test.ts` asserts that `scheduler` and `heartbeat` load by
default. After commit `8313258 fix(gateway): opt-in scheduler and
heartbeat` they are opt-in via `extensions.scheduler` / `extensions.heartbeat`,
so the test fails with an empty `extensions: {}` plus the missing
`agentFab: false` field. Out of scope for PRO-253 — fix is to either
opt into both extensions in that test's config or to update the assertion
to match the new opt-in defaults.
