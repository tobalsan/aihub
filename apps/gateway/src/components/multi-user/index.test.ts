import { describe, expect, it } from "vitest";
import type { ComponentContext, GatewayConfig } from "@aihub/shared";

describe("multi-user component", () => {
  it("accepts disabled config without oauth", async () => {
    const { multiUserComponent } = await import("./index.js");

    expect(multiUserComponent.validateConfig({ enabled: false })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects enabled config without google oauth credentials", async () => {
    const { multiUserComponent } = await import("./index.js");

    expect(
      multiUserComponent.validateConfig({
        enabled: true,
        sessionSecret: "secret",
      })
    ).toEqual({
      valid: false,
      errors: expect.arrayContaining(["Required"]),
    });
  });

  it("starts and exposes multi-user capability", async () => {
    const { multiUserComponent } = await import("./index.js");
    const ctx = {
      resolveSecret: async () => "secret",
      getAgent: () => undefined,
      getAgents: () => [],
      runAgent: async () => ({
        payloads: [],
        meta: { durationMs: 0, sessionId: "session" },
      }),
      getConfig: () =>
        ({
          agents: [],
          components: {},
        }) as GatewayConfig,
    } satisfies ComponentContext;

    await multiUserComponent.start(ctx);
    expect(multiUserComponent.capabilities()).toEqual(["multi-user"]);

    await multiUserComponent.stop();
    expect(multiUserComponent.capabilities()).toEqual([]);
  });
});
