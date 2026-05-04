// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ProjectListGrouped } from "./ProjectListGrouped";
import type { BoardProject } from "../../api/types";

// jsdom doesn't implement DragEvent — provide a minimal polyfill
if (typeof DragEvent === "undefined") {
  // @ts-expect-error jsdom polyfill
  globalThis.DragEvent = class DragEvent extends MouseEvent {
    dataTransfer = null;
    constructor(type: string, init?: EventInit) {
      super(type, { bubbles: true, cancelable: true, ...init });
    }
  };
}

// ── Mocks ──────────────────────────────────────────────────────────

const { moveBoardProjectMock } = vi.hoisted(() => ({
  moveBoardProjectMock: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  moveBoardProject: moveBoardProjectMock,
}));

// ── Helpers ────────────────────────────────────────────────────────

function makeProject(
  overrides: Partial<BoardProject> & { id: string }
): BoardProject {
  return {
    title: overrides.id,
    area: "",
    status: "active",
    lifecycleStatus: "active",
    group: "active",
    created: "2026-01-01",
    sliceProgress: { done: 0, total: 0 },
    lastActivity: null,
    activeRunCount: 0,
    worktrees: [],
    ...overrides,
  };
}

const TEST_AREAS = [
  { id: "infra", name: "Infrastructure" },
  { id: "web", name: "Web" },
];

let container: HTMLElement;
let dispose: () => void;

beforeEach(() => {
  moveBoardProjectMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  dispose?.();
  document.body.removeChild(container);
});

function renderComponent(projects: BoardProject[], extraProps = {}) {
  dispose = render(
    () => (
      <ProjectListGrouped
        projects={projects}
        areas={TEST_AREAS}
        {...extraProps}
      />
    ),
    container
  );
}

// ── Group rendering ────────────────────────────────────────────────

