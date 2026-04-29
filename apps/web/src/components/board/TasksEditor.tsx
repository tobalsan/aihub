import { For, Show, createMemo, createSignal } from "solid-js";
import { ProgressBar } from "../project/ProgressBar";

type TasksEditorProps = {
  projectId: string;
  content: string;
  onSave: (content: string) => void;
};

type ParsedTask = {
  lineIndex: number;
  title: string;
  description: string;
  checked: boolean;
  section: string | null;
};

type SectionGroup = {
  section: string | null;
  items: ParsedTask[];
};

const SUBSECTION_H3_PATTERN = /^###\s+(.+?)\s*$/;
const TASK_LINE_PATTERN = /^- \[( |x|X)\] \*\*(.+?)\*\*(.*)$/;

function parseTasks(content: string): ParsedTask[] {
  const lines = content.split("\n");
  let currentSection: string | null = null;
  const items: ParsedTask[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    const sub = trimmed.match(SUBSECTION_H3_PATTERN);
    if (sub) {
      currentSection = sub[1]?.trim() || null;
      continue;
    }

    const m = trimmed.match(TASK_LINE_PATTERN);
    if (!m) continue;
    items.push({
      lineIndex: i,
      checked: m[1].toLowerCase() === "x",
      title: m[2].trim(),
      description: m[3].trim(),
      section: currentSection,
    });
  }

  return items;
}

