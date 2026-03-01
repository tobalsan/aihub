// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { AgentSidebar } from "./AgentSidebar";

vi.mock("@solidjs/router", () => ({
  A: (props: Record<string, unknown>) => <a {...props} />,
  useLocation: () => ({ pathname: "/projects" }),
}));

describe("AgentSidebar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders sidebar logo and primary navigation links", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const [collapsed] = createSignal(false);

    const dispose = render(
      () => (
        <AgentSidebar
          collapsed={collapsed}
          onToggleCollapse={() => {}}
          showArchived={() => false}
          onToggleArchived={() => {}}
        />
      ),
      container
    );

    expect(container.textContent).toContain("AIHub");
    expect(container.textContent).toContain("Projects");
    expect(container.textContent).toContain("Conversations");
    expect(container.textContent).toContain("Chats");
    expect(container.textContent).toContain("Archived");

    dispose();
  });
});
