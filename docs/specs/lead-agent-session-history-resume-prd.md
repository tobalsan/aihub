# Lead-Agent Session History & Resume PRD

## Goal

Let users browse every past lead-agent conversation and resume any of them
directly from the web UI, without that resume disturbing the agent's `main`
session pointer. Today only the single `main` session per agent is reachable
(`/agents` → click agent → `/chat/:agentId` always opens `main`), even though
every prior session is already persisted on disk.

Prototype reference: `~/Downloads/aihub-prototype-01-standalone.html`.

## Background / Current State

- Lead-agent transcripts are stored one file per session as
  `$AIHUB_HOME/history/<timestamp>_<agentId>-<sessionId>.jsonl` (single user) or
  `$AIHUB_HOME/sessions/users/<userId>/history/<...>.jsonl` (multi-user).
  Path helpers: `getUserHistoryDir(userId, CONFIG_DIR)`
  (`packages/extensions/multi-user/src/isolation.ts`).
- `sessions.json` maps `<agentId>:<sessionKey>` → `{ sessionId, createdAt,
  updatedAt }`. It only remembers the *current* pointer per key (e.g.
  `sally:main`), so rotated/older sessions are invisible through it. The session
  files on disk are the source of truth for "all past sessions".
- The chat send path already supports an explicit `sessionId` that bypasses
  session-key resolution. In `apps/gateway/src/agents/runner.ts` the precedence
  is: explicit `sessionId` > `sessionKey` resolution > `"default"`. Sending with
  an explicit `sessionId` appends to that session and never writes
  `sessions.json`.
- `resolveSessionId` (`apps/gateway/src/sessions/store.ts`) rotates a *key* to a
  new `sessionId` after the idle timeout (default 360 min). Resuming by explicit
  `sessionId` skips this entirely.
- The web app has a persistent app-wide left sidebar
  (`apps/web/src/components/AgentSidebar.tsx`: brand, nav links, account, theme
  toggle). The chat surface is `apps/web/src/components/ChatView.tsx`, reached at
  `/chat/:agentId/:view?`.

## Scope

In scope:
- A backend endpoint that lists past sessions (enumerated from history files).
- A backend endpoint to delete and to rename a session.
- Surfacing a recency-grouped session list in the existing app-wide left
  sidebar, below the primary nav.
- Selecting a session loads its transcript in the chat surface and lets the user
  send follow-up messages into it (transparent resume).
- Deep-linkable selection via `/chat/:agentId?session=<sessionId>`.

Out of scope:
- Project / slice runtime-subagent runs (covered by
  `agent-tab-session-chat-prd.md`; that surface is unchanged).
- Slack / webhook / scheduler / benchmark sessions as interactive list entries
  (they are filtered out — see Filtering).
- Promoting a session to become `main`.
- Archiving sessions.
- A new persistent session-index/registry file.

## Decisions (locked)

| Topic | Decision |
| --- | --- |
| List source | Enumerate `history/*.jsonl` files (all real past sessions). No new index file. |
| List scope | **All** agents' sessions in one list, grouped by recency/time period (Today, Yesterday, Earlier this week, …) like the prototype — not grouped by agent. |
| List placement | The **existing app-wide left sidebar** (`AgentSidebar.tsx`), with the session list rendered below the primary nav items. No second sidebar. |
| Resume semantics | Resume by explicit `sessionId`. The agent's `main` pointer in `sessions.json` **never changes**. |
| Idle rotation on resume | Always append to the chosen session; ignore idle timeout (true resume). |
| Cross-agent click | Clicking a session for a different agent navigates to that agent's chat and loads the session: `/chat/<thatAgent>?session=<id>`. |
| URL | Selected session reflected as `/chat/:agentId?session=<sessionId>` (deep-linkable). |
| Default open (no `?session`) | Load the agent's `main` session (current behavior). |
| `+ New` | Start a fresh session (send `/new` to `main`, which rotates `main` to a new `sessionId`) and select it. |
| v1 actions | Search/filter, Delete, Rename. |
| Interactivity | Fully interactive — users can send/stream into a resumed (non-main) session. |
| Label/preview | First user message of the session (prototype `firstUserMessage`). |
| Multi-user scope | Each user sees only their own sessions (scoped by `userId`). |

