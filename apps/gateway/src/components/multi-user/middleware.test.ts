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
});
