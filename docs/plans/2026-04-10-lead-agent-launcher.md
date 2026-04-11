# Lead Agent Launcher & Subagent Config Implementation Plan

> Historical plan. Current docs use `--subagent` / `--allow-overrides`; any `--template` references below are implementation-history only.
>
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded agent templates with config-driven subagent types and lead agent launching from project details.

**Architecture:** Add `subagents` array to `aihub.json` config, expose via gateway API, update coordinator prompt to include subagent types, replace `--template` CLI flag with `--subagent`, and redesign the web UI dropdown to show config agents + Custom option.

**Tech Stack:** SolidJS (web), Zod (validation), Hono (gateway API), Commander (CLI)

---

## Wave 1: Shared Types & Config Foundation

### Task 1: Add SubagentConfigSchema to shared types

**Files:**
- Modify: `packages/shared/src/types.ts`

**Step 1: Add SubagentConfigSchema after existing schemas (~line 405)**

Add before `GatewayConfigSchema`:

```typescript
export const SubagentConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  harness: z.enum(["codex", "claude", "pi"]),
  model: z.string(),
  reasoning: z.string(),
  type: z.enum(["worker", "reviewer"]),
  runMode: z.enum(["clone", "main", "worktree", "none"]),
});
export type SubagentConfig = z.infer<typeof SubagentConfigSchema>;
```

**Step 2: Add `subagents` to GatewayConfigSchema (~line 407)**

Add to the `GatewayConfigSchema` z.object:

```typescript
subagents: z.array(SubagentConfigSchema).optional().default([]),
```

**Step 3: Verify types compile**

Run: `cd /Users/thinh/projects/.workspaces/aihub/sc-superfluid-fluxon-733d && pnpm exec tsc --noEmit -p packages/shared/tsconfig.json`

### Task 2: Update coordinator prompt to reference --subagent and include subagent types

**Files:**
- Modify: `packages/shared/src/projectPrompt.ts`

**Step 1: Add `subagentTypes` to RolePromptInput (line ~45)**

Add to the `RolePromptInput` type:

```typescript
subagentTypes?: Array<{ name: string; description?: string; harness: string; model: string; reasoning: string; type: string; runMode: string }>;
```

**Step 2: Update coordinator delegation instructions in buildCoordinatorPrompt**

In the coordinator role instructions array (lines ~305-341), replace all `--template worker` and `--template reviewer` references with `--subagent Worker` and `--subagent Reviewer`. Specifically:

Replace:
```
'- Worker: `apm start <project_id> --template worker --slug worker-<task> --name "Worker <Name>" --custom-prompt "Implement <task>; update SPECS.md status."`',
'- Reviewer: `apm start <project_id> --template reviewer --slug reviewer-<scope> --name "Reviewer <Name>" --custom-prompt "Review worker workspaces; run tests; report pass/fail against acceptance criteria."`',
```
With:
```
'- Worker: `apm start <project_id> --subagent Worker --slug worker-<task> --custom-prompt "Implement <task>; update SPECS.md status."`',
'- Reviewer: `apm start <project_id> --subagent Reviewer --slug reviewer-<scope> --custom-prompt "Review worker workspaces; run tests; report pass/fail against acceptance criteria."`',
```

Also replace references to `--template` in the "locked flags" note:
```
"- When using `--subagent`, do NOT add locked flags (`--agent`, `--model`, `--reasoning-effort`, `--thinking`, `--mode`, `--branch`, `--prompt-role`) unless also using `--allow-template-overrides`.",
```

Remove the line about agent names being auto-generated when using templates and replace with:
```
'- Agent names use the subagent config name as prefix (e.g. "Worker Sage"). Use `--name "..."` to override.',
```

**Step 3: Add subagent types section to coordinator prompt**

After the role instructions block but before the postRun block, add a new section that lists available subagent types. Insert this code in `buildCoordinatorPrompt()`:

```typescript
const subagentTypesBlock =
  includeRole && input.subagentTypes && input.subagentTypes.length > 0
    ? [
        "## Available Subagent Types",
        "The following subagent types are configured and can be spawned via `apm start`:",
        "",
        ...input.subagentTypes.map(
          (s) =>
            `- **${s.name}** (${s.harness} / ${s.model}, reasoning: ${s.reasoning}, mode: ${s.runMode})${s.description ? `: ${s.description}` : ""}\n  → \`apm start ${projectId} --subagent ${s.name} --custom-prompt "..."\``
        ),
      ].join("\n")
    : "";
