---
name: "PER-43 Direct OAuth Auth Flow for Pi SDK"
---

## Goal

**Feature Goal**: Add a direct OAuth authentication path for Pi SDK agents so they can run without the CLIProxyAPI, while preserving the existing proxy-based flow for Claude SDK.

**Deliverable**: New auth storage + CLI login commands + Pi adapter auth resolution updates, documented and wired into config.

**Success Definition**:
- Pi SDK agents can authenticate via OAuth tokens stored in `~/.aihub/credentials/oauth.json` and run without CLIProxyAPI.
- Claude SDK continues to work unchanged via proxy (`model.base_url` + `model.auth_token`).
- Config can opt into OAuth per agent using `auth.mode` and optional `profileId`.
- Docs describe both proxy and OAuth setups.

## User Persona (if applicable)

**Target User**: Solo dev running aihub locally (Pi SDK + Claude SDK) on personal machines.

**Use Case**: Run Pi SDK agents without relying on the CLIProxyAPI app for model auth; still use proxy for Claude SDK when desired.

**User Journey**:
1) User runs `aihub auth login anthropic` (or openai-codex) once.
2) OAuth tokens are stored in `~/.aihub/credentials/oauth.json` and indexed in auth profiles.
3) User sets agent `auth.mode = "oauth"` and `auth.profileId = "anthropic:default"`.
4) Agent runs with Pi SDK and uses OAuth tokens automatically (refreshes when expired).

**Pain Points Addressed**:
- Removes dependency on a local CLIProxyAPI running in the background.
- Keeps existing proxy path for Claude SDK.

## Why

- Enables direct OAuth login for Pi SDK models (Anthropic / OpenAI Codex) similar to Clawdbot.
- Preserves existing CLIProxyAPI integration for Claude SDK.
- Allows per-agent auth selection without breaking existing configs.

## What

Implement direct OAuth auth flow for Pi SDK in aihub. This includes:
- Config additions for per-agent auth mode.
- OAuth credential storage & profile resolution.
- CLI commands to initiate OAuth login flows.
- Pi SDK adapter uses resolved OAuth tokens (refresh on expiry).
- Claude SDK continues to use proxy env vars.

### Success Criteria

- [ ] `aihub auth login anthropic` stores tokens in `~/.aihub/credentials/oauth.json` and profiles in `~/.aihub/agent/auth-profiles.json`.
- [ ] Pi SDK adapter resolves API key from OAuth when `auth.mode=oauth` or `profileId` is set.
- [ ] Claude SDK path unchanged (proxy config still works).
- [ ] Docs updated with OAuth vs proxy usage examples.

## All Needed Context

### Context Completeness Check

If a new engineer had this PRP and the files below, they should be able to implement without guessing the architecture.

### Documentation & References

```yaml
- issue: PER-43 (Linear)
  why: Contains the detailed implementation plan to follow.
  critical: Includes config shape, storage paths, and CLI flow.

- file: apps/gateway/src/sdk/pi/adapter.ts
  why: Current Pi SDK auth resolution uses authStorage.getApiKey/getEnvApiKey; will be replaced/augmented.
  pattern: Resolve API key then authStorage.setRuntimeApiKey(model.provider, apiKey).

- file: apps/gateway/src/sdk/claude/adapter.ts
  why: Shows proxy-based auth via ANTHROPIC_BASE_URL/AUTH_TOKEN; must remain intact.
  gotcha: Claude uses model.base_url/auth_token with env lock.

- file: packages/shared/src/types.ts
  why: Add AgentConfig.auth block and sessions config patterns.
  pattern: zod schema + inferred types.

- file: apps/gateway/src/config/index.ts
  why: Config load and defaults. Ensure new auth fields are parsed by schema.

- file: docs/llms.md
  why: Update runtime doc for OAuth vs proxy, storage locations, and CLI usage.
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
.
├── apps
│   ├── gateway
│   │   ├── src
│   └── web
├── docs
│   ├── llms.md
│   └── prp
├── packages
│   └── shared
└── scripts
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
apps/gateway/src/
  auth/
    paths.ts            # constants for credential/profile paths + secure mkdir helpers
    oauth-store.ts      # read/write oauth.json (0600/0700) + migration from ~/.pi/agent/oauth.json
    auth-profiles.ts    # profile resolution + token refresh wrapper
  cli/
    index.ts            # new `aihub auth login|status|logout` commands

packages/shared/src/
  types.ts              # AgentConfig.auth schema additions

docs/llms.md            # OAuth documentation and config examples
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: Claude SDK uses model.base_url/auth_token and sets env vars with a global lock.
// DO NOT alter Claude proxy path for PER-43.
// Pi SDK adapter currently uses authStorage.getApiKey(provider) || getEnvApiKey(provider).
// New OAuth path must still call authStorage.setRuntimeApiKey(provider, apiKey).
// Config is loaded from ~/.aihub/aihub.json and validated with zod.
```