## Data Model

A listed session is derived from a history file, not stored separately.

```
SessionSummary {
  agentId: string          // parsed from filename
  sessionId: string        // parsed from filename
  createdAt: number        // from filename timestamp prefix (ms)
  lastActivity: number     // timestamp of last history entry (fallback: file mtime)
  messageCount: number     // count of user+assistant messages
  firstUserMessage: string // excerpt for the row preview/label
  title?: string           // optional user-set title (see Rename)
  isMain: boolean          // sessionId === sessions.json[`${agentId}:main`].sessionId
}
```

Filename parsing reuses the conventions in
`apps/gateway/src/sessions/files.ts`
(`<ts>_<agentId>-<sessionId>.jsonl`, plus legacy `<agentId>-<sessionId>.jsonl`).

### Title storage (Rename)

Titles are user-set metadata that must survive without a new registry file.
Store the title as a `meta` entry appended to the session's own JSONL via the
existing `appendSessionMeta(agentId, sessionId, "title", value, userId)`
(`apps/gateway/src/history/store.ts`). The latest `title` meta entry wins when
listing.

## Filtering (which sessions appear)

Hidden from the list:
- `scheduler:*` session keys (cron job runs).
- `bench-*` sessions (benchmark runs).
- Sessions with no visible user/assistant content (empty / system-only /
  setup-only files).

Also excluded from the interactive list (not user-facing chats here):
`slack:*`, `webhook:*`, `default`, and other non-`main`-style integration keys.
The agent + sessionId in the filename is enough to identify these by prefix; for
prefix detection, cross-reference `sessions.json` keys where helpful, but the
filter must work from the files alone since old rotated sessions are not in
`sessions.json`.

A session counts as having "visible content" if it contains at least one `user`
or `assistant` history entry with non-empty text (same notion of visible content
used elsewhere: user/assistant/tool/error content that renders in the
transcript).

## Backend

### `GET /api/agents/sessions`

Returns all visible past sessions for the requesting user, newest first.

- Resolve `userId` from auth (`getRequestUserId`), like existing history routes.
- Enumerate the user's history dir (`getUserHistoryDir(userId, CONFIG_DIR)`).
- Parse each filename → `{ agentId, sessionId, createdAt }`.
- Apply filtering rules above.
- For each kept file, read it to derive `firstUserMessage`, `messageCount`,
  `lastActivity`, and latest `title` meta.
- Mark `isMain` by comparing against `sessions.json[`${agentId}:main`]`.
- Response: `{ items: SessionSummary[] }` sorted by `lastActivity` desc.

Reading every file fully on each call is acceptable for v1 (file counts are
small). If needed later, read only head/tail lines for preview + count.

### `DELETE /api/agents/:agentId/sessions/:sessionId`

