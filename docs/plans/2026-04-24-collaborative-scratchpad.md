# Collaborative Scratchpad — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a shared markdown scratchpad as the primary content on the board canvas Overview panel, persisted to a single file, collaboratively editable by both the user (inline WYSIWYG) and agents (via dedicated API tool).

**Architecture:** The scratchpad is a single `SCRATCHPAD.md` file in the board workspace root. The gateway exposes two new endpoints under the board extension: `GET /api/board/scratchpad` and `PUT /api/board/scratchpad`. The agent accesses it via a new `scratchpad` internal tool registered in `internal-tools.ts`. The UI renders it inline in the Overview panel below the date, using contenteditable with markdown-it rendering (WYSIWYG-ish). Auto-save debounces edits to the PUT endpoint.

**Tech Stack:** SolidJS, Hono, markdown-it, file-based persistence (fs), debounced auto-save

---

## Spec

### Data model
- **File:** `$BOARD_ROOT/SCRATCHPAD.md` (created on first access if missing)
- **Content:** Freeform markdown text, single file, shared by all agents/users
- **Metadata:** Last-modified timestamp derived from `fs.statSync().mtime`

### API

#### `GET /api/board/scratchpad`
Returns:
```json
{
  "content": "# My scratchpad\n\nHello world",
  "updatedAt": "2026-04-24T10:30:00.000Z"
}
```
- Creates `SCRATCHPAD.md` with empty string if file doesn't exist
- Returns `updatedAt` from file mtime

#### `PUT /api/board/scratchpad`
Body:
```json
{
  "content": "# Updated\n\nNew content"
}
```
Returns:
```json
{
  "ok": true,
  "updatedAt": "2026-04-24T10:35:00.000Z"
}
```
- Writes content to `SCRATCHPAD.md`
- Uses atomic write (write to temp file, then rename) to avoid partial reads
- Emits `scratchpad.updated` event via extension context

### Agent tool: `scratchpad`

Registered in `internal-tools.ts` alongside existing project/subagent tools.

```
scratchpad.read  → GET content + updatedAt
scratchpad.write → PUT { content } → returns updatedAt
```

Tool definitions injected into agent system prompt:
```
Additional tools:
- scratchpad.read {} → Returns the current scratchpad content and last-updated timestamp.
- scratchpad.write { content: string } → Replaces the scratchpad content. Use for collaborative note-taking.
```

### UI

#### Overview panel changes
- **Remove** the placeholder (`🚧 Canvas panels will populate...`)
- **Add** scratchpad directly below the date heading
- Layout: date heading → "Last updated X" timestamp → scratchpad editor

#### Scratchpad editor component
- **Render mode:** markdown-it renders markdown → HTML displayed in a contenteditable div
- **Editing:** Click to edit. The editor shows raw markdown in a textarea when focused, rendered markdown when blurred.
- Actually, let's keep it simpler and more robust: use a **textarea** that shows raw markdown, with a **live preview** rendered alongside or below it. This avoids contenteditable nightmares.
  - **Revised approach:** Single textarea for editing. A separate preview area renders the markdown. Toggle between edit/preview, or show both (split view).
  - **Simplest v1:** Textarea with monospace font. Markdown rendered as a read-only preview above the textarea. Auto-save on every keystroke (debounced 500ms).
  - **Even simpler v1:** Just a textarea. Content loads from API, auto-saves on change (debounced). The markdown rendering is a nice-to-have that we skip for v1 — the content is markdown, the user sees raw markdown in the textarea, agents write markdown. Clean and honest.

**Decision: contenteditable div with markdown-it rendering. When focused/active, the user edits in the contenteditable div. Content is saved as raw markdown. When blurred, the rendered markdown is displayed. Use markdown-it to render HTML from the markdown source. On edit, extract raw markdown from the contenteditable (or maintain a parallel raw markdown state). Auto-save on change (debounced).**

#### Auto-save
- Debounce 500ms after last keystroke
- PUT to `/api/board/scratchpad`
- On save, update `updatedAt` display
- Show subtle "Saving…" / "Saved" indicator

#### Polling / real-time
- When agent writes to scratchpad, the UI needs to pick it up
- v1: Poll every 5s (alongside existing canvas polling) — check `updatedAt`, refetch if changed
- Future: SSE/WebSocket push via `scratchpad.updated` event

---

## Tasks

### Task 1: Add scratchpad read/write routes to board extension

**Objective:** Gateway can read and write the `SCRATCHPAD.md` file via HTTP.

**Files:**
- Modify: `packages/extensions/board/src/index.ts`

