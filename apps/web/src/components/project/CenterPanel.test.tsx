// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { ProjectDetail } from "../../api/types";
import { CenterPanel } from "./CenterPanel";
import { fetchSubagentLogs, fetchSubagents } from "../../api/client";

vi.mock("../AgentChat", () => ({
  AgentChat: (props: {
    agentType: string | null;
    agentName: string | null;
  }) => (
    <div class="agent-chat-mock">
      {props.agentType}:{props.agentName}
    </div>
  ),
}));

vi.mock("../../api/client", () => ({
  fetchSubagents: vi.fn(async () => ({ ok: true, data: { items: [] } })),
  fetchSubagentLogs: vi.fn(async () => ({
    ok: true,
    data: { cursor: 0, events: [] },
  })),
}));

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
  it("shows placeholder when no selected agent in chat tab", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <CenterPanel
          project={project}
          tab="chat"
          showTabs={false}
          selectedAgent={null}
        />
      ),
      container
    );

    expect(container.textContent).toContain("Select an agent to chat");
    expect(container.querySelector(".agent-chat-mock")).toBeNull();

    dispose();
  });

  it("renders AgentChat when selected agent is set", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <CenterPanel
          project={project}
          tab="chat"
          showTabs={false}
          selectedAgent={{
            type: "subagent",
            projectId: "PRO-1",
            slug: "alpha",
            cli: "codex",
            status: "running",
          }}
        />
      ),
      container
    );

    expect(container.querySelector(".agent-chat-mock")?.textContent).toContain(
      "subagent:PRO-1/codex"
    );

    dispose();
  });

  it("renders SpawnForm when spawn mode is active", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <CenterPanel
          project={project}
          tab="chat"
          showTabs={false}
          selectedAgent={null}
          spawnMode={{
            template: "custom",
            prefill: { cli: "codex", model: "gpt-5.3-codex" },
          }}
          subagents={[]}
        />
      ),
      container
    );

    expect(container.textContent).toContain("Spawn Agent");
    expect(container.querySelector(".agent-chat-mock")).toBeNull();

    dispose();
  });

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
          selectedAgent={null}
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

  it("renders activity date below author", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <CenterPanel
          project={{
            ...project,
            thread: [
              {
                author: "Thinh",
                date: "2026-02-28 20:53",
                body: "Updated spec",
              },
            ],
          }}
          tab="activity"
          showTabs={false}
          selectedAgent={null}
        />
      ),
      container
    );

    const meta = container.querySelector(".activity-meta");
    const author = container.querySelector(".activity-author");
    const date = container.querySelector(".activity-date");

    expect(meta).not.toBeNull();
    expect(author?.textContent).toBe("Thinh");
    expect(date?.textContent).toBe("2026-02-28 20:53");
    expect(meta?.firstElementChild).toBe(author);
    expect(meta?.lastElementChild).toBe(date);

    dispose();
  });

  it("merges thread and subagent activity entries", async () => {
    vi.mocked(fetchSubagents).mockResolvedValueOnce({
      ok: true,
      data: {
        items: [
          {
            slug: "alpha",
            cli: "codex",
            status: "replied",
            lastActive: "2026-02-28T21:10:00.000Z",
          },
        ],
      },
    });
    vi.mocked(fetchSubagentLogs).mockResolvedValueOnce({
      ok: true,
      data: {
        cursor: 10,
        events: [
          {
            ts: "2026-02-28T21:00:00.000Z",
            type: "user",
            text: "Implement task A",
          },
          {
            ts: "2026-02-28T21:05:00.000Z",
            type: "assistant",
            text: "Done with task A",
          },
        ],
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <CenterPanel
          project={{
            ...project,
            thread: [
              {
                author: "Thinh",
                date: "2026-02-28T20:55:00.000Z",
                body: "Status changed to in_progress",
              },
            ],
          }}
          tab="activity"
          showTabs={false}
          selectedAgent={null}
        />
      ),
      container
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const text = container.textContent ?? "";
    expect(text).toContain("Status changed to in_progress");
    expect(text).toContain("Agent started. Prompt: Implement task A");
    expect(text).toContain("Agent completed. Done with task A");

    dispose();
  });
});
