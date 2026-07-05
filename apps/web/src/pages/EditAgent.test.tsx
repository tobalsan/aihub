// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { Agent } from "../api/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { fetchPoolMock, useSessionMock, useParamsMock, navigateMock } =
  vi.hoisted(() => ({
    fetchPoolMock: vi.fn(),
    useSessionMock: vi.fn(),
    useParamsMock: vi.fn(),
    navigateMock: vi.fn(),
  }));

vi.mock("../api", () => ({ fetchPool: fetchPoolMock }));

vi.mock("../auth/client", () => ({ useSession: useSessionMock }));

vi.mock("@solidjs/router", () => ({
  A: (props: { href: string; class?: string; children: unknown }) => {
    const a = document.createElement("a");
    a.setAttribute("href", props.href);
    if (props.class) a.className = props.class;
    a.textContent = String(props.children ?? "");
    return a;
  },
  useParams: () => useParamsMock(),
  useNavigate: () => navigateMock,
}));

import { EditAgent } from "./EditAgent";

// ── Helpers ───────────────────────────────────────────────────────────────────

function agent(partial: Partial<Agent> & { id: string }): Agent {
  return { name: partial.id, ...partial } as Agent;
}

function setSession(role: string | null) {
  useSessionMock.mockReturnValue(() => ({
    isPending: false,
    data: role ? { user: { role } } : { user: {} },
  }));
}

let container: HTMLElement;
let dispose: () => void;

async function mountEdit(agentId: string) {
  useParamsMock.mockReturnValue({ agentId });
  dispose = render(() => <EditAgent />, container);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  fetchPoolMock.mockReset();
  useSessionMock.mockReset();
  useParamsMock.mockReset();
  navigateMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  dispose?.();
  container.remove();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EditAgent", () => {
  it("renders the target agent name and role for an admin", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([
      agent({ id: "scribe", name: "Scribe", role: "Writer", avatar: "📝" }),
    ]);
    await mountEdit("scribe");

    expect(container.querySelector(".edit-agent-name")?.textContent).toBe(
      "Scribe"
    );
    expect(container.querySelector(".edit-agent-role")?.textContent).toBe(
      "Writer"
    );
    expect(container.querySelector(".avatar-emoji")?.textContent).toBe("📝");
  });

  it("shows a not-found message when the agent id is unknown", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    await mountEdit("ghost");

    expect(container.textContent).toContain("Agent not found");
  });

  it("redirects a non-admin away from the page", async () => {
    setSession("user");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    await mountEdit("scribe");

    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
    expect(container.querySelector(".edit-agent")).toBeNull();
  });
});
