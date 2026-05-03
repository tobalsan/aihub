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
    thread: "Worker: Done with initial auth.\n",
  },
};

vi.mock("../api/client", () => ({
  fetchSlice: vi.fn(async () => MOCK_SLICE),
  updateSlice: vi.fn(async () => MOCK_SLICE),
  subscribeToFileChanges: vi.fn(() => () => {}),
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ projectId: "PRO-1", sliceId: "PRO-1-S01" }),
}));

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
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

  it("renders specs tab content by default", async () => {
    render(() => <SliceDetailPage />, container);
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-detail-tab-content")).not.toBeNull();
    });
    expect(container.querySelector(".slice-detail-tab-content")?.textContent).toContain(
      "Implement OAuth login."
    );
  });

  it("switches to tasks tab and shows checklist", async () => {
    render(() => <SliceDetailPage />, container);
    await vi.waitFor(() => {
      const tabs = container.querySelectorAll(".slice-detail-tab-btn");
      expect(tabs.length).toBe(4);
    });
    const tabs = container.querySelectorAll(".slice-detail-tab-btn");
    // Tab order: specs, tasks, validation, thread
    const tasksTab = tabs[1] as HTMLElement;
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

  it("shows readme content", async () => {
    render(() => <SliceDetailPage />, container);
    await vi.waitFor(() => {
      expect(container.querySelector(".slice-detail-readme")).not.toBeNull();
    });
    expect(container.querySelector(".slice-detail-readme")?.textContent).toContain("Must");
  });
});
