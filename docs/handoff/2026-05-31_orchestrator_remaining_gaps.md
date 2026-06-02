# Orchestrator remaining gaps

## TODO: manual claim should run full dispatch

PRD / slice 07 says manual claim mirrors dispatcher path while bypassing poll cadence.

Current state:
- `POST /api/orchestrator/issues/:issueId/claim` only reserves claim in memory + SQLite and emits claimed event.
- It does not fetch Linear issue, resolve workflow/repo/profile, prepare workspace, run hooks, start subagent, insert run row/events, or store `subagent_run_id`.

Needed:
- Add `LinearClient.getIssue(idOrIdentifier)` supporting UUID and human identifier (`ENG-123`).
- Add shared daemon method like `claimNow(idOrIdentifier)` using normal dispatch path.
- Route/CLI call that method.
- Preserve 409 on active claim race.

## TODO: dashboard spec completion

PRD / slice 09 expects a production `/orchestrator` runtime dashboard.

Current state:
- Route exists and is gated by orchestrator capability.
- Health header, active runs, recent runs, drawer skeleton, interrupt/kill buttons exist.
- Refresh uses 5s polling.

Needed:
- Add sidebar nav entry gated by `orchestrator` capability.
- Subscribe to `orchestrator.run.*` / `orchestrator.workflow.changed` WS events and refresh within ~1s.
- Implement drawer Logs tab with real follow/stream behavior.
- Implement Events tab using paginated SQLite events from backend route.
- Flesh out Workflow tab against resolved snapshot/body.
- Decide Chat tab v1 behavior: read-only event stream per PRD, not placeholder.

## TODO: complete hook lifecycle phases

PRD / slice 10 expects four lifecycle hooks: `after_create`, `before_run`, `after_run`, `before_remove`.

Current state:
- Generic `HookRunner` exists.
- Hook env strips `LINEAR_API_KEY`.
- stdout/stderr append to SQLite events.
- Daemon only calls `before_run`.

Needed:
- Call `after_create` once after fresh workspace creation.
- Call `after_run` after subagent completion with `AIHUB_EXIT_CODE` only for that phase.
- Call `before_remove` before workspace cleanup/kill.
- Preserve failure rules: `before_run` nonzero aborts dispatch; other hook failures log but do not abort.
- Surface hook events in dashboard drawer.

## TODO: Linear rate-limit handling

PRD / slices 01 and 13 require a shared Linear rate-limit bucket.

Current state:
- `LinearClient` records `x-ratelimit-remaining` for health only.
- No request throttling.
- No 429 reset sleep/retry.

Needed:
- Parse `X-RateLimit-*` remaining/reset headers.
- Pause calls when bucket is depleted or near depletion.
- On 429, sleep until reset + 1s and retry or return a clear cooldown error.
- Ensure poll, exporter, and `orchestrator.linear_graphql` share the same client/bucket.

## TODO: Linear webhook accelerator

PRD / slice 14 expects webhook to wake daemon faster than polling while polling remains source of truth.

Current state:
- `POST /api/orchestrator/webhook` exists behind `webhook.enabled`.
- Route is a stub; no HMAC, no payload filtering, no tick enqueue.

Needed:
- Verify HMAC-SHA256 using `webhook.secret`; mismatch returns 401.
- Treat webhook payload as wake-up signal, not source of truth.
- Enqueue/coalesce an immediate daemon tick for relevant issue events.
- Keep regular poll timer as recovery path for missed webhooks.

## TODO: HITL burst notifications

PRD / slice 12 expects existing HITL burst behavior reused.

Current state:
- Burst buffer code exists in orchestrator package.
- Daemon calls `notify()` directly.

Needed:
- Route `needs_human`, `stalled`, `failed`, and `startup_error` through burst buffer.
- Resolve workflow `server.notify_channel` / config channel consistently.
- Collapse duplicate notifications within burst window.
- Add optional daily digest only when enabled.