- Resolve the session's history file (`resolveSessionDataFile`, `createIfMissing:
  false`). 404 if not found.
- Delete the file. Invalidate the resolved-history-file cache
  (`invalidateResolvedHistoryFile`).
- If the deleted `sessionId` is the current `main` pointer for that agent, clear
  that `sessions.json` entry (`clearSessionEntry(agentId, "main", userId)`) so a
  fresh `main` is created on next message.
- Scoped to the requesting user's own history dir only.

### `PATCH /api/agents/:agentId/sessions/:sessionId`

- Body: `{ title: string }`.
- Append a `title` meta entry to the session JSONL via `appendSessionMeta`.
- 404 if the session file does not exist.

### Live updates by explicit `sessionId` (critical gap)

This is the one non-trivial backend change. The send path already accepts an
explicit `sessionId`, but **live streaming delivery does not**:

- `apps/gateway/src/server/ws-broker.ts` subscriptions are keyed by
  `{ agentId, sessionKey }`. `broadcastStreamEvent` resolves the subscriber's
  `sessionKey` → `sessionId` through `sessions.json` and only forwards events
  whose `event.sessionId` matches. For a transparently-resumed session (a
  `sessionId` that is *not* the current `main` pointer), no `sessionKey` resolves
  to it, so the client receives no live text/tool/done events.

Required change: allow the WS `subscribe` message to carry an explicit
`sessionId`. When present, the subscription matches `event.sessionId` directly
and skips `sessions.json` resolution. Apply the same to the initial
active-turn replay in `subscribeToSession`. The `sessionKey` path stays as-is for
the `main`/default case.

The HTTP send + WS `send` already work with an explicit `sessionId` and need no
change beyond the web client passing `sessionId` instead of (or in addition to)
`sessionKey`.

### History fetch by `sessionId`

`GET /api/agents/:id/history` currently resolves `sessionKey` → `sessionId` via
`getSessionEntry`. Add support for an explicit `sessionId` query param: when
`sessionId` is provided, read history for it directly (`getFullSessionHistory` /
`getSessionHistory`) and skip the `sessions.json` lookup. `streaming` /
`activeTurn` are computed against that `sessionId`.

## Web UI

### Session list in the left sidebar

In `AgentSidebar.tsx`, add a `Sessions` section between `.sidebar-nav` and
`.sidebar-footer`, matching the prototype's structure:

- Section header: `Sessions` label + `+ New` button.
- Search input that filters by `firstUserMessage` / `title` (client-side).
- Recency-grouped list (Today, Yesterday, Earlier this week, Earlier this month,
  then `Month Year`), newest first, **mixing all agents**.
- Each row: small agent-colored avatar (first letter), preview text
  (`title` if set else `firstUserMessage`), and a meta line with relative time +
  agent name.
- The row matching the current `main` session for its agent shows a `MAIN` tag.
- The currently-selected session row is highlighted (accent).
- Collapsed sidebar hides the section (consistent with existing collapse
  behavior).

Data: fetch `GET /api/agents/sessions`. Refresh on relevant file-change /
history-updated events (reuse `subscribeToFileChanges` / status subscriptions
already used elsewhere) so new and resumed sessions appear/update.

### Selection & navigation

- Clicking a row navigates to `/chat/<row.agentId>?session=<row.sessionId>`.
  If it's already the open agent, just update the `session` query param.
- `ChatView` reads the `session` query param:
  - If present: load that session's transcript (history fetched by explicit
    `sessionId`), subscribe to live updates by explicit `sessionId`, and send
    follow-ups with that `sessionId`. The `main` pointer is untouched.
  - If absent: current behavior — resolve and use the agent's `main` session.
- The chat header shows the agent + a short session id, and a `MAIN` indicator
  when the open session is `main` (mirrors prototype header).

### `+ New`

Sends `/new` to the agent's `main` key (existing reset path → rotates `main` to a
new `sessionId`), then selects the resulting session. Implementation can send
`/new` over the existing send flow with `sessionKey: "main"`, then read the new
`sessionId` from the `session_reset` event and navigate to
`/chat/:agentId?session=<newId>`.

### Per-session actions (v1)

- **Search/filter**: client-side over the loaded list.
- **Delete**: row action → `DELETE /api/agents/:agentId/sessions/:sessionId`;
  remove the row on success. If the deleted session is currently open, fall back
  to the agent's `main` (or empty state).
- **Rename**: row action → inline edit → `PATCH
  /api/agents/:agentId/sessions/:sessionId { title }`; update the row label on
  success.

## Multi-user

- All list/delete/rename/history/live operations are scoped to the requesting
  user's `userId` (via existing auth helpers and `getUserHistoryDir(userId, …)`).
- A user never sees or mutates another user's sessions.

## Acceptance Criteria

- The left sidebar shows a recency-grouped list of all the current user's past
  lead-agent sessions, newest first, across all agents.
- `scheduler:*`, `bench-*`, and content-empty sessions do not appear.
  `slack:*` / `webhook:* `/ `default` integration sessions do not appear.
- Clicking a session loads its transcript in the chat surface; clicking a session
  for a different agent navigates to that agent's chat with the session loaded.
- `/chat/:agentId?session=<sessionId>` deep-links to and restores a specific
  session.
- Opening `/chat/:agentId` with no `session` param loads the agent's `main`
  session (unchanged behavior).
- Sending a message into a resumed (non-main) session appends to that session,
  streams live in the UI, and does **not** change the agent's `main` pointer in
  `sessions.json`.
- Resuming a session older than the idle timeout still appends to it (no fork).
- `+ New` rotates `main` and opens the fresh session.
- Search filters the list; Delete removes a session (file + row, clearing the
  `main` pointer if it pointed at the deleted session); Rename sets a persisted
  title shown in the row.
- The row for an agent's current `main` session is tagged `MAIN`.
- Live streaming events reach the client when subscribed by explicit
  `sessionId` (WS subscribe accepts `sessionId`).

## Technical Notes / Touch Points

Backend:
- `apps/gateway/src/server/api.core.ts` — new `GET /api/agents/sessions`,
  `DELETE` / `PATCH /api/agents/:agentId/sessions/:sessionId`; extend
  `GET /api/agents/:id/history` to accept `sessionId`.
- `apps/gateway/src/server/ws-broker.ts` — accept explicit `sessionId` in
  `subscribe`; match `broadcastStreamEvent` / active-turn replay by `sessionId`.
- `apps/gateway/src/sessions/files.ts` — filename parse helpers (reuse/extend).
- `apps/gateway/src/history/store.ts` — `appendSessionMeta` for titles;
  `invalidateResolvedHistoryFile` on delete.
- `apps/gateway/src/sessions/store.ts` — `clearSessionEntry` on `main` delete.
- `@aihub/shared` WS message types — add optional `sessionId` to subscribe (and
  send already supports it).

Web:
- `apps/web/src/components/AgentSidebar.tsx` — session list section.
- `apps/web/src/components/ChatView.tsx` — read `session` query param; fetch
  history / subscribe / send by explicit `sessionId`.
- `apps/web/src/api/chat.ts` + WS client — pass `sessionId` through subscribe and
  send; new API client functions for list/delete/rename.

## E2E Validation

This feature surfaces every past lead-agent session in the left sidebar and lets
users resume any of them by explicit `sessionId` without moving the `main`
pointer. Unit tests cover filename parsing, filtering, and the WS matcher; this
validation proves the round-trip through the real gateway/UI: the list enumerates
real history files, deep-links restore a session, follow-ups stream live into a
resumed non-`main` session, and `main` in `sessions.json` is never touched.

### 1. Worktree + seed config (skip if already set up)

- Create `~/.worktrees/aihub/session-history` + `pnpm install` ONLY if not
  already inside a worktree. (This spec's branch is `session-history` — likely
  already in it; if so just `cd` there and `pnpm install` if `node_modules`
  missing.)
- `pnpm init-dev-config` ONLY if `$CWD/.aihub` is absent.
- Seed canary sessions so the list, grouping, filtering, and cross-agent click
  all have data. Use the dev CLI against the preview home:
  - Two agents with real `main` sessions (creates `<agentId>:main` in
    `sessions.json` + a history file each):
    ```bash
    AIHUB_HOME=$(pwd)/.aihub pnpm aihub:dev send --agent sally "First sally message — canary A"
    AIHUB_HOME=$(pwd)/.aihub pnpm aihub:dev send --agent rocky "First rocky message — canary B"
    ```
  - A rotated *older* session for `sally` (to prove resume-past-idle and a
    non-`main` row): send `/new` to rotate `main`, capturing that the prior
    `sessionId` now persists only as a file:
    ```bash
    AIHUB_HOME=$(pwd)/.aihub pnpm aihub:dev send --agent sally "/new"
    AIHUB_HOME=$(pwd)/.aihub pnpm aihub:dev send --agent sally "Second sally message — new main"
    ```
    The first sally file is now a non-`main` past session; the latest is `main`.
  - **Filtered-out** sessions — create history files that MUST NOT appear:
    a `scheduler:*` run, a `bench-*` run, a `slack:*` session, and an
    empty/system-only file. Write them directly into the user's history dir
    (`$(pwd)/.aihub/history/` single-user, or
    `$(pwd)/.aihub/sessions/users/<userId>/history/`) using the
    `<ts>_<agentId>-<sessionId>.jsonl` naming, e.g.
    `<ts>_sally-scheduler-nightly.jsonl`, `<ts>_sally-bench-001.jsonl`,
    `<ts>_sally-slack-c123.jsonl`, and an `<ts>_sally-empty.jsonl` containing
    only a system/setup entry (no user/assistant text). These prove the
    Filtering rules from files alone.
  - To exercise idle-rotation-on-resume, backdate one kept session's filename
    timestamp prefix (and its last entry) to older than the idle timeout
    (default 360 min) so resuming it would normally fork.

### 2. Unit tests

Run serially, one command at a time:

- `pnpm test:gateway` — expect filename-parse/filter helpers, the
  `GET /api/agents/sessions` route, DELETE/PATCH routes, the
  `?sessionId` history-fetch path, and the WS `subscribe`/`broadcastStreamEvent`
  `sessionId`-matching tests green.
- `pnpm test:shared` — expect WS message-type tests (optional `sessionId` on
  `subscribe`) green.
- `pnpm test:web` — expect AgentSidebar session-list + ChatView
  `?session`-param tests green.

### 3. Launch preview

`AIHUB_HOME=$(pwd)/.aihub pnpm dev` — note the auto-picked ports (gateway 4001+,
UI 3001+). Never touch the prod `~/.aihub` home.

For every browser/chat step below, drive the UI with **either** the
`playwright-cli` skill **or** the claude-in-chrome MCP tools
(`mcp__claude-in-chrome__*`). Capture numbered screenshots + DOM snapshots into
the repo-root `validation/` directory.

### 4. E2E steps

#### 4a. List renders, grouped, filtered (sidebar happy path)
1. Open the UI at `http://127.0.0.1:<ui_port>/`.
2. Assert: left sidebar shows a `Sessions` section between the nav and footer,
   with a `+ New` button and a search input.
