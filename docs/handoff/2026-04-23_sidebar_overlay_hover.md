# 2026-04-23: Sidebar hover overlay

- Updated `apps/web/src/components/AgentSidebar.tsx` and `apps/web/src/components/ContextPanel.tsx` so collapsed desktop sidebars keep a fixed 50px layout rail and expand on hover from an absolutely positioned inner shell.
- Result: hover peeks overlap the main content instead of compressing the center column.
- Mobile behavior stays the same: the left sidebar still slides fully off-canvas when collapsed, and the right context panel remains hidden on mobile.
- Docs updated in `docs/llms.md` and `README.md`.
