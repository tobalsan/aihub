# Removable board/projects extensions

- Gateway no longer declares `@aihub/extension-board` or `@aihub/extension-projects` in `apps/gateway/package.json`.
- Gateway registry loads board/projects through runtime optional imports and reports clear missing-package errors when enabled.
- Project/slice CLI commands and `subagents profiles` avoid static project-extension imports.
- Board extension now declares `dependencies: ["projects", "subagents"]`.
- Web App no longer imports board/project UI components directly. Extension route wrappers live under `apps/web/src/extensions/{board,projects}/routes.tsx` and load only after capability checks.
