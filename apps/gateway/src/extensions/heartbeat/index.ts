import { HeartbeatExtensionConfigSchema, type Extension } from "@aihub/shared";
import type { Hono } from "hono";
import { getAgent, isAgentActive } from "../../config/index.js";
import {
  runHeartbeat,
  startAllHeartbeats,
  stopAllHeartbeats,
} from "../../heartbeat/index.js";

const heartbeatExtension: Extension = {
  id: "heartbeat",
  displayName: "Heartbeat",
  description: "Periodic heartbeat checks and alert runs",
  dependencies: ["scheduler"],
  configSchema: HeartbeatExtensionConfigSchema,
  routePrefixes: ["/api/agents/:id/heartbeat"],
  validateConfig(raw) {
    const result = HeartbeatExtensionConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success ? [] : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes(app: Hono) {
    app.post("/agents/:id/heartbeat", async (c) => {
      const agentId = c.req.param("id");
      const agent = getAgent(agentId);
      if (!agent || !isAgentActive(agentId)) {
        return c.json({ error: "Agent not found" }, 404);
      }

      const result = await runHeartbeat(agentId);
      return c.json(result);
    });
  },
  async start() {
    startAllHeartbeats();
  },
  async stop() {
    stopAllHeartbeats();
  },
  capabilities() {
    return ["heartbeat"];
  },
};

export { heartbeatExtension };
