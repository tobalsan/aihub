// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateEvents, render } from "solid-js/web";
import type { Agent } from "../api/types";
import { QuickChatOverlay } from "./QuickChatOverlay";

vi.mock("./AgentChat", () => ({
  AgentChat: (props: { agentId: string; agentName: string }) => (
    <div data-testid="agent-chat-stub">
      {props.agentId}:{props.agentName}
    </div>
  ),
}));

const agents: Agent[] = [
  {
    id: "lead-alpha",
    name: "Lead Alpha",
    model: { provider: "anthropic", model: "claude-sonnet" },
  },
  {
    id: "lead-beta",
    name: "Lead Beta",
    model: { provider: "anthropic", model: "claude-opus" },
  },
];

describe("QuickChatOverlay", () => {
  beforeEach(() => {
    delegateEvents(["click", "change"]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders selected agent chat and supports switching", () => {
    const onSelectAgent = vi.fn();
    const onClose = vi.fn();
    const onMinimize = vi.fn();

    const container = document.createElement("div");
    document.body.appendChild(container);

    const dispose = render(
      () => (
        <QuickChatOverlay
          open={true}
          mobile={false}
          agents={agents}
          selectedAgentId="lead-alpha"
          onSelectAgent={onSelectAgent}
          onClose={onClose}
          onMinimize={onMinimize}
        />
      ),
      container
    );

    const chatStub = container.querySelector(
      '[data-testid="agent-chat-stub"]'
    ) as HTMLDivElement;
    expect(chatStub.textContent).toContain("lead-alpha:Lead Alpha");

    const select = container.querySelector(
      "#quick-chat-agent-select"
    ) as HTMLSelectElement;
    select.value = "lead-beta";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSelectAgent).toHaveBeenCalledWith("lead-beta");

    const buttons = Array.from(
      container.querySelectorAll(".quick-chat-overlay-action")
    ) as HTMLButtonElement[];
    buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    dispose();
  });

  it("shows empty state when no agents exist", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const dispose = render(
      () => (
        <QuickChatOverlay
          open={true}
          mobile={false}
          agents={[]}
          selectedAgentId={null}
          onSelectAgent={() => {}}
          onClose={() => {}}
          onMinimize={() => {}}
        />
      ),
      container
    );

    expect(container.textContent).toContain("No lead agents configured.");
    const select = container.querySelector(
      "#quick-chat-agent-select"
    ) as HTMLSelectElement;
    expect(select.disabled).toBe(true);

    dispose();
  });
});
