import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayConfig } from "@aihub/shared";

type MockWatcher = {
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emitAll: (event: string, changedPath: string) => void;
};

const mockWatchers: MockWatcher[] = [];

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(() => {
      const handlers = new Map<string, (event: string, path: string) => void>();
      const watcher: MockWatcher = {
        on: vi.fn(
          (event: string, handler: (event: string, path: string) => void) => {
            handlers.set(event, handler);
            return watcher;
          }
        ),
        close: vi.fn(async () => {}),
        emitAll: (event: string, changedPath: string) => {
          handlers.get("all")?.(event, changedPath);
        },
      };
      mockWatchers.push(watcher);
      return watcher;
    }),
  },
}));

vi.mock("../agents/events.js", () => ({
  agentEventBus: {
    emitFileChanged: vi.fn(),
    emitAgentChanged: vi.fn(),
  },
}));

import { agentEventBus } from "../agents/events.js";
import { startProjectWatcher } from "./watcher.js";

describe("project watcher file debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockWatchers.length = 0;
  });

  it("emits every changed file for a project within debounce window", async () => {
    const watcher = startProjectWatcher({
      projects: { root: "/tmp/projects" },
    } as GatewayConfig);

    const markdownWatcher = mockWatchers[0];
    expect(markdownWatcher).toBeDefined();

    markdownWatcher.emitAll(
      "change",
      "/tmp/projects/PRO-153_make_ui_update_in_real_time/README.md"
    );
    markdownWatcher.emitAll(
      "change",
      "/tmp/projects/PRO-153_make_ui_update_in_real_time/SPECS.md"
    );

    vi.advanceTimersByTime(300);

    expect(agentEventBus.emitFileChanged).toHaveBeenCalledTimes(2);
    expect(agentEventBus.emitFileChanged).toHaveBeenCalledWith({
      type: "file_changed",
      projectId: "PRO-153",
      file: "PRO-153_make_ui_update_in_real_time/README.md",
    });
    expect(agentEventBus.emitFileChanged).toHaveBeenCalledWith({
      type: "file_changed",
      projectId: "PRO-153",
      file: "PRO-153_make_ui_update_in_real_time/SPECS.md",
    });

    await watcher.close();
  });
});
