import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createSubagentToolHandlers, type SubagentToolHandlers } from "./tool_handlers.js";

const spawnParams = {
  type: "object",
  properties: {
    projectId: { type: "string" },
    slug: { type: "string" },
    cli: { type: "string" },
    prompt: { type: "string" },
    mode: { type: "string" },
    baseBranch: { type: "string" },
    resume: { type: "boolean" },
  },
  required: ["projectId", "slug", "cli", "prompt"],
} as any;

const statusParams = {
  type: "object",
  properties: {
    projectId: { type: "string" },
    slug: { type: "string" },
  },
  required: ["projectId", "slug"],
} as any;

const logsParams = {
  type: "object",
  properties: {
    projectId: { type: "string" },
    slug: { type: "string" },
    since: { type: "number" },
  },
  required: ["projectId", "slug"],
} as any;

const interruptParams = statusParams;

function okText(data: unknown) {
  return [{ type: "text" as const, text: JSON.stringify(data) }];
}

export function createPiSubagentTools(handlers?: SubagentToolHandlers): AgentTool[] {
  const ops = handlers ?? createSubagentToolHandlers();

  return [
    {
      name: "subagent.spawn",
      label: "Spawn subagent",
      description: "Spawn an external CLI subagent",
      parameters: spawnParams,
      execute: async (_toolCallId, params) => {
        const input = params as {
          projectId: string;
          slug: string;
          cli: string;
          prompt: string;
          mode?: string;
          baseBranch?: string;
          resume?: boolean;
        };
        const result = await ops.spawn({
          projectId: input.projectId,
          slug: input.slug,
          cli: input.cli as any,
          prompt: input.prompt,
          mode: input.mode as any,
          baseBranch: input.baseBranch,
          resume: input.resume,
        });
        if (!result.ok) throw new Error(result.error);
        return { content: okText(result.data), details: result.data };
      },
    },
    {
      name: "subagent.status",
      label: "Subagent status",
      description: "Get status for a subagent",
      parameters: statusParams,
      execute: async (_toolCallId, params) => {
        const input = params as { projectId: string; slug: string };
        const result = await ops.status({
          projectId: input.projectId,
          slug: input.slug,
        });
        if (!result.ok) throw new Error(result.error);
        return { content: okText(result.data), details: result.data };
      },
    },
    {
      name: "subagent.logs",
      label: "Subagent logs",
      description: "Fetch logs for a subagent",
      parameters: logsParams,
      execute: async (_toolCallId, params) => {
        const input = params as { projectId: string; slug: string; since?: number };
        const result = await ops.logs({
          projectId: input.projectId,
          slug: input.slug,
          since: typeof input.since === "number" ? input.since : undefined,
        });
        if (!result.ok) throw new Error(result.error);
        return { content: okText(result.data), details: result.data };
      },
    },
    {
      name: "subagent.interrupt",
      label: "Interrupt subagent",
      description: "Interrupt a running subagent",
      parameters: interruptParams,
      execute: async (_toolCallId, params) => {
        const input = params as { projectId: string; slug: string };
        const result = await ops.interrupt({
          projectId: input.projectId,
          slug: input.slug,
        });
        if (!result.ok) throw new Error(result.error);
        return { content: okText(result.data), details: result.data };
      },
    },
  ];
}
