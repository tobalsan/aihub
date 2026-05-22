# Update Models Agent YAML Discovery

- `pnpm update-models` now reads v3 agent directories listed in `aihub.json` and adds each `agent.yaml` model to the configured model set.
- Discovery is additive: models from inline legacy `aihub.json` agent objects, `$AIHUB_HOME/models.json`, and discovered `agent.yaml` files are unioned before OpenRouter/models.dev context lookup.
- Verified `AIHUB_HOME=$PWD/.aihub pnpm update-models` includes `.aihub/agents/devagent/agent.yaml` model `glm-5.1` plus the model from `.aihub/models.json`.

Verification:

- `pnpm exec vitest run scripts/update-models.test.ts`
- `AIHUB_HOME=$PWD/.aihub pnpm update-models`
