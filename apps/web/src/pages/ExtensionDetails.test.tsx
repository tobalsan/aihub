// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { ExtensionCatalogEntry } from "../api/extensions";

const { fetchAgentExtensionsMock, useSessionMock, useParamsMock, navigateMock } =
  vi.hoisted(() => ({
    fetchAgentExtensionsMock: vi.fn(),
    useSessionMock: vi.fn(),
    useParamsMock: vi.fn(),
    navigateMock: vi.fn(),
  }));

vi.mock("../api/extensions", async () => {
  const actual = await vi.importActual<typeof import("../api/extensions")>(
    "../api/extensions"
  );
  return {
    ...actual,
    fetchAgentExtensions: fetchAgentExtensionsMock,
  };
});

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

import { ExtensionDetails } from "./ExtensionDetails";

function crmEntry(
  partial: Partial<ExtensionCatalogEntry> = {}
): ExtensionCatalogEntry {
  return {
    id: "crm",
    displayName: "CRM",
    description: "CRM tools",
    builtIn: false,
    enabled: true,
    configJsonSchema: null,
    requiredSecrets: [],
    configRoutePath: null,
    tier: "toggle-only",
    ...partial,
  };
}

function setSession(role: string | null) {
  useSessionMock.mockReturnValue(() => ({
    isPending: false,
    data: role ? { user: { role } } : { user: {} },
  }));
}

let container: HTMLElement;
let dispose: () => void;

async function mount(agentId: string, extensionId: string) {
  useParamsMock.mockReturnValue({ agentId, extensionId });
  dispose = render(() => <ExtensionDetails />, container);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  fetchAgentExtensionsMock.mockReset();
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

describe("ExtensionDetails", () => {
  it("renders the extension name, description, and settings placeholder", async () => {
    setSession("admin");
    fetchAgentExtensionsMock.mockResolvedValue([crmEntry()]);
    await mount("scribe", "crm");

    expect(fetchAgentExtensionsMock).toHaveBeenCalledWith("scribe");
    expect(container.querySelector(".ext-details-name")?.textContent).toBe(
      "CRM"
    );
    expect(container.querySelector(".ext-details-desc")?.textContent).toBe(
      "CRM tools"
    );
    expect(
      container.querySelector(".ext-details-settings")?.textContent
    ).toContain("hasn't adopted the configuration contract");
  });

  it("shows a not-found message when the extension id is unknown", async () => {
    setSession("admin");
    fetchAgentExtensionsMock.mockResolvedValue([crmEntry()]);
    await mount("scribe", "ghost");

    expect(container.textContent).toContain("Extension not found");
  });

  it("redirects a non-admin away from the page", async () => {
    setSession("user");
    fetchAgentExtensionsMock.mockResolvedValue([crmEntry()]);
    await mount("scribe", "crm");

    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
    expect(container.querySelector(".ext-details")).toBeNull();
  });
});
