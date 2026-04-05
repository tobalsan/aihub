import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const getMultiUserRuntime = vi.fn();
const getAgent = vi.fn();
const getActiveAgents = vi.fn();
const getLoadedComponents = vi.fn();

vi.mock("./index.js", async () => {
  const actual =
    await vi.importActual<typeof import("./index.js")>("./index.js");
  return {
    ...actual,
    getMultiUserRuntime,
    getAgentFilter:
      (userId: string, role: string | string[] | null | undefined) =>
      <T extends { id: string }>(agents: T[]) => {
        const runtime = getMultiUserRuntime();
        if (!runtime) return agents;
        if (Array.isArray(role) ? role.includes("admin") : role === "admin") {
          return agents;
        }
        const allowed = new Set(
          runtime.assignments.getAssignmentsForUser(userId)
        );
        return agents.filter((agent) => allowed.has(agent.id));
      },
  };
});

vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  return {
    ...actual,
    getAgent,
    getActiveAgents,
    isAgentActive: () => true,
    resolveWorkspaceDir: (workspace: string) => workspace,
  };
});

vi.mock("../../components/registry.js", () => ({
  getLoadedComponents,
  isMultiUserLoaded: () =>
    getLoadedComponents().some(
      (component: { id?: string }) => component.id === "multiUser"
    ),
  isComponentLoaded: (id: string) =>
    getLoadedComponents().some(
      (component: { id?: string }) => component.id === id
    ),
}));

type MockSession = {
  user: {
    id: string;
    email?: string;
    name?: string;
    role?: string;
    approved?: boolean;
  };
  session: {
    id: string;
    userId: string;
  };
};

function createSession(role: "admin" | "user", approved = true): MockSession {
  return {
    user: {
      id: `${role}-1`,
      email: `${role}@example.com`,
      name: role,
      role,
      approved,
    },
    session: {
      id: `${role}-session`,
      userId: `${role}-1`,
    },
  };
}

function createAssignmentStore() {
  const byAgent = new Map<string, string[]>();
  return {
    store: {
      getAssignmentsForUser(userId: string) {
        return [...byAgent.entries()]
          .filter(([, userIds]) => userIds.includes(userId))
          .map(([agentId]) => agentId)
          .sort();
      },
      getAssignmentsForAgent(agentId: string) {
        return [...(byAgent.get(agentId) ?? [])].sort();
      },
      getAllAssignments() {
        return [...byAgent.entries()]
          .flatMap(([agentId, userIds]) =>
            [...userIds].sort().map((userId) => ({
              userId,
              agentId,
              assignedBy: "admin-1",
              assignedAt: "2026-04-04 18:00:00",
            }))
          )
          .sort((a, b) =>
            a.agentId === b.agentId
              ? a.userId.localeCompare(b.userId)
              : a.agentId.localeCompare(b.agentId)
          );
      },
      setAssignmentsForAgent(agentId: string, userIds: string[]) {
        byAgent.set(agentId, [...new Set(userIds)]);
      },
      removeAssignment(userId: string, agentId: string) {
        byAgent.set(
          agentId,
          (byAgent.get(agentId) ?? []).filter((value) => value !== userId)
        );
      },
    },
    seed(agentId: string, userIds: string[]) {
      byAgent.set(agentId, [...userIds]);
    },
  };
}

function createDbMock(users: Map<string, Record<string, unknown>>) {
  const approvedByUserId = new Map<string, number>();
  return {
    approvedByUserId,
    db: {
      prepare: vi.fn((sql: string) => ({
        all: vi.fn((...userIds: string[]) => {
          if (sql.includes("SELECT id FROM user WHERE id IN")) {
            return userIds
              .filter((userId) => users.has(userId))
              .map((userId) => ({ id: userId }));
          }
          return [];
        }),
        run: vi.fn((approved: number, userId: string) => {
          if (sql.includes("UPDATE user SET approved")) {
            approvedByUserId.set(userId, approved);
            const user = users.get(userId);
            if (user) user.approved = approved === 1;
          }
          return { changes: 1 };
        }),
      })),
    },
  };
}

