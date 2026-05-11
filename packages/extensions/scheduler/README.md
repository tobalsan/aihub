# Scheduler Extension

The `scheduler` extension is AIHub's built-in cron-like runner. It triggers a
configured agent on an interval or at a daily wall-clock time, persisting jobs
and their next-run state across restarts.

The extension is opt-in: add an `extensions.scheduler` block to the gateway
config to load it. The `heartbeat` extension depends on it and will not start
without it. The CLI for scheduling is HTTP-only — there is no `aihub scheduler`
command yet; use `curl` or any HTTP client against the gateway.

## What It Owns

- Two schedule kinds: interval (`everyMinutes`, optional anchor `startAt`) and
  daily (`HH:MM` with optional IANA `timezone`)
- Persisted job records and their `nextRunAtMs` / `lastRunAtMs` / `lastStatus`
- `/api/schedules` CRUD routes mounted by the gateway
- A single internal timer that wakes when the next job is due — no fixed
  polling cadence. When the queue is empty no timer is armed at all.
- Per-tick dispatch through `ExtensionContext.runAgent(...)` so scheduled runs
  flow through the same agent pipeline as web/Discord/CLI invocations

The scheduler does not own prompt selection, agent state, or message history.
It hands `{ agentId, message, sessionId }` to the runtime and records whether
the call succeeded.

## Storage

Jobs are stored in a single JSON file under `$AIHUB_HOME`:

```text
$AIHUB_HOME/schedules.json
```

Shape:

```json
{
  "version": 1,
  "jobs": [
    {
      "id": "9b1c...",
      "name": "Daily standup",
      "agentId": "my-agent",
      "enabled": true,
      "schedule": { "type": "daily", "time": "09:00", "timezone": "America/New_York" },
      "payload": { "message": "Generate standup summary" },
      "state": {
        "nextRunAtMs": 1730000000000,
        "lastRunAtMs": 1729913600000,
        "lastStatus": "ok"
      }
    }
  ]
}
```

Job ids are UUIDs minted on create. The file is rewritten atomically on every
add/update/remove and after each tick.

## Configuration

Enable the extension under `extensions.scheduler` in `$AIHUB_HOME/aihub.json`:

```json
{
  "extensions": {
    "scheduler": {
      "enabled": true
    }
  }
}
```

Options:

- `enabled` (boolean, default `true` when the block is present): set to `false`
  to load the extension but skip the runner loop. Useful for dev environments
  where you do not want scheduled work to fire.

Disabling at runtime: set `enabled: false` and restart the gateway. The
extension still owns the routes (so the UI does not 404), but `start()` short
-circuits with a `[scheduler] Disabled` log line.

### Heartbeat dependency

The `heartbeat` extension uses the scheduler to deliver periodic prompts. If
you enable `extensions.heartbeat`, also enable `extensions.scheduler` —
heartbeat will refuse to start otherwise.

## Schedule Types

### Interval

Runs every `everyMinutes` minutes. With no `startAt`, the first run fires
`everyMinutes` after the job is created. With `startAt`, runs are aligned to
that anchor:

```json
{ "type": "interval", "everyMinutes": 15 }
```

```json
{
  "type": "interval",
  "everyMinutes": 60,
  "startAt": "2026-05-11T09:00:00Z"
}
```

For an `everyMinutes: 60` job anchored to `09:00:00Z`, runs land at
`09:00`, `10:00`, `11:00`, ... in UTC regardless of when the job was created.

### Daily

Runs once per day at a fixed wall-clock `HH:MM`. An optional IANA `timezone`
overrides the gateway's local timezone; DST transitions are handled by
`Intl.DateTimeFormat`:

```json
{ "type": "daily", "time": "09:00", "timezone": "America/New_York" }
```

```json
{ "type": "daily", "time": "23:30" }
```

The second form runs at 23:30 in the gateway's local timezone.

## Execution Semantics

- A job fires only when its target agent is currently active. In single-agent
  mode the runner skips agents that aren't the active one, advances
  `nextRunAtMs`, and records nothing. This is intentional: scheduled traffic
  should not hijack the active agent.
