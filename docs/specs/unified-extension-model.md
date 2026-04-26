# FRP: Unified Extension Model

## 1. Goal

**Problem**: AIHub has two overlapping capability models: extensions and connectors. Connectors are agent-scoped tool providers, while extensions already own gateway lifecycle, routes, prompt hooks, tool hooks, and container callback dispatch. This split makes configuration and runtime behavior harder to reason about.

**End-user behavior**: Users configure all capabilities as extensions. Root config uses `extensions.<id>` for shared defaults, and each agent opts into tool-style extensions with `agents[].extensions.<id>`, keeping current connector opt-in behavior.

**Inputs -> Outputs**: Existing connector-style packages export tool definitions and config schemas. AIHub loads them from first-party extension packages or `$AIHUB_HOME/extensions`, merges root and agent extension config, exposes their prompts/tools to in-process and container agents, and dispatches tool execution through the extension runtime.

**In scope**:
- Replace user-facing `connectors` / `agents[].connectors` config with `extensions` / `agents[].extensions`.
- Add a lightweight tool-extension helper/adapter so connector packages do not need fake lifecycle/routes boilerplate.
- Preserve current connector semantics: agent-level config presence enables a tool extension; root config alone supplies defaults but does not opt every agent in.
- Keep root-level extension config for first-party AIHub extensions.
- Load external extensions from `$AIHUB_HOME/extensions` by default and support symlinked extension directories.
- Make unified extensions work for sandbox/container runtime.
- Update the Board extension so user content defaults to `$AIHUB_HOME`, not `$AIHUB_HOME/extensions/board`, and expose a config parameter for custom Board user-content path.
- Migrate `/Users/thinh/code/algodyn/cloudi-fi/aihub-connectors` to the new extension format.
- Update `README.md`, `docs/llms.md`, and add a handoff note under `docs/handoff/`.

**Out of scope**:
- Backward-compatible runtime support for old `connectors` config.
- Building new Cloudi-Fi connector tools.
- Changing tool names or model-facing behavior except where needed to move from connector prompts to extension prompt hooks.
- New UI for extension configuration.

**Success definition**: A config that uses only `extensions` and `agents[].extensions` can load local and symlinked tool extensions, inject their prompt/tool hooks into Pi and container runs, execute tools through the extension runtime, and run the migrated Cloudi-Fi connectors without `connectors` config.

## 2. Scale & Quality Bar

**Profile**: solo dev / internal MVP.

**Constraints**:
- Users / load: single operator, low concurrent agent volume.
- Environment: local dev and self-hosted single-node deployment.
- Failure tolerance: invalid config may fail gateway startup with a clear error.
- Performance budget: no explicit latency target; extension discovery and config validation happen at startup.
- Security / compliance: preserve current `$env:` secret resolution and container token validation; do not mount user secrets into sandbox containers.
- Persistence: existing `$AIHUB_HOME` file-based runtime data.
- Migration / rollback: breaking config change is acceptable; migration should be a trivial manual rename from `agents[].connectors` to `agents[].extensions` plus root `connectors` data moving under `extensions`.

**Quality bar implications**:
- Focused unit/integration tests are enough.
- No browser E2E required.
- Startup errors must be actionable.
- Avoid full `Extension` boilerplate for tool-only packages.

## 3. Context

**Codebase pointers**:
- `packages/shared/src/connectors/types.ts` - current connector contract to replace or adapt.
- `packages/shared/src/connectors/loader.ts` - current config merge, `$env:` resolution, enable/disable, and tool-prefix behavior.
- `packages/shared/src/connectors/discovery.ts` - existing symlink-aware external connector discovery pattern.
- `apps/gateway/src/connectors/index.ts` - current startup validation and per-agent tool/prompt lookup.
- `apps/gateway/src/server/connector-tools.ts` - current container callback endpoint to remove or fold into `/internal/tools`.
- `packages/shared/src/types.ts` - `AgentConfig`, `GatewayConfig`, `Extension`, `ExtensionAgentTool`, `ContainerInput` schemas.
- `packages/shared/src/extensions/discovery.ts` - external extension loading from `index.js`; currently symlink-aware but schema validation is incomplete.
- `apps/gateway/src/extensions/registry.ts` - built-in extension registry, default loading, external loading, home-claim validation.
- `apps/gateway/src/extensions/prompts.ts` and `apps/gateway/src/extensions/tools.ts` - extension prompt/tool collectors.
- `apps/gateway/src/sdk/pi/adapter.ts` - in-process prompt/tool injection.
- `apps/gateway/src/sdk/container/adapter.ts` - container serialization of extension prompts/tools and old connector configs.
- `container/agent-runner/src/runner.ts` - sandbox Pi registration of connector and extension tools.
- `container/agent-runner/src/claude-runner.ts` - sandbox Claude path; currently ignores extension tools and connector configs.
- `apps/gateway/src/server/internal-tools.ts` - container token-protected extension tool dispatch.
- `packages/extensions/board/src/index.ts` - Board currently defaults user content to `ctx.getDataDir()/extensions/board`.
- `/Users/thinh/code/algodyn/cloudi-fi/aihub-connectors/src/*/index.ts` - existing Cloudi-Fi connector exports.

