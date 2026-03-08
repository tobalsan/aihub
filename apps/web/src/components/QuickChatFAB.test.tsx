// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { delegateEvents, render } from "solid-js/web";
import { QuickChatFAB } from "./QuickChatFAB";

describe("QuickChatFAB", () => {
  beforeEach(() => {
    delegateEvents(["click"]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows pulse state for unread messages", () => {
    const [open] = createSignal(false);
    const [hasUnread] = createSignal(true);
    const onToggle = vi.fn();

    const container = document.createElement("div");
    document.body.appendChild(container);

    const dispose = render(
      () => (
        <QuickChatFAB
          open={open}
          hasUnread={hasUnread}
          agentLabel={() => "Lead Alpha"}
          onToggle={onToggle}
        />
      ),
      container
    );

    const fab = container.querySelector(".quick-chat-fab") as HTMLButtonElement;
    expect(fab.className).toContain("pulse");
    expect(fab.getAttribute("aria-expanded")).toBe("false");

    fab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    dispose();
  });
});
