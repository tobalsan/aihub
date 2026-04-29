import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { Markdown } from "@tiptap/markdown";
import { MarkdownLinkShortcut } from "./tiptap-utils";

type DocEditorProps = {
  projectId: string;
  docKey: string;
  content: string;
  onSave: (content: string) => void;
  onContentChange?: (content: string) => void;
};

const SAVE_DEBOUNCE_MS = 800;

export function DocEditor(props: DocEditorProps) {
  const [status, setStatus] = createSignal<"idle" | "saving" | "saved">("idle");

  let editorHostRef: HTMLDivElement | undefined;
  let editor: Editor | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSavedContent = props.content;
  let lastEditedContent = props.content;
  let disposed = false;

  function setEditorMarkdown(content: string) {
    editor?.commands.setContent(content, {
      contentType: "markdown",
      emitUpdate: false,
    });
  }

  function flushSave(content: string) {
    if (disposed) return;
    if (content === lastSavedContent) return;
    setStatus("saving");
    lastSavedContent = content;
    props.onSave(content);
    if (savedTimer) clearTimeout(savedTimer);
    setStatus("saved");
    savedTimer = setTimeout(() => {
      if (!disposed) setStatus("idle");
    }, 1500);
  }

  function scheduleSave(content: string, delay = SAVE_DEBOUNCE_MS) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      flushSave(content);
    }, delay);
  }

  // External content updates: apply when user not focused & no pending edits.
  createEffect(() => {
    const next = props.content;
    if (!editor) return;
    if (editor.isFocused) return;
    if (lastEditedContent !== lastSavedContent) return;
    if (next === lastSavedContent) return;
    lastSavedContent = next;
    lastEditedContent = next;
    setEditorMarkdown(next);
  });

  onMount(() => {
    if (!editorHostRef) return;

    editor = new Editor({
      element: editorHostRef,
      extensions: [
        StarterKit.configure({ link: false }),
        Link.configure({
          openOnClick: true,
          HTMLAttributes: {
            target: "_blank",
            rel: "noopener noreferrer",
          },
        }),
        Placeholder.configure({
          placeholder: "Start typing... Markdown supported.",
        }),
        Markdown,
        MarkdownLinkShortcut,
      ],
      content: props.content,
      contentType: "markdown",
      editorProps: {
        attributes: {
          "aria-label": `Document ${props.docKey}`,
        },
      },
      onUpdate: ({ editor: nextEditor }) => {
        const next = nextEditor.getMarkdown();
        lastEditedContent = next;
        props.onContentChange?.(next);
        scheduleSave(next);
      },
      onBlur: ({ editor: nextEditor }) => {
        const next = nextEditor.getMarkdown();
        lastEditedContent = next;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = undefined;
        flushSave(next);
      },
    });
  });

  onCleanup(() => {
    disposed = true;
    if (saveTimer) clearTimeout(saveTimer);
    if (savedTimer) clearTimeout(savedTimer);
    // Final flush on unmount.
    if (editor && lastEditedContent !== lastSavedContent) {
      props.onSave(lastEditedContent);
    }
    editor?.destroy();
  });

  return (
    <section class="doc-editor">
      <header class="doc-editor-header">
        <span class="doc-editor-key">{props.docKey}</span>
        <span class="doc-editor-status" data-status={status()}>
          <Show when={status() === "saving"}>saving…</Show>
          <Show when={status() === "saved"}>saved</Show>
        </span>
      </header>

      <div ref={editorHostRef} class="doc-editor-body" />

      <style>{`
        .doc-editor {
          min-height: 200px;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-surface);
          color: var(--text-primary);
          border: 1px solid var(--border-default);
          border-radius: 10px;
          overflow: hidden;
        }

        .doc-editor-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-default);
          background: var(--bg-surface);
          font-size: 11px;
          color: var(--text-secondary);
        }

        .doc-editor-key {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          letter-spacing: 0.02em;
        }

        .doc-editor-status {
          min-width: 56px;
          text-align: right;
          opacity: 0.75;
          transition: opacity 0.15s ease;
        }

        .doc-editor-status[data-status="idle"] {
          opacity: 0;
        }

        .doc-editor-body {
          flex: 1 1 auto;
          min-height: 200px;
          overflow: auto;
        }

        .doc-editor-body .ProseMirror {
          min-height: 200px;
          height: 100%;
          padding: 14px;
          border: 0;
          background: transparent;
          color: var(--text-primary);
          font: inherit;
          line-height: 1.55;
          outline: none;
          white-space: normal;
        }

        .doc-editor-body .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          height: 0;
          color: var(--text-secondary);
          pointer-events: none;
        }

        .doc-editor-body .ProseMirror :first-child { margin-top: 0; }
        .doc-editor-body .ProseMirror :last-child { margin-bottom: 0; }

        .doc-editor-body .ProseMirror a {
          color: var(--text-accent, #6366f1);
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        .doc-editor-body .ProseMirror p,
        .doc-editor-body .ProseMirror ul,
        .doc-editor-body .ProseMirror ol,
        .doc-editor-body .ProseMirror blockquote,
        .doc-editor-body .ProseMirror pre {
          margin: 0 0 12px;
        }

        .doc-editor-body .ProseMirror h1,
        .doc-editor-body .ProseMirror h2,
        .doc-editor-body .ProseMirror h3 {
          margin: 18px 0 8px;
          line-height: 1.2;
        }

        .doc-editor-body .ProseMirror h1 { font-size: 28px; }
        .doc-editor-body .ProseMirror h2 { font-size: 23px; }
        .doc-editor-body .ProseMirror h3 { font-size: 19px; }

        .doc-editor-body .ProseMirror ul,
        .doc-editor-body .ProseMirror ol {
          padding-left: 24px;
        }

        .doc-editor-body .ProseMirror blockquote {
          padding-left: 12px;
          border-left: 3px solid var(--text-accent, #6366f1);
          color: var(--text-secondary);
        }

        .doc-editor-body .ProseMirror hr {
          margin: 22px 0;
          border: 0;
          border-top: 1px solid var(--border-default);
        }

        .doc-editor-body .ProseMirror code,
        .doc-editor-body .ProseMirror pre {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        }

        .doc-editor-body .ProseMirror pre {
          overflow: auto;
          padding: 10px;
          border-radius: 6px;
          background: var(--bg-base);
        }
      `}</style>
    </section>
  );
}
