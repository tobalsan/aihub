import { Hono } from "hono";
import { z } from "zod";
import type { ConnectorTool, GatewayConfig } from "@aihub/shared";
import { loadConfig } from "../config/index.js";
import {
  getConnectorToolsForAgent,
} from "../connectors/index.js";
import { validateContainerToken } from "../sdk/container/tokens.js";

const ConnectorToolRequestSchema = z.object({
  connectorId: z.string(),
  tool: z.string(),
  args: z.unknown(),
  agentId: z.string(),
  agentToken: z.string(),
});

type ConnectorToolsDeps = {
  getConfig: () => GatewayConfig;
  validateToken: (token: string, agentId: string) => boolean;
};

const defaultDeps: ConnectorToolsDeps = {
  getConfig: loadConfig,
  validateToken: validateContainerToken,
};

export function createConnectorTools(
  overrides: Partial<ConnectorToolsDeps> = {}
): Hono {
  const deps = { ...defaultDeps, ...overrides };
  const app = new Hono();

  app.post("/tools", async (c) => {
    const body = await c.req.json();
    const parsed = ConnectorToolRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const headerAgentId = c.req.header("X-Agent-Id");
    const headerAgentToken = c.req.header("X-Agent-Token");
    if (
      (headerAgentId && headerAgentId !== parsed.data.agentId) ||
      (headerAgentToken && headerAgentToken !== parsed.data.agentToken) ||
      !deps.validateToken(parsed.data.agentToken, parsed.data.agentId)
    ) {
      return c.json({ error: "Invalid agent token" }, 403);
    }

    const config = deps.getConfig();
    const agent = config.agents.find((a) => a.id === parsed.data.agentId);
    if (!agent) {
      return c.json({ error: `Unknown agent: ${parsed.data.agentId}` }, 404);
    }

    const toolName = parsed.data.tool;
    const tools = getConnectorToolsForAgent(agent, config);
    const tool = tools.find((t: ConnectorTool) => t.name === toolName);
    if (!tool) {
      return c.json(
        { error: `Unknown connector tool: ${toolName}` },
        400
      );
    }

    try {
      const result = await tool.execute(parsed.data.args);
      return c.json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tool execution failed";
      return c.json({ error: message }, 500);
    }
  });

  return app;
}

export const connectorTools = createConnectorTools();
