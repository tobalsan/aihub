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
  subscribeToSubagentChangesMock,
} = vi.hoisted(() => ({
  archiveRuntimeSubagentMock: vi.fn(),
  deleteRuntimeSubagentMock: vi.fn(),
  fetchRuntimeSubagentLogsMock: vi.fn(),
  fetchRuntimeSubagentsMock: vi.fn(),
  interruptRuntimeSubagentMock: vi.fn(),
  subscribeToSubagentChangesMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  archiveRuntimeSubagent: archiveRuntimeSubagentMock,
  deleteRuntimeSubagent: deleteRuntimeSubagentMock,
  fetchRuntimeSubagentLogs: fetchRuntimeSubagentLogsMock,
  fetchRuntimeSubagents: fetchRuntimeSubagentsMock,
  interruptRuntimeSubagent: interruptRuntimeSubagentMock,
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
});
