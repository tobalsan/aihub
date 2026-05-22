# Auto Compact UX

- Auto/manual compaction now forces the transcript to scroll to the bottom when `Compacting context...`, success, or error status is shown.
- Compaction rewrites retained assistant turns without old `meta.usage`, so the context indicator recomputes from the compacted session instead of staying red from the pre-compaction peak.
- The context warning now appears at 75%+ and uses the copy: `Context usage is high, consider compacting by sending "/compact". Context will be auto-compacted above 80%.`

Verification:

- `pnpm exec vitest run apps/gateway/src/history/compact.test.ts apps/web/src/components/ChatView.test.tsx`
- `pnpm exec tsc -b`
- Browser reload confirmed warning copy and red indicator at high usage.
