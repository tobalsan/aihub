import { Hono } from "hono";
import { z } from "zod";
import {
  CreateProjectRequestSchema,
  ProjectCommentRequestSchema,
  UpdateProjectRequestSchema,
  type GatewayConfig,
} from "@aihub/shared";
import {
  recordCommentActivity,
  appendProjectComment,
  createProject,
  getProject,
  updateProject,
  type ProjectCommentResult,
  type ProjectItemResult,
} from "@aihub/extension-projects";
import {
  createSubagentToolHandlers,
  type SubagentToolHandlers,
} from "@aihub/extension-projects/tool-handlers";
import { loadConfig } from "../config/index.js";
import { validateContainerToken } from "../sdk/container/tokens.js";

const InternalToolRequestSchema = z.object({
  tool: z.string(),
  args: z.unknown(),
  agentId: z.string(),
  agentToken: z.string(),
});

const ProjectIdArgsSchema = z.object({ projectId: z.string() });
const ProjectUpdateArgsSchema = z
  .object({
    projectId: z.string(),
    updates: UpdateProjectRequestSchema.optional(),
  })
  .passthrough();
const ProjectCommentArgsSchema = z.object({
  projectId: z.string(),
  author: z.string(),
  message: z.string(),
});

type ProjectOps = {
  create: typeof createProject;
  update: typeof updateProject;
  get: typeof getProject;
  comment: typeof appendProjectComment;
};

type InternalToolsDeps = {
  getConfig: () => GatewayConfig;
  validateToken: (token: string, agentId: string) => boolean;
  subagents: SubagentToolHandlers;
  projects: ProjectOps;
  recordComment: typeof recordCommentActivity;
};

const defaultDeps: InternalToolsDeps = {
  getConfig: loadConfig,
  validateToken: validateContainerToken,
  subagents: createSubagentToolHandlers(),
  projects: {
    create: createProject,
    update: updateProject,
    get: getProject,
    comment: appendProjectComment,
  },
  recordComment: recordCommentActivity,
};

function formatThreadDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function unwrapProjectResult(
  result: ProjectItemResult | ProjectCommentResult
): unknown {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

function parseSubagentArgs<T>(args: unknown): T {
  return args as T;
}

async function dispatchInternalTool(
  deps: InternalToolsDeps,
  tool: string,
  args: unknown
): Promise<unknown> {
  const config = deps.getConfig();

  switch (tool) {
    case "subagent.spawn": {
      const result = await deps.subagents.spawn(parseSubagentArgs(args));
      if (!result.ok) throw new Error(result.error);
      return result.data;
    }
    case "subagent.status": {
      const result = await deps.subagents.status(parseSubagentArgs(args));
      if (!result.ok) throw new Error(result.error);
      return result.data;
    }
    case "subagent.logs": {
      const result = await deps.subagents.logs(parseSubagentArgs(args));
      if (!result.ok) throw new Error(result.error);
      return result.data;
    }
    case "subagent.interrupt": {
      const result = await deps.subagents.interrupt(parseSubagentArgs(args));
      if (!result.ok) throw new Error(result.error);
      return result.data;
    }
    case "project.create": {
      const parsed = CreateProjectRequestSchema.parse(args);
      return unwrapProjectResult(await deps.projects.create(config, parsed));
    }
    case "project.get": {
      const parsed = ProjectIdArgsSchema.parse(args);
      return unwrapProjectResult(
        await deps.projects.get(config, parsed.projectId)
      );
    }
    case "project.update": {
      const parsed = ProjectUpdateArgsSchema.parse(args);
      const { projectId, updates, ...rest } = parsed;
      const body = updates ?? UpdateProjectRequestSchema.parse(rest);
      return unwrapProjectResult(
        await deps.projects.update(config, projectId, body)
      );
    }
    case "project.comment": {
      const parsed = ProjectCommentArgsSchema.parse(args);
      const comment = ProjectCommentRequestSchema.parse(parsed);
      const result = await deps.projects.comment(config, parsed.projectId, {
        author: comment.author,
        date: formatThreadDate(new Date()),
        body: comment.message,
      });
      const data = unwrapProjectResult(result);
      await deps.recordComment({
        actor: comment.author,
        projectId: parsed.projectId,
        commentExcerpt: comment.message,
      });
      return data;
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

export function createInternalTools(
  overrides: Partial<InternalToolsDeps> = {}
): Hono {
  const deps = { ...defaultDeps, ...overrides };
  const app = new Hono();

  app.post("/tools", async (c) => {
    const body = await c.req.json();
    const parsed = InternalToolRequestSchema.safeParse(body);
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

    try {
      const result = await dispatchInternalTool(
        deps,
        parsed.data.tool,
        parsed.data.args
      );
      return c.json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tool execution failed";
      if (message.startsWith("Unknown tool: ")) {
        return c.json({ error: message }, 400);
      }
      return c.json({ error: message }, 500);
    }
  });

  return app;
}

export const internalTools = createInternalTools();