**Step 1: Add scratchpad file path helper**

In `packages/extensions/board/src/index.ts`, add after `getBoardRoot()`:

```ts
function getScratchpadPath(): string {
  return path.join(getBoardRoot(), "SCRATCHPAD.md");
}

function readScratchpad(): { content: string; updatedAt: string } {
  const filePath = getScratchpadPath();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", "utf-8");
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const stat = fs.statSync(filePath);
  return {
    content,
    updatedAt: stat.mtime.toISOString(),
  };
}

function writeScratchpad(content: string): { updatedAt: string } {
  const filePath = getScratchpadPath();
  // Ensure directory exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Atomic write via temp file + rename
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
  const stat = fs.statSync(filePath);
  return { updatedAt: stat.mtime.toISOString() };
}
```

**Step 2: Add routes inside `registerBoardRoutes`**

After the existing `/board/agents` route, add:

```ts
  // Scratchpad
  app.get("/board/scratchpad", (c) => {
    const data = readScratchpad();
    return c.json(data);
  });

  app.put("/board/scratchpad", async (c) => {
    const body = await c.req.json();
    const content = typeof body.content === "string" ? body.content : "";
    const result = writeScratchpad(content);
    getContext().emit("scratchpad.updated", {
      updatedAt: result.updatedAt,
    });
    return c.json({ ok: true, ...result });
  });
```

**Step 3: Rebuild the extension**

Run: `pnpm --filter @aihub/extension-board build`

**Step 4: Verify with curl**

```bash
# Start gateway first, then:
curl http://127.0.0.1:4010/api/board/scratchpad
# Expected: {"content":"","updatedAt":"2026-04-24T..."}

curl -X PUT http://127.0.0.1:4010/api/board/scratchpad \
  -H "Content-Type: application/json" \
  -d '{"content":"# Hello\n\nFirst scratchpad entry"}'
# Expected: {"ok":true,"updatedAt":"2026-04-24T..."}

curl http://127.0.0.1:4010/api/board/scratchpad
# Expected: {"content":"# Hello\n\nFirst scratchpad entry","updatedAt":"2026-04-24T..."}

# Verify file on disk
cat .aihub/extensions/board/SCRATCHPAD.md
# Expected: # Hello\n\nFirst scratchpad entry
```

**Step 5: Commit**

```bash
git add packages/extensions/board/src/index.ts
git commit -m "feat(board): add scratchpad read/write API endpoints"
```

---

### Task 2: Register scratchpad as an internal tool

**Objective:** Agents can call `scratchpad.read` and `scratchpad.write` through the internal tools system.

**Files:**
- Modify: `apps/gateway/src/server/internal-tools.ts`

**Step 1: Import board scratchpad helpers**

We need to either import from the board extension or call the API. Since the board extension's helpers are internal to it, the cleanest approach is to call the board routes internally. But the simpler approach: since `internal-tools.ts` dispatches tools by name and we need filesystem access, let's add a direct function.

Actually, the cleanest approach: add scratchpad tool handling in `dispatchInternalTool` that reads/writes the scratchpad file directly. The board root is discoverable from config.

Add at top of `internal-tools.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
```

Add a helper function:

```ts
function resolveBoardRoot(config: GatewayConfig): string {
  const raw = config.extensions?.board as Record<string, unknown> | undefined;
  const root = raw?.root as string | undefined;
  const base = root ? root.replace(/^~/, process.env.HOME || "") : path.join(process.env.AIHUB_HOME || path.join(os.homedir(), ".aihub"), "extensions", "board");
  return base;
}
```

Wait — we don't want to duplicate the board root resolution logic. Better approach: the board extension already exposes `/api/board/info` which returns the root. But internal tools shouldn't make HTTP calls to themselves.

**Cleaner approach:** Extract scratchpad read/write into a shared module, or simply have the board extension export a function. But extensions are standalone packages...

**Simplest correct approach:** The internal tool handler resolves the board root from config the same way the extension does. It's a few lines and avoids circular deps. Let's do that.

**Step 1: Add scratchpad tool cases to `dispatchInternalTool`**

In `apps/gateway/src/server/internal-tools.ts`, add imports at top:

```ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
```

Add helper before `dispatchInternalTool`:

```ts
function resolveBoardScratchpadPath(config: GatewayConfig): string {
  const raw = config.extensions?.board as Record<string, unknown> | undefined;
  const root = raw?.root as string | undefined;
  const base = root
    ? root.replace(/^~/, process.env.HOME || os.homedir())
    : path.join(
        process.env.AIHUB_HOME || path.join(os.homedir(), ".aihub"),
        "extensions",
        "board"
      );
  return path.join(base, "SCRATCHPAD.md");
}
```