**Conventions to follow**:
- Use `uv` for Python commands if needed.
- Use scoped tests: `pnpm test:shared`, `pnpm test:gateway`, `pnpm test:cli`, or exact `pnpm exec vitest run <path>`.
- Do not use `# type: ignore`, `# noqa`, or equivalent suppressions.
- Keep changes surgical and match existing TypeScript/Zod style.
- Run tests serially.

**Known gotchas**:
- `GatewayConfigSchema` currently has typed built-in `extensions`; unknown external extension configs can be stripped by parsing unless schema changes preserve them.
- `ExtensionDefinitionSchema` validates only part of the real contract; external extension validation should include required runtime fields.
- `aihub send` and eval runtime currently initialize connectors and pass `[]` extensions.
- Container Pi supports extension prompts/tools, but sandbox Claude does not currently register extension tools.
- Old connector prompt injection uses context files; extension prompts are appended. Preserve clear prompt ordering and test observable inclusion.
- Current connector tool names are auto-prefixed as `${connectorId}_${toolName}`. Do not break names.
- Board user content under `$AIHUB_HOME/extensions/board` conflicts with external extension code storage.

## 4. Implementation Tasks

1. Add a tool-extension contract/helper in `packages/shared`.
   - Provide a small authoring API that accepts the old connector-shaped fields: `id`, `displayName`, `description`, `systemPrompt`, `configSchema`, optional `agentConfigSchema`, `requiredSecrets`, and `createTools(resolvedConfig)`.
   - Return a real `Extension` with no routes, empty dependencies, no-op lifecycle, and `getSystemPromptContributions` / `getAgentTools`.
   - Preserve `$env:` resolution, shallow root+agent merge, `enabled:false`, required secret validation, and tool-name prefixing.

2. Add agent-level extension config.
   - Add `agents[].extensions?: Record<string, ExtensionBaseConfig>` to shared schemas.
   - Keep root `extensions.<id>` as shared defaults.
   - For tool-style extensions, root config alone must not enable tools for an agent; `agents[].extensions.<id>` presence enables unless `enabled:false`.
   - For normal gateway extensions, root `extensions.<id>` continues to control loading.

3. Replace connector startup/runtime with unified extension loading.
   - Remove `initializeConnectors()` from gateway startup, `aihub send`, and eval runtime.
   - Make `loadExtensions()` responsible for first-party extensions plus external extensions from `$AIHUB_HOME/extensions` or configured path.
   - Ensure external extension config survives schema parsing.
   - Preserve symlinked extension directory support.
   - Ensure external tool extensions load only when referenced by root or any agent-level extension config.
   - Clarify duplicate IDs: fail startup if the same id is provided by built-in and external extensions.

4. Unify prompt/tool injection.
   - Make prompt and tool collectors pass enough context for helper-created tool extensions to resolve root+agent config.
   - Keep current tool names stable.
   - Keep duplicate tool detection.
   - Remove old connector-specific Pi, Claude, and container injection after parity is covered.

5. Fix container runtime.
   - Remove `ContainerInput.connectorConfigs` and connector callback path from the sandbox flow.
   - Use `ContainerInput.extensionSystemPrompts` and `extensionTools` for all unified tool extensions.
   - Keep `/internal/tools` as the token-protected execution endpoint.
   - Add sandbox Claude support for extension prompts/tools or explicitly block sandbox Claude tool extensions with a startup/runtime error. Preferred: support parity.

6. Update Board storage config.
   - Replace `extensions.board.root` semantics with a user-content path that defaults to `ctx.getDataDir()` (`$AIHUB_HOME`).
   - Add or keep a clearly named config parameter, e.g. `extensions.board.contentRoot`, for custom user-content path.
   - Keep `/api/board/info` returning the resolved user-content path.
   - Update scratchpad/project paths to use this content root.

7. Migrate `aihub-connectors`.
   - In `/Users/thinh/code/algodyn/cloudi-fi/aihub-connectors`, convert `cloudifi_admin`, `hiveage`, `notion`, and `gsheets` exports to the new tool-extension helper format.
   - Preserve ids, tool names after AIHub prefixing, config schemas, required secrets, and tests.
   - Update package docs to instruct symlinking built extension folders into `$AIHUB_HOME/extensions`.