function groupBySection(items: ParsedTask[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  for (const item of items) {
    const prev = groups[groups.length - 1];
    if (!prev || prev.section !== item.section) {
      groups.push({ section: item.section, items: [item] });
      continue;
    }
    prev.items.push(item);
  }
  return groups;
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

function appendTask(
  content: string,
  title: string,
  description: string
): string {
  const desc = description ? ` ${description}` : "";
  const line = `- [ ] **${title}**${desc}`;
  if (!content || content.length === 0) return line + "\n";
  const trailingNewline = content.endsWith("\n") ? "" : "\n";
  return `${content}${trailingNewline}${line}\n`;
}

export function TasksEditor(props: TasksEditorProps) {
  const [addingTask, setAddingTask] = createSignal(false);
  const [newTaskTitle, setNewTaskTitle] = createSignal("");
  const [newTaskDesc, setNewTaskDesc] = createSignal("");

  const tasks = createMemo(() => parseTasks(props.content));
  const grouped = createMemo(() => groupBySection(tasks()));
  const progress = createMemo(() => {
    const items = tasks();
    return {
      done: items.filter((t) => t.checked).length,
      total: items.length,
    };
  });

  const handleToggle = (task: ParsedTask) => {
    const next = setLineChecked(props.content, task.lineIndex, !task.checked);
    props.onSave(next);
  };

  const resetForm = () => {
    setAddingTask(false);
    setNewTaskTitle("");
    setNewTaskDesc("");
  };

  const handleCreateTask = () => {
    const title = newTaskTitle().trim();
    if (!title) return;
    const desc = newTaskDesc().trim();
    const next = appendTask(props.content, title, desc);
    props.onSave(next);
    resetForm();
  };

  return (
    <section class="tasks-editor">
      <ProgressBar done={progress().done} total={progress().total} />

      <div class="tasks-editor-list">
        <For each={grouped()}>
          {(group) => (
            <div class="tasks-editor-group">
              <Show when={group.section}>
                <h4 class="tasks-editor-group-title">{group.section}</h4>
              </Show>
              <div class="tasks-editor-group-items">
                <For each={group.items}>
                  {(task) => (
                    <button
                      type="button"
                      class="tasks-editor-task"
                      onClick={() => handleToggle(task)}
                    >
                      <span
                        class={`tasks-editor-mark ${task.checked ? "checked" : ""}`}
                      >
                        {task.checked ? "x" : ""}
                      </span>
                      <span class="tasks-editor-body">
                        <span class="tasks-editor-title">{task.title}</span>
                        <Show when={task.description}>
                          <span class="tasks-editor-description">
                            {task.description}
                          </span>
                        </Show>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
        <Show when={tasks().length === 0}>
          <p class="tasks-editor-empty">No tasks yet.</p>
        </Show>
      </div>

      <Show when={!addingTask()}>
        <button
          class="tasks-editor-add"
          type="button"
          onClick={() => setAddingTask(true)}
        >
          + Add task
        </button>
      </Show>
      <Show when={addingTask()}>
        <div class="tasks-editor-form">
          <input
            class="tasks-editor-input"
            type="text"
            placeholder="Task title"
            value={newTaskTitle()}
            onInput={(e) => setNewTaskTitle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                resetForm();
                return;
              }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleCreateTask();
              }
            }}
          />
          <textarea
            class="tasks-editor-input tasks-editor-desc"
            placeholder="Description (optional)"
            value={newTaskDesc()}
            onInput={(e) => setNewTaskDesc(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                resetForm();
                return;
              }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleCreateTask();
              }
            }}
            rows={2}
          />
          <div class="tasks-editor-actions">
            <button
              type="button"
              class="tasks-editor-confirm"
              onClick={handleCreateTask}
              disabled={!newTaskTitle().trim()}
            >
              Add
            </button>
            <button
              type="button"
              class="tasks-editor-cancel"
              onClick={resetForm}
            >
              Cancel
            </button>
          </div>
        </div>
      </Show>

      <style>{`
        .tasks-editor {
          display: grid;
          gap: 12px;
          padding: 14px;
          background: var(--bg-surface);
          color: var(--text-primary);
          border: 1px solid var(--border-default);
          border-radius: 10px;
        }

        .tasks-editor-list {
          display: grid;
          gap: 10px;
        }

        .tasks-editor-group {
          display: grid;
          gap: 8px;
        }

        .tasks-editor-group + .tasks-editor-group {
          margin-top: 4px;
          padding-top: 10px;
          border-top: 1px solid var(--border-default);
        }

        .tasks-editor-group-title {
          margin: 0;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-secondary);
        }

        .tasks-editor-group-items {
          display: grid;
          gap: 6px;
        }

        .tasks-editor-task {
          width: 100%;
          border: 1px solid var(--border-default);
          background: var(--bg-base);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          color: var(--text-primary);
          text-align: left;
          cursor: pointer;
        }

        .tasks-editor-task:hover {
          border-color: var(--text-accent, #6366f1);
        }

        .tasks-editor-mark {
          width: 18px;
          height: 18px;
          border: 1px solid var(--text-secondary);
          border-radius: 4px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          color: var(--bg-base);
          background: transparent;
          flex-shrink: 0;
        }

        .tasks-editor-mark.checked {
          border-color: #22c55e;
          background: #22c55e;
        }

        .tasks-editor-body {
          min-width: 0;
          display: grid;
          gap: 4px;
          flex: 1;
        }

        .tasks-editor-title {
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 600;
          line-height: 1.4;
          overflow-wrap: anywhere;
        }

        .tasks-editor-description {
          color: var(--text-secondary);
          font-size: 12px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .tasks-editor-empty {
          margin: 0;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .tasks-editor-add {
          border: 1px dashed var(--border-default);
          border-radius: 8px;
          background: transparent;
          color: var(--text-secondary);
          font-size: 12px;
          padding: 8px;
          cursor: pointer;
        }

        .tasks-editor-add:hover {
          color: var(--text-primary);
          border-color: var(--text-secondary);
        }

        .tasks-editor-form {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .tasks-editor-input {
          width: 100%;
          border: 1px solid var(--border-default);
          border-radius: 8px;
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 8px;
          font-size: 12px;
          font-family: inherit;
          resize: vertical;
          box-sizing: border-box;
        }

        .tasks-editor-desc {
          font-size: 11px;
          color: var(--text-secondary);
          min-height: 40px;
        }

        .tasks-editor-actions {
          display: flex;
          gap: 6px;
        }

        .tasks-editor-confirm,
        .tasks-editor-cancel {
          border: none;
          border-radius: 6px;
          padding: 6px 14px;
          font-size: 12px;
          cursor: pointer;
        }

        .tasks-editor-confirm {
          background: #3b8ecc;
          color: #fff;
        }

        .tasks-editor-confirm:disabled {
          opacity: 0.4;
          cursor: default;
        }

        .tasks-editor-cancel {
          background: var(--border-default);
          color: var(--text-secondary);
        }
      `}</style>
    </section>
  );
}
