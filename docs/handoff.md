# Hand-off

Date: 2026-04-11
Repo: AIHub monorepo
Branch: `feat/lead-agent-launcher-ui` (based off `main` at `da6e9db`)
Project: PRO-221 — Lead Agent Launcher & Subagent Config

## Original Request

Replace hardcoded agent templates (Coordinator/Worker/Reviewer/Custom) in the project details agent creation UI with:

1. **Config-driven subagent templates** — define Worker/Reviewer configs in `aihub.json` via a `subagents` array instead of hardcoding in the UI
2. **Lead agent launching from project details** — start sessions on existing config agents (from the `agents` array in `aihub.json`) with coordinator prompt, not just CLI subagent processes
3. **Simplified UI** — dropdown shows config agents + "Custom" option; lead agents get a reduced form (prompt checkboxes + preview only, no harness/model/name selection)

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| `subagents` is top-level in `aihub.json` (not per-agent or per-project) | Simple, single source of truth for now |
| Lead agents always use coordinator prompt role | Matches user's workflow — only ever used Coordinator |
| `type` field is fixed enum (`worker` \| `reviewer`) | Maps cleanly to existing prompt templates |
| Coordinator prompt includes subagent types section | So the lead agent knows what it can spawn via `apm start --subagent <name>` |
| `--template` CLI flag fully removed, replaced by `--subagent` | User explicitly asked to remove backward compat |
| `--allow-template-overrides` renamed to `--allow-overrides` | Matches new naming |
| Lead agent sessions display agent name only in sidebar | No harness/model info needed for AIHub agents |
| All config agents shown in dropdown (no filtering) | Simple; user has only one agent currently |
| Custom option spawns CLI subagents only | Lead agents only via their named dropdown entry |
| Gateway returns `{ slug: "lead-<agentId>" }` for lead sessions | So `onSpawned(slug)` callback works uniformly |

## Work Completed (9 commits)

### 1. `659a0a5` feat: add SubagentConfigSchema and update coordinator prompt for --subagent
- **packages/shared/src/types.ts**: Added `SubagentConfigSchema` (Zod schema with name, description, harness, model, reasoning, type, runMode), `SubagentConfig` type, `subagents` optional array in `GatewayConfigSchema`, `subagentTemplate` in `StartProjectRunRequestSchema`
- **packages/shared/src/projectPrompt.ts**: Added `subagentTypes` to `RolePromptInput`. Updated coordinator delegation instructions to use `--subagent Worker`/`--subagent Reviewer` instead of `--template`. Added `subagentTypesBlock` that lists available subagent configs in the coordinator prompt when `includeRoleInstructions` is true.
- **packages/shared/src/projectPrompt.test.ts**: Updated assertions for `--subagent`, added tests for subagent types section

### 2. `857cc2e` feat(cli): replace --template with --subagent flag
- **packages/cli/src/index.ts**: Replaced `--template <template>` with `--subagent <name>`. Sends `subagentTemplate` to server (server resolves config). Removed local template profile application. Field-locking preserved with `--allow-overrides`.
- **packages/cli/src/index.start.test.ts**: All tests updated for new flag/behavior

### 3. `f160381` feat(gateway): expose subagent config, --subagent resolution, lead agent sessions
- **apps/gateway/src/config/index.ts**: Added `getSubagentTemplates()` getter
- **apps/gateway/src/components/projects/index.ts**: Added `GET /config/spawn-options` endpoint (returns agents + subagent templates). Added `subagentTemplate` resolution in start endpoint (case-insensitive name lookup → applies harness/model/reasoning/runMode/promptRole). Added lead agent session support in POST subagents endpoint (routes to `runAgent()` when `agentId` present). Passes `subagentTypes` to `buildRolePrompt`.