function createRuntime(options?: {
  session?: MockSession;
  users?: Array<Record<string, unknown>>;
}) {
  const assignmentStore = createAssignmentStore();
  const users = new Map(
    (
      options?.users ?? [
        {
          id: "admin-1",
          name: "Admin",
          email: "admin@example.com",
          role: "admin",
          approved: true,
        },
        {
          id: "user-1",
          name: "User One",
          email: "user1@example.com",
          role: "user",
          approved: false,
        },
        {
          id: "user-2",
          name: "User Two",
          email: "user2@example.com",
          role: "user",
          approved: true,
        },
      ]
    ).map((user) => [String(user.id), { ...user }])
  );
  const { approvedByUserId, db } = createDbMock(users);
  const listUsers = vi.fn(async () => ({
    users: [...users.values()],
    total: users.size,
  }));
  const getUser = vi.fn(async ({ query }: { query: { id: string } }) =>
    users.get(query.id)
  );
  const setRole = vi.fn(
    async ({ body }: { body: { userId: string; role: string } }) => {
      const user = users.get(body.userId);
      if (user) user.role = body.role;
      return { user };
    }
  );
  const getSession = vi.fn(
    async () => options?.session ?? createSession("admin")
  );

  const runtime = {
    auth: {
      api: {
        getSession,
        listUsers,
        getUser,
        setRole,
      },
    },
    db,
    assignments: assignmentStore.store,
  };

  return {
    runtime,
    users,
    approvedByUserId,
    listUsers,
    getUser,
    setRole,
    getSession,
    assignmentStore,
  };
}

function createAdminApp() {
  return new Hono();
}

async function importAdminRoutes() {
  return import("./routes.js");
}

async function importAuthMiddleware() {
  return import("./middleware.js");
}

function makeAuthRequest(path: string) {
  return new Request(`http://localhost${path}`, {
    headers: { cookie: "session=1" },
  });
}

