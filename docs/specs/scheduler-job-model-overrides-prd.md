# Scheduler Job Model Overrides PRD

## Problem Statement

Scheduled agent jobs currently always run with the agent's default runtime model. Users cannot pin a cron job to a different provider/model without changing the whole agent config, which makes recurring jobs harder to tune for cost, latency, or quality.

## Solution

Allow scheduler job files to declare an optional top-level `model` override. When present, scheduled fires use that provider/model instead of the agent default. Existing jobs without `model` continue using the agent default.

## User Stories

1. As an AIHub operator, I want a scheduled job to use a specific model, so that recurring work can use different cost/quality tradeoffs than interactive chat.
2. As an AIHub operator, I want the override stored in the job file, so that job behavior is explicit and portable.
3. As an AIHub operator, I want invalid model config rejected on load/save, so that bad scheduled jobs fail early instead of during an unattended run.
4. As an AIHub operator, I want existing jobs without model overrides to keep working, so that upgrades do not require migration.
5. As an AIHub operator, I want run history metadata to show the actual override model, so that I can audit which model ran the job.
6. As an AIHub maintainer, I want one per-run model override contract, so that Pi direct and container runs share behavior.
7. As an AIHub maintainer, I want focused scheduler/runtime tests, so that future adapter changes do not break scheduled model selection.

## Implementation Decisions

- Add optional top-level scheduler job `model` config with shape `{ provider, model }`.
- If `model` is present, both `provider` and `model` are required.
- Missing job `model` means use the agent default model. No migration or backfill.
- Scheduler job validation rejects malformed or unknown model config on load/save.
- Scheduled runs pass the job-level model override through the agent run contract.
- Runtime model resolution uses the override when present, otherwise the agent default.
- Pi direct and container scheduled runs must support the override. Other runtime adapters should use the same contract where applicable.
- Assistant history/model metadata reflects the actual model used for the scheduled run.
- Update user-facing and LLM docs: root README, scheduler README, and `docs/llms.md`.

## Testing Decisions

- Test externally visible behavior, not adapter internals.
- Scheduler schema/store tests cover accepting valid job `model`, rejecting partial/invalid model config, and preserving old jobs without `model`.
- Scheduler service tests cover passing the override into scheduled runs.
- Runtime tests cover fallback to agent default when no override exists.
- Container path tests cover serialized container input using the override model.
- History/stream tests should assert emitted model metadata shows the actual override where existing fixtures make that practical.

## Out of Scope

- Adding model override controls to web UI.
- Auto-migrating existing `cron/jobs.json` files.
- Allowing partial overrides such as model-only or provider-only.
- Changing interactive chat model selection.
- Adding new provider/model registry behavior beyond validation needed for scheduler jobs.

## Further Notes

This feature should stay small: schema, validation, per-run override propagation, adapter resolution, docs, tests.