### 4. `18fcde0` feat(web): redesign agent creation with lead agents and config-driven templates
- **apps/web/src/api/client.ts**: Added `fetchSpawnOptions()`, `AgentInfo`/`SubagentTemplateInfo` types, `agentId` to `SpawnSubagentInput`
- **apps/web/src/api/types.ts**: Added `agentId` to `SubagentListItem`
- **apps/web/src/components/project/SpawnForm.tsx**: `SpawnTemplate` changed to `"lead" | "custom"`. Added `agentId`/`agentName` to `SpawnPrefill`. Form grid hidden for lead template. `mapTemplateToPromptRole` returns "coordinator" for "lead".
- **apps/web/src/components/project/AgentPanel.tsx**: Replaced 4 hardcoded template buttons with dynamic agents list from `fetchSpawnOptions()` + Custom. Sidebar shows agent name instead of harness·model for lead sessions.

### 5. `12fe2bd` chore: update remaining template references to --subagent
- Updated test data in `subagents/index.test.ts` and `AgentChat.test.tsx`

### 6. `ba17790` refactor: remove --template backward compat, use --subagent exclusively
- **packages/shared/src/types.ts**: Removed `StartTemplateSchema`, `StartTemplate`, `StartTemplateProfile`, `START_TEMPLATE_PROFILES`, `template`/`allowTemplateOverrides` from request schema
- **apps/gateway/src/components/projects/index.ts**: Removed template helper functions, old template resolution block, updated rebase conflict resolver to use `getSubagentTemplates()`
- **packages/cli/src/index.ts**: Renamed `--allow-template-overrides` to `--allow-overrides`

### 7. `b4a012e` docs: add lead agent launcher plan

### 8. `aa8bedf` fix: make subagents config optional in type
- Changed `subagents` from `.optional().default([])` to `.optional()` to avoid requiring it in all config mock objects

### 9. `0bdefc2` fix: lead agent spawn prompt and response
- **Gateway**: Lead agent prompt now reads full project docs, uses prompt flags, passes repo/owner/projectFiles/specsPath. Returns `{ slug: "lead-<agentId>" }`.
- **SpawnForm**: Lead agent submit sends only `agentId` + custom instructions (not double-wrapped full prompt with cli/model/slug)

## Config File Updated

`~/.aihub/aihub.json` — added `subagents` array:
```json
{
  "subagents": [
    {
      "name": "Worker",
      "description": "Implements code in isolated workspace",
      "harness": "codex",
      "model": "gpt-5.4",
      "reasoning": "medium",
      "type": "worker",
      "runMode": "worktree"
    },
    {
      "name": "Reviewer",
      "description": "Reviews worker output, runs tests",
      "harness": "codex",
      "model": "gpt-5.4",
      "reasoning": "high",
      "type": "reviewer",
      "runMode": "none"
    }
  ]
}
```

## Current State

- All tests pass: shared (47), cli (19), gateway (527), web (164)
- Build passes: `pnpm build` succeeds
- **Not yet manually verified**: The user reported that clicking "Cloud" to launch a lead agent did nothing. The `0bdefc2` commit fixes the root causes (double-wrapped prompt, missing project context, response format mismatch), but the user has not yet retested after that fix.
- The `apm` skill docs (`~/.claude/skills/apm`) still reference `--template` in examples — should be updated to `--subagent`

## Next Steps

1. **Manual testing** — User needs to rebuild (`pnpm build`) and test launching Cloud on PRO-221 again to verify the `0bdefc2` fix works end-to-end
2. **Update apm skill docs** — The apm skill at `~/.claude/skills/apm` still shows `--template worker` examples. Update to `--subagent Worker`. Also update the "Template Defaults" section to reflect config-driven behavior.
3. **Update docs/llms.md** — Per CLAUDE.md instructions, documentation should be kept up to date with code changes
4. **Edge cases to verify**:
   - What happens when `subagents` array is empty in config? (Coordinator prompt should omit the Available Subagent Types section — tested)
   - What happens when the only agent (Cloud/openclaw) is down? (Should get error from `runAgent`)
   - Concurrent lead agent sessions on same project — does sessionKey collision cause issues?
5. **PR creation** — Branch `feat/lead-agent-launcher-ui` is ready for PR against `main` once manual testing passes
