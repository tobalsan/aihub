# Board Extension — Handoff Document

Created: 2026-04-23

## Context

The `projects` extension's Kanban board doesn't fit a solo-operator workflow. We're building a new `board` extension from scratch — a two-pane workspace: persistent agent chat on the left, a reactive canvas on the right.

This is **not** a replacement of the `projects` extension. Board is a new, independent extension. It may reuse patterns and data from projects later, but it must run standalone.

## Decisions

### Architecture
- **New extension:** `packages/extensions/board/` — independent, no dependency on `projects`
- **Route:** Board claims the home route (`/`) when its config has `home: true` (the default)
- **Home route priority:** Gateway resolves home ownership at startup via extension config schemas. Only one extension can claim `home: true` — the gateway refuses to start if there's a conflict. No hardcoding anywhere.
- **Two-pane layout:** Left = chat with selectable agent. Right = canvas that shows contextually relevant panels.

### Data model
- **Simplified statuses:** `intent` → `current` → `review` → `done` (down from 10 statuses in projects)
- **Dropped fields:** `domain`, `owner` from projects
- **Keep:** project-as-folder with frontmatter, specs, tasks, subagents, spaces/worktrees

### Canvas
- Agent can emit canvas commands (via API) to control what the right pane shows
- UI reacts to canvas state + supports manual tab navigation
- Agent always knows what's displayed (canvas state is queryable)
- Initial panels: Overview, Projects, Agents/Monitor

### Chat
- Shares the same agent/session infrastructure as the existing `/chat` route
- Same agent ID, same session key — just a different layout wrapper

## What's been built

### Gateway side
1. **Board extension** (`packages/extensions/board/src/index.ts`)
   - Config schema: `root` (optional path), `home` (defaults to `true`)
   - Routes: `/api/board/info`, `/api/board/canvas/:agentId`, `/api/board/agents`, `/api/board/projects`
   - Canvas state stored in-memory (will evolve to persistent)
   - Emits `canvas.updated` events for SSE subscribers

2. **Home route priority** (gateway changes)
   - `registry.ts`: After loading extensions, parses each one's raw config through its `configSchema` to resolve zod defaults. If >1 has `home === true`, startup fails with a clear error.
   - `api.core.ts`: `/api/capabilities` now includes `"home": "<extension-id>"` field
   - `shared/types.ts`: `CapabilitiesResponseSchema` has `home: z.string().optional()`
   - `ExtensionsConfigSchema` in shared types has `board` config shape

### UI side
3. **BoardView** (`apps/web/src/components/BoardView.tsx`)
   - Two-pane layout with responsive mobile fallback
   - Agent selector dropdown in chat header
   - Canvas tabs: Overview, Projects, Agents — switchable via buttons or API
   - Chat input with echo placeholder (not yet wired to real agent chat)
   - Polls canvas state every 2s for selected agent

4. **Home routing** (`apps/web/src/App.tsx`)
   - `HOME_REGISTRY` maps extension IDs → components (no hardcoding in route logic)
   - `HomeRoute` reads `capabilities.home` and does a registry lookup
   - Falls back to areas overview (if projects enabled) then agents list

### Test environment
5. **`.aihub/aihub.json`** — standalone config for dev testing
   - Agent "boardy" (🐼), gateway on port 3011, web on 4011
   - Projects extension disabled — proves board runs independently

## How to run

```bash
cd ~/projects/workspaces/board

# Gateway (port 3011)
AIHUB_HOME=$(pwd)/.aihub AIHUB_SKIP_WEB=1 \
  node apps/gateway/dist/cli/index.js gateway --dev --port 3011

# Web (port 4011, in another terminal)
AIHUB_HOME=$(pwd)/.aihub AIHUB_GATEWAY_PORT=3011 AIHUB_UI_PORT=4011 \
  pnpm --filter @aihub/web exec vite dev --port 4011 --host 127.0.0.1

# Open http://127.0.0.1:4011
```

## What's next

1. **Wire chat to real agent API** — currently echoes. Needs to use the existing agent messaging API (`POST /api/agents/:id/messages`) and render streaming responses
2. **Flesh out canvas panels** — project list with simplified statuses, agent monitor with live subagent status, day overview with priorities
3. **Canvas command protocol** — define how agents emit structured canvas commands (tool? structured output?). Agent must always know current canvas state.
4. **Project data model** — implement board's own project store with simplified statuses (intent/current/review/done). Folder-based, frontmatter, no domain/owner.
5. **SSE/WebSocket for canvas** — replace polling with real-time updates via the existing gateway WebSocket infrastructure
6. **Agent sidebar behavior** — when board is home, does the left agent sidebar still make sense? Or does the chat pane replace it?
