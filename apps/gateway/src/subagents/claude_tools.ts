import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { createSubagentToolHandlers, type SubagentToolHandlers } from "./tool_handlers.js";

export const SUBAGENT_MCP_SERVER = "aihub-subagents";
export const SUBAGENT_TOOL_NAMES = {
  spawn: "subagent.spawn",
  status: "subagent.status",
  logs: "subagent.logs",
  interrupt: "subagent.interrupt",
  kill: "subagent.kill",
};

export function createSubagentMcpServer(handlers?: SubagentToolHandlers) {
  const ops = handlers ?? createSubagentToolHandlers();

  const spawnSchema = {
    projectId: z.string(),
    slug: z.string(),
    cli: z.enum(["claude", "codex", "droid", "gemini"]),
    prompt: z.string(),
    mode: z.enum(["main-run", "worktree"]).optional(),
    baseBranch: z.string().optional(),
    resume: z.boolean().optional(),
  };

  const statusSchema = {
    projectId: z.string(),
    slug: z.string(),
  };

  const logsSchema = {
    projectId: z.string(),
    slug: z.string(),
    since: z.number().optional(),
  };

  const interruptSchema = statusSchema;
  const killSchema = statusSchema;

  return createSdkMcpServer({
    name: SUBAGENT_MCP_SERVER,
    version: "1.0.0",
    tools: [
      tool(SUBAGENT_TOOL_NAMES.spawn, "Spawn an external CLI subagent", spawnSchema, async (args) => {
        const result = await ops.spawn(args);
        if (!result.ok) throw new Error(result.error);
        return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
      }),
      tool(SUBAGENT_TOOL_NAMES.status, "Get status for a subagent", statusSchema, async (args) => {
        const result = await ops.status(args);
        if (!result.ok) throw new Error(result.error);
        return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
      }),
      tool(SUBAGENT_TOOL_NAMES.logs, "Fetch logs for a subagent", logsSchema, async (args) => {
        const result = await ops.logs(args);
        if (!result.ok) throw new Error(result.error);
        return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
      }),
      tool(SUBAGENT_TOOL_NAMES.interrupt, "Interrupt a running subagent", interruptSchema, async (args) => {
        const result = await ops.interrupt(args);
        if (!result.ok) throw new Error(result.error);
        return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
      }),
      tool(SUBAGENT_TOOL_NAMES.kill, "Kill and remove a subagent workspace", killSchema, async (args) => {
        const result = await ops.kill(args);
        if (!result.ok) throw new Error(result.error);
        return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
      }),
    ],
  });
}
