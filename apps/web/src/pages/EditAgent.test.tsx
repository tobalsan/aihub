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
  patchAgentExtensionMock,
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
  patchAgentExtensionMock: vi.fn(),
  useSessionMock: vi.fn(),
  useParamsMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("../api", () => ({ fetchPool: fetchPoolMock }));

vi.mock("../api/extensions", () => ({
  fetchAgentExtensions: fetchAgentExtensionsMock,
  patchAgentExtension: patchAgentExtensionMock,
  autoFormPath: (agentId: string, extensionId: string) =>
    `/agents/${agentId}/extensions/${extensionId}/config`,
  detailsPath: (agentId: string, extensionId: string) =>
    `/agents/${agentId}/extensions/${extensionId}`,
}));

vi.mock("../api/teams", () => ({
  fetchTeams: fetchTeamsMock,
  fetchForks: fetchForksMock,
  assignPoolToTeam: assignPoolToTeamMock,
  reassignFork: reassignForkMock,
}));

vi.mock("../auth/client", () => ({ useSession: useSessionMock }));

function appendChildren(el: HTMLElement, children: unknown): void {
  if (children == null) return;
  if (Array.isArray(children)) {
    children.forEach((child) => appendChildren(el, child));
    return;
  }
  if (children instanceof Node) {
    el.appendChild(children);
    return;
  }
  el.appendChild(document.createTextNode(String(children)));
}

