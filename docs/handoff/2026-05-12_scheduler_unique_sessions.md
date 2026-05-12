# Scheduler unique sessions

- Changed scheduler default session routing so each job fire uses a fresh `scheduler:<jobId>:<runId>` session.
- Kept explicit `payload.sessionId` behavior unchanged for intentional session merging.
- Updated scheduler docs and LLM context with the new default.
