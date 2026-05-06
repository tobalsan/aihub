import { describe, expect, it, vi } from "vitest";
import type { GatewayConfig } from "@aihub/shared";
import {
  interruptCancelledOrchestratorRuns,
  updateProjectLifecycle,
} from "./update-project-lifecycle.js";

describe("updateProjectLifecycle", () => {
  it("rejects legacy run fields", async () => {
    const result = await updateProjectLifecycle(
      { agents: [] } as unknown as GatewayConfig,
      "PRO-1",
      { runAgent: "cli:codex" }
    );

    expect(result).toEqual({
      ok: false,
      error: "runAgent/runMode/baseBranch not supported on projects",
      status: 400,
    });
  });
});

describe("interruptCancelledOrchestratorRuns", () => {
  it("interrupts only running orchestrator runs matching cascaded slice ids", async () => {
    const config = { agents: [] } as unknown as GatewayConfig;
    const listSubagentsFn = vi.fn(async () => ({
      ok: true as const,
      data: {
        items: [
          { slug: "match", source: "orchestrator", status: "running", sliceId: "S-1" },
          { slug: "manual", source: "manual", status: "running", sliceId: "S-1" },
          { slug: "idle", source: "orchestrator", status: "idle", sliceId: "S-1" },
          { slug: "other-slice", source: "orchestrator", status: "running", sliceId: "S-2" },
        ],
      },
    }));
    const interruptSubagentFn = vi.fn(async () => ({ ok: true as const }));

    await interruptCancelledOrchestratorRuns(config, "PRO-1", ["S-1"], {
      listSubagentsFn,
      interruptSubagentFn,
    });

    expect(interruptSubagentFn).toHaveBeenCalledTimes(1);
    expect(interruptSubagentFn).toHaveBeenCalledWith(config, "PRO-1", "match");
  });
});
