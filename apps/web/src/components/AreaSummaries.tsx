import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { fetchAreaSummaries, toggleAreaHidden, updateAreaLoop } from "../api";
import { renderMarkdown } from "../lib/markdown";
import type { AreaSummary } from "../api/types";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AreaSummaries() {
  const [summaries, setSummaries] = createSignal<AreaSummary[]>([]);
  const [open, setOpen] = createSignal(true);
  const [expandedCards, setExpandedCards] = createSignal<Set<string>>(new Set());
  const [editingCard, setEditingCard] = createSignal<string | null>(null);
  const [editText, setEditText] = createSignal("");
  const [saving, setSaving] = createSignal(false);
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

  function startEditing(area: AreaSummary) {
    // Build the textarea content from current state
    let text = "";
    if (area.recentlyDone.trim()) {
      text += area.recentlyDone.trim() + "\n";
    }
    if (area.whatsNext.trim()) {
      if (text) text += "\n";
      text += "Next:\n" + area.whatsNext.trim() + "\n";
    }
    setEditText(text);
    setEditingCard(area.id);
    // Make sure card is expanded
    setExpandedCards((prev) => {
      const next = new Set(prev);
      next.add(area.id);
      return next;
    });
  }

  async function saveEdit(areaId: string) {
    setSaving(true);
    try {
      await updateAreaLoop(areaId, todayStr(), editText().trim());
      setEditingCard(null);
      setEditText("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditingCard(null);
    setEditText("");
  }

  function handleKeyDown(e: KeyboardEvent, areaId: string) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void saveEdit(areaId);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
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
                const isEditing = () => editingCard() === area.id;
                const hasDone = () => area.recentlyDone.trim().length > 0;
                const hasNext = () => area.whatsNext.trim().length > 0;
                const empty = () => !hasContent(area);
                return (
                  <article
                    class={`as-card ${empty() && !isEditing() ? "as-card-empty" : ""}`}
                    style={{ "--area-color": area.color }}
                  >
                    <header class="as-card-header">
                      <button
                        class="as-card-toggle"
                        onClick={() => toggleCard(area.id)}
                        aria-expanded={isExpanded()}
                      >
                        <span class="as-dot" />
                        <span class="as-card-title">{area.title}</span>
                        <span class="as-card-id">{area.id}</span>
                        <span class={`as-card-caret ${isExpanded() ? "open" : ""}`}>
                          ▸
                        </span>
                      </button>
                      <div class="as-card-actions">
                        <Show when={!isEditing()}>
                          <button
                            class="as-action-btn as-edit-btn"
                            onClick={() => startEditing(area)}
                            title="Edit"
                            aria-label={`Edit ${area.title}`}
                          >
                            ✎
                          </button>
                        </Show>
                        <button
                          class="as-action-btn as-hide-btn"
                          onClick={() => hideArea(area.id)}
                          title={`Hide ${area.title}`}
                          aria-label={`Hide ${area.title}`}
                        >
                          ×
                        </button>
                      </div>
                    </header>

                    <Show when={isExpanded()}>
                      <Show
                        when={!isEditing()}
                        fallback={
                          <div class="as-card-body as-edit-body">
                            <div class="as-edit-date">[[{todayStr()}]]</div>
                            <textarea
                              class="as-textarea"
                              value={editText()}
                              onInput={(e) => setEditText(e.currentTarget.value)}
                              onKeyDown={(e) => handleKeyDown(e, area.id)}
                              placeholder="What was done today?\n\nNext:\n- what's coming up"
                              autofocus
                              rows={8}
                            />
                            <div class="as-edit-actions">
                              <span class="as-edit-hint">⌘↵ save · esc cancel</span>
                              <button
                                class="as-btn as-btn-cancel"
                                onClick={cancelEdit}
                                disabled={saving()}
                              >
                                Cancel
                              </button>
                              <button
                                class="as-btn as-btn-save"
                                onClick={() => void saveEdit(area.id)}
                                disabled={saving()}
                              >
                                {saving() ? "Saving…" : "Save"}
                              </button>
                            </div>
                          </div>
                        }
                      >
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

                          <Show when={empty()}>
                            <div class="as-empty-body">No activity yet</div>
                          </Show>
                        </div>
                      </Show>
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
          opacity: 0.6;
        }
        .as-card-empty:hover {
          opacity: 0.8;
        }

        .as-empty-body {
          color: var(--text-secondary);
          font-size: 11px;
          font-style: italic;
          padding: 2px 0 4px;
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
          cursor: pointer;
          text-align: left;
        }
        .as-card-toggle:hover {
          background: color-mix(in srgb, var(--text-primary) 4%, transparent);
        }

        .as-card-actions {
          display: flex;
          align-items: center;
          gap: 2px;
          margin: 4px 6px 0 0;
        }

        .as-action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
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
        .as-card:hover .as-action-btn {
          opacity: 0.5;
        }
        .as-action-btn:hover {
          opacity: 1 !important;
          background: color-mix(in srgb, var(--text-primary) 8%, transparent);
          color: var(--text-primary);
        }

        .as-edit-btn {
          font-size: 13px;
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

        /* Edit mode */
        .as-edit-body {
          gap: 8px;
        }

        .as-edit-date {
          color: var(--text-secondary);
          font-size: 11px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-weight: 500;
        }

        .as-textarea {
          width: 100%;
          min-height: 100px;
          padding: 8px 10px;
          background: var(--bg-raised, #1a1a2e);
          color: var(--text-primary);
          border: 1px solid var(--border-default);
          border-radius: 4px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px;
          line-height: 1.55;
          resize: vertical;
          box-sizing: border-box;
        }
        .as-textarea:focus {
          outline: none;
          border-color: var(--text-accent, #6366f1);
        }
        .as-textarea::placeholder {
          color: var(--text-secondary);
          opacity: 0.5;
        }

        .as-edit-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: flex-end;
        }

        .as-edit-hint {
          margin-right: auto;
          color: var(--text-secondary);
          font-size: 10px;
          opacity: 0.7;
        }

        .as-btn {
          padding: 4px 12px;
          border: 1px solid var(--border-default);
          border-radius: 4px;
          font-family: inherit;
          font-size: 12px;
          cursor: pointer;
          transition: background 120ms ease;
        }
        .as-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .as-btn-cancel {
          background: transparent;
          color: var(--text-secondary);
        }
        .as-btn-cancel:hover:not(:disabled) {
          background: color-mix(in srgb, var(--text-primary) 6%, transparent);
        }
        .as-btn-save {
          background: var(--text-accent, #6366f1);
          color: #fff;
          border-color: transparent;
        }
        .as-btn-save:hover:not(:disabled) {
          filter: brightness(1.1);
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