```

Then include `subagentTypesBlock` in the `joinPromptParts()` call, between the role instructions and the postRun block.

**Step 4: Update projectPrompt tests**

File: `packages/shared/src/projectPrompt.test.ts`

Update the coordinator prompt test to verify:
- `--subagent` appears instead of `--template`
- When `subagentTypes` is provided, the "Available Subagent Types" section appears
- When `subagentTypes` is empty/missing, no section appears

**Step 5: Run tests**

Run: `pnpm exec vitest run packages/shared/src/projectPrompt.test.ts`

### Task 3: Commit Wave 1

```bash
git add packages/shared/src/types.ts packages/shared/src/projectPrompt.ts packages/shared/src/projectPrompt.test.ts
git commit -m "feat: add SubagentConfigSchema and update coordinator prompt for --subagent"
```

---

## Wave 2: Gateway, CLI, and Web (parallel)

### Task 4: Gateway — expose subagents config and update start endpoint

**Files:**
- Modify: `apps/gateway/src/config/index.ts`
- Modify: `apps/gateway/src/components/projects/index.ts`

**Step 1: Add getter for subagents in config/index.ts**

After the existing `getAgent()` / `getActiveAgents()` functions, add:

```typescript
export function getSubagentTemplates(): SubagentConfig[] {
  const cfg = loadConfig();
  return cfg.subagents ?? [];
}
```

Import `SubagentConfig` from `@aihub/shared`.

**Step 2: Add API endpoint for agents list + subagent templates**

In `apps/gateway/src/components/projects/index.ts`, add a new GET endpoint (e.g. `/api/config/agents-and-subagents` or similar) that returns:

```json
{
  "agents": [{ "id": "pi:default", "name": "Pi Default" }, ...],
  "subagentTemplates": [{ "name": "Worker", "harness": "codex", ... }, ...]
}
```

Use `getActiveAgents()` for the agents list and `getSubagentTemplates()` for subagent templates. Look at how existing config endpoints are structured — likely in the main Hono app setup file rather than the projects component. Search for where other config/agents endpoints live.

**Step 3: Update start endpoint for --subagent resolution**

In the POST `/projects/:id/start` handler (line ~512), add logic to resolve `subagentTemplate` field:

When the request includes `subagentTemplate` (string name):
1. Look up the matching entry in `getSubagentTemplates()`
2. Apply its harness/model/reasoning/runMode as defaults (same pattern as current template resolution)
3. Map `type` to `promptRole` (worker → "worker", reviewer → "reviewer")
4. Use `name` as the run name prefix

This replaces the current `START_TEMPLATE_PROFILES[template]` lookup. Keep backward compat: if `template` is still sent (from old clients), map it through the existing logic.

**Step 4: Pass subagentTypes to buildRolePrompt**

When building the coordinator prompt in the start handler, pass `subagentTypes: getSubagentTemplates()` to `buildRolePrompt()`.

**Step 5: Add lead agent session support**

In the POST `/projects/:id/subagents` handler (line ~1414), add support for an `agentId` field:
- When `agentId` is provided, route to `runAgent()` instead of `spawnSubagent()`
- The prompt should be the coordinator prompt with subagent types included
- The response shape should match the existing spawn response

**Step 6: Run gateway tests**

Run: `pnpm test:gateway`

### Task 5: CLI — replace --template with --subagent

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.start.test.ts`

**Step 1: Replace --template flag with --subagent**

In the start command definition (line ~1127), replace:
```typescript
.option("--template <template>", "Prompt template (coordinator|worker|reviewer|custom)")
```
With:
```typescript
.option("--subagent <name>", "Subagent template name from aihub.json config (e.g. Worker, Reviewer)")
```

**Step 2: Update buildStartRequestBody**