- If the target agent id is unknown, the run is recorded with
  `lastStatus: "error"` and `lastError: "Agent not found"`. The next-run time
  is still advanced so the job does not livelock.
- Each fire sends `payload.message` through `runAgent({ agentId, message,
  sessionId })`. Default `sessionId` is `scheduler:<jobId>`, so all runs from a
  job share one session by default. Override `payload.sessionId` to merge into
  the agent's main session (e.g. `agent:<id>:main`) or any other key.
- `tick` is serialized: while one tick is running, additional timer firings are
  no-ops. Missed runs do not back-fill — only the next due time is computed.

## HTTP API

```http
GET    /api/schedules
POST   /api/schedules
PATCH  /api/schedules/:id
DELETE /api/schedules/:id
```

`GET /api/schedules` returns only enabled jobs.

### Create

```bash
curl -X POST localhost:4000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Hourly check",
    "agentId": "my-agent",
    "schedule": { "type": "interval", "everyMinutes": 60 },
    "payload": { "message": "Run hourly check" }
  }'
```

Response is the persisted `ScheduleJob` including its assigned `id`.

### Update

`PATCH` accepts any subset of `name`, `enabled`, `schedule`, `payload`. When
`schedule` changes, `nextRunAtMs` is recomputed from now:

```bash
curl -X PATCH localhost:4000/api/schedules/<id> \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

```bash
curl -X PATCH localhost:4000/api/schedules/<id> \
  -H "Content-Type: application/json" \
  -d '{ "schedule": { "type": "daily", "time": "08:00", "timezone": "Europe/London" } }'
```

### Delete

```bash
curl -X DELETE localhost:4000/api/schedules/<id>
```

Returns `404` if the id does not exist.

## Examples

### Hourly health check on an interval

```bash
curl -X POST localhost:4000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Hourly check",
    "agentId": "ops",
    "schedule": { "type": "interval", "everyMinutes": 60 },
    "payload": { "message": "Run the standard health check and summarize." }
  }'
```

### Daily 9am standup in New York time

```bash
curl -X POST localhost:4000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily standup",
    "agentId": "lead",
    "schedule": { "type": "daily", "time": "09:00", "timezone": "America/New_York" },
    "payload": { "message": "Generate the daily standup digest." }
  }'
```

### Aligned interval anchored to a start time

```bash
curl -X POST localhost:4000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Top of the hour",
    "agentId": "ops",
    "schedule": {
      "type": "interval",
      "everyMinutes": 60,
      "startAt": "2026-05-11T00:00:00Z"
    },
    "payload": { "message": "Hourly sweep." }
  }'
```

### Route runs into the agent's main session

By default each job uses `sessionId: "scheduler:<jobId>"`. Override it to merge
scheduled output into the agent's main thread so users see it in the chat
panel:

```bash
curl -X POST localhost:4000/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Morning briefing",
    "agentId": "lead",
    "schedule": { "type": "daily", "time": "08:00" },
    "payload": {
      "message": "Briefing time. Summarize overnight changes.",
      "sessionId": "agent:lead:main"
    }
  }'
```

### Pause a job without deleting it

```bash
curl -X PATCH localhost:4000/api/schedules/<id> \
  -H "Content-Type: application/json" \
  -d '{ "enabled": false }'
```

Re-enable with `{ "enabled": true }`; `nextRunAtMs` is recomputed from the time
of the patch.

## Operational Notes

- Schedules persist across gateway restarts; on boot the runner recomputes
  `nextRunAtMs` from now for every enabled job, so a job that was due during
  downtime fires once, soon after startup — not once per missed interval.
- `GET /api/schedules` hides disabled jobs. They remain in `schedules.json`
  and can be re-enabled via `PATCH`.
- The runner logs `[scheduler] Running job: <name> -> <agent>` per fire and
  `[scheduler] Job failed: <name>` with the underlying error on failure.
- `pnpm dev` disables the scheduler by default to keep the dev loop quiet.
