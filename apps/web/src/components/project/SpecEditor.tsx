import DOMPurify from "dompurify";
import { marked } from "marked";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { Task } from "../../api/types";
import { ProgressBar } from "./ProgressBar";
import { TaskCheckbox } from "./TaskCheckbox";

type SpecEditorProps = {
  specContent: string;
  tasks: Task[];
  progress: { done: number; total: number };
  areaColor?: string;
  onToggleTask: (task: Task) => Promise<void>;
  onAddTask: (title: string) => Promise<void>;
  onSaveSpec: (content: string) => Promise<void>;
  onRefresh: () => Promise<void>;
};

type SectionCheckbox = {
  lineIndex: number;
  label: string;
  checked: boolean;
};

function parseSectionCheckboxes(
  content: string,
  heading: string
): SectionCheckbox[] {
  const lines = content.split("\n");
  const headingPattern = new RegExp(`^##\\s+${heading}\\s*$`, "i");
  let inSection = false;
  const items: SectionCheckbox[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!inSection && headingPattern.test(line.trim())) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line.trim())) break;
    if (!inSection) continue;

    const match = line.match(/^\s*-\s+\[([ xX])\]\s+(.+)$/);
    if (!match) continue;
    items.push({
      lineIndex: i,
      checked: match[1].toLowerCase() === "x",
      label: match[2].trim(),
    });
  }

  return items;
}

function setLineChecked(
  content: string,
  lineIndex: number,
  checked: boolean
): string {
  const lines = content.split("\n");
  const current = lines[lineIndex];
  if (!current) return content;
  lines[lineIndex] = current.replace(/\[([ xX])\]/, checked ? "[x]" : "[ ]");
  return lines.join("\n");
}

function stripSection(content: string, heading: string): string {
  const lines = content.split("\n");
  const headingPattern = new RegExp(`^##\\s+${heading}\\s*$`, "i");

  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (headingPattern.test((lines[i] ?? "").trim())) {
      start = i;
      break;
    }
  }
  if (start < 0) return content.trim();

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test((lines[i] ?? "").trim())) {
      end = i;
      break;
    }
  }

  const next = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
  return next.trim();
}

