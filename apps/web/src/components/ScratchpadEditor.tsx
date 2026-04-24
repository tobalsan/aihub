import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { renderMarkdown } from "../lib/markdown";

const SCRATCHPAD_ENDPOINT = "/api/board/scratchpad";
const PLACEHOLDER = "Start typing... Markdown supported.";

function formatRelativeTime(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "just now";

  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

export function ScratchpadEditor() {
  const [rawMarkdown, setRawMarkdown] = createSignal("");
  const [savedContent, setSavedContent] = createSignal("");
  const [updatedAt, setUpdatedAt] = createSignal("");
  const [isEditing, setIsEditing] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [relativeNow, setRelativeNow] = createSignal(Date.now());

  let editorRef: HTMLDivElement | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let saveInFlight = false;
  let pendingSaveContent: string | null = null;

  function renderDisplay() {
    if (!editorRef || isEditing()) return;
    editorRef.innerHTML = rawMarkdown().trim()
      ? renderMarkdown(rawMarkdown())
      : "";
  }

  async function loadScratchpad() {
    const response = await fetch(SCRATCHPAD_ENDPOINT);
    if (!response.ok) return;

    const data = (await response.json()) as {
      content?: string;
      updatedAt?: string;
    };
    const nextContent = data.content ?? "";
    const nextUpdatedAt = data.updatedAt ?? "";

    setRawMarkdown(nextContent);
    setSavedContent(nextContent);
    setUpdatedAt(nextUpdatedAt);
  }

  async function flushSave(content: string): Promise<void> {
    if (saveInFlight) {
      pendingSaveContent = content;
      return;
    }

    saveInFlight = true;
    setSaving(true);

    try {
      const response = await fetch(SCRATCHPAD_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          ok?: boolean;
          updatedAt?: string;
        };
        setSavedContent(content);
        if (data.updatedAt) setUpdatedAt(data.updatedAt);
      }
    } finally {
      saveInFlight = false;
      const next = pendingSaveContent;
      pendingSaveContent = null;

      if (next !== null && next !== content && !disposed) {
        void flushSave(next);
      } else {
        setSaving(false);
      }
    }
  }

  function scheduleSave(content: string, delay = 500) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      void flushSave(content);
    }, delay);
  }

  async function pollScratchpad() {
    const response = await fetch(SCRATCHPAD_ENDPOINT);
    if (!response.ok) return;

    const data = (await response.json()) as {
      content?: string;
      updatedAt?: string;
    };
    const remoteContent = data.content ?? "";
    if (
      remoteContent !== savedContent() &&
      rawMarkdown() === savedContent() &&
      !isEditing()
    ) {
      setRawMarkdown(remoteContent);
      setSavedContent(remoteContent);
      setUpdatedAt(data.updatedAt ?? "");
    }
  }

  function handleFocus() {
    setIsEditing(true);
    if (editorRef) {
      editorRef.textContent = rawMarkdown();
    }
  }

  function handleInput() {
    if (!editorRef) return;
    const next = editorRef.textContent ?? "";
    setRawMarkdown(next);
    scheduleSave(next);
  }

  function handleBlur() {
    if (!editorRef) return;
    const next = editorRef.textContent ?? "";
    setRawMarkdown(next);
    setIsEditing(false);
    scheduleSave(next, 0);
  }

  createEffect(() => {
    if (isEditing()) return;
    renderDisplay();
  });

  void loadScratchpad();

  const pollTimer = setInterval(() => {
    void pollScratchpad();
  }, 5000);
  const relativeTimer = setInterval(() => setRelativeNow(Date.now()), 1000);

  onCleanup(() => {
    disposed = true;
    if (saveTimer) clearTimeout(saveTimer);
    clearInterval(pollTimer);
    clearInterval(relativeTimer);
  });

  return (
    <section class="scratchpad-editor">
      <header class="scratchpad-editor-header">
        <div class="scratchpad-editor-title">📝 Scratchpad</div>
        <div class="scratchpad-editor-status">
          <Show when={saving()}>
            <span>Saving...</span>
          </Show>
          <Show when={updatedAt()}>
            <span>
              Updated {relativeNow() && formatRelativeTime(updatedAt())}
            </span>
          </Show>
        </div>
      </header>

      <div
        ref={editorRef}
        class="scratchpad-editor-body"
        classList={{ editing: isEditing() }}
        contenteditable="true"
        role="textbox"
        aria-label="Scratchpad"
        data-placeholder={PLACEHOLDER}
        onFocus={handleFocus}
        onInput={handleInput}
        onBlur={handleBlur}
      />

      <style>{`
        .scratchpad-editor {
          min-height: 200px;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-base);
          color: var(--text-primary);
        }

        .scratchpad-editor-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 10px 0;
        }

        .scratchpad-editor-title {
          font-size: 14px;
          font-weight: 650;
          color: var(--text-primary);
        }

        .scratchpad-editor-status {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          min-height: 18px;
          font-size: 12px;
          color: var(--text-secondary);
          white-space: nowrap;
        }

        .scratchpad-editor-body {
          flex: 1 1 auto;
          min-height: 200px;
          padding: 14px;
          overflow: auto;
          border: 1px solid var(--border-default);
          border-radius: 8px;
          background: var(--bg-surface);
          color: var(--text-primary);
          font: inherit;
          line-height: 1.55;
          outline: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .scratchpad-editor-body:focus {
          border-color: var(--text-accent, #6366f1);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--text-accent, #6366f1) 24%, transparent);
        }

        .scratchpad-editor-body.editing {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          white-space: pre-wrap;
        }

        .scratchpad-editor-body:empty::before {
          content: attr(data-placeholder);
          color: var(--text-secondary);
          pointer-events: none;
        }

        .scratchpad-editor-body :first-child {
          margin-top: 0;
        }

        .scratchpad-editor-body :last-child {
          margin-bottom: 0;
        }

        .scratchpad-editor-body a {
          color: var(--text-accent, #6366f1);
        }

        .scratchpad-editor-body code,
        .scratchpad-editor-body pre {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        }

        .scratchpad-editor-body pre {
          overflow: auto;
          padding: 10px;
          border-radius: 6px;
          background: var(--bg-base);
        }
      `}</style>
    </section>
  );
}
