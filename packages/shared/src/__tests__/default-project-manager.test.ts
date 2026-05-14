import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GatewayConfigSchema,
  resolveDefaultProjectManager,
  resetDefaultProjectManagerWarningsForTests,
  type GatewayConfig,
} from "../index.js";

function agent(id: string) {
  return {
    id,
    name: id,
    workspace: `~/agents/${id}`,
    model: { provider: "anthropic", model: "claude" },
  };
}

function config(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return GatewayConfigSchema.parse({
    agents: [agent("pom"), agent("driller")],
    extensions: {},
    ...overrides,
  });
}

describe("defaultProjectManager config", () => {
  beforeEach(() => {
    resetDefaultProjectManagerWarningsForTests();
  });

  it("accepts an optional string field", () => {
    expect(config({ defaultProjectManager: "pom" }).defaultProjectManager).toBe(
      "pom"
    );
    expect(
      config({ defaultProjectManager: undefined }).defaultProjectManager
    ).toBeUndefined();
  });

  it("rejects non-string values", () => {
    const result = GatewayConfigSchema.safeParse({
      agents: [agent("pom")],
      extensions: {},
      defaultProjectManager: 123,
    });

    expect(result.success).toBe(false);
  });

  it("returns the configured agent when it resolves", () => {
    expect(
      resolveDefaultProjectManager(config({ defaultProjectManager: "driller" }))
    ).toBe("driller");
  });

  it("falls back to the first agent and warns once for an invalid id", () => {
    const warn = vi.fn();
    const invalidConfig = config({ defaultProjectManager: "missing" });

    expect(resolveDefaultProjectManager(invalidConfig, warn)).toBe("pom");
    expect(resolveDefaultProjectManager(invalidConfig, warn)).toBe("pom");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the first agent without warning when unset", () => {
    const warn = vi.fn();

    expect(resolveDefaultProjectManager(config(), warn)).toBe("pom");
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null when no agents are configured", () => {
    expect(resolveDefaultProjectManager(config({ agents: [] }))).toBeNull();
  });
});
