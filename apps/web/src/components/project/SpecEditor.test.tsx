// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { Task } from "../../api/types";
import { SpecEditor } from "./SpecEditor";

describe("SpecEditor", () => {
  it("calls toggle handler when task checkbox clicked", async () => {
    const task: Task = {
      title: "Route setup",
      status: "todo",
      checked: false,
      order: 0,
    };
    const onToggleTask = vi.fn(async () => {});

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpecEditor
          specContent={"## Tasks\n- [ ] Route setup"}
          tasks={[task]}
          progress={{ done: 0, total: 1 }}
          onToggleTask={onToggleTask}
          onAddTask={async () => {}}
          onSaveSpec={async () => {}}
          onRefresh={async () => {}}
        />
      ),
      container
    );

    const taskButton = container.querySelector(".task-checkbox");
    expect(taskButton).not.toBeNull();
    taskButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();
    expect(onToggleTask).toHaveBeenCalledTimes(1);
    expect(onToggleTask).toHaveBeenCalledWith(task);

    dispose();
  });
});
