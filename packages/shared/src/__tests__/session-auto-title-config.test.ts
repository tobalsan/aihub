import { describe, expect, it } from "vitest";
import { GatewayConfigSchema } from "../types.js";

function agent(id: string) {
  return {
    id,
    name: id,
    workspace: `~/agents/${id}`,
    model: { provider: "anthropic", model: "claude" },
  };
}

describe("session auto-title config", () => {
  it("accepts extensions.sessions.autoTitleModel", () => {
    const config = GatewayConfigSchema.parse({
      agents: [agent("pom")],
      extensions: {
        sessions: { autoTitleModel: "anthropic/claude-3-5-haiku" },
      },
    });

    expect(config.extensions?.sessions?.autoTitleModel).toBe(
      "anthropic/claude-3-5-haiku"
    );
  });

  it("rejects non-string autoTitleModel values", () => {
    const result = GatewayConfigSchema.safeParse({
      agents: [agent("pom")],
      extensions: { sessions: { autoTitleModel: 123 } },
    });

    expect(result.success).toBe(false);
  });
});
