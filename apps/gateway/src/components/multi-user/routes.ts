import type { Hono } from "hono";
import { getMultiUserRuntime } from "./index.js";

function getRuntimeOrThrow() {
  const runtime = getMultiUserRuntime();
  if (!runtime) {
    throw new Error("multi-user runtime not initialized");
  }
  return runtime;
}

export function registerMultiUserRoutes(app: Hono): void {
  app.on(["GET", "POST"], "/auth/*", (c) => {
    const { auth } = getRuntimeOrThrow();
    return auth.handler(c.req.raw);
  });

  app.get("/me", async (c) => {
    const { auth } = getRuntimeOrThrow();
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json({ user: null, session: null }, 401);
    }

    return c.json(session);
  });
}
