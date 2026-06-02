# Orchestrator UI redesign

Date: 2026-06-02
Scope: `/orchestrator` web dashboard visual/UX overhaul. Single file, no behavior/API change.

## Why

The dashboard was functional but barebones. Root cause of the rawness: the page
referenced CSS custom properties that do not exist in this app (`--border`, `--bg`,
`--surface`, `--danger`). They resolved to nothing, so borders vanished and buttons fell
back to unstyled browser defaults. The real tokens live in `apps/web/index.html` `:root`
(`--bg-base/surface/raised/inset`, `--border-default/subtle`, `--text-primary/secondary/
tertiary/muted`, accent purple `124,58,237`).

Other problems: the Run column showed the full composite id
(`orchestrator:<project>:<uuid>:<epoch>`) which bled across the table; outcomes were plain
uncolored text; daemon health was one gray sentence; timestamps were absolute only.

## What changed

Rewrote `apps/web/src/extensions/orchestrator/routes.tsx` (only changed file). Still a
self-contained route module with zero imports from the projects extension (extension
independence preserved); the clean projects run-history look was replicated inline, not
imported.

- Daemon status bar: green online pulse dot, status word, stat chips (active / recent /
  last tick as relative time). Dropped the Rate-limit chip; `OrchestratorHealth` carries no
  rate-limit field, so it would have been a permanent `—`.
- Active runs are live rows (not cards) per the chosen design: status pill, ticking elapsed
  from `claimedAt`, project chip, copyable short run hash, Open/Interrupt(⏸)/Kill(✕).
  Rows scale better than a card grid for the planned 5-10 concurrent runs. Warm empty state
  when idle. No fake "last activity" line: claims carry no event data, so nothing invented.
- Recent runs: grid rows with semantic status pill, Linear identifier, copyable short hash,
  project, relative start time, exit code. `exit 0` renders correctly (guarded `!= null`,
  not truthiness).
- Drawer: scrim + slide-in, styled tabs (Logs / Events / Workflow), mono log viewer with
  per-line tone, event cards, workflow viewer. Removed the old "Chat" tab; it was a
  duplicate event-stream dump and the PRD defers chat to the read-only event stream (the
  Events tab already serves that).
- Verbose outcomes shortened for the pill (`interrupted_gateway_restart` -> "interrupted",
  etc.); full raw outcome kept in the pill `title`. Pill clips with ellipsis so no label can
  overflow its column.
- Relative-time helper, 1s clock signal for ticking elapsed, styled buttons, real tokens
  throughout, mobile breakpoint at 720px.
- Status colors are theme-adaptive: `--orch-ok/warn/fail` defined on `.orch-root` (bright for
  dark) and overridden under `[data-theme="light"] .orch-root` (darker, for contrast).
  Pill backgrounds/borders derive from them via `color-mix`. Light + dark both verified.

## Verified

- `pnpm exec tsc -p apps/web/tsconfig.json --noEmit` clean.
- Browser preview at `http://127.0.0.1:3001/orchestrator`: light + dark themes, drawer open
  with live logs, pill collision fixed. No orchestrator web tests exist (grep clean).

## Follow-ups (not done)

- Active-run "last activity" preview would need the run detail/events fetched per active
  claim each tick; deferred to avoid N fetches per poll for 5-10 runs.
- Multi-project supervisor: a "projects" stat / per-project filter could use
  `fetchOrchestratorProjects()`; not added to keep scope tight.
