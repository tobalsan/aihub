# ChatView streaming flicker fix

## Symptom
Streaming assistant messages "flashed like hell" in full and simple modes —
each incoming chunk caused the entire streaming message DOM to remount,
re-firing the `message-in` fade-in CSS animation per chunk.

## Root causes (two compounding bugs)

1. **`streamingBlocks.length` used on a `createSignal` accessor.**
   `streamingBlocks` is a signal getter (function); `signal.length` returns
   the function arity (always `0`). This broke every conditional that gated
   streaming UI on block count and prevented the scroll/reactive effect from
   tracking block changes.

2. **`<For each={streamingBlocks()}>` keyed by item identity, but the text
   block object was rebuilt on every chunk** via
   `{...last, text: last.text + chunk}`. New identity ⇒ `<For>` unmounted
   and remounted the block's DOM container ⇒ `message-in` animation
   re-triggered on every chunk.

## Fix
- Fixed all `streamingBlocks.length` call sites to `streamingBlocks().length`.
- Swapped both `<For>` loops over `streamingBlocks()` to `<Index>`. `<Index>`
  keys by position, so the outer `.message` / `.block-text` container stays
  mounted across chunks; only inner reactive reads (`block.text`,
  `block.status`, etc.) update. The fade-in animation now fires once per
  block instead of once per chunk.
- Inner appenders (`appendStreamingTextBlock`, `appendStreamingThinkingBlock`,
  etc.) keep immutable signal updates so `block.*` reads inside `<Index>`'s
  accessor stay reactive.

## Notes
- A previous attempt switched `streamingBlocks` to `createStore`. In Solid
  1.9.3 a root-level array store's `<For each={store}>` did not propagate
  `length` changes (verified via DOM mutation observer in dev). The
  `<Index>` + signal combination avoids that pitfall entirely.
- Inner `.content markdown-content` still re-parses HTML once per chunk
  (innerHTML reset). It no longer remounts the surrounding `.message` element
  so it does not re-trigger CSS animations. If markdown re-parse becomes a
  performance concern for large streams, throttle via `requestAnimationFrame`.

## Validation
- `pnpm exec vitest run apps/web/src/components/ChatView.test.tsx` — 8 passed.
- Manual: opened `/chat/roddy` in Chrome with a `MutationObserver`
  installed; sent "List your tools". During streaming, `.message` mounts =
  1 (placeholder dots only); only `.content markdown-content` inner
  children mutate per chunk. No `message-in` re-fire.