Add cases in the `switch` block, before `default:`:

```ts
    case "scratchpad.read": {
      const filePath = resolveBoardScratchpadPath(deps.getConfig());
      if (!fs.existsSync(filePath)) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, "", "utf-8");
      }
      const content = fs.readFileSync(filePath, "utf-8");
      const stat = fs.statSync(filePath);
      return { content, updatedAt: stat.mtime.toISOString() };
    }
    case "scratchpad.write": {
      const parsed = z.object({ content: z.string() }).parse(args);
      const filePath = resolveBoardScratchpadPath(deps.getConfig());
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmpPath = filePath + ".tmp";
      fs.writeFileSync(tmpPath, parsed.content, "utf-8");
      fs.renameSync(tmpPath, filePath);
      const stat = fs.statSync(filePath);
      return { updatedAt: stat.mtime.toISOString() };
    }
```

**Step 2: Verify internal tool dispatch**

```bash
# Rebuild gateway
pnpm --filter @aihub/gateway build

# Start gateway, then test (need agent token from boardy's config)
# For dev testing, can call directly:
curl -X POST http://127.0.0.1:4010/internal/tools \
  -H "Content-Type: application/json" \
  -d '{"tool":"scratchpad.read","args":{},"agentId":"boardy","agentToken":"<TOKEN>"}'
```

**Step 3: Commit**

```bash
git add apps/gateway/src/server/internal-tools.ts
git commit -m "feat(board): register scratchpad.read/write as internal tools"
```

---

### Task 3: Expose scratchpad tool definitions to agents

**Objective:** Agents see `scratchpad.read` and `scratchpad.write` in their tool list when the board extension is enabled.

**Files:**
- Modify: `apps/gateway/src/sdk/pi/adapter.ts`

**Step 1: Add scratchpad tool prompt alongside subagent tools**

In the `runWithPi` function (around line 276), after the `subagentToolPrompt` block, add scratchpad tool detection:

Find:
```ts
      const projectsComponentEnabled = hasProjectsComponentEnabled();
```

After it, add:
```ts
      const boardExtensionEnabled = hasExtensionEnabled(config, "board");
```

We need a helper. Check if there's already one: 

**Step 2: Add helper to check if extension is enabled**

Look at `hasProjectsComponentEnabled` — find where it's defined and add a similar one for board:

```bash
grep -rn "hasProjectsComponentEnabled" /Users/thinh/projects/workspaces/board/apps/gateway/src/ --include="*.ts"
```

Follow the same pattern. Then add to the tool prompt section:

```ts
      const scratchpadToolPrompt = boardExtensionEnabled
        ? [
            "Board scratchpad tools:",
            "- scratchpad.read {} → Returns { content: string, updatedAt: string }. The shared scratchpad content.",
            "- scratchpad.write { content: string } → Replaces scratchpad content. Use for collaborative notes, brainstorms, status updates.",
          ].join("\n")
        : undefined;
```

And include it in `allAppendedPrompts`:
```ts
      const allAppendedPrompts = [
        subagentToolPrompt,
        scratchpadToolPrompt,
        renderedContext || undefined,
      ].filter((prompt): prompt is string => Boolean(prompt));
```

**Step 3: Commit**

```bash
git add apps/gateway/src/sdk/pi/adapter.ts
git commit -m "feat(board): expose scratchpad tools in agent prompt"
```

---

### Task 4: Build the ScratchpadEditor UI component

**Objective:** Create a SolidJS component that loads, displays, and edits the scratchpad with auto-save, using contenteditable with markdown-it rendering.

**Files:**
- Create: `apps/web/src/components/ScratchpadEditor.tsx`

**Requirements:**
- Uses `contenteditable` div for inline editing — NO textarea
- Renders markdown using `markdown-it` library in the contenteditable div
- Maintains raw markdown state internally — the contenteditable shows rendered HTML
- When user clicks/types in the contenteditable, they edit the rendered markdown directly
- On every input, extract the raw markdown back from internal state (NOT from innerHTML)
- Auto-save debounced (500ms) sends raw markdown to PUT endpoint
- On blur or after external update, re-render the markdown into the contenteditable
- Shows "Updated X ago" timestamp and "Saving…" indicator
- Polls every 5s for external changes (agent writes)

**Key design:** The component holds a `rawMarkdown` signal (the source of truth). The contenteditable div renders `markdown-it.render(rawMarkdown())` as its innerHTML. On user input events, the raw markdown is NOT extracted from the DOM — instead, the component tracks cursor position and applies changes to the raw markdown state. This avoids the complexity of reverse-parsing HTML back to markdown.

