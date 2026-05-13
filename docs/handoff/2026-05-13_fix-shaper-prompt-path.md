# Fix Shaper Prompt Path

- Fixed orchestrator shaper prompt template lookup to read from `AIHUB_HOME/prompts`.
- Added regression coverage for gateway cwd differing from `AIHUB_HOME`.
- Verified `packages/extensions/projects/src/orchestrator/index.test.ts` passes.