3. Assert: rows are recency-grouped (Today / Yesterday / Earlier this week / …),
   newest first, **mixing sally + rocky** (not grouped by agent). Each row shows
   the agent-colored avatar, preview (`firstUserMessage`), and a meta line with
   relative time + agent name.
4. Assert (negative — Filtering): NO row for the `scheduler-*`, `bench-*`,
   `slack-*`, or empty canary files.
5. Assert: the latest sally session and the rocky session each carry a `MAIN`
   tag; the rotated older sally session does NOT.
6. Capture `validation/01-sidebar-list.png` + DOM snapshot of the `Sessions`
   section (rows + `MAIN` tag + group headers).

#### 4b. Default open loads `main` (unchanged behavior)
1. Navigate to `/chat/sally` (no `session` param).
2. Assert: the agent's current `main` transcript loads (the "Second sally
   message" turn), and the chat header shows the `MAIN` indicator.
3. Capture `validation/02-default-main.png`.

#### 4c. Select a past session → deep-link restores it
1. Click the rotated older sally row.
2. Assert: URL becomes `/chat/sally?session=<oldSessionId>`; transcript switches
   to that session ("First sally message"); header shows the short session id and
   NO `MAIN` indicator; the selected row is highlighted.
3. Reload the page at that URL directly. Assert: same session restored
   (deep-link works).
