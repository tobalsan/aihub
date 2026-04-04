import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GatewayConfigSchema,
  type ComponentContext,
} from "@aihub/shared";

describe("multi-user component", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

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
    const close = vi.fn();
    const db = { close } as const;
    const auth = { handler: vi.fn(), api: { getSession: vi.fn() } } as const;

    vi.doMock("./db.js", () => ({
      initializeMultiUserDatabase: vi.fn(() => db),
    }));
    vi.doMock("./auth.js", () => ({
      createMultiUserAuth: vi.fn(async () => auth),
    }));

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
        GatewayConfigSchema.parse({
          agents: [],
          components: {},
          sessions: {},
          multiUser: {
            enabled: true,
            oauth: {
              google: {
                clientId: "client-id",
                clientSecret: "client-secret",
              },
            },
            sessionSecret: "x".repeat(32),
          },
        }),
    } satisfies ComponentContext;

    await multiUserComponent.start(ctx);
    expect(multiUserComponent.capabilities()).toEqual(["multi-user"]);

    await multiUserComponent.stop();
    expect(multiUserComponent.capabilities()).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
  });
});
