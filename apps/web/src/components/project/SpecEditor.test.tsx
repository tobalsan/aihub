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
          docs={{ "SPECS.md": "## Tasks\n- [ ] Route setup" }}
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

  it("renders markdown doc tabs with SPECS first when present", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpecEditor
          specContent={"# Spec title"}
          docs={{
            "README.md": "# Readme",
            "SPECS.md": "# Spec title",
            "NOTES.md": "# Notes",
          }}
          tasks={[]}
          progress={{ done: 0, total: 0 }}
          onToggleTask={async () => {}}
          onAddTask={async () => {}}
          onSaveSpec={async () => {}}
          onRefresh={async () => {}}
        />
      ),
      container
    );

    const tabs = Array.from(container.querySelectorAll(".spec-doc-tab")).map(
      (tab) => tab.textContent
    );
    expect(tabs).toEqual(["SPECS.md", "NOTES.md", "README.md"]);

    dispose();
  });

  it("does not render synthetic SPECS tab when SPECS.md is missing", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpecEditor
          specContent={"# Spec title"}
          docs={{
            "README.md": "# Readme",
            "NOTES.md": "# Notes",
          }}
          tasks={[]}
          progress={{ done: 0, total: 0 }}
          onToggleTask={async () => {}}
          onAddTask={async () => {}}
          onSaveSpec={async () => {}}
          onRefresh={async () => {}}
        />
      ),
      container
    );

    const tabs = Array.from(container.querySelectorAll(".spec-doc-tab")).map(
      (tab) => tab.textContent
    );
    expect(tabs).toEqual(["README.md", "NOTES.md"]);

    const preview = container.querySelector(".spec-doc");
    expect(preview?.innerHTML).toContain("Readme");

    dispose();
  });

  it("renders tabs from API-style doc keys without extension", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpecEditor
          specContent={"# Spec title"}
          docs={{
            README: "# Readme",
            SPECS: "# Spec title",
            NOTES: "# Notes",
          }}
          tasks={[]}
          progress={{ done: 0, total: 0 }}
          onToggleTask={async () => {}}
          onAddTask={async () => {}}
          onSaveSpec={async () => {}}
          onRefresh={async () => {}}
        />
      ),
      container
    );

    const tabs = Array.from(container.querySelectorAll(".spec-doc-tab")).map(
      (tab) => tab.textContent
    );
    expect(tabs).toEqual(["SPECS.md", "NOTES.md", "README.md"]);

    dispose();
  });

  it("switches preview content when a non-spec doc tab is clicked", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpecEditor
          specContent={"# Spec title"}
          docs={{
            "README.md": "# Readme",
            "SPECS.md": "# Spec title",
          }}
          tasks={[]}
          progress={{ done: 0, total: 0 }}
          onToggleTask={async () => {}}
          onAddTask={async () => {}}
          onSaveSpec={async () => {}}
          onRefresh={async () => {}}
        />
      ),
      container
    );

    const readmeTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".spec-doc-tab")
    ).find((tab) => tab.textContent === "README.md");
    expect(readmeTab).toBeDefined();
    readmeTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const preview = container.querySelector(".spec-doc");
    expect(preview?.innerHTML).toContain("Readme");
    expect(container.textContent).not.toContain("Tasks");
    expect(container.textContent).not.toContain("Acceptance Criteria");

    dispose();
  });
});