8. Remove connector docs and update public docs.
   - Update `README.md` and `docs/llms.md`: single extension model, root config defaults, agent-level opt-in, `$AIHUB_HOME/extensions`, container behavior, Board content path.
   - Add `docs/handoff/2026-04-26_unified_extension_model.md`.
   - Remove or mark stale connector-specific docs/examples that would mislead users.

## 5. Validation Plan

> A fresh agent must be able to execute this top-to-bottom without asking questions.

### 5.1 Setup

**AIHub workspace**: `/Users/thinh/.codex/worktrees/e7ac/aihub`

**AIHub branch**:
```bash
cd /Users/thinh/.codex/worktrees/e7ac/aihub
git switch -c codex/unified-extension-model
```

If branch already exists:
```bash
cd /Users/thinh/.codex/worktrees/e7ac/aihub
git switch codex/unified-extension-model
```

**Connectors workspace**: `/Users/thinh/code/algodyn/cloudi-fi/aihub-connectors`

**Connectors branch**:
```bash
cd /Users/thinh/code/algodyn/cloudi-fi/aihub-connectors
git switch -c codex/unified-extension-model
```

If branch already exists:
```bash
cd /Users/thinh/code/algodyn/cloudi-fi/aihub-connectors
git switch codex/unified-extension-model
```

**Install**:
```bash
cd /Users/thinh/.codex/worktrees/e7ac/aihub
pnpm install
cd /Users/thinh/code/algodyn/cloudi-fi/aihub-connectors
pnpm install
```

**Seeded config**:
- Use the existing seeded config at `/Users/thinh/.codex/worktrees/e7ac/aihub/.aihub/aihub.json`.
- Do not create a fake `AIHUB_HOME` for smoke validation.
- The seeded config contains agent `devagent` and gateway port `4001`.

**Env / secrets**:
- Unit tests must not require real connector secrets.
- Use fake env vars in tests, e.g. `AIHUB_TEST_TOKEN=secret`.

**Services to start**: none for automated validation.

### 5.2 Commands To Run

Run commands serially.

**AIHub focused tests**:
```bash
cd /Users/thinh/.codex/worktrees/e7ac/aihub
pnpm exec vitest run packages/shared/src/__tests__/extension-types.test.ts
pnpm exec vitest run packages/shared/src/__tests__/tool-extension.test.ts
pnpm exec vitest run apps/gateway/src/extensions/registry.test.ts
pnpm exec vitest run apps/gateway/src/extensions/tools.test.ts
pnpm exec vitest run apps/gateway/src/sdk/container/adapter.test.ts
pnpm exec vitest run container/agent-runner/src/__tests__/runner.test.ts
pnpm exec vitest run packages/extensions/board/src/index.test.ts
pnpm exec vitest run apps/gateway/src/evals/runtime.test.ts
```

If a listed test file does not exist before implementation, add focused coverage or replace with the nearest exact new test file path.

**AIHub package suites**:
```bash
cd /Users/thinh/.codex/worktrees/e7ac/aihub
pnpm test:shared
pnpm test:gateway
pnpm test:cli
pnpm --filter @aihub/agent-runner test
```

**AIHub typecheck/build**:
```bash
cd /Users/thinh/.codex/worktrees/e7ac/aihub
pnpm exec tsc -b
pnpm build
```

**External extension tests/build**:
```bash
cd /Users/thinh/code/algodyn/cloudi-fi/aihub-connectors
pnpm test
pnpm build
```

### 5.3 Manual / Interactive Verification

**Modality**: CLI and HTTP API. No browser verification required.

**Skills / tools to use**:
- Local shell commands.

**External symlink load smoke**:
1. Build the migrated extensions:
```bash
cd /Users/thinh/code/algodyn/cloudi-fi/aihub-connectors
pnpm build
```
Expected: build exits 0 and emits extension entrypoints.

2. Use the seeded worktree AIHub home and symlink one migrated extension:
```bash
cd /Users/thinh/.codex/worktrees/e7ac/aihub
cp .aihub/aihub.json .aihub/aihub.json.before-smoke
mkdir -p .aihub/extensions
ln -sfn /Users/thinh/code/algodyn/cloudi-fi/aihub-connectors/dist/hiveage .aihub/extensions/hiveage
node -e '
const fs = require("fs");
const file = ".aihub/aihub.json";
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.extensions = { ...(config.extensions || {}), hiveage: { timeoutMs: 1000 } };
config.agents[0].extensions = { ...(config.agents[0].extensions || {}), hiveage: { apiKey: "$env:HIVEAGE_API_KEY", subdomain: "demo" } };
config.ui = { ...(config.ui || {}), enabled: false };
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
'
HIVEAGE_API_KEY=fake AIHUB_HOME="$PWD/.aihub" pnpm --filter @aihub/gateway exec tsx src/cli/index.ts gateway --dev --port 4999
```
Expected: gateway starts without connector config, logs loaded extension `hiveage`, and does not warn about unknown extensions. Stop with Ctrl-C.

