# AIHub UI v2 Spec

Date: 2026-01-30

## Goal

Transform AIHub from a project-centric tool into an agent-centric command center. The UI should feel like it "glides" — smooth, fast, minimal friction. Agents are first-class citizens; projects are work artifacts managed by agents.

## Layout: Three-Column with Context Panel

```
┌─────────────┬────────────────────────────────┬──────────────┐
│   Agents    │         Kanban (primary)       │   Context    │
│   Sidebar   │                                │    Panel     │
│             │  [MAYBE] [IN PROGRESS] [DONE]  │              │
│  LEAD       │                                │   Activity   │
│  ● CTO      │         Project Cards          │    Feed      │
│  ○ PM       │                                │     or       │
│             │                                │  Agent Chat  │
│  SUBAGENTS  │                                │              │
│  ● PRO-24   │                                │              │
│  ○ PRO-7    │                                │              │
└─────────────┴────────────────────────────────┴──────────────┘
     250px              flex 1                      400px
   collapsible                                   collapsible
```

### Why This Layout

- **Kanban stays primary and unconstrained** — never squeezed by chat
- **Chat is narrow (400px)** — conversations don't need full width
- **Activity feed provides ambient awareness** — see what's happening without switching views
- **Single context panel** — less cognitive overhead than multiple panels
- **Mirrors familiar patterns** — Slack, Linear, Mission Control

---

## Agent Model

### Two Agent Types

| Type | Examples | Session | Can Create Projects | Killable |
|------|----------|---------|---------------------|----------|
| **Lead** | CTO, Executive Assistant, Project Manager | Persistent | Yes | No |
| **Subagent** | CLI processes (codex, claude, gemini) | Ephemeral | No | Yes |

### Lead Agents

- Custom AIHub agents with defined roles/personalities
- Always have persistent sessions (sessions never killed)
- Can create and manipulate projects via tools
- Can spawn subagents or work on projects directly
- **Working** = streaming response or running background process
- **Idle** = waiting for human input

### Subagents

- Generic CLI processes launched by lead agents or human
- Assigned to projects via the `agent` property
- Can be interrupted, resumed, or killed
- When killed, disappear from sidebar
- Each spawned subagent appears in sidebar
- **Working** = CLI process running
- **Idle** = finished or interrupted

### Project Ownership

- `owner` field = human OR lead agent (who manages the project)
- `agent` field = subagent assigned to execute work

---

## Left Sidebar: Agents

### Structure

```
┌─────────────────────┐
│ «                   │  ← collapse button
├─────────────────────┤
│ LEAD AGENTS         │
│ ● CTO         (working)
│ ○ Exec Asst   (idle)
│ ○ PM          (idle)
├─────────────────────┤
│ SUBAGENTS           │
│ ● PRO-24/codex (working)
│ ○ PRO-7/claude (idle)
│                     │
│ [empty when none]   │
└─────────────────────┘
```

### Behavior

| Aspect | Behavior |
|--------|----------|
| Default | Open (sticky), 250px |
| Collapse | Click « button → shrinks to 50px (dots only) |
| Expand | Hover over collapsed sidebar → temporarily expands |
| Click agent | Opens chat in right panel (desktop) or fullscreen (mobile) |

### Status Indicators

- Green dot = working (streaming/running)
- Gray dot = idle (waiting/finished)

---

## Right Sidebar: Context Panel

### Structure

```
┌─────────────────────┐
│ » [Feed] [Chat]     │  ← collapse + mode tabs
├─────────────────────┤
│                     │
│   Activity Feed     │
│        or           │
│    Agent Chat       │
│                     │
└─────────────────────┘
```

### Modes

| Mode | Trigger | Content |
|------|---------|---------|
| **Activity Feed** | Default, click Feed tab | Live stream of events |
| **Agent Chat** | Click agent in sidebar | Chat with selected agent |

### Activity Feed Content

- Agent actions (moved project, approved, assigned)
- Project status changes
- Commits pushed
- Last agent messages
- Comments (future feature)

### Agent Chat

- Header: agent name + back arrow (returns to feed)
- Scrollable message history
- Input at bottom (disabled when agent running autonomously)
- Chat = Monitoring — same view for interactive chat and autonomous logs

### Behavior

| Aspect | Behavior |
|--------|----------|
| Default | Open (sticky), 400px, showing Activity Feed |
| Collapse | Click » button → shrinks to 50px (icons only) |
| Expand | Hover over collapsed panel → temporarily expands |
| Icon click (collapsed) | Expands AND switches to that mode |

---

## Project Detail Overlay

Clicking a project card opens a **near-maximized overlay** (existing behavior preserved).

### Content

- Left pane: Project README (markdown rendered)
- Right pane: **Agent Runs** list (replaces current monitoring pane)
  - Shows active + past runs for this project
  - Click a run → opens that session's logs

### Behavior

- ESC or click backdrop → closes overlay
- Full control retained — can edit project properties
- Can intervene mid-run (changes YAML frontmatter)

---

## Responsive Breakpoints

