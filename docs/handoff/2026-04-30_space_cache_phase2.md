# PRO-234 Phase 2: Space Cache

Added `packages/extensions/projects/src/projects/space-cache.ts` with lazy `space.json`
reads, in-memory caching, `fs.watch` invalidation, negative caching for missing files,
malformed JSON warnings, and in-flight read dedupe.

Exported `SpaceFile`, `SpaceQueueEntry`, and `parseSpaceFile` from `space.ts` so the
cache reuses existing Space parsing/normalization instead of duplicating it.

Added `space-cache.test.ts` for missing files, parsed reads, cached object reuse,
watch invalidation, malformed JSON, deletion, targeted/global invalidation, and
concurrent read dedupe.