vi.mock("@solidjs/router", () => ({
  A: (props: { href: string; class?: string; children: unknown }) => {
    const a = document.createElement("a");
    a.setAttribute("href", props.href);
    if (props.class) a.className = props.class;
    appendChildren(a, props.children);
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
  patchAgentExtensionMock.mockReset();
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

  it("lists extensions with on/off toggle state for an admin", async () => {
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

    // The state is a clickable switch reflecting enabled via aria-checked.
    const toggles = container.querySelectorAll<HTMLButtonElement>(
      ".edit-agent-ext-item button.edit-agent-ext-state"
    );
    expect(toggles.length).toBe(2);
    expect(toggles[0].getAttribute("role")).toBe("switch");
    expect(toggles[0].getAttribute("aria-checked")).toBe("true");
    expect(toggles[0].getAttribute("aria-label")).toBe("Enable CRM");
    expect(toggles[1].getAttribute("aria-checked")).toBe("false");
    expect(toggles[1].getAttribute("aria-label")).toBe("Enable Mailer");
  });

  it("links the card body to the extension details page", async () => {
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
    ]);
    await mountEdit("scribe");

    const link = container.querySelector<HTMLAnchorElement>(
      ".edit-agent-ext-open"
    )!;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/agents/scribe/extensions/crm");
    // The name/desc still render inside the link, and the toggle stays a
    // separate sibling so clicking it never navigates.
    expect(link.querySelector(".edit-agent-ext-name")?.textContent).toBe(
      "CRM"
    );
    expect(link.contains(container.querySelector(".edit-agent-ext-state"))).toBe(
      false
    );
  });

  it("toggles an extension and persists via patchAgentExtension", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    fetchAgentExtensionsMock.mockResolvedValue([
      {
        id: "crm",
        displayName: "CRM",
        description: "CRM tools",
        builtIn: false,
        enabled: false,
        configJsonSchema: null,
        requiredSecrets: [],
        tier: "toggle-only",
      },
    ]);
    // Server returns the refreshed catalog with the flipped state.
    patchAgentExtensionMock.mockResolvedValue([
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
    ]);
    await mountEdit("scribe");

    const toggle = container.querySelector<HTMLButtonElement>(
      ".edit-agent-ext-item button.edit-agent-ext-state"
    )!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(patchAgentExtensionMock).toHaveBeenCalledWith("scribe", "crm", {
      enabled: true,
    });
    // UI reflects the server-confirmed state.
    const after = container.querySelector<HTMLButtonElement>(
      ".edit-agent-ext-item button.edit-agent-ext-state"
    )!;
    expect(after.getAttribute("aria-checked")).toBe("true");
  });

  it("redirects to the bespoke config route when enabling a bespoke-route extension", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    fetchAgentExtensionsMock.mockResolvedValue([
      {
        id: "mcp",
        displayName: "MCP",
        description: "File-based MCP config",
        builtIn: false,
        enabled: false,
        configJsonSchema: null,
        requiredSecrets: [],
        configRoutePath: "/agents/scribe/extensions/mcp",
        tier: "bespoke-route",
      },
    ]);
    patchAgentExtensionMock.mockResolvedValue([
      {
        id: "mcp",
        displayName: "MCP",
        description: "File-based MCP config",
        builtIn: false,
        enabled: true,
        configJsonSchema: null,
        requiredSecrets: [],
        configRoutePath: "/agents/scribe/extensions/mcp",
        tier: "bespoke-route",
      },
    ]);
    await mountEdit("scribe");

    container
      .querySelector<HTMLButtonElement>(
        ".edit-agent-ext-item button.edit-agent-ext-state"
      )!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(patchAgentExtensionMock).toHaveBeenCalledWith("scribe", "mcp", {
      enabled: true,
    });
    expect(navigateMock).toHaveBeenCalledWith("/agents/scribe/extensions/mcp");
  });

  it("redirects to the auto-form path when enabling an auto-form extension", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    const entry = {
      id: "exa",
      displayName: "Exa",
      description: "Search",
      builtIn: true,
      configJsonSchema: {
        type: "object",
        properties: { apiKey: { type: "string" } },
      },
      requiredSecrets: ["apiKey"],
      configRoutePath: null,
      tier: "auto-form" as const,
    };
    fetchAgentExtensionsMock.mockResolvedValue([{ ...entry, enabled: false }]);
    patchAgentExtensionMock.mockResolvedValue([{ ...entry, enabled: true }]);
    await mountEdit("scribe");

    container
      .querySelector<HTMLButtonElement>(
        ".edit-agent-ext-item button.edit-agent-ext-state"
      )!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(patchAgentExtensionMock).toHaveBeenCalledWith("scribe", "exa", {
      enabled: true,
    });
    expect(navigateMock).toHaveBeenCalledWith(
      "/agents/scribe/extensions/exa/config"
    );
  });

  it("flips a toggle-only extension inline with no redirect", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    const entry = {
      id: "crm",
      displayName: "CRM",
      description: "CRM tools",
      builtIn: false,
      configJsonSchema: null,
      requiredSecrets: [],
      configRoutePath: null,
      tier: "toggle-only" as const,
    };
    fetchAgentExtensionsMock.mockResolvedValue([{ ...entry, enabled: false }]);
    patchAgentExtensionMock.mockResolvedValue([{ ...entry, enabled: true }]);
    await mountEdit("scribe");

    container
      .querySelector<HTMLButtonElement>(
        ".edit-agent-ext-item button.edit-agent-ext-state"
      )!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(patchAgentExtensionMock).toHaveBeenCalledWith("scribe", "crm", {
      enabled: true,
    });
    // Toggle-only never redirects into a config surface.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("does not redirect when disabling a bespoke-route extension", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    const entry = {
      id: "mcp",
      displayName: "MCP",
      description: "File-based MCP config",
      builtIn: false,
      configJsonSchema: null,
      requiredSecrets: [],
      configRoutePath: "/agents/scribe/extensions/mcp",
      tier: "bespoke-route" as const,
    };
    fetchAgentExtensionsMock.mockResolvedValue([{ ...entry, enabled: true }]);
    patchAgentExtensionMock.mockResolvedValue([{ ...entry, enabled: false }]);
    await mountEdit("scribe");

    container
      .querySelector<HTMLButtonElement>(
        ".edit-agent-ext-item button.edit-agent-ext-state"
      )!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(patchAgentExtensionMock).toHaveBeenCalledWith("scribe", "mcp", {
      enabled: false,
    });
    // Turning a config surface off must not redirect into it.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows an error when a toggle fails to persist", async () => {
    setSession("admin");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    fetchAgentExtensionsMock.mockResolvedValue([
      {
        id: "crm",
        displayName: "CRM",
        description: "CRM tools",
        builtIn: false,
        enabled: false,
        configJsonSchema: null,
        requiredSecrets: [],
        tier: "toggle-only",
      },
    ]);
    patchAgentExtensionMock.mockRejectedValue(new Error("nope"));
    await mountEdit("scribe");

    container
      .querySelector<HTMLButtonElement>(
        ".edit-agent-ext-item button.edit-agent-ext-state"
      )!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector(".edit-agent-ext-error")?.textContent).toBe(
      "nope"
    );
    // State stays off since the write failed.
    expect(
      container
        .querySelector(".edit-agent-ext-item button.edit-agent-ext-state")
        ?.getAttribute("aria-checked")
    ).toBe("false");
  });

  it("does not fetch extensions for a non-admin", async () => {
    setSession("user");
    fetchPoolMock.mockResolvedValue([agent({ id: "scribe" })]);
    await mountEdit("scribe");

    expect(fetchAgentExtensionsMock).not.toHaveBeenCalled();
    expect(container.querySelector(".edit-agent-extensions")).toBeNull();
  });
});
