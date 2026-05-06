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

function mockSlice(
  id: string,
  title: string,
  status: SliceRecord["frontmatter"]["status"],
  blockedBy?: string[]
): SliceRecord {
  return {
    ...MOCK_SLICE,
    id,
    projectId: id.match(/^(PRO-\d+)-S\d+$/)?.[1] ?? "PRO-1",
    frontmatter: {
      ...MOCK_SLICE.frontmatter,
      id,
      project_id: id.match(/^(PRO-\d+)-S\d+$/)?.[1] ?? "PRO-1",
      title,
      status,
      blocked_by: blockedBy,
    },
  };
}

let updateSliceMock: ReturnType<typeof vi.fn>;
let createSliceMock: ReturnType<typeof vi.fn>;
let fetchSlicesMock: ReturnType<typeof vi.fn>;
let fetchSubagentsMock: ReturnType<typeof vi.fn>;
let subagentChangeCallback: (() => void) | undefined;
let fileChangeCallbacks:
  | {
      onFileChanged?: (projectId: string, file: string) => void;
      onAgentChanged?: (projectId: string) => void;
      onError?: (error: string) => void;
    }
  | undefined;

vi.mock("../api", () => ({
  fetchSlices: (...args: unknown[]) => fetchSlicesMock(...args),
  fetchSubagents: (...args: unknown[]) => fetchSubagentsMock(...args),
  updateSlice: (...args: unknown[]) => updateSliceMock(...args),
  createSlice: (...args: unknown[]) => createSliceMock(...args),
  subscribeToSubagentChanges: vi.fn(
    (callbacks: { onSubagentChanged?: () => void }) => {
      subagentChangeCallback = callbacks.onSubagentChanged;
      return () => {};
    }
  ),
  subscribeToFileChanges: vi.fn(
    (callbacks: {
      onFileChanged?: (projectId: string, file: string) => void;
      onAgentChanged?: (projectId: string) => void;
      onError?: (error: string) => void;
    }) => {
      fileChangeCallbacks = callbacks;
      return () => {
        fileChangeCallbacks = undefined;
      };
    }
  ),
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
  fetchSubagentsMock = vi.fn(async () => ({ ok: true, data: { items: [] } }));
  createSliceMock = vi.fn(async () => ({
    ...MOCK_SLICE,
    id: "PRO-1-S02",
    frontmatter: {
      ...MOCK_SLICE.frontmatter,
      id: "PRO-1-S02",
      title: "New slice",
    },
  }));
  updateSliceMock = vi.fn(
    async (projectId: string, sliceId: string, payload: unknown) => ({
      ...MOCK_SLICE,
      frontmatter: {
        ...MOCK_SLICE.frontmatter,
        ...(payload as Record<string, unknown>),
      },
    })
  );
  fileChangeCallbacks = undefined;
  subagentChangeCallback = undefined;
});

afterEach(() => {
  document.body.removeChild(container);
  vi.useRealTimers();
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

  it("shows create slice API errors", async () => {
    createSliceMock.mockRejectedValueOnce(new Error("Cannot create slice"));
    render(() => <SliceKanbanWidget projectId="PRO-1" />, container);
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-kanban-column")).not.toBeNull();
    });

    const addButton = container.querySelector(
      ".slice-kanban-add-btn"
    ) as HTMLButtonElement;
    addButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = container.querySelector(
      ".slice-kanban-add-input"
    ) as HTMLInputElement;
    input.value = "New slice";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const form = container.querySelector(
      ".slice-kanban-add-form"
    ) as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true }));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Cannot create slice");
    });
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
      value: {
        effectAllowed: "",
        setData: vi.fn(),
        getData: vi.fn(() => "PRO-1-S01"),
        dropEffect: "",
      },
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
    const todoBadge = container.querySelectorAll(
      ".slice-kanban-column-count"
    )[0];
    expect(todoBadge?.textContent).toBe("1");
  });

  it("debounces matching project file changes before refetching slices", async () => {
    vi.useFakeTimers();
    render(() => <SliceKanbanWidget projectId="PRO-1" />, container);
    await vi.runAllTimersAsync();

    const initialCalls = fetchSlicesMock.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);
    expect(fileChangeCallbacks?.onFileChanged).toBeTypeOf("function");

    fileChangeCallbacks?.onFileChanged?.("PRO-2", "PRO-2_other/README.md");
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchSlicesMock.mock.calls.length).toBe(initialCalls);

    fileChangeCallbacks?.onFileChanged?.(
      "PRO-1",
      "PRO-1_test/slices/PRO-1-S01/README.md"
    );
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchSlicesMock.mock.calls.length).toBe(initialCalls);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSlicesMock.mock.calls.length).toBe(initialCalls + 1);
    vi.useRealTimers();
  });

  it("shows blocked badge and dims card when any blocker is non-terminal", async () => {
    fetchSlicesMock = vi.fn(async (projectId: string) => {
      if (projectId === "PRO-2") {
        return [mockSlice("PRO-2-S01", "External prerequisite", "in_progress")];
      }
      return [mockSlice("PRO-1-S01", "Auth flow", "todo", ["PRO-2-S01"])];
    });

    render(() => <SliceKanbanWidget projectId="PRO-1" />, container);
    await vi.waitFor(() => {
      expect(
        container.querySelector(".slice-card-blocked-badge")
      ).not.toBeNull();
    });

    const card = container.querySelector(".slice-kanban-card") as HTMLElement;
    const badge = container.querySelector(
      ".slice-card-blocked-badge"
    ) as HTMLElement;
    expect(card.classList.contains("blocked")).toBe(true);
    expect(badge.textContent).toContain("blocked");
    expect(badge.getAttribute("aria-label")).toBe("Blocked by PRO-2-S01");
    await vi.waitFor(() => {
      expect(badge.getAttribute("title")).toContain("PRO-2-S01: in_progress");
    });
  });

  it("does not show blocked badge when all blockers are terminal", async () => {
    fetchSlicesMock = vi.fn(async () => [
      mockSlice("PRO-1-S01", "Auth flow", "todo", [
        "PRO-1-S02",
        "PRO-1-S03",
        "PRO-1-S04",
      ]),
      mockSlice("PRO-1-S02", "Done prerequisite", "done"),
      mockSlice("PRO-1-S03", "Merge prerequisite", "ready_to_merge"),
      mockSlice("PRO-1-S04", "Cancelled prerequisite", "cancelled"),
    ]);

    render(() => <SliceKanbanWidget projectId="PRO-1" />, container);
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-kanban-card")).not.toBeNull();
    });

    const card = container.querySelector(".slice-kanban-card") as HTMLElement;
    expect(container.querySelector(".slice-card-blocked-badge")).toBeNull();
    expect(card.classList.contains("blocked")).toBe(false);
  });

  it("shows an active agent pill for running slice runs", async () => {
    fetchSubagentsMock = vi.fn(async () => ({
      ok: true,
      data: {
        items: [
          {
            slug: "worker",
            status: "running",
            sliceId: "PRO-1-S01",
          },
        ],
      },
    }));

    render(() => <SliceKanbanWidget projectId="PRO-1" />, container);

    await vi.waitFor(() => {
      expect(
        container.querySelector(".slice-card-agent-active")
      ).not.toBeNull();
    });
    expect(
      container
        .querySelector(".slice-card-agent-active")
        ?.getAttribute("aria-label")
    ).toBe("Agent active on slice PRO-1-S01");
  });

  it("removes the active agent pill after subagent changes refetch", async () => {
    vi.useFakeTimers();
    fetchSubagentsMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: [{ slug: "worker", status: "running", sliceId: "PRO-1-S01" }],
        },
      })
      .mockResolvedValue({
        ok: true,
        data: {
          items: [{ slug: "worker", status: "replied", sliceId: "PRO-1-S01" }],
        },
      });

    render(() => <SliceKanbanWidget projectId="PRO-1" />, container);
    await vi.waitFor(() => {
      expect(
        container.querySelector(".slice-card-agent-active")
      ).not.toBeNull();
    });

    subagentChangeCallback?.();
    await vi.advanceTimersByTimeAsync(250);

    await vi.waitFor(() => {
      expect(container.querySelector(".slice-card-agent-active")).toBeNull();
    });
  });
});