function renderMarkdown(content: string): string {
  const html = marked.parse(content, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

export function SpecEditor(props: SpecEditorProps) {
  const [mode, setMode] = createSignal<"preview" | "edit">("preview");
  const [draft, setDraft] = createSignal(props.specContent);
  const [saving, setSaving] = createSignal(false);
  const [updatingOrder, setUpdatingOrder] = createSignal<number | null>(null);
  const [addingTask, setAddingTask] = createSignal(false);
  const [newTaskTitle, setNewTaskTitle] = createSignal("");
  let autosaveTimer: number | undefined;

  createEffect(() => {
    if (mode() === "preview") setDraft(props.specContent);
  });

  const acceptanceItems = createMemo(() =>
    parseSectionCheckboxes(props.specContent, "Acceptance Criteria")
  );

  const documentHtml = createMemo(() => {
    const withoutTasks = stripSection(props.specContent, "Tasks");
    const withoutAcceptance = stripSection(withoutTasks, "Acceptance Criteria");
    return renderMarkdown(withoutAcceptance);
  });

  const saveDraft = async (switchToPreview = false) => {
    const content = draft();
    if (content === props.specContent) {
      if (switchToPreview) setMode("preview");
      return;
    }
    setSaving(true);
    try {
      await props.onSaveSpec(content);
      await props.onRefresh();
      if (switchToPreview) setMode("preview");
    } finally {
      setSaving(false);
    }
  };

  const scheduleAutosave = () => {
    if (autosaveTimer) window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      void saveDraft(false);
    }, 500);
  };

  const handleToggleTask = async (task: Task) => {
    setUpdatingOrder(task.order);
    try {
      await props.onToggleTask(task);
    } finally {
      setUpdatingOrder(null);
    }
  };

  const handleToggleAcceptance = async (item: SectionCheckbox) => {
    const next = setLineChecked(
      props.specContent,
      item.lineIndex,
      !item.checked
    );
    setSaving(true);
    try {
      await props.onSaveSpec(next);
      await props.onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTask = async () => {
    const title = newTaskTitle().trim();
    if (!title) return;
    await props.onAddTask(title);
    setNewTaskTitle("");
    setAddingTask(false);
  };

  return (
    <>
      <section class="spec-editor">
        <header class="spec-editor-header">
          <div class="spec-mode-toggle">
            <button
              type="button"
              classList={{ active: mode() === "preview" }}
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
            <button
              type="button"
              classList={{ active: mode() === "edit" }}
              onClick={() => setMode("edit")}
            >
              Edit
            </button>
          </div>
          <Show when={mode() === "edit"}>
            <button
              class="spec-save-button"
              type="button"
              onClick={() => void saveDraft(true)}
              disabled={saving()}
            >
              {saving() ? "Saving..." : "Save"}
            </button>
          </Show>
        </header>

        <Show when={mode() === "preview"}>
          <div class="spec-editor-preview">
            <article
              class="spec-doc markdown"
              innerHTML={documentHtml()}
              aria-label="Spec markdown preview"
            />

            <Show when={props.tasks.length > 0}>
              <section class="spec-section">
                <h3>Tasks</h3>
                <ProgressBar
                  done={props.progress.done}
                  total={props.progress.total}
                  color={props.areaColor}
                />
                <div class="spec-task-list">
                  <For each={props.tasks}>
                    {(task) => (
                      <TaskCheckbox
                        task={task}
                        disabled={updatingOrder() === task.order || saving()}
                        onToggle={(current) => void handleToggleTask(current)}
                      />
                    )}
                  </For>
                </div>
                <Show when={!addingTask()}>
                  <button
                    class="spec-add-task"
                    type="button"
                    onClick={() => setAddingTask(true)}
                  >
                    + Add task
                  </button>
                </Show>
                <Show when={addingTask()}>
                  <input
                    class="spec-add-input"
                    type="text"
                    placeholder="Task title"
                    value={newTaskTitle()}
                    onInput={(e) => setNewTaskTitle(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setAddingTask(false);
                        setNewTaskTitle("");
                        return;
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleCreateTask();
                      }
                    }}
                  />
                </Show>
              </section>
            </Show>

            <Show when={acceptanceItems().length > 0}>
              <section class="spec-section">
                <h3>Acceptance Criteria</h3>
                <ul class="acceptance-list">
                  <For each={acceptanceItems()}>
                    {(item) => (
                      <li>
                        <button
                          type="button"
                          class="acceptance-item"
                          onClick={() => void handleToggleAcceptance(item)}
                          disabled={saving()}
                        >
                          <span
                            class={`acceptance-check ${item.checked ? "checked" : ""}`}
                          >
                            {item.checked ? "x" : ""}
                          </span>
                          <span>{item.label}</span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            </Show>
          </div>
        </Show>

        <Show when={mode() === "edit"}>
          <div class="spec-editor-edit">
            <textarea
              class="spec-textarea"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onBlur={scheduleAutosave}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                  e.preventDefault();
                  void saveDraft(true);
                }
              }}
            />
          </div>
        </Show>
      </section>
      <style>{`
        .spec-editor {
          min-height: 100%;
          display: grid;
          grid-template-rows: auto 1fr;
          background: #0a0a0f;
          color: #e4e4e7;
          min-width: 0;
        }

        .spec-editor-header {
          position: sticky;
          top: 0;
          z-index: 3;
          background: #0a0a0f;
          border-bottom: 1px solid #1c2430;
          padding: 14px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .spec-mode-toggle {
          display: inline-flex;
          border: 1px solid #2a3240;
          border-radius: 8px;
          overflow: hidden;
        }

        .spec-mode-toggle button {
          border: 0;
          background: #111722;
          color: #a1a1aa;
          padding: 7px 12px;
          font-size: 12px;
          cursor: pointer;
        }

        .spec-mode-toggle button.active {
          background: #172554;
          color: #e4e4e7;
        }

        .spec-save-button {
          border: 1px solid #2a3240;
          border-radius: 8px;
          background: #111722;
          color: #e4e4e7;
          font-size: 12px;
          padding: 7px 10px;
          cursor: pointer;
        }

        .spec-editor-preview {
          padding: 20px;
          display: grid;
          gap: 18px;
          align-content: start;
          min-width: 0;
        }

        .spec-editor-preview > * {
          min-width: 0;
        }

        .spec-section {
          border: 1px solid #1c2430;
          border-radius: 12px;
          padding: 14px;
          background: #101520;
          display: grid;
          gap: 10px;
        }

        .spec-section h3 {
          margin: 0;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #a1a1aa;
        }

        .spec-task-list {
          display: grid;
          gap: 8px;
        }

        .spec-add-task {
          border: 1px dashed #374151;
          border-radius: 8px;
          background: transparent;
          color: #a1a1aa;
          font-size: 12px;
          padding: 8px;
          cursor: pointer;
        }

        .spec-add-input {
          width: 100%;
          border: 1px solid #2a3240;
          border-radius: 8px;
          background: #0f1724;
          color: #e4e4e7;
          padding: 8px;
          font-size: 12px;
        }

        .acceptance-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 6px;
        }

        .acceptance-item {
          border: 0;
          background: transparent;
          color: #d4d4d8;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 2px 0;
          cursor: pointer;
          text-align: left;
        }

        .acceptance-check {
          width: 16px;
          height: 16px;
          border: 1px solid #374151;
          border-radius: 4px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
          color: #0a0a0f;
          flex-shrink: 0;
        }

        .acceptance-check.checked {
          border-color: #22c55e;
          background: #22c55e;
        }

        .spec-doc {
          border: 1px solid #1c2430;
          border-radius: 12px;
          padding: 20px;
          background: #0f131d;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          color: #d4dbe5;
          font-size: 13px;
          line-height: 1.6;
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        }

        .spec-doc p {
          margin: 0;
          overflow-wrap: anywhere;
        }

        .spec-doc p + p {
          margin-top: 8px;
        }

        .spec-doc strong {
          color: #f0f0f0;
          font-weight: 600;
        }

        .spec-doc code {
          background: rgba(255, 255, 255, 0.06);
          border-radius: 4px;
          padding: 2px 6px;
          font-family: "SF Mono", "Consolas", "Liberation Mono", monospace;
          font-size: 0.9em;
          color: #ccc;
          overflow-wrap: anywhere;
        }

        .spec-doc pre {
          margin: 10px 0;
          padding: 12px 14px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 8px;
          overflow: auto;
          font-family: "SF Mono", "Consolas", "Liberation Mono", monospace;
          font-size: 13px;
          line-height: 1.5;
          color: #ccc;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .spec-doc pre code {
          background: transparent;
          padding: 0;
          color: inherit;
        }

        .spec-doc ul,
        .spec-doc ol {
          margin: 8px 0;
          padding-left: 22px;
        }

        .spec-doc li {
          margin: 0;
          overflow-wrap: anywhere;
        }

        .spec-doc li + li {
          margin-top: 4px;
        }

        .spec-doc li > p {
          margin: 0;
        }

        .spec-doc hr {
          margin: 12px 0;
          border: 0;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        .spec-doc h1,
        .spec-doc h2,
        .spec-doc h3,
        .spec-doc h4 {
          color: #f0f0f0;
          margin: 16px 0 8px;
          line-height: 1.3;
        }

        .spec-doc h1 { font-size: 1.25em; }
        .spec-doc h2 { font-size: 1.15em; }
        .spec-doc h3 { font-size: 1.05em; }
        .spec-doc h4 { font-size: 1em; }

        .spec-doc h1:first-child,
        .spec-doc h2:first-child,
        .spec-doc h3:first-child,
        .spec-doc h4:first-child {
          margin-top: 0;
        }

        .spec-doc blockquote {
          margin: 8px 0;
          padding: 4px 12px;
          border-left: 2px solid rgba(255, 255, 255, 0.15);
          color: #999;
        }

        .spec-doc table {
          width: 100%;
          display: block;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          border-collapse: collapse;
          margin: 10px 0;
          font-size: 13px;
        }

        .spec-doc th,
        .spec-doc td {
          border: 1px solid #2a2a2a;
          padding: 8px 12px;
          text-align: left;
        }

        .spec-doc th {
          background: rgba(255, 255, 255, 0.04);
          color: #ddd;
          font-weight: 600;
        }

        .spec-doc tbody tr:nth-child(even) {
          background: rgba(255, 255, 255, 0.02);
        }

        .spec-editor-edit {
          padding: 16px;
          height: 100%;
        }

        .spec-textarea {
          width: 100%;
          height: 100%;
          min-height: 70vh;
          border: 1px solid #1c2430;
          border-radius: 12px;
          background: #0f131d;
          color: #e4e4e7;
          resize: vertical;
          padding: 14px;
          line-height: 1.6;
          font-family: "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
          font-size: 12px;
        }
      `}</style>
    </>
  );
}