**Agent-level opt-in smoke**:
1. Remove only the agent-level Hiveage opt-in from the seeded config while keeping root defaults:
```bash
cd /Users/thinh/.codex/worktrees/e7ac/aihub
node -e '
const fs = require("fs");
const file = ".aihub/aihub.json";
const config = JSON.parse(fs.readFileSync(file, "utf8"));
delete config.agents[0].extensions.hiveage;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
'
HIVEAGE_API_KEY=fake AIHUB_HOME="$PWD/.aihub" pnpm --filter @aihub/gateway exec tsx src/cli/index.ts gateway --dev --port 4999
```
Expected: gateway starts, but the test agent receives no Hiveage tools or Hiveage prompt contribution. This should be covered by an automated test if possible.

**Board path smoke**:
```bash
cd /Users/thinh/.codex/worktrees/e7ac/aihub
node -e '
const fs = require("fs");
const file = ".aihub/aihub.json";
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.extensions = { ...(config.extensions || {}), board: { enabled: true, home: true } };
config.ui = { ...(config.ui || {}), enabled: false };
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
'
AIHUB_HOME="$PWD/.aihub" pnpm --filter @aihub/gateway exec tsx src/cli/index.ts gateway --dev --port 4998
```
In another terminal:
```bash
curl -s http://127.0.0.1:4998/api/board/info
```
Expected response includes a Board content path under `/Users/thinh/.codex/worktrees/e7ac/aihub/.aihub`, not `/Users/thinh/.codex/worktrees/e7ac/aihub/.aihub/extensions/board`.

**Restore seeded config after smoke checks**:
```bash
cd /Users/thinh/.codex/worktrees/e7ac/aihub
mv .aihub/aihub.json.before-smoke .aihub/aihub.json
```

### 5.4 Acceptance Criteria

- [ ] `GatewayConfigSchema` accepts `agents[].extensions` and external `extensions.<id>` configs without losing unknown keys.
- [ ] Old `connectors` config is no longer required for runtime and documented as removed.
- [ ] Tool-style extensions preserve connector behavior: root defaults plus agent-level opt-in, `enabled:false`, `$env:` refs, required secrets, shallow overrides, and prefixed tool names.
- [ ] Symlinked directories under `$AIHUB_HOME/extensions` load.
- [ ] In-process Pi receives unified extension prompts and tools.
- [ ] Container Pi receives unified extension prompts and tools and executes them through `/internal/tools`.
- [ ] Sandbox Claude either supports unified extension prompts/tools or fails with an explicit unsupported-runtime error when such tools are configured.
- [ ] `aihub send` and eval runtime load unified extensions where connector tools previously worked.
- [ ] Board writes `SCRATCHPAD.md` under `$AIHUB_HOME` by default and under `extensions.board.contentRoot` when configured.
- [ ] Cloudi-Fi connector package builds and exports migrated tool extensions for `cloudifi_admin`, `hiveage`, `notion`, and `gsheets`.
- [ ] README, `docs/llms.md`, and a dated handoff note reflect the new model.

### 5.5 Success vs Failure Signals

**Success**:
- All commands in section 5.2 exit 0.
- CLI smoke tests start the gateway with only `extensions` / `agents[].extensions`.
- No code path serializes or calls `connectorConfigs` for container runs.
- `rg -n "agents\\[\\]\\.connectors|connectorConfigs|/connectors/tools|initializeConnectors|config\\.connectors|agent\\.connectors" apps packages container docs README.md` returns no active runtime/docs references, except historical handoff notes or explicitly removed-code tests.

**Failure / regression**:
- Gateway startup requires `connectors` or `agents[].connectors`.
- Root `extensions.<id>` alone enables a tool extension for every agent.
- Tool names change from current connector names.
- Sandbox container calls `/connectors/tools`.
- Board creates `SCRATCHPAD.md` under `$AIHUB_HOME/extensions/board` by default.
- External symlinked extensions are skipped.

## 6. Open Questions / Risks

- The exact helper name is open. Bias: `defineToolExtension()` exported from `@aihub/shared`.
- Sandbox Claude parity may be more work than Pi. If support is not implemented, fail loudly when an agent with `sdk: "claude"` and sandbox enabled opts into tool extensions.
- Removing connector exports from `@aihub/shared` may affect external packages. Since this is a breaking config change, package API breakage is acceptable only if the new helper is easy to adopt.
- Existing docs/examples under Harbor mention `connectors/`; update or clearly mark them stale.

## 7. Confidence

**One-pass implementation likelihood**: 7/10.

The core extension prompt/tool path already exists, including container Pi dispatch. Main risk is cleanly preserving connector config semantics while removing connector-specific runtime paths and extending sandbox Claude behavior.
