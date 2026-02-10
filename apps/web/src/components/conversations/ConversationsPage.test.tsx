// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ConversationsPage } from "./ConversationsPage";

vi.mock("../../api/client", () => ({
  fetchConversations: vi.fn(),
}));

import { fetchConversations } from "../../api/client";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ConversationsPage", () => {
  const mockedFetchConversations = vi.mocked(fetchConversations);

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

    dispose();
  });

  it("sends search/source/tag filters", async () => {
    mockedFetchConversations.mockResolvedValue([]);

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
});