## Implementation Blueprint

### Data models and structure

- Add `auth` block to `AgentConfig`:
  ```ts
  auth?: {
    mode?: "oauth" | "api_key" | "proxy";
    profileId?: string; // e.g. "anthropic:default", "openai-codex:default"
  }
  ```
- Keep `AgentModelConfig.base_url/auth_token` for proxy usage.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: UPDATE packages/shared/src/types.ts
  - ADD: AgentConfig.auth block
  - FOLLOW: existing zod schema patterns for optional config blocks
  - KEEP: model.base_url/auth_token for proxy

Task 2: CREATE apps/gateway/src/auth/paths.ts
  - IMPLEMENT: path helpers for
      - oauth dir: ~/.aihub/credentials
      - oauth file: ~/.aihub/credentials/oauth.json
      - profile store: ~/.aihub/agent/auth-profiles.json
  - ENSURE: dirs created with 0700, files written 0600

Task 3: CREATE apps/gateway/src/auth/oauth-store.ts
  - IMPLEMENT: readOAuthStore() / writeOAuthStore()
  - FORMAT:
      {
        "anthropic": { "type": "oauth", "access": "...", "refresh": "...", "expires": 1767304352803 },
        "openai-codex": { "type": "oauth", "access": "...", "refresh": "...", "expires": 1767304352803, "accountId": "acct_..." }
      }
  - OPTIONAL: import legacy ~/.pi/agent/oauth.json on first run

Task 4: CREATE apps/gateway/src/auth/auth-profiles.ts
  - PORT: auth profile logic from Clawdbot
  - ADD: ensureAuthProfileStore() merges oauth store into profiles
  - ADD: resolveApiKeyForProfile() that refreshes expired tokens via Pi SDK helper
  - PROVIDE: resolveApiKeyForProvider({ provider, config, profileId })

Task 5: UPDATE apps/gateway/src/cli/index.ts
  - ADD: `aihub auth login <provider>`
  - PROVIDE: `aihub auth status` and `aihub auth logout <provider>` if easy
  - USE: Pi SDK OAuth helpers (loginAnthropic, loginOpenAICodex)
  - STORE: tokens in oauth store + update profiles

Task 6: UPDATE apps/gateway/src/sdk/pi/adapter.ts
  - REPLACE: authStorage.getApiKey(provider) || getEnvApiKey(provider)
  - WITH: resolveApiKeyForProvider({ provider, config, profileId })
  - FALLBACK: authStorage or env when auth.mode != oauth
  - SET: authStorage.setRuntimeApiKey(provider, apiKey)

Task 7: UPDATE docs/llms.md
  - ADD: Direct OAuth section
  - INCLUDE: storage paths + CLI login commands + config examples
  - SHOW: Proxy vs OAuth configs
```

### Implementation Patterns & Key Details

```typescript
// Config example (OAuth, Pi SDK)
{
  "sdk": "pi",
  "auth": { "mode": "oauth", "profileId": "anthropic:default" },
  "model": { "provider": "anthropic", "model": "claude-opus-4-5" }
}

// Config example (Proxy, Claude SDK)
{
  "sdk": "claude",
  "model": { "model": "claude-sonnet-4-5-20250929", "base_url": "http://127.0.0.1:8317", "auth_token": "sk-dummy" }
}

// Pi adapter auth resolution pseudocode
const apiKey = await resolveApiKeyForProvider({
  provider: model.provider,
  agentConfig: agent,
  profileId: agent.auth?.profileId,
});
authStorage.setRuntimeApiKey(model.provider, apiKey);
```

### Integration Points

```yaml
CONFIG:
  - add to: ~/.aihub/aihub.json
  - new block: agents[].auth
  - default behavior unchanged for existing configs

CLI:
  - new commands: aihub auth login <provider>
  - optional: aihub auth status, aihub auth logout <provider>

SDK:
  - Pi SDK uses OAuth tokens for provider api key resolution
  - Claude SDK unchanged (proxy env + lock)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
pnpm lint
pnpm typecheck
```

### Level 2: Unit Tests

```bash
pnpm test
```

### Level 3: Manual Validation

```bash
# OAuth login
pnpm aihub auth login anthropic

# Run a Pi SDK agent with oauth config
pnpm aihub send -a <agentId> -m "hello"
```

## Final Validation Checklist

- [ ] OAuth tokens stored with secure permissions (dir 0700, file 0600)
- [ ] Pi SDK uses OAuth tokens when configured
- [ ] Claude SDK proxy flow unchanged
- [ ] Docs updated with OAuth instructions
- [ ] Config schema validated and backward compatible

## Anti-Patterns to Avoid

- ❌ Do not remove or alter CLIProxyAPI/Claude SDK proxy behavior
- ❌ Do not hardcode provider names outside mapping layer
- ❌ Do not store tokens in world-readable files
- ❌ Do not skip refresh logic for OAuth tokens
```
