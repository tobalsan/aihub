// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { ProjectDetail } from "../../api/types";
import { CenterPanel } from "./CenterPanel";

const project: ProjectDetail = {
  id: "PRO-1",
  title: "Alpha Project",
  path: "PRO-1_alpha-project",
  absolutePath: "/tmp/PRO-1_alpha-project",
  frontmatter: {},
  docs: {},
  thread: [],
};

describe("CenterPanel", () => {
  it("adds activity comment via composer", async () => {
    const onAddComment = vi.fn(async () => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <CenterPanel
          project={project}
          tab="activity"
          showTabs={false}
          onAddComment={onAddComment}
        />
      ),
      container
    );

    const textarea = container.querySelector(
      ".thread-add-textarea"
    ) as HTMLTextAreaElement | null;
    const addButton = container.querySelector(
      ".thread-add-btn"
    ) as HTMLButtonElement | null;

    expect(textarea).not.toBeNull();
    expect(addButton).not.toBeNull();

    textarea!.value = "  Hello thread  ";
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    addButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();

    expect(onAddComment).toHaveBeenCalledTimes(1);
    expect(onAddComment).toHaveBeenCalledWith("Hello thread");
    expect(textarea!.value).toBe("");

    dispose();
  });
});
