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

### Board workspace
- **Default root:** `$AIHUB_HOME/extensions/board` — resolved from gateway's data dir
- **Custom override:** `extensions.board.root` in config (supports `~` expansion via `expandPath`)
- **Auto-created** on extension `start()` via `fs.mkdirSync(root, { recursive: true })`
- **Exposed** via `/api/board/info` → `{ root: string }` so UI/agents can discover it

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
- Uses **full history** (`fetchFullHistory`) — not simple history — so tool calls, thinking blocks, and diffs render inline

## What's been built

### Gateway side
1. **Board extension** (`packages/extensions/board/src/index.ts`)
   - Config schema: `root` (optional path), `home` (defaults to `true`)
   - Board root resolution: custom path or `$AIHUB_HOME/extensions/board`, auto-created on start
   - Routes: `/api/board/info`, `/api/board/canvas/:agentId`, `/api/board/agents`, `/api/board/projects`, `/api/board/scratchpad`
   - Canvas state stored in-memory (will evolve to persistent)
   - Emits `canvas.updated` and `scratchpad.updated` events for SSE subscribers

2. **Scratchpad internal tools** (`apps/gateway/src/server/internal-tools.ts`)
   - `scratchpad.read {}` — returns `{ content, updatedAt }` from `$BOARD_ROOT/SCRATCHPAD.md`
   - `scratchpad.write { content }` — atomic write (temp + rename) to scratchpad file
   - Board root resolved from `config.extensions.board.root` (same logic as extension)
   - Registered alongside existing project/subagent tools in `dispatchInternalTool`

3. **Agent prompt contribution**
   - Board implements the shared `Extension.getSystemPromptContributions(agent)` hook
   - Gateway aggregates extension prompt contributions in `apps/gateway/src/extensions/prompts.ts`
   - In-process Pi runs append those strings through `DefaultResourceLoader.appendSystemPrompt`
   - Sandbox/container runs receive them as `ContainerInput.extensionSystemPrompts` and append them in the runner
   - Board's contribution documents `scratchpad.read` and `scratchpad.write`

4. **Home route priority** (gateway changes)
   - `registry.ts`: After loading extensions, parses each one's raw config through its `configSchema` to resolve zod defaults. If >1 has `home === true`, startup fails with a clear error.
   - `api.core.ts`: `/api/capabilities` now includes `"home": "<extension-id>"` field
   - `shared/types.ts`: `CapabilitiesResponseSchema` has `home: z.string().optional()`
   - `ExtensionsConfigSchema` in shared types has `board` config shape

### UI side
5. **ScratchpadEditor** (`apps/web/src/components/ScratchpadEditor.tsx`)
   - Contenteditable div with markdown rendering via `renderMarkdown()` (existing `marked` + DOMPurify util)
   - **Display mode (blurred):** innerHTML set to rendered markdown HTML
   - **Edit mode (focused):** textContent set to raw markdown, monospace font
   - Auto-save debounced 500ms after input, serialized (no concurrent saves)
   - Polls `/api/board/scratchpad` every 5s for external changes (agent writes)
   - Conflict guard: only applies remote changes if user is not actively editing
   - Shows "Updated X ago" (refreshes every 1s) and "Saving…" indicator
   - Placeholder: "Start typing... Markdown supported." when empty

6. **OverviewPanel integration** (`apps/web/src/components/BoardView.tsx`)
   - Scratchpad is the first content below the date heading on the canvas Overview tab
   - Removed the 🚧 placeholder — scratchpad IS the default content now
   - Flex layout: date heading → scratchpad fills remaining space

7. **BoardChatRenderer** (`apps/web/src/components/BoardChatRenderer.tsx`)
   - `buildBoardLogs(messages: FullHistoryMessage[]): BoardLogItem[]` — converts full history into renderable log items (text, thinking, tool calls, diffs)
   - `BoardChatLog` component — renders all log item types with:
     - User messages in pill bubbles, assistant text via `renderMarkdown()`
     - Collapsible tool call entries with icons (read, bash, write, generic tool)
     - Collapsible thinking blocks, inline diffs with green/red tint
   - Markdown rendered with proper list styling (`white-space: normal`, tight margins)

8. **BoardView** (`apps/web/src/components/BoardView.tsx`)
   - Two-pane layout (520px chat / flex canvas) with responsive mobile fallback
   - **Chat pane (left):**
     - Agent avatar + transparent select dropdown in header
     - Empty state: centered chat icon + "How can I help?"
     - Full history via `fetchFullHistory()` — shows tool calls, thinking, diffs
     - Live streaming via `streamMessage()` with tool call/result callbacks (`onToolCall`, `onToolResult`)
     - Session subscription with tool callbacks for background run monitoring
     - `liveText` signal accumulates streaming text, appended as assistant log item
     - Queued messages displayed inline while agent is streaming
     - Animated "Thinking…" indicator (pulsating opacity, italic, respects `prefers-reduced-motion`)
     - Codex-style rounded input container with send/stop toggle
     - Auto-scroll to bottom (follow mode, pauses on scroll up, resumes when near bottom)
   - **Canvas pane (right):**
     - Tabs: Overview, Projects, Agents — switchable via buttons or API
     - Polls canvas state every 2s for selected agent