In `buildStartRequestBody()` (line ~215):
- Replace all `template` references with `subagentTemplate`
- When `--subagent` is provided, send it as `subagentTemplate` in the request body
- Remove the `toStartTemplate()` validation (no longer enum-based, it's a freeform name)
- Keep `--allow-template-overrides` flag working (rename to `--allow-overrides` if desired)
- The server-side resolution handles mapping name → config values

**Step 3: Update the StartProjectRunRequestSchema in shared/types.ts**

Add `subagentTemplate: z.string().optional()` to the request schema.
Keep `template` as optional for backward compat but mark as deprecated.

**Step 4: Update CLI tests**

In `packages/cli/src/index.start.test.ts`:
- Update all tests that use `--template worker` to use `--subagent Worker`
- Update expected request body to use `subagentTemplate` instead of `template`
- Remove tests for template enum validation (it's now server-validated)
- Add test: `--subagent Worker` sends `{ subagentTemplate: "Worker" }` in body

**Step 5: Run CLI tests**

Run: `pnpm exec vitest run packages/cli/src/index.start.test.ts`

### Task 6: Web UI — redesign dropdown, form, and sidebar

**Files:**
- Modify: `apps/web/src/components/project/AgentPanel.tsx`
- Modify: `apps/web/src/components/project/SpawnForm.tsx`
- Modify: `apps/web/src/components/project/CenterPanel.tsx`
- Modify: `apps/web/src/api/client.ts`

**Step 1: Add API client for fetching agents + subagent templates**

In `apps/web/src/api/client.ts`, add:

```typescript
export type AgentInfo = { id: string; name: string };

export async function fetchAgentsAndSubagentTemplates(): Promise<{
  agents: AgentInfo[];
  subagentTemplates: SubagentConfig[];
}> {
  const res = await fetch(`${API_BASE}/config/agents-and-subagents`);
  if (!res.ok) throw new Error("Failed to fetch agents config");
  return res.json();
}
```

Also add a new `startLeadAgentSession` function (or extend `spawnSubagent` with an `agentId` field):

```typescript
export type SpawnSubagentInput = {
  // ... existing fields ...
  agentId?: string; // NEW: for lead agent sessions
  subagentTemplate?: string; // NEW: replaces template
};
```

**Step 2: Update SpawnTemplate type**

In SpawnForm.tsx (line 7), change:
```typescript
export type SpawnTemplate = "coordinator" | "worker" | "reviewer" | "custom";
```
To:
```typescript
export type SpawnTemplate = "lead" | "custom";
```

Update `SpawnPrefill` to add optional `agentId`:
```typescript
export type SpawnPrefill = {
  // ... existing fields ...
  agentId?: string; // for lead agent sessions
};
```

**Step 3: Redesign template menu in AgentPanel.tsx**

Replace the 4 hardcoded template buttons (lines ~1022-1094) with:

1. Fetch agents list on mount (or receive via props from parent)
2. Render each agent as a menu option: show agent name, on click call `openTemplate("lead", { agentId: agent.id, cli: "claude", model: "opus", ... })`
3. Keep "Custom" as last option with `openTemplate("custom", {})`
4. Remove Coordinator/Worker/Reviewer options entirely

**Step 4: Create reduced form for lead agent template**

In SpawnForm.tsx, when `props.template === "lead"`:
- Hide the form grid (name, harness, model, reasoning, runMode fields)
- Show only: prompt checkboxes, custom instructions textarea (if enabled), final prompt preview, Spawn/Cancel buttons
- The prompt should use coordinator role with subagent types
- Default checkbox values: includeDefaultPrompt=true, includeRoleInstructions=true, includePostRun=false (matching current coordinator defaults)

When `props.template === "custom"`:
- Show full form as today (unchanged)

**Step 5: Update form submission for lead agents**

In SpawnForm's submit handler, when template is "lead":
- Include `agentId` in the spawn request
- Don't send cli/model/reasoning/runMode (server knows from agent config)
- Send prompt with coordinator role

**Step 6: Update sidebar display for lead agent sessions**

In AgentPanel.tsx where subagent list items are rendered, when a session has an `agentId` (lead agent), show only the agent name without the `harness · model` suffix.

**Step 7: Update SpawnForm tests**

In `apps/web/src/components/project/SpawnForm.test.tsx`:
- Update coordinator prefill test to use "lead" template
- Add test for reduced form (lead template hides form grid)
- Keep custom template tests mostly unchanged

**Step 8: Run web tests**

Run: `pnpm test:web`

---

## Wave 3: Cleanup & Integration

### Task 7: Remove deprecated template code

**Files:**
- Modify: `packages/shared/src/types.ts`

**Step 1: Clean up START_TEMPLATE_PROFILES**

Remove `START_TEMPLATE_PROFILES` constant (lines ~665-713) and related types (`StartTemplate`, `StartTemplateProfile`) if no longer referenced. Or mark as deprecated if backward compat is needed.

Remove `StartTemplateSchema` and `toStartTemplate()` from types.ts.

**Step 2: Verify no remaining references**

Run: `grep -r "START_TEMPLATE_PROFILES\|StartTemplateSchema\|toStartTemplate" packages/ apps/ --include="*.ts" --include="*.tsx"`

If references remain, update them to use the new subagent config pattern.

**Step 3: Run all tests**

Run: `pnpm test:shared && pnpm test:gateway && pnpm test:cli && pnpm test:web`

### Task 8: Commit all changes

```bash
git add -A
git commit -m "feat: lead agent launcher with config-driven subagent templates"
```

---

## Parallelism Guide

- **Wave 1** (Tasks 1-3): Sequential, foundational. Must complete first.
- **Wave 2** (Tasks 4-6): **Parallel** — Gateway, CLI, and Web changes are in separate packages with minimal overlap.
- **Wave 3** (Tasks 7-8): Sequential cleanup after Wave 2 merges.