describe("ProjectListGrouped — group rendering", () => {
  it("renders all four group sections", () => {
    renderComponent([]);
    expect(
      container.querySelector('[data-testid="group-section-active"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="group-section-shaping"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="group-section-done"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="group-section-cancelled"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="group-section-archived"]')
    ).toBeTruthy();
  });

  it("groups projects by lifecycleStatus", () => {
    const projects = [
      makeProject({ id: "PRO-001", lifecycleStatus: "active" }),
      makeProject({ id: "PRO-002", lifecycleStatus: "shaping" }),
      makeProject({ id: "PRO-003", lifecycleStatus: "done", status: "done" }),
      makeProject({ id: "PRO-004", lifecycleStatus: "cancelled", status: "cancelled" }),
    ];
    renderComponent(projects);
    // active and shaping are expanded by default
    expect(
      container
        .querySelector('[data-testid="group-section-active"]')
        ?.querySelector('[data-testid="project-card-PRO-001"]')
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-testid="group-section-shaping"]')
        ?.querySelector('[data-testid="project-card-PRO-002"]')
    ).toBeTruthy();
    // done and cancelled are collapsed — expand headers first
    (container.querySelector('[data-testid="group-header-done"]') as HTMLElement)?.click();
    expect(
      container
        .querySelector('[data-testid="group-section-done"]')
        ?.querySelector('[data-testid="project-card-PRO-003"]')
    ).toBeTruthy();
    (container.querySelector('[data-testid="group-header-cancelled"]') as HTMLElement)?.click();
    expect(
      container
        .querySelector('[data-testid="group-section-cancelled"]')
        ?.querySelector('[data-testid="project-card-PRO-004"]')
    ).toBeTruthy();
  });

  it("does not render archived projects", () => {
    const projects = [
      makeProject({
        id: "PRO-ARC",
        lifecycleStatus: "archived",
        status: "archived",
      }),
    ];
    renderComponent(projects);
    expect(
      container.querySelector('[data-testid="project-card-PRO-ARC"]')
    ).toBeNull();
  });

  it("does not render the synthetic unassigned project", () => {
    const projects = [
      makeProject({
        id: "__unassigned",
        title: "Unassigned",
        status: "unassigned",
        lifecycleStatus: "shaping",
      }),
    ];
    renderComponent(projects);
    expect(
      container.querySelector('[data-testid="project-card-__unassigned"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="project-list-empty"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="group-count-shaping"]')
        ?.textContent
    ).toContain("0");
  });

  it("shows count in group headers", () => {
    const projects = [
      makeProject({ id: "PRO-001", lifecycleStatus: "active" }),
      makeProject({ id: "PRO-002", lifecycleStatus: "active" }),
    ];
    renderComponent(projects);
    const count = container.querySelector('[data-testid="group-count-active"]');
    expect(count?.textContent).toContain("2");
  });

  it("done and cancelled groups are collapsed by default", () => {
    const projects = [
      makeProject({ id: "PRO-D1", lifecycleStatus: "done", status: "done" }),
      makeProject({
        id: "PRO-C1",
        lifecycleStatus: "cancelled",
        status: "cancelled",
      }),
    ];
    renderComponent(projects);
    // Cards should NOT be visible when collapsed
    expect(
      container.querySelector('[data-testid="project-card-PRO-D1"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="project-card-PRO-C1"]')
    ).toBeNull();
  });

  it("active and shaping groups expanded by default", () => {
    const projects = [
      makeProject({ id: "PRO-A1", lifecycleStatus: "active" }),
      makeProject({ id: "PRO-S1", lifecycleStatus: "shaping" }),
    ];
    renderComponent(projects);
    expect(
      container.querySelector('[data-testid="project-card-PRO-A1"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="project-card-PRO-S1"]')
    ).toBeTruthy();
  });

  it("toggling done group shows cards", () => {
    const projects = [
      makeProject({ id: "PRO-D1", lifecycleStatus: "done", status: "done" }),
    ];
    renderComponent(projects);
    // Click header to expand
    const header = container.querySelector(
      '[data-testid="group-header-done"]'
    ) as HTMLElement;
    header?.click();
    expect(
      container.querySelector('[data-testid="project-card-PRO-D1"]')
    ).toBeTruthy();
  });

  it("shows empty state when no projects", () => {
    renderComponent([]);
    expect(
      container.querySelector('[data-testid="project-list-empty"]')
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="create-cta"]')
    ).toBeTruthy();
  });

  it("shows loading skeleton", () => {
    dispose = render(
      () => (
        <ProjectListGrouped
          projects={[]}
          areas={[]}
          loading={true}
        />
      ),
      container
    );
    expect(
      container.querySelector('[data-testid="project-list-loading"]')
    ).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="skeleton-row"]').length).toBeGreaterThan(0);
  });

  it("shows error state with retry button", () => {
    const onRetry = vi.fn();
    dispose = render(
      () => (
        <ProjectListGrouped
          projects={[]}
          areas={[]}
          error="Network error"
          onRetry={onRetry}
        />
      ),
      container
    );
    const errorEl = container.querySelector('[data-testid="project-list-error"]');
    expect(errorEl).toBeTruthy();
    const retry = container.querySelector('[data-testid="retry-button"]') as HTMLElement;
    retry?.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// ── Card content ───────────────────────────────────────────────────

describe("ProjectListGrouped — card content", () => {
  it("renders project ID, status pill, title, progress, activity", () => {
    const projects = [
      makeProject({
        id: "PRO-100",
        title: "My Feature",
        lifecycleStatus: "active",
        sliceProgress: { done: 2, total: 5 },
        lastActivity: new Date(Date.now() - 3 * 60_000).toISOString(),
        activeRunCount: 1,
        area: "infra",
      }),
    ];
    renderComponent(projects);
    const card = container.querySelector('[data-testid="project-card-PRO-100"]')!;
    expect(card.querySelector('[data-testid="project-id"]')?.textContent).toContain("PRO-100");
    expect(card.querySelector('[data-testid="status-pill-active"]')).toBeTruthy();
    expect(card.querySelector('[data-testid="project-title"]')?.textContent).toContain("My Feature");
    expect(card.querySelector('[data-testid="progress-bar-label"]')?.textContent).toContain("2/5");
    expect(card.querySelector('[data-testid="active-run-dot"]')).toBeTruthy();
    expect(card.querySelector('[data-testid="project-last-activity"]')?.textContent).toMatch(/ago/);
    expect(card.querySelector('[data-testid="project-area-chip"]')?.textContent).toContain("Infrastructure");
  });

  it("omits active run dot when no runs", () => {
    const projects = [
      makeProject({
        id: "PRO-101",
        lifecycleStatus: "active",
        activeRunCount: 0,
      }),
    ];
    renderComponent(projects);
    expect(
      container.querySelector('[data-testid="project-card-PRO-101"] [data-testid="active-run-dot"]')
    ).toBeNull();
  });
});

// ── Search ─────────────────────────────────────────────────────────

describe("ProjectListGrouped — search", () => {
  it("filters by title", () => {
    const projects = [
      makeProject({ id: "PRO-001", title: "Auth flow", lifecycleStatus: "active" }),
      makeProject({ id: "PRO-002", title: "Payment gateway", lifecycleStatus: "active" }),
    ];
    renderComponent(projects);
    const search = container.querySelector('[data-testid="project-search"]') as HTMLInputElement;
    search.value = "auth";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(container.querySelector('[data-testid="project-card-PRO-001"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="project-card-PRO-002"]')).toBeNull();
  });

  it("filters by project ID", () => {
    const projects = [
      makeProject({ id: "PRO-001", title: "Alpha", lifecycleStatus: "active" }),
      makeProject({ id: "PRO-002", title: "Beta", lifecycleStatus: "active" }),
    ];
    renderComponent(projects);
    const search = container.querySelector('[data-testid="project-search"]') as HTMLInputElement;
    search.value = "PRO-002";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(container.querySelector('[data-testid="project-card-PRO-001"]')).toBeNull();
    expect(container.querySelector('[data-testid="project-card-PRO-002"]')).toBeTruthy();
  });
});

// ── Area filter chips ─────────────────────────────────────────────

describe("ProjectListGrouped — area filter chips", () => {
  it("renders area chips", () => {
    renderComponent([]);
    expect(container.querySelector('[data-testid="area-chip-all"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="area-chip-infra"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="area-chip-web"]')).toBeTruthy();
  });

  it("filters by area when chip clicked", () => {
    const projects = [
      makeProject({ id: "PRO-001", lifecycleStatus: "active", area: "infra" }),
      makeProject({ id: "PRO-002", lifecycleStatus: "active", area: "web" }),
    ];
    renderComponent(projects);
    const chip = container.querySelector('[data-testid="area-chip-infra"]') as HTMLElement;
    chip?.click();
    expect(container.querySelector('[data-testid="project-card-PRO-001"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="project-card-PRO-002"]')).toBeNull();
  });

  it("All chip resets filter", () => {
    const projects = [
      makeProject({ id: "PRO-001", lifecycleStatus: "active", area: "infra" }),
      makeProject({ id: "PRO-002", lifecycleStatus: "active", area: "web" }),
    ];
    renderComponent(projects);
    // Filter to infra
    (container.querySelector('[data-testid="area-chip-infra"]') as HTMLElement)?.click();
    expect(container.querySelector('[data-testid="project-card-PRO-002"]')).toBeNull();
    // Reset
    (container.querySelector('[data-testid="area-chip-all"]') as HTMLElement)?.click();
    expect(container.querySelector('[data-testid="project-card-PRO-002"]')).toBeTruthy();
  });
});

// ── Drag and drop ──────────────────────────────────────────────────

describe("ProjectListGrouped — drag and optimistic revert", () => {
  it("calls moveBoardProject on drop and shows optimistic update", async () => {
    let resolveMove: (value: {
      ok: true;
      status: string;
      previousStatus: string;
    }) => void = () => {};
    moveBoardProjectMock.mockReturnValue(
      new Promise((resolve) => {
        resolveMove = resolve;
      })
    );

    const projects = [
      makeProject({ id: "PRO-001", lifecycleStatus: "active" }),
    ];
    renderComponent(projects);

    // Simulate dragstart on card (active group is expanded by default)
    const card = container.querySelector('[data-testid="project-card-PRO-001"]') as HTMLElement;
    card?.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));

    // Drop on shaping zone (also expanded by default)
    const shapingZone = container.querySelector('[data-testid="group-drop-zone-shaping"]') as HTMLElement;
    shapingZone?.dispatchEvent(new DragEvent("drop", { bubbles: true }));

    expect(
      container
        .querySelector('[data-testid="group-section-shaping"]')
        ?.querySelector('[data-testid="project-card-PRO-001"]')
    ).toBeTruthy();

    // Wait for async
    await vi.waitFor(() => {
      expect(moveBoardProjectMock).toHaveBeenCalledWith("PRO-001", "shaping");
    });
    resolveMove({ ok: true, status: "shaping", previousStatus: "active" });
  });

  it("moves through the keyboard status select without opening detail", async () => {
    moveBoardProjectMock.mockResolvedValue({
      ok: true,
      status: "done",
      previousStatus: "active",
    });
    const onProjectClick = vi.fn();
    renderComponent(
      [makeProject({ id: "PRO-004", lifecycleStatus: "active" })],
      { onProjectClick }
    );

    const select = container.querySelector(
      '[data-testid="project-status-select-PRO-004"]'
    ) as HTMLSelectElement;
    select.value = "done";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect(moveBoardProjectMock).toHaveBeenCalledWith("PRO-004", "done");
    });
    expect(onProjectClick).not.toHaveBeenCalled();
  });

  it("drops to archived and hides the project optimistically", async () => {
    moveBoardProjectMock.mockResolvedValue({
      ok: true,
      status: "archived",
      previousStatus: "done",
    });
    renderComponent([
      makeProject({ id: "PRO-005", lifecycleStatus: "done", status: "done" }),
    ]);
    (container.querySelector('[data-testid="group-header-done"]') as HTMLElement)
      ?.click();

    const card = container.querySelector(
      '[data-testid="project-card-PRO-005"]'
    ) as HTMLElement;
    card.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));
    const archivedZone = container.querySelector(
      '[data-testid="group-drop-zone-archived"]'
    ) as HTMLElement;
    archivedZone.dispatchEvent(new DragEvent("drop", { bubbles: true }));

    await vi.waitFor(() => {
      expect(moveBoardProjectMock).toHaveBeenCalledWith("PRO-005", "archived");
    });
    expect(
      container.querySelector('[data-testid="project-card-PRO-005"]')
    ).toBeNull();
  });

  it("reverts optimistic update and shows error toast on rejection", async () => {
    moveBoardProjectMock.mockResolvedValue({
      ok: false,
      error: "Cannot mark done: 2 slice(s) not yet finished",
      code: "slices_not_terminal",
    });

    const toastMessages: string[] = [];
    const projects = [
      makeProject({ id: "PRO-002", lifecycleStatus: "active" }),
    ];
    dispose = render(
      () => (
        <ProjectListGrouped
          projects={projects}
          areas={[]}
          onToast={(msg) => toastMessages.push(msg)}
        />
      ),
      container
    );

    const card = container.querySelector('[data-testid="project-card-PRO-002"]') as HTMLElement;
    card?.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));

    // Drop on shaping (expanded, always visible)
    const shapingZone = container.querySelector('[data-testid="group-drop-zone-shaping"]') as HTMLElement;
    shapingZone?.dispatchEvent(new DragEvent("drop", { bubbles: true }));

    await vi.waitFor(() => {
      expect(moveBoardProjectMock).toHaveBeenCalledWith("PRO-002", "shaping");
    });

    // Toast with error
    await vi.waitFor(() => {
      expect(toastMessages).toContain("Cannot mark done: 2 slice(s) not yet finished");
    });

    // Card should still be in active group (reverted)
    expect(
      container
        .querySelector('[data-testid="group-section-active"]')
        ?.querySelector('[data-testid="project-card-PRO-002"]')
    ).toBeTruthy();
  });

  it("renders error toast with close button", async () => {
    moveBoardProjectMock.mockResolvedValue({
      ok: false,
      error: "Terminal status error",
      code: "terminal_status",
    });

    const projects = [
      makeProject({ id: "PRO-003", lifecycleStatus: "active" }),
    ];
    renderComponent(projects);

    const card = container.querySelector('[data-testid="project-card-PRO-003"]') as HTMLElement;
    card?.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));
    // Drop on shaping zone (expanded and visible)
    const shapingZone = container.querySelector('[data-testid="group-drop-zone-shaping"]') as HTMLElement;
    shapingZone?.dispatchEvent(new DragEvent("drop", { bubbles: true }));

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="toast-error"]')).toBeTruthy();
    });

    // Close the toast
    const closeBtn = container.querySelector('[data-testid="toast-close"]') as HTMLElement;
    closeBtn?.click();
    expect(container.querySelector('[data-testid="toast-error"]')).toBeNull();
  });
});
