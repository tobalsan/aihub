# Slice detail thread and recent runs

S16 polished `SliceDetailPage`:

- Thread tab parses raw slice `THREAD.md` (`## <timestamp>` sections, plus optional `[author:]`/`[date:]` metadata) into read-only comment cards.
- Comment bodies still render through `renderMarkdown`.
- Empty thread state now says `No thread entries yet.`
- Recent Runs rows show relative timestamps from `lastActive`, falling back to `startedAt`; rows with no timestamp omit the time.

Validation:

- `pnpm exec vitest run apps/web/src/components/SliceDetailPage.test.tsx`
- `pnpm test:web`
- `pnpm typecheck`
