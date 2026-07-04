import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const getMultiUserRuntime = vi.fn();

vi.mock("./index.js", () => ({
  getMultiUserRuntime,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("multi-user middleware", () => {
  it("returns 401 when session is missing", async () => {
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => null),
        },
      },
    });

    const { createAuthMiddleware } = await import("./middleware.js");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/protected", (c) => c.json({ ok: true }));

    const response = await app.request("/api/protected");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("attaches auth context for approved users", async () => {
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => ({
            user: {
              id: "user-1",
              email: "user@example.com",
              name: "User",
              role: "user",
              approved: true,
            },
            session: {
              id: "session-1",
              userId: "user-1",
              expiresAt: new Date("2026-04-04T17:00:00.000Z"),
            },
          })),
        },
      },
    });

    const { createAuthMiddleware, getRequestAuthContext } =
      await import("./middleware.js");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/protected", (c) => c.json(getRequestAuthContext(c)));

    const response = await app.request("/api/protected");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User",
        role: "user",
        approved: true,
      },
      session: {
        id: "session-1",
        userId: "user-1",
        expiresAt: "2026-04-04T17:00:00.000Z",
      },
    });
  });

  it("returns 403 for unapproved users", async () => {
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => ({
            user: {
              id: "user-1",
              role: "user",
              approved: false,
            },
            session: {
              id: "session-1",
              userId: "user-1",
            },
          })),
        },
      },
    });

    const { createAuthMiddleware } = await import("./middleware.js");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/protected", (c) => c.json({ ok: true }));

    const response = await app.request("/api/protected");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("enforces admin-only access", async () => {
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => ({
            user: {
              id: "user-1",
              role: "user",
              approved: true,
            },
            session: {
              id: "session-1",
              userId: "user-1",
            },
          })),
        },
      },
    });

    const { createAuthMiddleware, requireAdmin } =
      await import("./middleware.js");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/admin", requireAdmin(), (c) => c.json({ ok: true }));

    const response = await app.request("/api/admin");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("enforces agent assignments for non-admin users", async () => {
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => ({
            user: {
              id: "user-1",
              role: "user",
              approved: true,
            },
            session: {
              id: "session-1",
              userId: "user-1",
            },
          })),
        },
      },
      db: {
        prepare: vi.fn(() => ({
          get: vi.fn(() => undefined),
        })),
      },
      assignments: {
        getAssignmentsForUser: vi.fn(() => []),
      },
    });

    const { createAuthMiddleware, requireAgentAccess } =
      await import("./middleware.js");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/agents/:id", requireAgentAccess("id"), (c) =>
      c.json({ ok: true })
    );

    const response = await app.request("/api/agents/agent-1");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("attaches auth context for bearer tokens of approved users", async () => {
    const verifyApiKey = vi.fn(async () => ({
      valid: true,
      key: { id: "key-1", referenceId: "user-1" },
    }));
    const getSession = vi.fn(async () => null);
    getMultiUserRuntime.mockReturnValue({
      auth: { api: { getSession, verifyApiKey } },
      db: {
        prepare: vi.fn((sql: string) => ({
          get: vi.fn(() => {
            if (sql.includes("FROM user")) {
              return {
                id: "user-1",
                email: "user@example.com",
                name: "User",
                image: null,
                role: "user",
                approved: 1,
              };
            }
            return undefined;
          }),
        })),
      },
    });

    const { createAuthMiddleware, getRequestAuthContext } =
      await import("./middleware.js");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/protected", (c) => c.json(getRequestAuthContext(c)));

    const response = await app.request("/api/protected", {
      headers: { Authorization: "Bearer my-token" },
    });

    expect(response.status).toBe(200);
    expect(verifyApiKey).toHaveBeenCalledWith({ body: { key: "my-token" } });
    expect(getSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User",
        image: null,
        role: "user",
        approved: true,
      },
      session: {
        id: "apikey:key-1",
        userId: "user-1",
      },
    });
  });

  it("returns 403 for bearer tokens of unapproved users", async () => {
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => null),
          verifyApiKey: vi.fn(async () => ({
            valid: true,
            key: { id: "key-1", referenceId: "user-1" },
          })),
        },
      },
      db: {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({
            id: "user-1",
            email: "user@example.com",
            name: "User",
            image: null,
            role: "user",
            approved: 0,
          })),
        })),
      },
    });

    const { createAuthMiddleware } = await import("./middleware.js");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/protected", (c) => c.json({ ok: true }));

    const response = await app.request("/api/protected", {
      headers: { Authorization: "Bearer my-token" },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("returns 401 for invalid bearer tokens and does not consult cookie session", async () => {
    const verifyApiKey = vi.fn(async () => ({ valid: false }));
    const getSession = vi.fn(async () => ({
      user: { id: "user-1", role: "user", approved: true },
      session: { id: "session-1", userId: "user-1" },
    }));
    getMultiUserRuntime.mockReturnValue({
      auth: { api: { getSession, verifyApiKey } },
      db: { prepare: vi.fn() },
    });

    const { createAuthMiddleware } = await import("./middleware.js");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/protected", (c) => c.json({ ok: true }));

    const response = await app.request("/api/protected", {
      headers: { Authorization: "Bearer revoked" },
    });

    expect(response.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns 401 for bearer where verifyApiKey returns valid=false", async () => {
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => null),
          verifyApiKey: vi.fn(async () => ({
            valid: false,
            error: { code: "KEY_NOT_FOUND" },
          })),
        },
      },
      db: { prepare: vi.fn() },
    });

    const { createAuthMiddleware } = await import("./middleware.js");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/protected", (c) => c.json({ ok: true }));

    const response = await app.request("/api/protected", {
      headers: { Authorization: "Bearer bad-token" },
    });

    expect(response.status).toBe(401);
  });

  it("enforces agent assignments for bearer auth on unassigned agents", async () => {
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => null),
          verifyApiKey: vi.fn(async () => ({
            valid: true,
            key: { id: "key-1", referenceId: "user-1" },
          })),
        },
      },
      db: {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({
            id: "user-1",
            email: "user@example.com",
            name: "User",
            image: null,
            role: "user",
            approved: 1,
          })),
        })),
      },
      assignments: {
        getAssignmentsForUser: vi.fn(() => []),
      },
    });

    const { createAuthMiddleware, requireAgentAccess } =
      await import("./middleware.js");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/agents/:id", requireAgentAccess("id"), (c) =>
      c.json({ ok: true })
    );

    const response = await app.request("/api/agents/agent-1", {
      headers: { Authorization: "Bearer my-token" },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("parses bearer scheme case-insensitively without lowercasing the token", async () => {
    const verifyApiKey = vi.fn(async () => ({
      valid: true,
      key: { id: "key-1", referenceId: "user-1" },
    }));
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => null),
          verifyApiKey,
        },
      },
      db: {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({
            id: "user-1",
            email: "user@example.com",
            name: "User",
            image: null,
            role: "user",
            approved: 1,
          })),
        })),
      },
    });

    const { createAuthMiddleware } = await import("./middleware.js");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/protected", (c) => c.json({ ok: true }));

    const response = await app.request("/api/protected", {
      headers: { Authorization: "bEaReR MixedCaseToken123" },
    });

    expect(response.status).toBe(200);
    expect(verifyApiKey).toHaveBeenCalledWith({
      body: { key: "MixedCaseToken123" },
    });
  });

  it("swaps admin session context during active impersonation", async () => {
    const prepare = vi.fn((sql: string) => ({
      get: vi.fn(() => {
        if (sql.includes("SELECT id, email")) {
          return {
            id: "user-2",
            email: "target@example.com",
            name: "Target",
            image: null,
            approved: 1,
          };
        }
        return undefined;
      }),
    }));
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => ({
            user: {
              id: "admin-1",
              email: "admin@example.com",
              role: "admin",
              approved: true,
            },
            session: {
              id: "session-1",
              userId: "admin-1",
            },
          })),
        },
      },
      db: { prepare },
    });

    const { startImpersonation, endImpersonation } = await import("./impersonation.js");
    const { createAuthMiddleware, getRequestAuthContext } = await import("./middleware.js");
    startImpersonation("session-1", "user-2");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/protected", (c) => c.json(getRequestAuthContext(c)));

    const response = await app.request("/api/protected");
    endImpersonation("session-1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: "user-2",
        email: "target@example.com",
        name: "Target",
        image: null,
        role: "user",
        approved: true,
      },
      session: {
        id: "session-1",
        userId: "user-2",
      },
      impersonator: {
        id: "admin-1",
        email: "admin@example.com",
      },
    });
  });

  it("ignores active impersonation for bearer tokens", async () => {
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => null),
          verifyApiKey: vi.fn(async () => ({
            valid: true,
            key: { id: "key-1", referenceId: "admin-1" },
          })),
        },
      },
      db: {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({
            id: "admin-1",
            email: "admin@example.com",
            name: "Admin",
            image: null,
            role: "admin",
            approved: 1,
          })),
        })),
      },
    });

    const { startImpersonation, endImpersonation } = await import("./impersonation.js");
    const { createAuthMiddleware, getRequestAuthContext } = await import("./middleware.js");
    startImpersonation("apikey:key-1", "user-2");

    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/protected", (c) => c.json(getRequestAuthContext(c)));

    const response = await app.request("/api/protected", {
      headers: { Authorization: "Bearer my-token" },
    });
    endImpersonation("apikey:key-1");

    expect(response.status).toBe(200);
    expect((await response.json()).user.id).toBe("admin-1");
  });

  it("validates websocket requests via Better Auth session lookup", async () => {
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => ({
            user: {
              id: "admin-1",
              role: "admin",
              approved: true,
            },
            session: {
              id: "session-1",
              userId: "admin-1",
            },
          })),
        },
      },
    });

    const { validateWebSocketRequest } = await import("./middleware.js");

    const authContext = await validateWebSocketRequest(
      new Request("http://localhost/ws", {
        headers: {
          cookie: "session=1",
        },
      })
    );

    expect(authContext).toEqual({
      user: {
        id: "admin-1",
        role: "admin",
        approved: true,
      },
      session: {
        id: "session-1",
        userId: "admin-1",
      },
    });
  });

  function mockSessionRole(role: string) {
    getMultiUserRuntime.mockReturnValue({
      auth: {
        api: {
          getSession: vi.fn(async () => ({
            user: { id: `${role}-1`, role, approved: true },
            session: { id: "session-1", userId: `${role}-1` },
          })),
        },
      },
    });
  }

  it("staff bypass (requireAdmin) allows both admin and superadmin", async () => {
    for (const role of ["admin", "superadmin"]) {
      vi.resetModules();
      mockSessionRole(role);
      const { createAuthMiddleware, requireAdmin } = await import(
        "./middleware.js"
      );
      const app = new Hono();
      app.use("/api/*", createAuthMiddleware());
      app.get("/api/admin", requireAdmin(), (c) => c.json({ ok: true }));

      const response = await app.request("/api/admin", {
        headers: { cookie: "session=1" },
      });
      expect(response.status).toBe(200);
    }
  });

  it("requireSuperadmin allows superadmin", async () => {
    mockSessionRole("superadmin");
    const { createAuthMiddleware, requireSuperadmin } = await import(
      "./middleware.js"
    );
    const app = new Hono();
    app.use("/api/*", createAuthMiddleware());
    app.get("/api/su", requireSuperadmin(), (c) => c.json({ ok: true }));

    const response = await app.request("/api/su", {
      headers: { cookie: "session=1" },
    });
    expect(response.status).toBe(200);
  });

  it("requireSuperadmin rejects admin and user with 403", async () => {
    for (const role of ["admin", "user"]) {
      vi.resetModules();
      mockSessionRole(role);
      const { createAuthMiddleware, requireSuperadmin } = await import(
        "./middleware.js"
      );
      const app = new Hono();
      app.use("/api/*", createAuthMiddleware());
      app.get("/api/su", requireSuperadmin(), (c) => c.json({ ok: true }));

      const response = await app.request("/api/su", {
        headers: { cookie: "session=1" },
      });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "forbidden" });
    }
  });

  it("single-user mode: requireSuperadmin passes through when multiUser not loaded", async () => {
    getMultiUserRuntime.mockReturnValue(null);
    const { requireSuperadmin } = await import("./middleware.js");
    const app = new Hono();
    app.get("/api/su", requireSuperadmin(), (c) => c.json({ ok: true }));

    const response = await app.request("/api/su");
    expect(response.status).toBe(200);
  });
});
