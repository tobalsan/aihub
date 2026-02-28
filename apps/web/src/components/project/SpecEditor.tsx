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
  const regex = new RegExp(
    String.raw`^##\s+${heading}\s*\n[\s\S]*?(?=^##\s+|$)`,
    "gim"
  );
  return content.replace(regex, "").trim();
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

            <article
              class="spec-doc markdown"
              innerHTML={documentHtml()}
              aria-label="Spec markdown preview"
            />
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
          max-width: 70ch;
          line-height: 1.6;
        }

        .spec-doc :global(h1),
        .spec-doc :global(h2),
        .spec-doc :global(h3) {
          line-height: 1.35;
          color: #e4e4e7;
        }

        .spec-doc :global(p),
        .spec-doc :global(li) {
          color: #d4d4d8;
        }

        .spec-doc :global(code) {
          background: #1f2937;
          border-radius: 6px;
          padding: 2px 5px;
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
