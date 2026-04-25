# Subagent CLI Config Handoff

Updated configured subagent templates to use `cli` instead of `harness`.

- `SubagentConfigSchema` now expects `cli`.
- Project subagent template resolution reads `template.cli`.
- Runtime `aihub subagents start --profile <name>` resolves extension profiles first, then top-level `subagents[]` templates.
- Top-level templates map `reasoning` to runtime `reasoningEffort`.
- Dev config and generated config template use `cli`.

Run checks before handoff:

- `pnpm test:shared`
- `pnpm test:gateway`