| Width | Layout |
|-------|--------|
| ≥ 1400px | Full three-column, all panels open |
| 769px – 1399px | Both sidebars auto-collapse, hover to expand |
| ≤ 768px | Mobile — right panel hidden, fullscreen overlays |

### Mobile Behavior (≤ 768px)

- Right panel: Hidden completely
- Left sidebar: Fixed position, collapsed (50px), hover to expand with shadow
- Click agent: Opens **fullscreen chat overlay**
- Floating activity button (bottom-right): Opens **fullscreen feed overlay**
- Back arrow in fullscreen: Returns to kanban

---

## Navigation & Routes

| Route | View |
|-------|------|
| `/` | Kanban board (homepage) |
| `/agents` | Legacy agent list (preserved) |
| `/projects/:id` | Deep link to project detail overlay |

### Keyboard Shortcuts (TBD)

- `Escape` — Close overlay/fullscreen
- `Cmd+K` — Quick search/command palette (existing)

---

## Implementation Phases

### Phase 1: Kanban as Homepage ✓ COMPLETE

**Goal**: Make Kanban the landing page.

**Changes**:
- Route `/` → renders `ProjectsBoard`
- Route `/agents` → renders `AgentList`
- Header: Remove back arrow, show "AIHub" only
- Keep all existing Kanban functionality

**Files**:
- `apps/web/src/App.tsx`
- `apps/web/src/components/ProjectsBoard.tsx`

---

### Phase 2: Left Sidebar — Agents

**Goal**: Add agent sidebar to main layout.

**Changes**:
- New component: `AgentSidebar.tsx`
- Two sections: Lead Agents, Subagents
- Status dots (working/idle)
- Collapsible with hover-expand
- Click agent → sets `selectedAgent` state

**Data**:
- Lead agents: from config/API
- Subagents: from existing subagent API (active sessions)

**Files**:
- `apps/web/src/components/AgentSidebar.tsx` (new)
- `apps/web/src/components/ProjectsBoard.tsx` (integrate sidebar)

---

### Phase 3: Right Panel — Context Panel

**Goal**: Add context panel with Feed/Chat modes.

**Changes**:
- New component: `ContextPanel.tsx`
- Activity Feed view (placeholder events initially)
- Agent Chat view (reuse existing chat components)
- Mode tabs + collapsed icon bar
- Collapsible with hover-expand

**Files**:
- `apps/web/src/components/ContextPanel.tsx` (new)
- `apps/web/src/components/ActivityFeed.tsx` (new)
- `apps/web/src/components/AgentChat.tsx` (new or refactor existing)

---

### Phase 4: Wire Real Data

**Goal**: Connect UI to real backend data.

**Changes**:
- Activity feed pulls from real events:
  - Agent actions via WebSocket/polling
  - Project moves from projects API
  - Commits (if available)
- Agent chat connects to existing session logic
- Subagents appear/disappear dynamically based on API
- Lead agent status from agent API

**Files**:
- `apps/web/src/api/client.ts` (add activity feed endpoint)
- `apps/gateway/src/server/api.ts` (add activity endpoint if needed)

---

### Phase 5: Project Detail — Agent Runs

**Goal**: Replace monitoring pane with Agent Runs list.

**Changes**:
- Project detail overlay shows "Agent Runs" instead of active session
- List: active + past runs for this project
- Click run → opens session logs
- Preserve existing overlay behavior (ESC, backdrop close)

**Files**:
- `apps/web/src/components/ProjectsBoard.tsx` (modify detail overlay)

---

### Phase 6: Mobile & Polish

**Goal**: Responsive behavior + visual refinement.

**Changes**:
- Fullscreen chat overlay for mobile
- Fullscreen feed overlay for mobile
- Floating activity button (mobile only)
- Transitions, spacing, animations
- Keyboard shortcuts

**Files**:
- Various component files
- CSS/Tailwind responsive classes

---

## Design Tokens (Reference)

From mockup — to be formalized in implementation:

```css
/* Surfaces */
--bg-base: #0a0a0a;
--bg-surface: #1a1a1a;
--bg-elevated: #2a2a2a;

/* Borders */
--border-default: #2a2a2a;
--border-hover: #444;

/* Text */
--text-primary: #ffffff;
--text-secondary: #aaaaaa;
--text-muted: #666666;

/* Status */
--status-online: #22c55e;
--status-offline: #666666;

/* Accents (Kanban columns) */
--accent-maybe: #eab308;
--accent-in-progress: #a855f7;
--accent-done: #22c55e;

/* Interactive */
--accent-primary: #3b82f6;
--accent-primary-hover: #2563eb;
```

---

## Mockups

Interactive HTML mockups available at:
- `docs/mockups/option-e-three-column.html` — Final layout with all interactions

Test with:
```bash
open docs/mockups/option-e-three-column.html
```

---

## Open Questions / Future

- **Comments feature**: Async communication on projects between human and lead agents
- **Drag & drop**: Status moves on Kanban (deferred from v1)
- **Quick create**: Fast task creation from anywhere (floating button? keyboard shortcut?)
- **Notifications**: When agent needs attention, finishes task, etc.
- **Agent assignment UI**: How to assign agent to project from chat vs. from project detail
