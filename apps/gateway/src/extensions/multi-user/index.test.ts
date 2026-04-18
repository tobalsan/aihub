import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayConfigSchema, type ExtensionContext } from "@aihub/shared";

describe("multi-user component", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("accepts disabled config without oauth", async () => {
    const { multiUserExtension } = await import("./index.js");

    expect(multiUserExtension.validateConfig({ enabled: false })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects enabled config without google oauth credentials", async () => {
    const { multiUserExtension } = await import("./index.js");

    expect(
      multiUserExtension.validateConfig({
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
    vi.doMock("./assignments.js", () => ({
      createAgentAssignmentStore: vi.fn(() => ({
        getAssignmentsForUser: vi.fn(() => []),
        getAssignmentsForAgent: vi.fn(() => []),
        getAllAssignments: vi.fn(() => []),
        setAssignmentsForAgent: vi.fn(),
        removeAssignment: vi.fn(),
      })),
    }));

    const { multiUserExtension } = await import("./index.js");
    const ctx = {
      getConfig: () =>
        GatewayConfigSchema.parse({
          agents: [],
          extensions: {
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
          },
          sessions: {},
        }),
      getDataDir: () => "/tmp",
      getAgent: () => undefined,
      getAgents: () => [],
      isAgentActive: () => true,
      isAgentStreaming: () => false,
      resolveWorkspaceDir: () => "/tmp",
      runAgent: async () => ({
        payloads: [],
        meta: { durationMs: 0, sessionId: "session" },
      }),
      getSubagentTemplates: () => [],
      resolveSessionId: async () => undefined,
      getSessionEntry: async () => undefined,
      clearSessionEntry: async () => undefined,
      restoreSessionUpdatedAt: () => undefined,
      deleteSession: () => undefined,
      invalidateHistoryCache: async () => undefined,
      getSessionHistory: async () => [],
      subscribe: () => () => undefined,
      emit: () => undefined,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    } satisfies ExtensionContext;

    await multiUserExtension.start(ctx);
    expect(multiUserExtension.capabilities()).toEqual(["multi-user"]);

    await multiUserExtension.stop();
    expect(multiUserExtension.capabilities()).toEqual([]);
    expect(close).toHaveBeenCalledOnce();
  });
});
