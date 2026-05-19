# Heartbeat output capture

- Heartbeat keeps existing duration timer architecture; full scheduler-job unification deferred.
- Heartbeat now noops with a warning when scheduler extension is disabled or unavailable.
- Successful/failed heartbeat runs write hybrid markdown output to `<workspace>/cron/output/__heartbeat__/YYYY-MM-DD_HH-mm-ss.md` using scheduler output helper.
- Output includes YAML frontmatter (`run_type: heartbeat`, `result_status`) plus `# Heartbeat`, `## Prompt`, and `## Response`/`## Error` sections.
- `HEARTBEAT.md` prompt resolution and ack/delivery behavior preserved.
