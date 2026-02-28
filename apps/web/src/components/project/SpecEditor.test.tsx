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

  it("enters edit mode on double-click and saves spec on blur", async () => {
    const onSaveSpec = vi.fn(async () => {});
    const onRefresh = vi.fn(async () => {});

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpecEditor
          specContent={"# Spec title"}
          docs={{ "SPECS.md": "# Spec title" }}
          tasks={[]}
          progress={{ done: 0, total: 0 }}
          onToggleTask={async () => {}}
          onAddTask={async () => {}}
          onSaveSpec={onSaveSpec}
          onRefresh={onRefresh}
        />
      ),
      container
    );

    const preview = container.querySelector(".spec-doc");
    expect(preview).not.toBeNull();
    preview?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    const textarea = container.querySelector<HTMLTextAreaElement>(".spec-textarea");
    expect(textarea).not.toBeNull();
    textarea!.value = "# Updated spec";
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    textarea!.dispatchEvent(new FocusEvent("blur", { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSaveSpec).toHaveBeenCalledWith("# Updated spec");
    expect(onRefresh).toHaveBeenCalledTimes(1);

    dispose();
  });

  it("saves non-spec docs on Cmd/Ctrl+Enter", async () => {
    const onSaveDoc = vi.fn(async () => {});

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
          onSaveDoc={onSaveDoc}
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
    expect(preview).not.toBeNull();
    preview?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    const textarea = container.querySelector<HTMLTextAreaElement>(".spec-textarea");
    expect(textarea).not.toBeNull();
    textarea!.value = "# Updated readme";
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    textarea!.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
        ctrlKey: true,
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSaveDoc).toHaveBeenCalledWith("README.md", "# Updated readme");

    dispose();
  });

  it("updates progress immediately while task toggle request is pending", async () => {
    const task: Task = {
      title: "Route setup",
      status: "todo",
      checked: false,
      order: 0,
    };
    let resolveToggle: (() => void) | undefined;
    const onToggleTask = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveToggle = resolve;
        })
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpecEditor
          specContent={"# Title"}
          docs={{ "SPECS.md": "# Title" }}
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

    const before = container.querySelector(".progress-bar-label");
    expect(before?.textContent).toContain("0/1 tasks");

    const taskButton = container.querySelector(".task-checkbox");
    expect(taskButton).not.toBeNull();
    taskButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const after = container.querySelector(".progress-bar-label");
    expect(after?.textContent).toContain("1/1 tasks");

    resolveToggle?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    dispose();
  });

  it("submits new task with Cmd/Ctrl+Enter from title field", async () => {
    const onAddTask = vi.fn(async () => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpecEditor
          specContent={"# Title"}
          docs={{ "SPECS.md": "# Title" }}
          tasks={[]}
          progress={{ done: 0, total: 0 }}
          onToggleTask={async () => {}}
          onAddTask={onAddTask}
          onSaveSpec={async () => {}}
          onRefresh={async () => {}}
        />
      ),
      container
    );

    const addButton = container.querySelector(".spec-add-task");
    expect(addButton).not.toBeNull();
    addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const titleInput = container.querySelector<HTMLInputElement>(".spec-add-input");
    expect(titleInput).not.toBeNull();
    titleInput!.value = "Ship inline editing";
    titleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    titleInput!.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
        ctrlKey: true,
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onAddTask).toHaveBeenCalledWith("Ship inline editing", undefined);

    dispose();
  });

  it("submits new task with Cmd/Ctrl+Enter from description field", async () => {
    const onAddTask = vi.fn(async () => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SpecEditor
          specContent={"# Title"}
          docs={{ "SPECS.md": "# Title" }}
          tasks={[]}
          progress={{ done: 0, total: 0 }}
          onToggleTask={async () => {}}
          onAddTask={onAddTask}
          onSaveSpec={async () => {}}
          onRefresh={async () => {}}
        />
      ),
      container
    );

    const addButton = container.querySelector(".spec-add-task");
    expect(addButton).not.toBeNull();
    addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const titleInput = container.querySelector<HTMLInputElement>(".spec-add-input");
    const descInput = container.querySelector<HTMLTextAreaElement>(".spec-add-desc");
    expect(titleInput).not.toBeNull();
    expect(descInput).not.toBeNull();

    titleInput!.value = "Polish activity layout";
    titleInput!.dispatchEvent(new Event("input", { bubbles: true }));
    descInput!.value = "Move timestamp under author.";
    descInput!.dispatchEvent(new Event("input", { bubbles: true }));
    descInput!.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
        ctrlKey: true,
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onAddTask).toHaveBeenCalledWith(
      "Polish activity layout",
      "Move timestamp under author."
    );

    dispose();
  });
});