4. Capture `validation/03-resume-deeplink.png`.

#### 4d. Cross-agent click navigates
1. With sally's chat open, click the rocky row.
2. Assert: navigates to `/chat/rocky?session=<rockyMain>`; rocky transcript loads.
3. Capture `validation/04-cross-agent.png`.

#### 4e. Live resume into a non-`main` session — does NOT move `main` (the point)
1. Before sending, record `sessions.json[`sally:main`].sessionId` (read
   `$(pwd)/.aihub/sessions.json`, or
   `AIHUB_HOME=$(pwd)/.aihub pnpm aihub:dev agent list`).
2. Open `/chat/sally?session=<oldSessionId>` (the rotated, non-`main` session).
3. Send a follow-up message in the chat UI.
4. Assert: the reply **streams live** in the UI (text/tool/done events arrive —
   this exercises the WS `subscribe` carrying explicit `sessionId`); the message
   appends to the open transcript.
5. Assert (critical, negative): re-read `sessions.json` — `sally:main` sessionId
   is **unchanged**; the new turn landed in the old session's history file, not
   `main`'s.
6. Capture `validation/05-resume-live-stream.png`.

#### 4f. Resume past idle timeout — no fork
1. Open the backdated session (older than the 360-min idle timeout) via its
   `?session=<id>`.
