// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delegateEvents, render } from "solid-js/web";
import { SubagentRunsPanel } from "./SubagentRunsPanel";

const {
  archiveRuntimeSubagentMock,
  deleteRuntimeSubagentMock,
  fetchRuntimeSubagentLogsMock,
  fetchRuntimeSubagentsMock,
  interruptRuntimeSubagentMock,
  subscribeToFileChangesMock,
  subscribeToSubagentChangesMock,
} = vi.hoisted(() => ({
  archiveRuntimeSubagentMock: vi.fn(),
  deleteRuntimeSubagentMock: vi.fn(),
  fetchRuntimeSubagentLogsMock: vi.fn(),
  fetchRuntimeSubagentsMock: vi.fn(),
  interruptRuntimeSubagentMock: vi.fn(),
  subscribeToFileChangesMock: vi.fn(),
  subscribeToSubagentChangesMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  archiveRuntimeSubagent: archiveRuntimeSubagentMock,
  deleteRuntimeSubagent: deleteRuntimeSubagentMock,
  fetchRuntimeSubagentLogs: fetchRuntimeSubagentLogsMock,
  fetchRuntimeSubagents: fetchRuntimeSubagentsMock,
  interruptRuntimeSubagent: interruptRuntimeSubagentMock,
  subscribeToFileChanges: subscribeToFileChangesMock,
  subscribeToSubagentChanges: subscribeToSubagentChangesMock,
}));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SubagentRunsPanel", () => {
  beforeEach(() => {
    delegateEvents(["click"]);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    fetchRuntimeSubagentsMock.mockResolvedValue({
      items: [
        {
          id: "sar_1",
          label: "Worker",
          cli: "codex",
          cwd: "/tmp/worktrees/worker",
          prompt: "test",
          status: "done",
          startedAt: "2026-04-30T10:00:00.000Z",
          latestOutput: "Ready",
        },
      ],
    });
    fetchRuntimeSubagentLogsMock.mockResolvedValue({
      cursor: 12,
      events: [{ type: "assistant", text: "Finished work." }],
    });
    subscribeToFileChangesMock.mockReturnValue(() => {});
    subscribeToSubagentChangesMock.mockReturnValue(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders cwd-filtered runs and fetches logs only after expansion", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => <SubagentRunsPanel cwd="/tmp/worktrees/worker" />,
      container
    );
    await tick();
    await tick();

    expect(fetchRuntimeSubagentsMock).toHaveBeenCalledWith({
      cwd: "/tmp/worktrees/worker",
      parent: undefined,
      projectId: undefined,
      sliceId: undefined,
      status: undefined,
      includeArchived: undefined,
    });
    expect(container.textContent).toContain("Worker");
    expect(container.textContent).toContain("Ready");
    expect(fetchRuntimeSubagentLogsMock).not.toHaveBeenCalled();

    container
      .querySelector<HTMLButtonElement>(".canvas-monitor-run-toggle")
      ?.click();
    await tick();
    await tick();

    expect(fetchRuntimeSubagentLogsMock).toHaveBeenCalledWith("sar_1", 0);
    expect(container.textContent).toContain("Finished work.");
    dispose();
  });

  it("renders only active unassigned runs outside excluded cwds", async () => {
    fetchRuntimeSubagentsMock.mockResolvedValue({
      items: [
        {
          id: "sar_1",
          label: "Loose",
          cli: "codex",
          cwd: "/tmp/worktrees/loose",
          prompt: "test",
          status: "running",
          startedAt: "2026-04-30T10:00:00.000Z",
        },
        {
          id: "sar_2",
          label: "Tracked",
          cli: "codex",
          cwd: "/tmp/worktrees/tracked",
          prompt: "test",
          status: "running",
          startedAt: "2026-04-30T10:00:00.000Z",
        },
        {
          id: "sar_3",
          label: "Done",
          cli: "codex",
          cwd: "/tmp/worktrees/done",
          prompt: "test",
          status: "done",
          startedAt: "2026-04-30T10:00:00.000Z",
        },
      ],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SubagentRunsPanel
          mode="unassigned"
          excludeCwds={["/tmp/worktrees/tracked"]}
        />
      ),
      container
    );
    await tick();
    await tick();

    expect(fetchRuntimeSubagentsMock).toHaveBeenCalledWith({
      cwd: undefined,
      parent: undefined,
      projectId: undefined,
      sliceId: undefined,
      status: undefined,
      includeArchived: undefined,
    });
    expect(container.textContent).toContain("Loose");
    expect(container.textContent).not.toContain("Tracked");
    expect(container.textContent).not.toContain("Done");
    dispose();
  });

  it("filters by project and slice and appends logs on project agent changes", async () => {
    let fileCallbacks:
      | {
          onAgentChanged?: (projectId: string) => void;
        }
      | undefined;
    subscribeToFileChangesMock.mockImplementation((callbacks) => {
      fileCallbacks = callbacks;
      return () => {};
    });
    fetchRuntimeSubagentsMock.mockResolvedValue({
      items: [
        {
          id: "PRO-1:worker",
          label: "Worker",
          cli: "codex",
          cwd: "/tmp/worktrees/worker",
          prompt: "test",
          projectId: "PRO-1",
          sliceId: "PRO-1-S01",
          status: "running",
          startedAt: "2026-04-30T10:00:00.000Z",
        },
      ],
    });
    fetchRuntimeSubagentLogsMock
      .mockResolvedValueOnce({
        cursor: 12,
        events: [{ type: "assistant", text: "First event." }],
      })
      .mockResolvedValueOnce({
        cursor: 24,
        events: [{ type: "assistant", text: "Next event." }],
      });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SubagentRunsPanel
          projectId="PRO-1"
          sliceId="PRO-1-S01"
          rawLogHref={(run) => `/raw/${run.id}`}
        />
      ),
      container
    );
    await tick();
    await tick();

    expect(fetchRuntimeSubagentsMock).toHaveBeenCalledWith({
      cwd: undefined,
      parent: undefined,
      projectId: "PRO-1",
      sliceId: "PRO-1-S01",
      status: undefined,
      includeArchived: undefined,
    });

    container
      .querySelector<HTMLButtonElement>(".canvas-monitor-run-toggle")
      ?.click();
    await tick();
    await tick();
    expect(container.textContent).toContain("First event.");
    expect(
      container.querySelector<HTMLAnchorElement>(
        ".canvas-monitor-icon-action[href='/raw/PRO-1:worker']"
      )
    ).not.toBeNull();

    fileCallbacks?.onAgentChanged?.("PRO-1");
    await tick();
    await tick();

    expect(fetchRuntimeSubagentLogsMock).toHaveBeenLastCalledWith(
      "PRO-1:worker",
      12
    );
    expect(container.textContent).toContain("Next event.");
    dispose();
  });
});
