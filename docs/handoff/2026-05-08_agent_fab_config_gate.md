# Agent FAB config gate

- Added root config flag `agentFab` with schema default `false`.
- `/api/capabilities` now includes `agentFab` from loaded config.
- Web capabilities default/test helpers include `agentFab: false`.
- `App` gates the global quick chat FAB/overlay behind `capabilities.agentFab === true`, in addition to auth/login/chat-page checks.
- Updated README and LLM docs to document the opt-in behavior.
- Follow-up: added `agentFab: false` to projects extension fallback `GatewayConfig` literals used by migration/slices CLI helpers, fixing `@aihub/extension-projects` TypeScript build after `GatewayConfig` inference made the defaulted flag required.
- Follow-up: normalized the subagents extension test context helper to default `agentFab: false`, fixing `@aihub/extension-subagents` TypeScript build without repeating the flag in every test fixture.