**Simpler approach:** Use a hybrid — when focused, show a textarea for raw markdown editing. When blurred, render markdown in a contenteditable display div. This gives true WYSIWYG preview without the HTML→markdown round-trip nightmare.

**Actual approach (chosen):** Contenteditable div that renders markdown-it output. The raw markdown is stored in a signal. On `input` events, we diff the current text content against what we expect and reconstruct markdown. For v1, a pragmatic approach:
1. Render markdown-it HTML into contenteditable
2. On focus: switch to raw markdown editing (textarea-style, but still in the same div — just set textContent to raw markdown)
3. On blur: re-render markdown-it HTML
4. This gives a "toggle between rendered and raw" UX within a single contenteditable element

Actually, simplest correct approach that meets the contenteditable mandate:
- **Single contenteditable div**
- **Display mode (not focused):** innerHTML = markdown-it.render(rawMarkdown)
- **Edit mode (focused):** innerHTML = `<pre>` + rawMarkdown + `</pre>` (raw markdown visible for editing)
- On blur: parse the textContent back to rawMarkdown signal, re-render
- Auto-save on every change (debounced)

**Step 1: Install markdown-it dependency**

```bash
cd /Users/thinh/projects/workspaces/board
pnpm --filter @aihub/web add markdown-it
pnpm --filter @aihub/web add -D @types/markdown-it
```

**Step 2: Create the component** (implementer should write the full component)
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ScratchpadEditor.tsx
git commit -m "feat(board): add ScratchpadEditor UI component"
```

---

### Task 5: Integrate ScratchpadEditor into OverviewPanel

**Objective:** The scratchpad appears as the first content below the date, replacing the placeholder.

**Files:**
- Modify: `apps/web/src/components/BoardView.tsx`

**Step 1: Import and render ScratchpadEditor**

At the top of `BoardView.tsx`, add:
```ts
import { ScratchpadEditor } from "./ScratchpadEditor";
```

**Step 2: Update OverviewPanel**

Replace the current `OverviewPanel` function:

```tsx
function OverviewPanel() {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div class="canvas-overview">
      <h1>{dateStr}</h1>
      <div class="canvas-overview-scratchpad">
        <ScratchpadEditor />
      </div>
      <style>{`
        .canvas-overview {
          max-width: 600px;
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .canvas-overview h1 {
          margin: 0 0 8px;
          font-size: 22px;
          color: var(--text-primary);
          flex-shrink: 0;
        }
        .canvas-overview-scratchpad {
          flex: 1;
          min-height: 0;
          margin-top: 16px;
        }
      `}</style>
    </div>
  );
}
```

This removes:
- `canvas-overview-subtitle` paragraph
- `canvas-overview-placeholder` div with the 🚧 message

And adds the ScratchpadEditor below the date heading.

**Step 3: Verify in browser**

```bash
# Open http://127.0.0.1:3010
# Click "Overview" tab on canvas
# Should see: date heading → scratchpad textarea
# Type something, wait 500ms, see "Saving…" → "Updated just now"
# Refresh page → content persists
```

**Step 4: Commit**

```bash
git add apps/web/src/components/BoardView.tsx
git commit -m "feat(board): integrate scratchpad into overview panel, remove placeholder"
```

---

### Task 6: E2E verification

**Objective:** Verify the full loop works — user edits, agent reads/writes, cross-sync.

**Step 1: Test user flow**
```bash
# Start gateway + web
# Open board, type in scratchpad
# Verify auto-save works (check "Updated X ago" indicator)
# Refresh page → content persists
```

**Step 2: Test file on disk**
```bash
cat .aihub/extensions/board/SCRATCHPAD.md
# Should show what you typed
```

**Step 3: Test API directly**
```bash
curl http://127.0.0.1:4010/api/board/scratchpad
# Should return content + updatedAt

curl -X PUT http://127.0.0.1:4010/api/board/scratchpad \
  -H "Content-Type: application/json" \
  -d '{"content":"Agent wrote this!"}'
# Should succeed

# Check UI picks up the change within 5s (poll interval)
```

**Step 4: Update handoff document**

Add to "What's been built" section and "What's next" in `docs/handoff/board-extension.md`.

---

## Open questions for future
- **Conflict resolution** — if user and agent edit simultaneously, last-write-wins (acceptable for v1)
- **SSE push** — replace 5s polling with WebSocket/SSE for instant agent→UI sync
- **Scratchpad history** — git-track the file? Version snapshots?
