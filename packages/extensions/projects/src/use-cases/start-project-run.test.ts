import { afterEach, describe, expect, it } from "vitest";
import type { GatewayConfig } from "@aihub/shared";
import { clearProjectsContext, setProjectsContext } from "../context.js";
import { startProjectRun } from "./start-project-run.js";

afterEach(() => {
  clearProjectsContext();
});

describe("startProjectRun", () => {
  it("rejects unknown subagent templates before touching project storage", async () => {
    const config = { agents: [] } as unknown as GatewayConfig;
    setProjectsContext({
      getConfig: () => config,
      getSubagentTemplates: () => [],
    } as never);

    const result = await startProjectRun(config, "PRO-1", {
      subagentTemplate: "Worker",
    });

    expect(result).toEqual({
      ok: false,
      error: "Unknown subagent template: Worker",
      status: 400,
    });
  });
});