function encodeAuthHeader(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("base64url");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  getAgent.mockImplementation((agentId: string) =>
    [
      { id: "agent-a", name: "Agent A", model: { model: "m", provider: "p" } },
      { id: "agent-b", name: "Agent B", model: { model: "m", provider: "p" } },
    ].find((agent) => agent.id === agentId)
  );
  getActiveAgents.mockReturnValue([
    {
      id: "agent-a",
      name: "Agent A",
      model: { provider: "anthropic", model: "claude" },
      workspace: "/tmp/a",
    },
    {
      id: "agent-b",
      name: "Agent B",
      model: { provider: "anthropic", model: "claude" },
      workspace: "/tmp/b",
    },
  ]);
  getLoadedComponents.mockReturnValue([{ id: "multiUser" }]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("multi-user admin routes", () => {
  it("admin can list users", async () => {
    const runtime = createRuntime();
    getMultiUserRuntime.mockReturnValue(runtime.runtime);

    const { registerMultiUserRoutes } = await importAdminRoutes();
    const { createAuthMiddleware } = await importAuthMiddleware();
    const app = createAdminApp();
    app.use("*", createAuthMiddleware());
    registerMultiUserRoutes(app);

    const response = await app.request(makeAuthRequest("/admin/users"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      users: expect.arrayContaining([
        expect.objectContaining({ id: "admin-1", role: "admin" }),
        expect.objectContaining({ id: "user-1", approved: false }),
      ]),
      total: 3,
    });
    expect(runtime.listUsers).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: {},
    });
  });

  it("admin can approve and reject a user", async () => {
    const runtime = createRuntime();
    getMultiUserRuntime.mockReturnValue(runtime.runtime);

    const { registerMultiUserRoutes } = await importAdminRoutes();
    const { createAuthMiddleware } = await importAuthMiddleware();
    const app = createAdminApp();
    app.use("*", createAuthMiddleware());
    registerMultiUserRoutes(app);

    const approveResponse = await app.request(
      new Request("http://localhost/admin/users/user-1", {
        method: "PATCH",
        headers: {
          cookie: "session=1",
          "content-type": "application/json",
        },
        body: JSON.stringify({ approved: true }),
      })
    );

    expect(approveResponse.status).toBe(200);
    expect(runtime.approvedByUserId.get("user-1")).toBe(1);
    await expect(approveResponse.json()).resolves.toEqual({
      user: expect.objectContaining({ id: "user-1", approved: true }),
    });

    const rejectResponse = await app.request(
      new Request("http://localhost/admin/users/user-1", {
        method: "PATCH",
        headers: {
          cookie: "session=1",
          "content-type": "application/json",
        },
        body: JSON.stringify({ approved: false }),
      })
    );

    expect(rejectResponse.status).toBe(200);
    expect(runtime.approvedByUserId.get("user-1")).toBe(0);
  });

  it("admin can change user role", async () => {
    const runtime = createRuntime();
    getMultiUserRuntime.mockReturnValue(runtime.runtime);

    const { registerMultiUserRoutes } = await importAdminRoutes();
    const { createAuthMiddleware } = await importAuthMiddleware();
    const app = createAdminApp();
    app.use("*", createAuthMiddleware());
    registerMultiUserRoutes(app);

    const response = await app.request(
      new Request("http://localhost/admin/users/user-1", {
        method: "PATCH",
        headers: {
          cookie: "session=1",
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "admin" }),
      })
    );

    expect(response.status).toBe(200);
    expect(runtime.setRole).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { userId: "user-1", role: "admin" },
    });
    await expect(response.json()).resolves.toEqual({
      user: expect.objectContaining({ id: "user-1", role: "admin" }),
    });
  });

  it("admin can list and set agent assignments", async () => {
    const runtime = createRuntime();
    runtime.assignmentStore.seed("agent-a", ["user-1"]);
    getMultiUserRuntime.mockReturnValue(runtime.runtime);

    const { registerMultiUserRoutes } = await importAdminRoutes();
    const { createAuthMiddleware } = await importAuthMiddleware();
    const app = createAdminApp();
    app.use("*", createAuthMiddleware());
    registerMultiUserRoutes(app);

    const listResponse = await app.request(
      makeAuthRequest("/admin/agents/assignments")
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      assignments: [
        {
          userId: "user-1",
          agentId: "agent-a",
          assignedBy: "admin-1",
          assignedAt: "2026-04-04 18:00:00",
        },
      ],
    });

    const setResponse = await app.request(
      new Request("http://localhost/admin/agents/agent-b/assignments", {
        method: "PUT",
        headers: {
          cookie: "session=1",
          "content-type": "application/json",
        },
        body: JSON.stringify({ userIds: ["user-1", "user-2", "user-2"] }),
      })
    );

    expect(setResponse.status).toBe(200);
    await expect(setResponse.json()).resolves.toEqual({
      agentId: "agent-b",
      userIds: ["user-1", "user-2"],
    });
  });

  it("rejects unknown user ids when setting agent assignments", async () => {
    const runtime = createRuntime();
    getMultiUserRuntime.mockReturnValue(runtime.runtime);

    const { registerMultiUserRoutes } = await importAdminRoutes();
    const { createAuthMiddleware } = await importAuthMiddleware();
    const app = createAdminApp();
    app.use("*", createAuthMiddleware());
    registerMultiUserRoutes(app);

    const response = await app.request(
      new Request("http://localhost/admin/agents/agent-b/assignments", {
        method: "PUT",
        headers: {
          cookie: "session=1",
          "content-type": "application/json",
        },
        body: JSON.stringify({ userIds: ["user-1", "missing-user"] }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown user ids",
      userIds: ["missing-user"],
    });
    expect(
      runtime.assignmentStore.store.getAssignmentsForAgent("agent-b")
    ).toEqual([]);
  });

  it("non-admin gets 403 on admin routes", async () => {
    const runtime = createRuntime({ session: createSession("user") });
    getMultiUserRuntime.mockReturnValue(runtime.runtime);

    const { registerMultiUserRoutes } = await importAdminRoutes();
    const { createAuthMiddleware } = await importAuthMiddleware();
    const app = createAdminApp();
    app.use("*", createAuthMiddleware());
    registerMultiUserRoutes(app);

    const usersResponse = await app.request(makeAuthRequest("/admin/users"));
    expect(usersResponse.status).toBe(403);

    const assignmentsResponse = await app.request(
      makeAuthRequest("/admin/agents/assignments")
    );
    expect(assignmentsResponse.status).toBe(403);
  });

  it("/api/me returns current user and assignments", async () => {
    const runtime = createRuntime({ session: createSession("user") });
    runtime.assignmentStore.seed("agent-a", ["user-1"]);
    runtime.assignmentStore.seed("agent-b", ["user-1", "user-2"]);
    getMultiUserRuntime.mockReturnValue(runtime.runtime);

    const { registerMultiUserRoutes } = await importAdminRoutes();
    const { createAuthMiddleware } = await importAuthMiddleware();
    const app = createAdminApp();
    app.use("*", createAuthMiddleware());
    registerMultiUserRoutes(app);

    const response = await app.request(makeAuthRequest("/me"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: "user-1",
        name: "user",
        email: "user@example.com",
        role: "user",
        approved: true,
      },
      assignedAgentIds: ["agent-a", "agent-b"],
    });
  });
});

