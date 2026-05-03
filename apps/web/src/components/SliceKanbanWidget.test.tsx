// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { SliceKanbanWidget } from "./SliceKanbanWidget";
import type { SliceRecord } from "../api/types";

const MOCK_SLICE: SliceRecord = {
  id: "PRO-1-S01",
  projectId: "PRO-1",
  dirPath: "/tmp/PRO-1/slices/PRO-1-S01",
  frontmatter: {
    id: "PRO-1-S01",
    project_id: "PRO-1",
    title: "Auth flow",
    status: "todo",
    hill_position: "figuring",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  docs: {
    readme: "## Must\n- login\n\n## Nice\n- ~2FA",
    specs: "# Specs\n",
    tasks: "- [ ] Implement login\n- [x] DB schema",
    validation: "- [ ] Login works\n",
    thread: "",
  },
};

let updateSliceMock: ReturnType<typeof vi.fn>;
let fetchSlicesMock: ReturnType<typeof vi.fn>;

vi.mock("../api/client", () => ({
  fetchSlices: (...args: unknown[]) => fetchSlicesMock(...args),
  updateSlice: (...args: unknown[]) => updateSliceMock(...args),
  createSlice: vi.fn(async () => ({
    ...MOCK_SLICE,
    id: "PRO-1-S02",
    frontmatter: { ...MOCK_SLICE.frontmatter, id: "PRO-1-S02", title: "New slice" },
  })),
  subscribeToFileChanges: vi.fn(() => () => {}),
}));

// Router mock (useNavigate)
vi.mock("@solidjs/router", () => ({
  useNavigate: () => vi.fn(),
}));

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  fetchSlicesMock = vi.fn(async () => [MOCK_SLICE]);
  updateSliceMock = vi.fn(async (projectId: string, sliceId: string, payload: unknown) => ({
    ...MOCK_SLICE,
    frontmatter: { ...MOCK_SLICE.frontmatter, ...(payload as Record<string, unknown>) },
  }));
});

afterEach(() => {
  document.body.removeChild(container);
});

describe("SliceKanbanWidget", () => {
  it("renders all six columns", async () => {
    render(() => <SliceKanbanWidget projectId="PRO-1" />, container);
    await vi.waitFor(() => {
      const cols = container.querySelectorAll(".slice-kanban-column");
      expect(cols.length).toBe(6);
    });
    const titles = Array.from(
      container.querySelectorAll(".slice-kanban-column-title")
    ).map((el) => el.textContent);
    expect(titles).toContain("Todo");
    expect(titles).toContain("In Progress");
    expect(titles).toContain("Review");
    expect(titles).toContain("Ready to Merge");
    expect(titles).toContain("Done");
    expect(titles).toContain("Cancelled");
  });

  it("renders slice card in todo column", async () => {
    render(() => <SliceKanbanWidget projectId="PRO-1" />, container);
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-kanban-card")).not.toBeNull();
    });
    const card = container.querySelector(".slice-kanban-card");
    expect(card?.textContent).toContain("Auth flow");
    expect(card?.textContent).toContain("PRO-1-S01");
  });

  it("calls updateSlice with new status on drop", async () => {
    render(() => <SliceKanbanWidget projectId="PRO-1" />, container);
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-kanban-card")).not.toBeNull();
    });

    const card = container.querySelector(".slice-kanban-card") as HTMLElement;
    const columns = container.querySelectorAll(".slice-kanban-column");
    // column index 1 = in_progress
    const inProgressCol = columns[1] as HTMLElement;

    // jsdom does not implement DragEvent — use a polyfill approach:
    // Directly invoke the internal signals by triggering synthetic events via MouseEvent.
    // We test the observable outcome: updateSlice is called when drop fires.
    const makeEvent = (type: string, extra?: EventInit) => {
      // Fallback to CustomEvent when DragEvent is unavailable in jsdom
      const EventCtor =
        typeof DragEvent !== "undefined" ? DragEvent : CustomEvent;
      return new EventCtor(type, { bubbles: true, cancelable: true, ...extra });
    };

    const dragStart = makeEvent("dragstart");
    Object.defineProperty(dragStart, "dataTransfer", {
      value: { effectAllowed: "", setData: vi.fn(), getData: vi.fn(() => "PRO-1-S01"), dropEffect: "" },
      configurable: true,
    });
    card.dispatchEvent(dragStart);

    const dragOver = makeEvent("dragover");
    inProgressCol.dispatchEvent(dragOver);

    const drop = makeEvent("drop");
    Object.defineProperty(drop, "dataTransfer", {
      value: { getData: vi.fn(() => "PRO-1-S01") },
      configurable: true,
    });
    inProgressCol.dispatchEvent(drop);

    await vi.waitFor(() => {
      expect(updateSliceMock).toHaveBeenCalledWith(
        "PRO-1",
        "PRO-1-S01",
        expect.objectContaining({ status: "in_progress" })
      );
    });
  });

  it("renders count badge on each column", async () => {
    render(() => <SliceKanbanWidget projectId="PRO-1" />, container);
    await vi.waitFor(() => {
      const badges = container.querySelectorAll(".slice-kanban-column-count");
      expect(badges.length).toBe(6);
    });
    // todo column should show count 1
    const todoBadge = container.querySelectorAll(".slice-kanban-column-count")[0];
    expect(todoBadge?.textContent).toBe("1");
  });
});
