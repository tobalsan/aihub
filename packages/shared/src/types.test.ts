import { describe, it, expect } from "vitest";
import { AgentConfigSchema } from "./types.js";

describe("AgentConfigSchema openclaw model handling", () => {
  it("allows openclaw agents to omit model", () => {
    const result = AgentConfigSchema.safeParse({
      id: "openclaw-agent",
      name: "OpenClaw Agent",
      workspace: "~/agents/openclaw",
      sdk: "openclaw",
    });

    expect(result.success).toBe(true);
  });

  it("requires model for non-openclaw SDKs", () => {
    const result = AgentConfigSchema.safeParse({
      id: "pi-agent",
      name: "Pi Agent",
      workspace: "~/agents/pi",
      sdk: "pi",
    });

    expect(result.success).toBe(false);
  });

  it("applies default model when openclaw model is omitted", () => {
    const result = AgentConfigSchema.parse({
      id: "openclaw-agent",
      name: "OpenClaw Agent",
      workspace: "~/agents/openclaw",
      sdk: "openclaw",
    });

    expect(result.model).toEqual({ provider: "openclaw", model: "unknown" });
  });
});
