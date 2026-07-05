// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { Agent } from "../api/types";
import type { AgentFork, Team } from "../api/teams";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  fetchPoolMock,
  fetchTeamsMock,
  fetchForksMock,
  assignPoolToTeamMock,
  reassignForkMock,
  fetchAgentExtensionsMock,
  useSessionMock,
  useParamsMock,
  navigateMock,
} = vi.hoisted(() => ({
  fetchPoolMock: vi.fn(),
  fetchTeamsMock: vi.fn(),
  fetchForksMock: vi.fn(),
  assignPoolToTeamMock: vi.fn(),
  reassignForkMock: vi.fn(),
  fetchAgentExtensionsMock: vi.fn(),
  useSessionMock: vi.fn(),
  useParamsMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("../api", () => ({ fetchPool: fetchPoolMock }));

vi.mock("../api/extensions", () => ({
  fetchAgentExtensions: fetchAgentExtensionsMock,
}));

vi.mock("../api/teams", () => ({
  fetchTeams: fetchTeamsMock,
  fetchForks: fetchForksMock,
  assignPoolToTeam: assignPoolToTeamMock,
  reassignFork: reassignForkMock,
}));

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

function fork(partial: Partial<AgentFork> & { sourcePoolId: string }): AgentFork {
  return {
    forkAgentId: `fork__${partial.sourcePoolId}`,
    teamId: null,
    createdBy: "admin-1",
    createdAt: "now",
    assignedBy: null,
    assignedAt: null,
    ...partial,
  };
}

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
  fetchTeamsMock.mockReset().mockResolvedValue([] as Team[]);
  fetchForksMock.mockReset().mockResolvedValue([] as AgentFork[]);
  fetchAgentExtensionsMock.mockReset().mockResolvedValue([]);
  assignPoolToTeamMock.mockReset();
  reassignForkMock.mockReset();
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

  it("assigns a never-forked agent to a team via assignPoolToTeam", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    fetchForksMock.mockResolvedValue([]);
    fetchTeamsMock.mockResolvedValue([{ id: "t1", name: "Red" } as Team]);
    assignPoolToTeamMock.mockResolvedValue(fork({ sourcePoolId: "scribe", teamId: "t1" }));
    await mountEdit("scribe");

    const section = container.querySelector(".edit-agent-team");
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("Not assigned to a team");

    const select = container.querySelector<HTMLSelectElement>(
      ".edit-agent-team-select"
    )!;
    select.value = "t1";
    select.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = container.querySelector<HTMLButtonElement>(
      ".edit-agent-team-button"
    )!;
    expect(button.textContent).toBe("Assign");
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(assignPoolToTeamMock).toHaveBeenCalledWith("scribe", "t1");
    expect(reassignForkMock).not.toHaveBeenCalled();
  });

  it("moves an already-forked agent to another team via reassignFork", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    fetchForksMock.mockResolvedValue([
      fork({ sourcePoolId: "scribe", teamId: "t1" }),
    ]);
    fetchTeamsMock.mockResolvedValue([
      { id: "t1", name: "Red" } as Team,
      { id: "t2", name: "Blue" } as Team,
    ]);
    reassignForkMock.mockResolvedValue(fork({ sourcePoolId: "scribe", teamId: "t2" }));
    await mountEdit("scribe");

    const section = container.querySelector(".edit-agent-team");
    expect(section?.textContent).toContain("Assigned to");
    expect(section?.textContent).toContain("Red");

    const select = container.querySelector<HTMLSelectElement>(
      ".edit-agent-team-select"
    )!;
    expect(select.textContent).not.toContain("Red");
    expect(select.textContent).toContain("Blue");
    select.value = "t2";
    select.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = container.querySelector<HTMLButtonElement>(
      ".edit-agent-team-button"
    )!;
    expect(button.textContent).toBe("Move");
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reassignForkMock).toHaveBeenCalledWith("scribe", "t2");
    expect(assignPoolToTeamMock).not.toHaveBeenCalled();
  });

  it("does not render the team controls for a non-admin", async () => {
    setSession("user");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    await mountEdit("scribe");

    expect(container.querySelector(".edit-agent-team")).toBeNull();
  });

  it("lists extensions read-only with on/off state for an admin", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    fetchAgentExtensionsMock.mockResolvedValue([
      {
        id: "crm",
        displayName: "CRM",
        description: "CRM tools",
        builtIn: false,
        enabled: true,
        configJsonSchema: null,
        requiredSecrets: [],
        tier: "toggle-only",
      },
      {
        id: "mailer",
        displayName: "Mailer",
        description: "Email tools",
        builtIn: true,
        enabled: false,
        configJsonSchema: null,
        requiredSecrets: [],
        tier: "toggle-only",
      },
    ]);
    await mountEdit("scribe");

    expect(fetchAgentExtensionsMock).toHaveBeenCalledWith("scribe");
    const items = container.querySelectorAll(".edit-agent-ext-item");
    expect(items.length).toBe(2);

    const names = Array.from(
      container.querySelectorAll(".edit-agent-ext-name")
    ).map((el) => el.textContent);
    expect(names).toEqual(["CRM", "Mailer"]);

    const states = Array.from(
      container.querySelectorAll(".edit-agent-ext-state")
    ).map((el) => el.textContent);
    expect(states).toEqual(["On", "Off"]);

    // Read-only: no toggles/buttons in the extension list.
    expect(
      container.querySelector(".edit-agent-ext-item button")
    ).toBeNull();
    expect(
      container.querySelector(".edit-agent-ext-item input")
    ).toBeNull();
  });

  it("does not fetch extensions for a non-admin", async () => {
    setSession("user");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    await mountEdit("scribe");

    expect(fetchAgentExtensionsMock).not.toHaveBeenCalled();
    expect(container.querySelector(".edit-agent-extensions")).toBeNull();
  });
});
