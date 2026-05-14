# 2026-05-14 default project manager

- Added top-level `defaultProjectManager?: string` to `GatewayConfigSchema`.
- Added shared `resolveDefaultProjectManager()` with warn-once invalid-id fallback to first agent, returning `null` for empty agent lists.
- `/api/agents` now marks the visible default with `isDefaultProjectManager` and still returns `[]` for empty visible-agent configs.
- Board home selection now resolves valid localStorage preference, then the API default marker, then first agent through `selectDefaultProjectManagerAgent()`.