2. Send a message; assert the turn appends to that **same** session file (no new
   `sessionId` minted, no rotation). Re-read the history dir: no new file for
   that agent appeared.
3. Capture `validation/06-resume-past-idle.png`.

#### 4g. `+ New` rotates `main` and opens fresh
1. Record current `sally:main` sessionId.
2. Click `+ New` (with sally context) — sends `/new` to `sally:main`.
3. Assert: URL becomes `/chat/sally?session=<newId>`; the new empty session opens
   and carries `MAIN`; `sessions.json[`sally:main`]` now points at `<newId>`
   (rotation happened); a new row appears in the list.
4. Capture `validation/07-new-session.png`.

#### 4h. Search filters client-side
1. Type a substring of one session's preview into the search input.
2. Assert: only matching rows remain; clear it → full list returns. No network
   call needed (client-side over the loaded list).
3. Capture `validation/08-search-filter.png`.

#### 4i. Rename persists a title
1. Trigger the row Rename action on the older sally session; set a title; confirm.
2. Assert: row label updates to the title immediately. Re-fetch
   `GET /api/agents/sessions` (or reload) → the row still shows the title (title
   stored as a `meta` entry in the session JSONL via `appendSessionMeta`, latest
   wins).
3. Assert (persistence): `tail` that session's `.jsonl` shows a `title` meta entry.
4. Capture `validation/09-rename.png`.

#### 4j. Delete removes file + row; clears `main` pointer when needed
1. Delete a **non-`main`** session via its row action →
   `DELETE /api/agents/sally/sessions/:sessionId`. Assert: row disappears; the
   `.jsonl` file is gone from the history dir; `sally:main` unchanged.
2. Delete the agent's **current `main`** session. Assert: row gone, file gone,
   AND `sessions.json[`sally:main`]` entry is cleared
   (`clearSessionEntry`) so a fresh `main` is minted on the next message. If that
   session was open, the UI falls back to `main`/empty state.
3. Send a new message to sally afterward; assert a brand-new `main` session+file
   is created.
4. Capture `validation/10-delete.png`.

#### 4k. Multi-user isolation (if multi-user extension enabled)
1. As user A, note the session list. As a different user B, assert B sees only
   B's own sessions and cannot list/delete/rename A's (scoped by
   `getUserHistoryDir(userId, …)`).
2. Capture `validation/11-multiuser-isolation.png`.

### 5. Artifacts

Required under `validation/`:
- `01-sidebar-list.png` … `11-multiuser-isolation.png` (drop `11` if multi-user
  is not enabled in the preview).
- DOM snapshot of the `Sessions` sidebar section (rows, group headers, `MAIN`
  tag, highlighted-selected row).
- DOM snapshot of the chat header in both states (with `MAIN` indicator vs. a
  resumed session showing the short session id).
- A before/after capture or note of `sessions.json[`sally:main`]` proving it is
  unchanged across 4e/4f and rotated across 4g.
