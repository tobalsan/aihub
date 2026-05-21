# Sidebar Dev Badge Toggle

- Expanded collapsed sidebar header now lets the brand text shrink with ellipsis.
- `DEV` badge and collapse toggle keep fixed width so the toggle stays visible.
- Verification: `pnpm exec vitest run apps/web/src/components/AgentSidebar.test.tsx` passes.
- Browser check on `/agents`: hover-expanded sidebar shows both `DEV` and the collapse button inside the header.
