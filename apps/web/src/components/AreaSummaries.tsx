import { createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { fetchAreaSummaries, toggleAreaHidden } from "../api/client";
import { renderMarkdown } from "../lib/markdown";
import type { AreaSummary } from "../api/types";

export function AreaSummaries() {
  const [summaries, setSummaries] = createSignal<AreaSummary[]>([]);
  const [open, setOpen] = createSignal(true);
  const [expandedCards, setExpandedCards] = createSignal<Set<string>>(new Set());
  const [error, setError] = createSignal<string | null>(null);

  async function load() {
    try {
      const items = await fetchAreaSummaries();
      setSummaries(items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  onMount(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    onCleanup(() => window.clearInterval(timer));
  });

  // All non-hidden areas are visible (even if empty)
  const visible = () => summaries().filter((a) => !a.hidden);

  const hasContent = (a: AreaSummary) =>
    a.recentlyDone.trim().length > 0 || a.whatsNext.trim().length > 0;

  const toggleCard = (id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function hideArea(id: string) {
    try {
      await toggleAreaHidden(id, true);
      await load();
    } catch {
      // silently fail
    }
  }

  return (
    <section class="area-summaries">
      <button
        class="as-header"
        onClick={() => setOpen(!open())}
        aria-expanded={open()}
      >
        <span class={`as-caret ${open() ? "open" : ""}`}>▸</span>
        <span class="as-title">Area Summaries</span>
        <span class="as-count">{visible().length}</span>
        <span class="as-hint">
          <Show when={open()} fallback="click to expand">
            recent activity &amp; next steps
          </Show>
        </span>
      </button>

      <Show when={error()}>
        <div class="as-error">{error()}</div>
      </Show>

      <Show when={open()}>
        <Show
          when={visible().length > 0}
          fallback={
            <div class="as-empty">No areas configured yet.</div>
          }
        >
          <div class="as-grid">
            <For each={visible()}>
              {(area) => {
                const isExpanded = () => expandedCards().has(area.id);
                const hasDone = () => area.recentlyDone.trim().length > 0;
                const hasNext = () => area.whatsNext.trim().length > 0;
                const empty = () => !hasContent(area);
                return (
                  <article
                    class={`as-card ${empty() ? "as-card-empty" : ""}`}
                    style={{ "--area-color": area.color }}
                  >
                    <header class="as-card-header">
                      <button
                        class="as-card-toggle"
                        onClick={() => !empty() && toggleCard(area.id)}
                        aria-expanded={isExpanded()}
                        style={{ cursor: empty() ? "default" : "pointer" }}
                      >
                        <span class="as-dot" />
                        <span class="as-card-title">{area.title}</span>
                        <span class="as-card-id">{area.id}</span>
                        <Show when={!empty()}>
                          <span class={`as-card-caret ${isExpanded() ? "open" : ""}`}>
                            ▸
                          </span>
                        </Show>
                      </button>
                      <button
                        class="as-hide-btn"
                        onClick={() => hideArea(area.id)}
                        title={`Hide ${area.title}`}
                        aria-label={`Hide ${area.title}`}
                      >
                        ×
                      </button>
                    </header>

                    <Show when={isExpanded() && !empty()}>
                      <div class="as-card-body">
                        <Show when={hasDone()}>
                          <div class="as-section">
                            <div class="as-section-label">
                              <span class="as-label-dot as-label-dot-done" />
                              Recently Done
                            </div>
                            <div
                              class="as-section-content"
                              innerHTML={renderMarkdown(area.recentlyDone)}
                            />
                          </div>
                        </Show>

                        <Show when={hasNext()}>
                          <div class="as-section">
                            <div class="as-section-label">
                              <span class="as-label-dot as-label-dot-next" />
                              What's Next
                            </div>
                            <div
                              class="as-section-content"
                              innerHTML={renderMarkdown(area.whatsNext)}
                            />
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </article>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>

      <style>{`
        .area-summaries {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--border-default);
          margin-bottom: 16px;
        }

        .as-header {
          display: flex;
          align-items: center;
          gap: 8px;
          background: transparent;
          border: 0;
          padding: 4px 0;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.01em;
          cursor: pointer;
          text-align: left;
        }
        .as-header:hover .as-title {
          color: var(--text-accent, #6366f1);
        }

        .as-caret {
          display: inline-block;
          width: 10px;
          color: var(--text-secondary);
          font-size: 10px;
          transition: transform 120ms ease;
        }
        .as-caret.open {
          transform: rotate(90deg);
        }

        .as-title {
          color: var(--text-primary);
        }

        .as-count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 18px;
          height: 18px;
          padding: 0 6px;
          border-radius: 9px;
          background: color-mix(in srgb, var(--text-primary) 8%, transparent);
          color: var(--text-secondary);
          font-size: 11px;
          font-weight: 500;
        }

        .as-hint {
          margin-left: auto;
          color: var(--text-secondary);
          font-size: 11px;
          font-weight: 400;
          letter-spacing: 0;
        }

        .as-error {
          color: #f87171;
          font-size: 13px;
          padding: 8px 12px;
          border: 1px solid color-mix(in srgb, #f87171 35%, var(--border-default));
          border-radius: 6px;
          background: color-mix(in srgb, #f87171 8%, var(--bg-surface));
        }

        .as-empty {
          padding: 14px 0 4px;
          color: var(--text-secondary);
          font-size: 12px;
        }

        /* Fixed grid: equal-height rows, cards don't push neighbours */
        .as-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 10px;
          align-items: start;
        }

        .as-card {
          position: relative;
          display: flex;
          flex-direction: column;
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: 6px;
          overflow: hidden;
        }
        .as-card::before {
          content: "";
          position: absolute;
          inset: 0 0 auto 0;
          height: 2px;
          background: var(--area-color);
          opacity: 0.85;
        }

        .as-card-empty {
          opacity: 0.55;
        }

        .as-card-header {
          display: flex;
          align-items: center;
          padding: 0;
        }

        .as-card-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 0;
          padding: 10px 4px 8px 12px;
          background: transparent;
          border: 0;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 12px;
          text-align: left;
        }
        .as-card-toggle:hover {
          background: color-mix(in srgb, var(--text-primary) 4%, transparent);
        }

        .as-hide-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          margin: 4px 6px 0 0;
          padding: 0;
          background: transparent;
          border: 0;
          border-radius: 4px;
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1;
          cursor: pointer;
          opacity: 0;
          transition: opacity 120ms ease, background 120ms ease;
        }
        .as-card:hover .as-hide-btn {
          opacity: 0.5;
        }
        .as-hide-btn:hover {
          opacity: 1 !important;
          background: color-mix(in srgb, var(--text-primary) 8%, transparent);
          color: var(--text-primary);
        }

        .as-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--area-color);
          flex-shrink: 0;
        }

        .as-card-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .as-card-id {
          color: var(--text-secondary);
          font-size: 11px;
          font-weight: 400;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }

        .as-card-caret {
          margin-left: auto;
          color: var(--text-secondary);
          font-size: 10px;
          transition: transform 120ms ease;
        }
        .as-card-caret.open {
          transform: rotate(90deg);
        }

        .as-card-body {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 4px 12px 12px;
        }

        .as-section {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .as-section-label {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--text-secondary);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .as-label-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
        }
        .as-label-dot-done {
          background: color-mix(in srgb, var(--area-color) 70%, var(--text-secondary));
        }
        .as-label-dot-next {
          background: var(--text-accent, #6366f1);
        }

        .as-section-content {
          color: var(--text-primary);
          font-size: 12px;
          line-height: 1.55;
        }
        .as-section-content ul,
        .as-section-content ol {
          margin: 0;
          padding-left: 16px;
        }
        .as-section-content li {
          margin: 2px 0;
        }
        .as-section-content p {
          margin: 0 0 4px;
        }
        .as-section-content p:last-child {
          margin-bottom: 0;
        }
        .as-section-content code {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          padding: 1px 4px;
          border-radius: 3px;
          background: color-mix(in srgb, var(--text-primary) 8%, transparent);
        }
      `}</style>
    </section>
  );
}
