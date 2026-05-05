# Merger Conflict HITL Escalation

- Added explicit `aihub slices merger-conflict <sliceId> "<summary>"` metadata for irrecoverable Merger outcomes.
- Orchestrator now emits `merger_conflict` HITL events, parks matching `ready_to_merge` slices, and skips Merger respawn until humans clear/change state.
- Merger comments that match `Merge conflict - needs human:` remain a fallback signal, but they do not overwrite explicit `merger_outcome` metadata.
- Moving a slice away from `ready_to_merge` clears old `merger_conflict` metadata so human remediation can re-enter the normal flow.
- Enabled orchestrator daemons now require `hitl_channel` to reference `notifications.channels`.