describe("multi-user api core", () => {
  it("/api/agents filters assignments for non-admin users", async () => {
    const runtime = createRuntime();
    runtime.assignmentStore.seed("agent-b", ["user-1"]);
    getMultiUserRuntime.mockReturnValue(runtime.runtime);

    const { api } = await import("../../server/api.core.js");
    const response = await api.request(
      new Request("http://localhost/agents", {
        headers: {
          "x-aihub-auth-context": encodeAuthHeader({
            user: {
              id: "user-1",
              role: "user",
              approved: true,
            },
            session: {
              id: "session-1",
              userId: "user-1",
            },
          }),
        },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({ id: "agent-b" }),
    ]);
  });

  it("/api/agents stays unfiltered for admins", async () => {
    const runtime = createRuntime();
    runtime.assignmentStore.seed("agent-b", ["user-1"]);
    getMultiUserRuntime.mockReturnValue(runtime.runtime);

    const { api } = await import("../../server/api.core.js");
    const response = await api.request(
      new Request("http://localhost/agents", {
        headers: {
          "x-aihub-auth-context": encodeAuthHeader({
            user: {
              id: "admin-1",
              role: "admin",
              approved: true,
            },
            session: {
              id: "session-1",
              userId: "admin-1",
            },
          }),
        },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({ id: "agent-a" }),
      expect.objectContaining({ id: "agent-b" }),
    ]);
  });

  it("/api/agents/status filters assignments for non-admin users", async () => {
    const runtime = createRuntime();
    runtime.assignmentStore.seed("agent-b", ["user-1"]);
    getMultiUserRuntime.mockReturnValue(runtime.runtime);

    const { api } = await import("../../server/api.core.js");
    const response = await api.request(
      new Request("http://localhost/agents/status", {
        headers: {
          "x-aihub-auth-context": encodeAuthHeader({
            user: {
              id: "user-1",
              role: "user",
              approved: true,
            },
            session: {
              id: "session-1",
              userId: "user-1",
            },
          }),
        },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      statuses: {
        "agent-b": "idle",
      },
    });
  });

  it("/api/capabilities includes multi-user info", async () => {
    const runtime = createRuntime();
    runtime.assignmentStore.seed("agent-b", ["user-1"]);
    getMultiUserRuntime.mockReturnValue(runtime.runtime);

    const { api } = await import("../../server/api.core.js");
    const response = await api.request(
      new Request("http://localhost/capabilities", {
        headers: {
          "x-aihub-auth-context": encodeAuthHeader({
            user: {
              id: "user-1",
              name: "User One",
              email: "user1@example.com",
              role: "user",
              approved: true,
            },
            session: {
              id: "session-1",
              userId: "user-1",
            },
          }),
        },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 2,
      components: { multiUser: true },
      agents: ["agent-b"],
      multiUser: true,
      user: {
        id: "user-1",
        name: "User One",
        email: "user1@example.com",
        role: "user",
      },
    });
  });
});