9. **Home routing** (`apps/web/src/App.tsx`)
   - `HOME_REGISTRY` maps extension IDs → components (no hardcoding in route logic)
   - `HomeRoute` reads `capabilities.home` and does a registry lookup
   - Falls back to areas overview (if projects enabled) then agents list

### Test environment
10. **`.aihub/aihub.json`** — standalone config for dev testing
   - Agent "boardy" (🐼), gateway on port 4010, web on 3010
   - Projects extension disabled — proves board runs independently
   - `AIHUB_HOME=$(pwd)/.aihub`

### Commits (all sessions)
- `12cb4b0` scaffold board extension with home route priority
- `bb8b00c` add board extension handoff document
- `93a5811` wire chat to real agent streaming API
- `5c89234` improve chat styling and thinking indicator animation (amended)
- `ace8efa` add stop button and message queuing while streaming (amended)
- `bfc81d8` add full-history log renderer with tool call support (BoardChatRenderer)
- `014dcdb` switch BoardView to full history with tool call rendering
- `e906d00` style markdown bullet/ordered lists with proper padding and margin
- `3a80881` move white-space pre-wrap to user messages only, fix markdown line-height
- `12ddd6b` resolve board root from config, default to $AIHUB_HOME/extensions/board
- `41476e0` add scratchpad read/write API endpoints
- `a9ae7e8` register scratchpad.read/write as internal tools
- `7bb3a43` expose scratchpad tools in agent prompt
- `4b2c0f6` add ScratchpadEditor UI component with contenteditable markdown rendering
- `0cf57b0` integrate scratchpad into overview panel, remove placeholder

## How to run

```bash
cd ~/projects/workspaces/board

# Build extension (REQUIRED after gateway-side changes!)
pnpm --filter @aihub/extension-board build

# Gateway (port 4010)
AIHUB_HOME=$(pwd)/.aihub AIHUB_SKIP_WEB=1 \
  node apps/gateway/dist/cli/index.js gateway --dev --port 4010

# Web (port 3010, in another terminal)
AIHUB_HOME=$(pwd)/.aihub AIHUB_GATEWAY_PORT=4010 AIHUB_UI_PORT=3010 \
  pnpm --filter @aihub/web exec vite dev --port 3010 --host 127.0.0.1

# Open http://127.0.0.1:3010
```

## E2E debugging with agent-browser

Use `agent-browser` CLI to inspect the live UI when you can't see it directly. The gateway must be running.

```bash
# Navigate to board
agent-browser open http://127.0.0.1:3010/

# Take a screenshot to see current state
agent-browser screenshot
agent-browser screenshot --annotate    # with ref labels

# Get accessibility snapshot of the page
agent-browser snapshot                 # full tree
agent-browser snapshot -i              # interactive elements only

# Interact with elements (refs from snapshot/annotate)
agent-browser fill @e3 "list 5 cat facts"
agent-browser click @e4

# Run JS in the browser to inspect computed styles
cat <<'EOF' | agent-browser eval --stdin
(() => {
  const el = document.querySelector('.board-msg-markdown');
  const cs = getComputedStyle(el);
  return JSON.stringify({ whiteSpace: cs.whiteSpace, lineHeight: cs.lineHeight });
})()
EOF

# Get element text/html
agent-browser get text @e5
agent-browser get html @e5

# Wait for a condition
agent-browser wait --fn "document.querySelector('.board-msg-markdown') !== null"
```

### Tips
- **Inline `<style>` tags** in SolidJS components may not hot-reload via Vite HMR. Do a hard refresh (Cmd+Shift+R) if CSS changes aren't taking effect.
- **Gateway changes** require rebuilding: `pnpm --filter @aihub/extension-board build` then restart gateway.
- **Web UI changes** are picked up automatically by Vite dev server.

## Known issues
- CSS variables like `--text-accent`, `--bg-accent` are undefined in the board extension context. All UI elements must use solid color fallbacks (e.g., `var(--bg-accent, #6366f1)`).
- The `.board-msg-content` base rule was setting `white-space: pre-wrap` which broke markdown rendering (extra vertical gaps in lists, paragraphs). Fixed by scoping `pre-wrap` to `.board-msg-user .board-msg-content` only. Don't re-add it to the base rule.

## What's next

1. ~~**Markdown rendering**~~ ✅ — assistant messages render via `renderMarkdown()`
2. ~~**Tool call rendering**~~ ✅ — collapsible entries with icons for read/bash/write, diffs, thinking blocks
3. ~~**Collaborative scratchpad**~~ ✅ — contenteditable markdown editor on Overview panel, persisted to `SCRATCHPAD.md`, agent tools `scratchpad.read/write`, auto-save + polling
4. **Flesh out canvas panels** — project list with simplified statuses, agent monitor with live subagent status
5. **Canvas command protocol** — define how agents emit structured canvas commands (tool? structured output?). Agent must always know current canvas state.
6. **Project data model** — implement board's own project store with simplified statuses (intent/current/review/done). Folder-based, frontmatter, no domain/owner. Board root is now configured and auto-created — store should live under it.
7. **SSE/WebSocket for canvas + scratchpad** — replace polling with real-time updates via the existing gateway WebSocket infrastructure
8. **Agent sidebar behavior** — when board is home, does the left agent sidebar still make sense? Or does the chat pane replace it?
