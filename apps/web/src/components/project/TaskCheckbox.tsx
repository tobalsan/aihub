import type { Task } from "../../api/types";

type TaskCheckboxProps = {
  task: Task;
  disabled?: boolean;
  onToggle: (task: Task) => void;
};

export function TaskCheckbox(props: TaskCheckboxProps) {
  const badgeClass = () =>
    props.task.status === "done"
      ? "done"
      : props.task.status === "in_progress"
        ? "in-progress"
        : "todo";

  return (
    <>
      <button
        type="button"
        class="task-checkbox"
        onClick={() => props.onToggle(props.task)}
        disabled={props.disabled}
      >
        <span
          class={`task-checkbox-mark ${props.task.checked ? "checked" : ""}`}
        >
          {props.task.checked ? "x" : ""}
        </span>
        <span class="task-checkbox-main">
          <span class="task-checkbox-row">
            <span class="task-checkbox-title">{props.task.title}</span>
            <span class={`task-checkbox-status ${badgeClass()}`}>
              {props.task.status}
            </span>
          </span>
          {props.task.description && (
            <span class="task-checkbox-description">
              {props.task.description}
            </span>
          )}
        </span>
      </button>
      <style>{`
        .task-checkbox {
          width: 100%;
          border: 1px solid #1f2937;
          background: #111722;
          border-radius: 10px;
          padding: 10px 12px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          color: #e4e4e7;
          text-align: left;
          cursor: pointer;
        }

        .task-checkbox:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .task-checkbox-mark {
          width: 18px;
          height: 18px;
          border: 1px solid #374151;
          border-radius: 4px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          color: #0a0a0f;
          background: transparent;
          flex-shrink: 0;
        }

        .task-checkbox-mark.checked {
          border-color: #22c55e;
          background: #22c55e;
        }

        .task-checkbox-main {
          min-width: 0;
          display: grid;
          gap: 4px;
          flex: 1;
        }

        .task-checkbox-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          min-width: 0;
        }

        .task-checkbox-title {
          color: #e4e4e7;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.4;
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .task-checkbox-status {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-radius: 999px;
          padding: 2px 8px;
          border: 1px solid transparent;
          flex-shrink: 0;
        }

        .task-checkbox-status.todo {
          color: #a1a1aa;
          border-color: #3f3f46;
          background: #18181b;
        }

        .task-checkbox-status.in-progress {
          color: #93c5fd;
          border-color: #1d4ed8;
          background: #172554;
        }

        .task-checkbox-status.done {
          color: #86efac;
          border-color: #166534;
          background: #052e16;
        }

        .task-checkbox-description {
          color: #71717a;
          font-size: 12px;
          line-height: 1.5;
        }
      `}</style>
    </>
  );
}
