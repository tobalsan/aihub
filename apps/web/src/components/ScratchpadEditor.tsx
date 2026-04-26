import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";

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
  const [relativeNow, setRelativeNow] = createSignal(Date.now());

  let editorHostRef: HTMLDivElement | undefined;
  let editor: Editor | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let relativeTimer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let saveInFlight = false;
  let pendingSaveContent: string | null = null;

  function setEditorMarkdown(content: string) {
    editor?.commands.setContent(content, {
      contentType: "markdown",
      emitUpdate: false,
    });
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
    setEditorMarkdown(nextContent);
  }

  async function flushSave(content: string): Promise<void> {
    if (saveInFlight) {
      pendingSaveContent = content;
      return;
    }

    saveInFlight = true;

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
      !editor?.isFocused
    ) {
      setRawMarkdown(remoteContent);
      setSavedContent(remoteContent);
      setUpdatedAt(data.updatedAt ?? "");
      setEditorMarkdown(remoteContent);
    }
  }

  onMount(() => {
    if (!editorHostRef) return;

    editor = new Editor({
      element: editorHostRef,
      extensions: [
        StarterKit,
        Placeholder.configure({
          placeholder: PLACEHOLDER,
        }),
        Markdown,
      ],
      content: "",
      contentType: "markdown",
      editorProps: {
        attributes: {
          "aria-label": "Scratchpad",
        },
      },
      onUpdate: ({ editor: nextEditor }) => {
        const next = nextEditor.getMarkdown();
        setRawMarkdown(next);
        scheduleSave(next);
      },
      onBlur: ({ editor: nextEditor }) => {
        const next = nextEditor.getMarkdown();
        setRawMarkdown(next);
        scheduleSave(next, 0);
      },
    });

    void loadScratchpad();
    pollTimer = setInterval(() => {
      void pollScratchpad();
    }, 5000);
    relativeTimer = setInterval(() => setRelativeNow(Date.now()), 1000);
  });

  onCleanup(() => {
    disposed = true;
    if (saveTimer) clearTimeout(saveTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (relativeTimer) clearInterval(relativeTimer);
    editor?.destroy();
  });

  return (
    <section class="scratchpad-editor">
      <header class="scratchpad-editor-header">
        <div class="scratchpad-editor-status">
          <Show when={updatedAt()}>
            <span>
              Updated {relativeNow() && formatRelativeTime(updatedAt())}
            </span>
          </Show>
        </div>
      </header>

      <div ref={editorHostRef} class="scratchpad-editor-body" />

      <style>{`
        .scratchpad-editor {
          min-height: 200px;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: transparent;
          color: var(--text-primary);
        }

        .scratchpad-editor-header {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 0 8px;
          background: transparent;
        }

        .scratchpad-editor-status {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          min-height: 18px;
          width: 100%;
          font-size: 11px;
          color: var(--text-secondary);
          opacity: 0.72;
          white-space: nowrap;
        }

        .scratchpad-editor-body {
          flex: 1 1 auto;
          min-height: 200px;
        }

        .scratchpad-editor-body .ProseMirror {
          min-height: 200px;
          height: 100%;
          padding: 14px;
          overflow: auto;
          border: 0;
          background: transparent;
          color: var(--text-primary);
          font: inherit;
          line-height: 1.55;
          outline: none;
          white-space: normal;
        }

        .scratchpad-editor-body .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          height: 0;
          color: var(--text-secondary);
          pointer-events: none;
        }

        .scratchpad-editor-body .ProseMirror :first-child {
          margin-top: 0;
        }

        .scratchpad-editor-body .ProseMirror :last-child {
          margin-bottom: 0;
        }

        .scratchpad-editor-body .ProseMirror a {
          color: var(--text-accent, #6366f1);
        }

        .scratchpad-editor-body .ProseMirror p,
        .scratchpad-editor-body .ProseMirror ul,
        .scratchpad-editor-body .ProseMirror ol,
        .scratchpad-editor-body .ProseMirror blockquote,
        .scratchpad-editor-body .ProseMirror pre {
          margin: 0 0 12px;
        }

        .scratchpad-editor-body .ProseMirror h1,
        .scratchpad-editor-body .ProseMirror h2,
        .scratchpad-editor-body .ProseMirror h3 {
          margin: 18px 0 8px;
          line-height: 1.2;
        }

        .scratchpad-editor-body .ProseMirror h1 {
          font-size: 28px;
        }

        .scratchpad-editor-body .ProseMirror h2 {
          font-size: 23px;
        }

        .scratchpad-editor-body .ProseMirror h3 {
          font-size: 19px;
        }

        .scratchpad-editor-body .ProseMirror ul,
        .scratchpad-editor-body .ProseMirror ol {
          padding-left: 24px;
        }

        .scratchpad-editor-body .ProseMirror blockquote {
          padding-left: 12px;
          border-left: 3px solid var(--text-accent, #6366f1);
          color: var(--text-secondary);
        }

        .scratchpad-editor-body .ProseMirror code,
        .scratchpad-editor-body .ProseMirror pre {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        }

        .scratchpad-editor-body .ProseMirror pre {
          overflow: auto;
          padding: 10px;
          border-radius: 6px;
          background: var(--bg-base);
        }
      `}</style>
    </section>
  );
}
