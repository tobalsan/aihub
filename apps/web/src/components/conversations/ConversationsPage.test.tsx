// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ConversationsPage } from "./ConversationsPage";

vi.mock("../../api/client", () => ({
  fetchConversations: vi.fn(),
  fetchConversation: vi.fn(),
  createProjectFromConversation: vi.fn(),
  getConversationAttachmentUrl: vi.fn((id: string, name: string) => `/api/conversations/${id}/attachments/${name}`),
}));

import {
  createProjectFromConversation,
  fetchConversation,
  fetchConversations,
} from "../../api/client";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ConversationsPage", () => {
  const mockedFetchConversations = vi.mocked(fetchConversations);
  const mockedFetchConversation = vi.mocked(fetchConversation);
  const mockedCreateProjectFromConversation = vi.mocked(
    createProjectFromConversation
  );

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("loads conversations and selects the clicked card", async () => {
    mockedFetchConversations.mockResolvedValue([
      {
        id: "conv-1",
        title: "Design session",
        date: "2026-02-10",
        source: "slack",
        participants: ["thinh", "codex"],
        tags: ["ui", "scope"],
        preview: "Discussed conversation browsing UI.",
        attachments: [],
      },
      {
        id: "conv-2",
        title: "Bug triage",
        date: "2026-02-09",
        source: "discord",
        participants: ["thinh"],
        tags: ["bug"],
        preview: "Reviewed current regressions.",
        attachments: [],
      },
    ]);
    mockedFetchConversation.mockImplementation(async (id) => ({
      id,
      title: id === "conv-1" ? "Design session" : "Bug triage",
      date: "2026-02-10",
      source: "slack",
      participants: ["thinh", "codex"],
      tags: ["ui", "scope"],
      preview: "preview",
      attachments: id === "conv-1" ? ["notes.txt"] : ["report.md"],
      frontmatter: {},
      content: "**Codex** (10:00): Thread body",
      messages: [{ speaker: "Codex", timestamp: "10:00", body: "Thread body" }],
    }));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ConversationsPage />, container);

    await tick();
    await tick();

    expect(mockedFetchConversations.mock.calls[0]?.[0]).toEqual({
      q: undefined,
      source: undefined,
      tag: undefined,
    });

    const secondCard = container.querySelectorAll(".conversation-card")[1];
    secondCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(secondCard?.classList.contains("is-selected")).toBe(true);
    expect(container.textContent).toContain("Bug triage");
    expect(mockedFetchConversation).toHaveBeenCalledWith("conv-2");
    expect(container.textContent).toContain("Attachments");
    expect(container.querySelector('a[href="/api/conversations/conv-2/attachments/report.md"]')).not.toBeNull();

    dispose();
  });

  it("sends search/source/tag filters", async () => {
    mockedFetchConversations.mockResolvedValue([]);
    mockedFetchConversation.mockResolvedValue({
      id: "unused",
      title: "Unused",
      date: "2026-02-10",
      source: "slack",
      participants: [],
      tags: [],
      preview: "",
      attachments: [],
      frontmatter: {},
      content: "",
      messages: [],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ConversationsPage />, container);

    await tick();

    const inputs = Array.from(container.querySelectorAll(".conversation-filters input"));
    const [qInput, sourceInput, tagInput] = inputs as HTMLInputElement[];

    qInput.value = "release";
    qInput.dispatchEvent(new Event("input", { bubbles: true }));
    sourceInput.value = "slack";
    sourceInput.dispatchEvent(new Event("input", { bubbles: true }));
    tagInput.value = "scope";
    tagInput.dispatchEvent(new Event("input", { bubbles: true }));

    await tick();
    await tick();

    const lastCall = mockedFetchConversations.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual({
      q: "release",
      source: "slack",
      tag: "scope",
    });

    dispose();
  });

  it("opens create-project modal with prefilled conversation title", async () => {
    mockedCreateProjectFromConversation.mockResolvedValue({
      ok: true,
      data: {
        id: "PRO-9",
        title: "Design session",
        path: "PRO-9_design-session",
        absolutePath: "/tmp/PRO-9_design-session",
        frontmatter: { status: "shaping" },
        docs: { README: "# Design session" },
        thread: [],
      },
    });
    mockedFetchConversations.mockResolvedValue([
      {
        id: "conv-1",
        title: "Design session",
        date: "2026-02-10",
        source: "slack",
        participants: ["thinh"],
        tags: ["ui"],
        preview: "Discussed UI",
        attachments: [],
      },
    ]);
    mockedFetchConversation.mockResolvedValue({
      id: "conv-1",
      title: "Design session",
      date: "2026-02-10",
      source: "slack",
      participants: ["thinh"],
      tags: ["ui"],
      preview: "Discussed UI",
      attachments: [],
      frontmatter: {},
      content: "**Thinh** (10:00): Hey",
      messages: [{ speaker: "Thinh", timestamp: "10:00", body: "Hey" }],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ConversationsPage />, container);

    await tick();
    await tick();

    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Create project")
    );
    createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const modalInput = container.querySelector(
      ".conversation-create-modal input"
    ) as HTMLInputElement | null;
    expect(modalInput).not.toBeNull();
    expect(modalInput?.value).toBe("Design session");

    dispose();
  });

  it("falls back to raw markdown when no messages were parsed", async () => {
    mockedFetchConversations.mockResolvedValue([
      {
        id: "conv-1",
        title: "Design session",
        date: "2026-02-10",
        source: "slack",
        participants: ["thinh"],
        tags: ["ui"],
        preview: "Discussed conversation browsing UI.",
        attachments: [],
      },
    ]);
    mockedFetchConversation.mockResolvedValue({
      id: "conv-1",
      title: "Design session",
      date: "2026-02-10",
      source: "slack",
      participants: ["thinh"],
      tags: ["ui"],
      preview: "Discussed conversation browsing UI.",
      attachments: [],
      frontmatter: {},
      content: "## Raw Thread\n\nNo structured speaker blocks.",
      messages: [],
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <ConversationsPage />, container);

    await tick();
    await tick();

    const raw = container.querySelector(".thread-raw");
    expect(raw?.textContent).toContain("Raw Thread");

    dispose();
  });
});
