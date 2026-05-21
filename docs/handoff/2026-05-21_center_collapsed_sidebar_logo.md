# Center Collapsed Sidebar Logo

- Collapsed `AgentSidebar` header now centers the logo mark and hides both brand text spans.
- Hover-expanded sidebar still restores the full header content.
- Verification: `pnpm exec vitest run apps/web/src/components/AgentSidebar.test.tsx` passes.
- Browser check on `/agents`: collapsed non-hover state has logo visible, `logo-full` hidden, and `logo-short` hidden.
