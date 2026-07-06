// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { Agent } from "../api/types";
import type { PoolCatalogEntry } from "../api/teams";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  fetchPoolMock,
  fetchPoolActionsMock,
  useSessionMock,
} = vi.hoisted(() => ({
  fetchPoolMock: vi.fn(),
  fetchPoolActionsMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock("../api", () => ({ fetchPool: fetchPoolMock }));

vi.mock("../api/teams", () => ({
  fetchPoolActions: fetchPoolActionsMock,
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
  chatAgentId: string | null = action === "chat" ? poolId : null,
  overrides: Partial<Pick<PoolCatalogEntry, "reason" | "teamName">> = {}
): PoolCatalogEntry {
  return {
    poolId,
    forked: action !== "assign_to_team",
    chatAgentId,
    action,
    reason: overrides.reason ?? (action === "none" ? "unassigned" : null),
    teamName: overrides.teamName ?? null,
  };
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
    expect(chat?.getAttribute("href")).toBe("/chat/scribe");
  });

  it("shows the unassigned message and no Chat link when action is none", async () => {
    setSession("user");
    fetchPoolMock.mockResolvedValue([agent("scout")]);
    fetchPoolActionsMock.mockResolvedValue([entry("scout", "none")]);
    await mountCatalog();

    expect(container.querySelector(".catalog-chat-link")).toBeNull();
    expect(container.querySelector(".catalog-unavailable")).not.toBeNull();
    expect(container.textContent).toContain(
      "This agent has not been assigned to a team."
    );
  });

  it("shows '<team name> Team' for a non-admin viewing another team's agent", async () => {
    setSession("user");
    fetchPoolMock.mockResolvedValue([agent("scout")]);
    fetchPoolActionsMock.mockResolvedValue([
      entry("scout", "none", null, { reason: "other_team", teamName: "Green" }),
    ]);
    await mountCatalog();

    expect(container.querySelector(".catalog-chat-link")).toBeNull();
    expect(container.textContent).toContain("Green Team");
  });

  it("shows the no-workspace message for an admin on a broken fork", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent("scribe")]);
    fetchPoolActionsMock.mockResolvedValue([
      entry("scribe", "none", null, { reason: "no_workspace", teamName: "Red" }),
    ]);
    await mountCatalog();

    expect(container.textContent).toContain("This agent has no workspace.");
  });

  it("no longer renders inline team assign/move controls", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent("fresh")]);
    fetchPoolActionsMock.mockResolvedValue([entry("fresh", "assign_to_team")]);
    await mountCatalog();

    // Team assignment moved to the Edit-Agent page; cards have no picker.
    expect(container.querySelector(".catalog-assign")).toBeNull();
    expect(container.textContent).not.toContain("Assign to team");
    expect(container.textContent).not.toContain("Move to team");
  });

  it("shows the unassigned message for an admin's assign_to_team card", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent("fresh")]);
    fetchPoolActionsMock.mockResolvedValue([entry("fresh", "assign_to_team")]);
    await mountCatalog();

    expect(container.querySelector(".catalog-unavailable")).not.toBeNull();
    expect(container.textContent).toContain(
      "This agent has not been assigned to a team."
    );
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
