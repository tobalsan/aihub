# Hand-off

Date: 2026-04-12
Repo: AIHub monorepo
Branch: `feat/lead-agent-launcher-ui` (based off `main` at `da6e9db`)
Project: PRO-221 — Lead Agent Launcher & Subagent Config

## Follow-up Notes

- PRO-224 adds Langfuse history-event tracing for user input, model usage, tool spans, and guarded flush/shutdown warnings.
- Coordinator prompt wording should say configured subagents, not templates.
- Coordinator prompt should tell lead agents to use exact configured `--subagent` names from the injected subagent list.
- AIHub post-run comment instructions should use `--author <your name>`.
- Deprecated Cloud/openclaw completion instruction was removed from post-run guidance.

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

- Lead-agent launch from project details works end-to-end.
- Project lead sessions now persist in `frontmatter.sessionKeys` and the project UI binds chat to the returned project-scoped `sessionKey`.
- OpenClaw project invocations now override configured `openclaw.sessionKey` only when runtime `sessionKey` starts with `project:`. `/chat` and FAB keep current config-driven behavior.
- Lead sessions now support sidebar actions:
  - `DELETE /api/projects/:id/lead-sessions/:agentId` removes the project lead-session binding
  - `POST /api/projects/:id/lead-sessions/:agentId/reset` clears the existing bound session state and starts fresh on the canonical `project:<id>:<agentId>` key
- Reset now refreshes visible lead chat immediately in the project UI; no page reload needed.
- Project left-panel lead status dot now reflects real lead-agent runtime state via `fetchAgentStatuses()` + `subscribeToStatus()`.
- Lead spawn form no longer shows the irrelevant CLI command preview.
- Validation now passing after these follow-up fixes:
  - `pnpm exec vitest run apps/gateway/src/sdk/openclaw/adapter.test.ts`
  - `pnpm exec vitest run apps/web/src/components/AgentChat.test.tsx apps/web/src/components/project/ProjectDetailPage.test.tsx`
  - `pnpm exec vitest run apps/web/src/components/project/SpawnForm.test.tsx apps/gateway/src/subagents/subagents.api.test.ts`
  - `pnpm build`
  - `pnpm typecheck`
- Repo docs were updated to reflect config-driven `--subagent` invocation, project-scoped lead sessions, and the latest lead-session UI fixes.
- Follow-up fix: project-detail lead chat now forces one history refresh when the session subscription opens, closing a race where fast Pi SDK lead-agent runs could finish after the first empty fetch but before the websocket subscription was active.
- Follow-up UX fix: fresh project-detail lead sessions now enter a pending state immediately, then stream subscribed text/tool activity live in the chat pane while running instead of staying blank until the final history refresh.
- Follow-up polish: lead-agent spawn no longer emits a project file-change refresh; project detail now mutates local `sessionKeys`/status optimistically, removing the visible full-pane flash on launch.
- The external `apm` skill docs (`~/.claude/skills/apm`) may still reference old `--template` examples.

## Next Steps

1. **Optional extra coverage** — Add targeted gateway/web tests for lead reset/remove endpoints and lead-status rendering if desired.
2. **External docs cleanup** — Update the separate `apm` skill docs if you want all non-repo docs aligned too.
3. **Verify in browser** — Re-test a fast Pi SDK lead-agent launch from project detail; the pane should now populate after the websocket subscribe handshake even if the initial fetch races the run.
3. **PR creation** — Branch `feat/lead-agent-launcher-ui` is ready for PR against `main`.
