// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { SliceDetailPage } from "./SliceDetailPage";
import type { SliceRecord } from "../api/types";

const MOCK_SLICE: SliceRecord = {
  id: "PRO-1-S01",
  projectId: "PRO-1",
  dirPath: "/tmp/PRO-1/slices/PRO-1-S01",
  frontmatter: {
    id: "PRO-1-S01",
    project_id: "PRO-1",
    title: "Auth flow",
    status: "in_progress",
    hill_position: "executing",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  },
  docs: {
    readme: "## Must\n- login\n\n## Nice\n- ~2FA",
    specs: "# Specs\nImplement OAuth login.",
    tasks: "- [ ] Implement login\n- [x] DB schema",
    validation: "- [ ] Login works end-to-end\n",
    thread:
      "## 2026-01-02T00:00:00.000Z\n\nWorker: **Done** with [auth](https://example.com).\n\n<script>alert(1)</script>\n",
  },
};

let fetchSliceMock: ReturnType<typeof vi.fn>;
let fetchSlicesMock: ReturnType<typeof vi.fn>;

vi.mock("../api/client", () => ({
  fetchSlices: (...args: unknown[]) => fetchSlicesMock(...args),
  fetchSlice: (...args: unknown[]) => fetchSliceMock(...args),
  updateSlice: vi.fn(async () => MOCK_SLICE),
  subscribeToFileChanges: vi.fn(() => () => {}),
  fetchSubagents: vi.fn(async () => ({ ok: true as const, data: { items: [] } })),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ projectId: "PRO-1", sliceId: "PRO-1-S01" }),
}));

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  fetchSliceMock = vi.fn(async () => MOCK_SLICE);
  fetchSlicesMock = vi.fn(async () => [MOCK_SLICE]);
});

afterEach(() => {
  document.body.removeChild(container);
});

describe("SliceDetailPage", () => {
  it("renders slice title and ID in breadcrumb", async () => {
    render(() => <SliceDetailPage />, container);
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-detail-id")).not.toBeNull();
    });
    expect(container.querySelector(".slice-detail-id")?.textContent).toBe("PRO-1-S01");
    expect(container.querySelector(".slice-detail-title-crumb")?.textContent).toBe("Auth flow");
  });

  it("renders status pill with current status", async () => {
    render(() => <SliceDetailPage />, container);
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-detail-status-pill")).not.toBeNull();
    });
    expect(container.querySelector(".slice-detail-status-pill")?.textContent).toBe("In Progress");
  });

  it("renders frontmatter metadata in sidebar", async () => {
    render(() => <SliceDetailPage />, container);
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-detail-sidebar")).not.toBeNull();
    });
    const sidebar = container.querySelector(".slice-detail-sidebar")!;
    expect(sidebar.textContent).toContain("executing"); // hill_position
  });

  it("renders blockers list with count and statuses", async () => {
    fetchSliceMock = vi.fn(async () => ({
      ...MOCK_SLICE,
      frontmatter: {
        ...MOCK_SLICE.frontmatter,
        blocked_by: ["PRO-1-S02", "PRO-1-S03"],
      },
    }));
    fetchSlicesMock = vi.fn(async () => [
      MOCK_SLICE,
      {
        ...MOCK_SLICE,
        id: "PRO-1-S02",
        frontmatter: {
          ...MOCK_SLICE.frontmatter,
          id: "PRO-1-S02",
          title: "Database schema",
          status: "review",
        },
      },
      {
        ...MOCK_SLICE,
        id: "PRO-1-S03",
        frontmatter: {
          ...MOCK_SLICE.frontmatter,
          id: "PRO-1-S03",
          title: "OAuth provider",
          status: "done",
        },
      },
    ]);

    render(() => <SliceDetailPage />, container);
    await vi.waitFor(() => {
      expect(
        container.querySelectorAll(".slice-detail-blocker-row").length
      ).toBe(2);
    });

    const blockers = container.querySelector(".slice-detail-blockers")!;
    expect(blockers.textContent).toContain("Blockers (2)");
    expect(blockers.textContent).toContain("PRO-1-S02");
    expect(blockers.textContent).toContain("Review");
    expect(blockers.textContent).toContain("Database schema");
    expect(blockers.textContent).toContain("PRO-1-S03");
    expect(blockers.textContent).toContain("Done");
    expect(blockers.textContent).toContain("OAuth provider");
  });

  it("hides blockers section when blocked_by is empty", async () => {
    fetchSliceMock = vi.fn(async () => ({
      ...MOCK_SLICE,
      frontmatter: { ...MOCK_SLICE.frontmatter, blocked_by: [] },
    }));

    render(() => <SliceDetailPage />, container);
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-detail-sidebar")).not.toBeNull();
    });

    expect(container.querySelector(".slice-detail-blockers")).toBeNull();
    expect(
      container.querySelector(".slice-detail-sidebar")?.textContent
    ).not.toContain("Blockers");
  });

  it("renders README tab content by default", async () => {
    render(() => <SliceDetailPage />, container);
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-detail-tab-content")).not.toBeNull();
    });
    const tabs = container.querySelectorAll(".slice-detail-tab-btn");
    expect(tabs.length).toBe(5);
    expect(tabs[0]?.textContent).toBe("README");
    expect(tabs[0]?.classList.contains("active")).toBe(true);
    expect(container.querySelector(".slice-detail-tab-content")?.textContent).toContain(
      "Must"
    );
    expect(container.querySelector(".slice-detail-tab-content")?.textContent).toContain(
      "login"
    );
    expect(container.querySelector(".slice-detail-readme")).toBeNull();
  });

  it("switches to tasks tab and shows checklist", async () => {
    render(() => <SliceDetailPage />, container);
    await vi.waitFor(() => {
      const tabs = container.querySelectorAll(".slice-detail-tab-btn");
      expect(tabs.length).toBe(5);
    });
    const tabs = container.querySelectorAll(".slice-detail-tab-btn");
    // Tab order: README, specs, tasks, validation, thread
    const tasksTab = tabs[2] as HTMLElement;
    tasksTab.click();
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-detail-checklist")).not.toBeNull();
    });
    expect(container.querySelector(".slice-detail-checklist")?.textContent).toContain(
      "Implement login"
    );
    expect(container.querySelector(".slice-detail-checklist")?.textContent).toContain(
      "DB schema"
    );
  });

  it("switches to specs tab and shows specs content", async () => {
    render(() => <SliceDetailPage />, container);
    await vi.waitFor(() => {
      const tabs = container.querySelectorAll(".slice-detail-tab-btn");
      expect(tabs.length).toBe(5);
    });
    const specsTab = container.querySelectorAll(".slice-detail-tab-btn")[1] as HTMLElement;
    specsTab.click();
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-detail-tab-content")?.textContent).toContain(
        "Implement OAuth login."
      );
    });
  });

  it("renders thread markdown safely", async () => {
    render(() => <SliceDetailPage />, container);
    await vi.waitFor(() => {
      const tabs = container.querySelectorAll(".slice-detail-tab-btn");
      expect(tabs.length).toBe(4);
    });

    const tabs = container.querySelectorAll(".slice-detail-tab-btn");
    (tabs[3] as HTMLElement).click();

    await vi.waitFor(() => {
      expect(container.querySelector(".slice-detail-thread-markdown")).not.toBeNull();
    });

    const body = container.querySelector(".slice-detail-thread-markdown") as HTMLElement;
    expect(body.textContent).toContain("Worker: Done with auth.");
    expect(body.innerHTML).toContain("<strong>Done</strong>");
    expect(body.innerHTML).not.toContain("<script>");
    const link = body.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
