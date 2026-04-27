# 2026-04-27 Subagent Runtime Log Filter

## Update

- Subagent log reads now hide noisy Codex/Claude CLI lifecycle/progress records:
  `thread.started`, `turn.started`, `turn.completed`, non-display item events,
  Claude system/rate-limit envelopes, and known internal Codex stderr
  warnings/errors.
- Claude assistant/result JSONL records are normalized into plain assistant text
  so monitor history does not render generic runtime-event fallback rows.
- Claude `tool_use`/`tool_result` blocks are normalized as monitor tool
  calls/outputs so history stays comparable to Codex command events.
- Raw `logs.jsonl` is still preserved for debugging and session id capture.
- `latestOutput` derivation now ignores hidden runtime noise so run cards show
  useful agent output instead of Codex warnings.
- The Agent Monitor refresh action now reloads expanded run logs from the
  beginning, replacing any stale client-side runtime-event rows after the
  gateway normalizer changes.
- Added regression coverage in `packages/extensions/subagents/src/runtime.test.ts`.
