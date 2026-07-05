// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { Agent } from "../api/types";
import type { AgentFork, PoolCatalogEntry, Team } from "../api/teams";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  fetchPoolMock,
  fetchPoolActionsMock,
  fetchForksMock,
  fetchTeamsMock,
  assignPoolToTeamMock,
  reassignForkMock,
  useSessionMock,
} = vi.hoisted(() => ({
  fetchPoolMock: vi.fn(),
  fetchPoolActionsMock: vi.fn(),
  fetchForksMock: vi.fn(),
  fetchTeamsMock: vi.fn(),
  assignPoolToTeamMock: vi.fn(),
  reassignForkMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock("../api", () => ({ fetchPool: fetchPoolMock }));

vi.mock("../api/teams", () => ({
  fetchPoolActions: fetchPoolActionsMock,
  fetchForks: fetchForksMock,
  fetchTeams: fetchTeamsMock,
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
}));

import { AgentCatalog } from "./AgentCatalog";

// ── Helpers ───────────────────────────────────────────────────────────────────

function agent(id: string): Agent {
  return { id, name: id } as Agent;
}

function entry(
  poolId: string,
  action: PoolCatalogEntry["action"],
  chatAgentId: string | null = action === "chat" ? `fork__${poolId}` : null
): PoolCatalogEntry {
  return { poolId, forked: action !== "assign_to_team", chatAgentId, action };
}

function setSession(role: string | null) {
  useSessionMock.mockReturnValue(() => ({
    data: role ? { user: { role } } : { user: {} },
  }));
}

let container: HTMLElement;
let dispose: () => void;

async function mountCatalog() {
  dispose = render(() => <AgentCatalog />, container);
  // Let the createResource promises resolve + render.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  fetchPoolMock.mockReset();
  fetchPoolActionsMock.mockReset();
  fetchForksMock.mockReset().mockResolvedValue([] as AgentFork[]);
  fetchTeamsMock.mockReset().mockResolvedValue([] as Team[]);
  assignPoolToTeamMock.mockReset();
  reassignForkMock.mockReset();
  useSessionMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  dispose?.();
  container.remove();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AgentCatalog action states", () => {
  it("shows a Chat link routed to the fork agent id when action is chat", async () => {
    setSession("user");
    fetchPoolMock.mockResolvedValue([agent("scribe")]);
    fetchPoolActionsMock.mockResolvedValue([entry("scribe", "chat")]);
    await mountCatalog();

    const chat = container.querySelector<HTMLAnchorElement>(
      ".catalog-chat-link"
    );
    expect(chat).not.toBeNull();
    expect(chat?.getAttribute("href")).toBe("/chat/fork__scribe");
  });

  it("shows 'Not available' and no Chat link when action is none", async () => {
    setSession("user");
    fetchPoolMock.mockResolvedValue([agent("scout")]);
    fetchPoolActionsMock.mockResolvedValue([entry("scout", "none")]);
    await mountCatalog();

    expect(container.querySelector(".catalog-chat-link")).toBeNull();
    expect(container.querySelector(".catalog-unavailable")).not.toBeNull();
    expect(container.textContent).toContain("Not available");
  });

  it("shows the Assign-to-team picker for an admin on an unforked agent", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent("fresh")]);
    fetchPoolActionsMock.mockResolvedValue([entry("fresh", "assign_to_team")]);
    fetchTeamsMock.mockResolvedValue([
      { id: "t1", name: "Red" } as Team,
    ]);
    await mountCatalog();

    // No chat action, but the admin assign UI is present.
    expect(container.querySelector(".catalog-chat-link")).toBeNull();
    const assign = container.querySelector(".catalog-assign");
    expect(assign).not.toBeNull();
    expect(container.textContent).toContain("Assign to team");
  });

  it("shows Chat AND the reassign picker for an admin on an existing fork", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent("scribe")]);
    fetchPoolActionsMock.mockResolvedValue([entry("scribe", "chat")]);
    fetchForksMock.mockResolvedValue([
      {
        sourcePoolId: "scribe",
        forkAgentId: "fork__scribe",
        teamId: "t1",
        createdBy: "admin-1",
        createdAt: "now",
        assignedBy: "admin-1",
        assignedAt: "now",
      } satisfies AgentFork,
    ]);
    fetchTeamsMock.mockResolvedValue([
      { id: "t1", name: "Red" } as Team,
      { id: "t2", name: "Blue" } as Team,
    ]);
    await mountCatalog();

    expect(container.querySelector(".catalog-chat-link")).not.toBeNull();
    expect(container.querySelector(".catalog-assign")).not.toBeNull();
    // Move-to-team wording once forked.
    expect(container.textContent).toContain("Move to team");
  });

  it("does not show the assign picker to a non-admin", async () => {
    setSession("user");
    fetchPoolMock.mockResolvedValue([agent("fresh")]);
    fetchPoolActionsMock.mockResolvedValue([entry("fresh", "none")]);
    await mountCatalog();

    expect(container.querySelector(".catalog-assign")).toBeNull();
  });

  it("shows an admin an edit icon linking to the agent's edit route", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent("scribe")]);
    fetchPoolActionsMock.mockResolvedValue([entry("scribe", "chat")]);
    await mountCatalog();

    const edit = container.querySelector<HTMLAnchorElement>(".catalog-edit");
    expect(edit).not.toBeNull();
    expect(edit?.getAttribute("href")).toBe("/agents/scribe/edit");
  });

  it("does not show the edit icon to a non-admin", async () => {
    setSession("user");
    fetchPoolMock.mockResolvedValue([agent("scribe")]);
    fetchPoolActionsMock.mockResolvedValue([entry("scribe", "chat")]);
    await mountCatalog();

    expect(container.querySelector(".catalog-edit")).toBeNull();
  });
});
