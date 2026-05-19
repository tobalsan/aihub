# Simplified agent workspace templates

- New agent workspaces now generate only `AGENTS.md`, `SOUL.md`, and `USER.md`.
- Removed `BOOTSTRAP.md`, `IDENTITY.md`, `TOOLS.md`, and `HEARTBEAT.md` templates from `docs/templates/`.
- Merged identity prompts into `SOUL.md`.
- First-run detection remains programmatic: `ensureWorkspaceFiles()` returns true when no core files existed, and Pi/container runs append a concise bootstrap instruction to system prompt for that launch only.
- Context injection now reads only `AGENTS.md`, `SOUL.md`, and `USER.md`; old files may remain on disk but are ignored by core context loading.
