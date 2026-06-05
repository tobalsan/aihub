# Orchestrator skip logging

- Removed runless DB persistence approach for dispatch skips.
- Kept existing in-process `orchestrator.run.event` emission.
- Added concise process log line for dispatch skips.
- Verified orchestrator tests pass.
