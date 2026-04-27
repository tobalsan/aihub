# 2026-04-27: Projects CLI moves under `aihub projects`

- Removed the standalone legacy project-manager command surface.
- Registered the existing projects CLI commands under gateway CLI as `aihub projects ...`.
- Removed root/package legacy script/bin entries and the old gateway direct projects wrapper.
- Updated project prompts, tests, README, and LLM docs to use `aihub projects ...`.
- Moved the projects CLI reference into `packages/extensions/projects/README.md`.
- Routed gateway CLI registration through `@aihub/extension-projects`.
