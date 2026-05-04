import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { Hono } from "hono";
import {
  AreaSchema,
  CreateProjectRequestSchema,
  ProjectCommentRequestSchema,
  ProjectsExtensionConfigSchema,
  StartProjectRunRequestSchema,
  UpdateProjectCommentRequestSchema,
  UpdateProjectRequestSchema,
  buildRolePrompt,
  normalizeProjectStatus,
  type Extension,
  type ExtensionAgentTool,
  type GatewayConfig,
  type PromptRole,
  type UpdateProjectRequest,
} from "@aihub/shared";
import { z } from "zod";
import {
  getRecentActivity,
  recordCommentActivity,
  recordProjectStatusActivity,
} from "./activity/index.js";
import {
  createArea,
  deleteArea,
  listAreas,
  migrateAreas,
  updateArea,
} from "./areas/index.js";
import {
  appendProjectComment,
  archiveProject,
  clearProjectSpaceRebaseConflict,
  commitProjectChanges,
  createProject,
  deleteProject,
  deleteProjectComment,
  getGitHead,
  getProject,
  getProjectChanges,
  getProjectPullRequestTarget,
  getProjectSpace,
  getProjectSpaceCommitLog,
  getProjectSpaceConflictContext,
  getProjectSpaceContribution,
  getProjectSpaceWriteLease,
  integrateProjectSpaceQueue,
  integrateSpaceEntries,
  acquireProjectSpaceWriteLease,
  isSpaceWriteLeaseEnabled,
  listArchivedProjects,
  listProjects,
  mergeSpaceIntoBase,
  parseTasks,
  readSpec,
  rebaseSpaceOntoMain,
  listSlices,
  createSlice,
  getSlice,
  updateSlice,
  releaseProjectSpaceWriteLease,
  resolveAttachmentFile,
  saveAttachments,
  serializeTasks,
  skipSpaceEntries,
  unarchiveProject,
  updateProject,
  updateProjectComment,
  writeSpec,
  type SliceStatus,
  type SliceHillPosition,
} from "./projects/index.js";
import {
  startProjectWatcher,
  type ProjectWatcher,
} from "./projects/watcher.js";
import {
  startOrchestratorDaemon,
  type OrchestratorDaemon,
} from "./orchestrator/index.js";
import {
  archiveSubagent,
  getSubagentLogs,
  listAllSubagents,
  listProjectBranches,
  listSubagents,
  readSubagentConfig,
  unarchiveSubagent,
  updateSubagentConfig,
} from "./subagents/index.js";
import {
  getUnsupportedSubagentCliError,
  interruptSubagent,
  isSupportedSubagentCli,
  killSubagent,
  spawnSubagent,
} from "./subagents/runner.js";
import { getTaskboardItem, scanTaskboard } from "./taskboard/index.js";
import { parseMarkdownFile } from "./taskboard/parser.js";
import {
  clearProjectsContext,
  getProjectsContext,
  setProjectsContext,
} from "./context.js";

const execFileAsync = promisify(execFile);
const registeredApps = new WeakSet<object>();

type CancelInterruptDeps = {
  listSubagentsFn?: typeof listSubagents;
  interruptSubagentFn?: typeof interruptSubagent;
};

async function getCancelledSliceIdsForProject(
  config: GatewayConfig,
  id: string
): Promise<string[]> {
  const prev = await getProject(config, id);
  if (!prev.ok) return [];
  const slices = await listSlices(prev.data.absolutePath);
  return slices
    .filter(
      (slice) =>
        slice.frontmatter.status !== "done" &&
        slice.frontmatter.status !== "cancelled"
    )
    .map((slice) => slice.id);
}

export async function interruptCancelledOrchestratorRuns(
  config: GatewayConfig,
  projectId: string,
  cancelledSliceIds: string[],
  deps: CancelInterruptDeps = {}
): Promise<void> {
  if (cancelledSliceIds.length === 0) return;
  const listSubagentsFn = deps.listSubagentsFn ?? listSubagents;
  const interruptSubagentFn = deps.interruptSubagentFn ?? interruptSubagent;
  const runs = await listSubagentsFn(config, projectId, true);
  if (!runs.ok) return;
  await Promise.all(
    runs.data.items
      .filter(
        (item) =>
          item.source === "orchestrator" &&
          item.status === "running" &&
          item.sliceId &&
          cancelledSliceIds.includes(item.sliceId)
      )
      .map((item) =>
        interruptSubagentFn(config, projectId, item.slug).catch(() => undefined)
      )
  );
}

async function updateProjectWithCancelInterrupt(
  config: GatewayConfig,
  projectId: string,
  input: UpdateProjectRequest
) {
  const cancelledSliceIds =
    input.status === "cancelled"
      ? await getCancelledSliceIdsForProject(config, projectId)
      : [];
  const result = await updateProject(config, projectId, input);
  if (result.ok && input.status === "cancelled") {
    await interruptCancelledOrchestratorRuns(
      config,
      projectId,
      cancelledSliceIds
    );
  }
  return result;
}

type CliRunMode = "main-run" | "worktree" | "clone" | "none";
type CliHarness = "codex" | "claude" | "pi";

const CODEX_MODELS = [
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2",
];
const CLAUDE_MODELS = ["opus", "sonnet", "haiku"];
const PI_MODELS = [
  "qwen3.5-plus",
  "qwen3-max-2026-01-23",
  "MiniMax-M2.5",
  "glm-5",
  "kimi-k2.5",
];
const CODEX_REASONING = ["xhigh", "high", "medium", "low"];
const CLAUDE_EFFORT = ["high", "medium", "low"];
const PI_THINKING = ["off", "low", "medium", "high", "xhigh"];

const UpdateTaskRequestSchema = z.object({
  checked: z.boolean().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  agentId: z.union([z.string(), z.null()]).optional(),
});

const CreateTaskRequestSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
});

const PutSpecRequestSchema = z.object({
  content: z.string(),
});

const CommitProjectChangesRequestSchema = z.object({
  message: z.string(),
});

const AcquireSpaceLeaseRequestSchema = z.object({
  holder: z.string(),
  ttlSeconds: z.number().int().positive().optional(),
  force: z.boolean().optional(),
});

const ReleaseSpaceLeaseRequestSchema = z.object({
  holder: z.string().optional(),
  force: z.boolean().optional(),
});

const MergeSpaceRequestSchema = z.object({
  cleanup: z.boolean().optional(),
});

const SpaceEntriesRequestSchema = z.object({
  entryIds: z.array(z.string()),
});

const UpdateSubagentRequestSchema = z.object({
  name: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: z.string().optional(),
  thinking: z.string().optional(),
});

let watcher: ProjectWatcher | null = null;
let orchestrator: OrchestratorDaemon | null = null;

function getProjectsRuntimeConfig(config: GatewayConfig): GatewayConfig {
  const root = config.extensions?.projects?.root ?? config.projects?.root;
  if (root === undefined) return config;
  return {
    ...config,
    projects: {
      ...config.projects,
      root,
    },
  };
}

function getProjectsConfig(): GatewayConfig {
  return getProjectsRuntimeConfig(getProjectsContext().getConfig());
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function expandHomePath(value: string): string {
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function projectDirNameFromPath(projectPath: string): string {
  return path.basename(projectPath.replace(/\\/g, "/"));
}

function emitProjectFileChanged(
  projectId: string,
  projectDirName: string,
  fileName: string
): void {
  getProjectsContext().emit("file.changed", {
    type: "file_changed",
    projectId,
    file: `${projectDirName}/${fileName}`,
  });
}

function emitUpdatedProjectFiles(
  projectId: string,
  projectDirName: string,
  input: UpdateProjectRequest
): void {
  const updatedFiles = new Set<string>(["README.md"]);
  if (input.specs !== undefined) updatedFiles.add("SPECS.md");
  if (input.readme !== undefined) updatedFiles.add("README.md");
  if (input.docs) {
    for (const key of Object.keys(input.docs)) {
      const normalized = key.replace(/\.md$/i, "");
      updatedFiles.add(`${normalized}.md`);
    }
  }
  for (const fileName of updatedFiles) {
    emitProjectFileChanged(projectId, projectDirName, fileName);
  }
}

function normalizeRunAgent(
  value?: string
): { type: "aihub"; id: string } | { type: "cli"; id: string } | null {
  if (!value) return null;
  if (value.startsWith("aihub:")) return { type: "aihub", id: value.slice(6) };
  if (value.startsWith("cli:")) return { type: "cli", id: value.slice(4) };
  return null;
}

function normalizeCliRunMode(value: string): CliRunMode {
  if (value === "main-run") return "main-run";
  if (value === "worktree") return "worktree";
  if (value === "clone") return "clone";
  if (value === "none") return "none";
  return "clone";
}

function slugToName(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 3)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function resolveRunName(
  prefix: string | undefined,
  slug: string | undefined,
  explicitName: string | undefined
): string | undefined {
  const requestedName = hasText(explicitName) ? explicitName.trim() : undefined;
  if (requestedName) return requestedName;
  if (!prefix) return undefined;

  if (!hasText(slug)) return prefix;

  const words = slugToName(slug)
    .split(" ")
    .filter((part) => part.length > 0);
  if (words.length === 0) return prefix;
  if (words[0].toLowerCase() === prefix.toLowerCase()) {
    words.shift();
  }
  return words.length > 0 ? `${prefix} ${words.join(" ")}` : prefix;
}

function resolveCliSpawnOptions(
  cli: CliHarness,
  model?: string,
  reasoningEffort?: string,
  thinking?: string
):
  | {
      ok: true;
      data: {
        model: string;
        reasoningEffort?: string;
        thinking?: string;
      };
    }
  | { ok: false; error: string } {
  if (cli === "codex") {
    const resolvedModel = model || "gpt-5.3-codex";
    if (!CODEX_MODELS.includes(resolvedModel)) {
      return {
        ok: false,
        error: `Invalid codex model: ${resolvedModel}. Allowed: ${CODEX_MODELS.join(", ")}`,
      };
    }
    const resolvedEffort = reasoningEffort || "high";
    if (!CODEX_REASONING.includes(resolvedEffort)) {
      return {
        ok: false,
        error: `Invalid codex reasoning effort: ${resolvedEffort}. Allowed: ${CODEX_REASONING.join(", ")}`,
      };
    }
    if (thinking) {
      return {
        ok: false,
        error: "thinking is only valid for pi CLI",
      };
    }
    return {
      ok: true,
      data: { model: resolvedModel, reasoningEffort: resolvedEffort },
    };
  }

  if (cli === "claude") {
    const resolvedModel = model || "sonnet";
    if (!CLAUDE_MODELS.includes(resolvedModel)) {
      return {
        ok: false,
        error: `Invalid claude model: ${resolvedModel}. Allowed: ${CLAUDE_MODELS.join(", ")}`,
      };
    }
    const resolvedEffort = reasoningEffort || "high";
    if (!CLAUDE_EFFORT.includes(resolvedEffort)) {
      return {
        ok: false,
        error: `Invalid claude effort: ${resolvedEffort}. Allowed: ${CLAUDE_EFFORT.join(", ")}`,
      };
    }
    if (thinking) {
      return {
        ok: false,
        error: "thinking is only valid for pi CLI",
      };
    }
    return {
      ok: true,
      data: { model: resolvedModel, reasoningEffort: resolvedEffort },
    };
  }

  const resolvedModel = model || "qwen3.5-plus";
  if (!PI_MODELS.includes(resolvedModel)) {
    return {
      ok: false,
      error: `Invalid pi model: ${resolvedModel}. Allowed: ${PI_MODELS.join(", ")}`,
    };
  }
  const resolvedThinking = thinking || "medium";
  if (!PI_THINKING.includes(resolvedThinking)) {
    return {
      ok: false,
      error: `Invalid pi thinking: ${resolvedThinking}. Allowed: ${PI_THINKING.join(", ")}`,
    };
  }
  if (reasoningEffort) {
    return {
      ok: false,
      error: "reasoningEffort is only valid for codex and claude CLIs",
    };
  }
  return {
    ok: true,
    data: { model: resolvedModel, thinking: resolvedThinking },
  };
}

function slugifyTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatThreadDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function unwrapProjectToolResult<T>(
  result: { ok: true; data: T } | { ok: false; error: string }
): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function createProjectAgentTools(): ExtensionAgentTool[] {
  return [
    {
      name: "project.create",
      description: "Create an AIHub project",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          specs: { type: "string" },
          status: { type: "string" },
          area: { type: "string" },
        },
        required: ["title"],
      },
      async execute(args, { config }) {
        const parsed = CreateProjectRequestSchema.parse(args);
        return unwrapProjectToolResult(await createProject(config, parsed));
      },
    },
    {
      name: "project.get",
      description: "Get an AIHub project",
      parameters: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      async execute(args, { config }) {
        const parsed = z.object({ projectId: z.string() }).parse(args);
        return unwrapProjectToolResult(
          await getProject(config, parsed.projectId)
        );
      },
    },
    {
      name: "project.update",
      description: "Update an AIHub project",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          updates: { type: "object" },
        },
        required: ["projectId"],
      },
      async execute(args, { config }) {
        const parsed = z
          .object({
            projectId: z.string(),
            updates: UpdateProjectRequestSchema.optional(),
          })
          .passthrough()
          .parse(args);
        const { projectId, updates, ...rest } = parsed;
        const body = updates ?? UpdateProjectRequestSchema.parse(rest);
        return unwrapProjectToolResult(
          await updateProjectWithCancelInterrupt(config, projectId, body)
        );
      },
    },
    {
      name: "project.comment",
      description: "Add a comment to an AIHub project",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          author: { type: "string" },
          message: { type: "string" },
        },
        required: ["projectId", "author", "message"],
      },
      async execute(args, { config }) {
        const parsed = z
          .object({
            projectId: z.string(),
            author: z.string(),
            message: z.string(),
          })
          .parse(args);
        const comment = ProjectCommentRequestSchema.parse(parsed);
        const data = unwrapProjectToolResult(
          await appendProjectComment(config, parsed.projectId, {
            author: comment.author,
            date: formatThreadDate(new Date()),
            body: comment.message,
          })
        );
        await recordCommentActivity({
          actor: comment.author,
          projectId: parsed.projectId,
          commentExcerpt: comment.message,
        });
        return data;
      },
    },
  ];
}

function attachmentContentType(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

async function clearLeadSessionState(
  agentId: string,
  sessionKey: string,
  userId?: string
): Promise<void> {
  const cleared = await getProjectsContext().clearSessionEntry(
    agentId,
    sessionKey,
    userId
  );
  if (!cleared) return;
  getProjectsContext().deleteSession(agentId, cleared.sessionId);
  await getProjectsContext().invalidateHistoryCache(
    agentId,
    cleared.sessionId,
    userId
  );
}

function isUploadedFile(
  value: unknown
): value is { name: string; arrayBuffer: () => Promise<ArrayBuffer> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
    "name" in value &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

export function isProjectsComponentEnabled(config: GatewayConfig): boolean {
  const componentConfig = config.extensions?.projects;
  if (componentConfig) return componentConfig.enabled !== false;
  return config.projects !== undefined;
}

export function registerProjectRoutes(app: Hono): void {
  if (registeredApps.has(app)) return;
  registeredApps.add(app);

  app.get("/areas", async (c) => {
    const config = getProjectsConfig();
    const areas = await listAreas(config);
    return c.json(areas);
  });

  app.post("/areas", async (c) => {
    const body = await c.req.json();
    const parsed = AreaSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const config = getProjectsConfig();
    try {
      const area = await createArea(config, parsed.data);
      return c.json(area, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.startsWith("Area already exists") ? 409 : 400;
      return c.json({ error: message }, status);
    }
  });

  app.patch("/areas/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = AreaSchema.partial().safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const config = getProjectsConfig();
    try {
      const area = await updateArea(config, id, parsed.data);
      return c.json(area);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.startsWith("Area not found") ? 404 : 400;
      return c.json({ error: message }, status);
    }
  });

  app.delete("/areas/:id", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    const deleted = await deleteArea(config, id);
    if (!deleted) {
      return c.json({ error: "Area not found" }, 404);
    }
    return c.json({ ok: true });
  });

  app.post("/areas/migrate", async (c) => {
    const config = getProjectsConfig();
    const result = await migrateAreas(config);
    return c.json(result);
  });

  app.post("/projects/:id/start", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const parsed = StartProjectRunRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const startInput = { ...parsed.data };
    const userExplicitName = hasText(startInput.name)
      ? startInput.name.trim()
      : undefined;

    // Subagent template resolution
    const subagentTemplateName = startInput.subagentTemplate;
    if (subagentTemplateName) {
      const match = getProjectsContext()
        .getSubagentTemplates()
        .find(
          (t) => t.name.toLowerCase() === subagentTemplateName.toLowerCase()
        );
      if (!match) {
        return c.json(
          { error: `Unknown subagent template: ${subagentTemplateName}` },
          400
        );
      }
      if (!hasText(startInput.runAgent))
        startInput.runAgent = `cli:${match.cli}`;
      if (!hasText(startInput.model)) startInput.model = match.model;
      if (!hasText(startInput.reasoningEffort))
        startInput.reasoningEffort = match.reasoning;
      if (!hasText(startInput.runMode)) startInput.runMode = match.runMode;
      if (!hasText(startInput.promptRole)) {
        startInput.promptRole = match.type as PromptRole;
      }
      if (!hasText(startInput.name)) startInput.name = match.name;
    }

    const config = getProjectsConfig();
    const projectResult = await getProject(config, id);
    if (!projectResult.ok) {
      return c.json({ error: projectResult.error }, 404);
    }
    const project = projectResult.data;
    const frontmatter = project.frontmatter ?? {};

    const status =
      typeof frontmatter.status === "string" ? frontmatter.status : "";
    const normalizedStatus = normalizeProjectStatus(status);

    const requestedRunAgentValue = hasText(startInput.runAgent)
      ? startInput.runAgent.trim()
      : "";
    const frontmatterRunAgentValue =
      typeof frontmatter.runAgent === "string"
        ? frontmatter.runAgent.trim()
        : "";
    const resolvedRunAgentValue =
      requestedRunAgentValue || frontmatterRunAgentValue || "cli:codex";
    const normalizedRunAgentValue = resolvedRunAgentValue.includes(":")
      ? resolvedRunAgentValue
      : `cli:${resolvedRunAgentValue}`;

    let runAgentSelection = normalizeRunAgent(normalizedRunAgentValue);
    if (!runAgentSelection) {
      const agents = getProjectsContext().getAgents();
      if (agents.length === 0) {
        return c.json({ error: "No active agents available" }, 400);
      }
      const preferred =
        normalizedStatus === "shaping"
          ? agents.find((agent) => agent.name === "Project Manager")
          : null;
      const selected = preferred ?? agents[0];
      runAgentSelection = { type: "aihub", id: selected.id };
    }

    let runMode: CliRunMode | undefined;
    let slug: string | undefined;
    let baseBranch: string | undefined;
    const requestedModel = hasText(startInput.model)
      ? startInput.model.trim()
      : undefined;
    const requestedReasoningEffort = hasText(startInput.reasoningEffort)
      ? startInput.reasoningEffort.trim()
      : undefined;
    const requestedThinking = hasText(startInput.thinking)
      ? startInput.thinking.trim()
      : undefined;
    const requestedRunModeValue = hasText(startInput.runMode)
      ? startInput.runMode.trim()
      : "";
    const resolvedRunMode = normalizeCliRunMode(
      requestedRunModeValue || "clone"
    );
    if (runAgentSelection.type === "cli") {
      runMode = resolvedRunMode;
      const requestedSlugValue = hasText(startInput.slug)
        ? startInput.slug.trim()
        : "";
      slug =
        runMode === "main-run"
          ? "main"
          : requestedSlugValue || slugifyTitle(project.title);
      baseBranch = hasText(startInput.baseBranch)
        ? startInput.baseBranch.trim()
        : "main";
    }

    let runAgentLabel: string | undefined;
    if (runAgentSelection.type === "cli") {
      const cliId = runAgentSelection.id;
      runAgentLabel =
        cliId === "codex"
          ? "Codex"
          : cliId === "claude"
            ? "Claude"
            : cliId === "pi"
              ? "Pi"
              : undefined;
    } else {
      runAgentLabel = getProjectsContext().getAgent(runAgentSelection.id)?.name;
    }

    const repo = typeof frontmatter.repo === "string" ? frontmatter.repo : "";
    const root =
      config.extensions?.projects?.root ??
      config.projects?.root ??
      "~/projects";
    const resolvedRoot = root.startsWith("~/")
      ? path.join(os.homedir(), root.slice(2))
      : root;
    const mainRepoPath = repo ? expandHomePath(repo) : "";
    const spaceWorktreePath = path.join(
      resolvedRoot,
      ".workspaces",
      project.id,
      "_space"
    );

    let implementationRepo = repo;
    if (runMode && (runMode === "clone" || runMode === "worktree") && slug) {
      implementationRepo = path.join(
        resolvedRoot,
        ".workspaces",
        project.id,
        slug
      );
    }
    const basePath = (project.absolutePath || project.path).replace(/\/$/, "");
    const absReadmePath = basePath.endsWith("README.md")
      ? basePath
      : `${basePath}/README.md`;
    const absSpecsPath = basePath.endsWith("SPECS.md")
      ? basePath
      : `${basePath}/SPECS.md`;
    const relBasePath = project.path.replace(/\/$/, "");
    const relReadmePath = relBasePath.endsWith("README.md")
      ? relBasePath
      : `${relBasePath}/README.md`;
    const relSpecsPath = relBasePath.endsWith("SPECS.md")
      ? relBasePath
      : `${relBasePath}/SPECS.md`;
    const readmePath =
      runAgentSelection.type === "aihub" ? absReadmePath : relReadmePath;
    const specsPathForRole =
      runAgentSelection.type === "aihub" ? absSpecsPath : relSpecsPath;
    const threadPath = path.join(basePath, "THREAD.md");
    let threadContent = "";
    try {
      const parsedThread = await parseMarkdownFile(threadPath);
      threadContent = parsedThread.content.trim();
    } catch {
      // ignore missing thread
    }

    const docKeys = Object.keys(project.docs ?? {}).sort((a, b) => {
      if (a === "README") return -1;
      if (b === "README") return 1;
      return a.localeCompare(b);
    });
    let fullContent = project.docs?.README ?? "";
    if (threadContent) {
      fullContent += `\n\n## THREAD\n\n${threadContent}`;
    }
    for (const key of docKeys) {
      if (key === "README") continue;
      const docContent = project.docs?.[key];
      if (docContent) {
        fullContent += `\n\n## ${key}\n\n${docContent}`;
      }
    }

    const promptRole: PromptRole = startInput.promptRole ?? "legacy";
    const specsPath = promptRole === "legacy" ? readmePath : specsPathForRole;
    const coordinatorWorkspaceContext =
      promptRole === "coordinator"
        ? [
            mainRepoPath
              ? [
                  "## Main Repository",
                  `Path: ${mainRepoPath}`,
                  "(Use this canonical repo for planning and delegation.)",
                ].join("\n")
              : "",
            [
              "## Project Space Worktree",
              `Path: ${spaceWorktreePath}`,
              "(Integration workspace where main-run aggregates worker changes.)",
            ].join("\n"),
          ]
            .filter((part) => part.length > 0)
            .join("\n\n")
        : "";
    const mergedCustomPrompt = [
      coordinatorWorkspaceContext,
      typeof startInput.customPrompt === "string"
        ? startInput.customPrompt
        : "",
    ]
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join("\n\n");
    let reviewerWorkspaces:
      | Array<{ name: string; cli?: string; path: string }>
      | undefined;
    if (promptRole === "reviewer") {
      const subagentsResult = await listSubagents(config, project.id);
      if (subagentsResult.ok) {
        reviewerWorkspaces = subagentsResult.data.items
          .filter(
            (item) =>
              item.archived !== true &&
              (item.runMode === "clone" || item.runMode === "worktree")
          )
          .map((item) => {
            const workspacePath = hasText(item.worktreePath)
              ? item.worktreePath.trim()
              : path.join(resolvedRoot, ".workspaces", project.id, item.slug);
            return {
              name: item.name?.trim() || item.slug,
              cli: item.cli,
              path: workspacePath,
            };
          });
      }
    }
    const prompt = buildRolePrompt({
      role: promptRole,
      title: project.title,
      status,
      path: basePath,
      content: fullContent,
      specsPath,
      projectFiles: [
        "README.md",
        "THREAD.md",
        ...docKeys.map((key) => `${key}.md`),
      ],
      projectId: project.id,
      repo: promptRole === "coordinator" ? mainRepoPath : implementationRepo,
      customPrompt: mergedCustomPrompt || undefined,
      runAgentLabel,
      workerWorkspaces: reviewerWorkspaces,
      subagentTypes: getProjectsContext().getSubagentTemplates(),
      includeDefaultPrompt: startInput.includeDefaultPrompt,
      includeRoleInstructions: startInput.includeRoleInstructions,
      includePostRun: startInput.includePostRun,
    });

    const updates: Partial<UpdateProjectRequest> = {};
    const hasLegacyRunConfig =
      typeof frontmatter.runAgent === "string" ||
      typeof frontmatter.runMode === "string" ||
      typeof frontmatter.baseBranch === "string";

    if (runAgentSelection.type === "aihub") {
      const agent = getProjectsContext().getAgent(runAgentSelection.id);
      if (!agent || !getProjectsContext().isAgentActive(runAgentSelection.id)) {
        return c.json({ error: "Agent not found" }, 404);
      }
      const sessionKeys =
        typeof frontmatter.sessionKeys === "object" &&
        frontmatter.sessionKeys !== null
          ? (frontmatter.sessionKeys as Record<string, string>)
          : {};
      const sessionKey =
        sessionKeys[agent.id] ?? `project:${project.id}:${agent.id}`;
      if (!sessionKeys[agent.id]) {
        updates.sessionKeys = { ...sessionKeys, [agent.id]: sessionKey };
      }
      if (normalizedStatus === "todo") {
        updates.status = "in_progress";
      }

      getProjectsContext()
        .runAgent({
          agentId: agent.id,
          message: prompt,
          sessionKey,
        })
        .catch((err) => {
          console.error(`[projects:${project.id}] start run failed:`, err);
        });

      if (Object.keys(updates).length > 0 || hasLegacyRunConfig) {
        await updateProject(config, project.id, updates);
      }

      return c.json({ ok: true, type: "aihub", sessionKey });
    }

    if (!isSupportedSubagentCli(runAgentSelection.id)) {
      return c.json(
        { error: getUnsupportedSubagentCliError(runAgentSelection.id) },
        400
      );
    }
    const runCli = runAgentSelection.id;
    const resolvedCliOptions = resolveCliSpawnOptions(
      runCli,
      requestedModel,
      requestedReasoningEffort,
      requestedThinking
    );
    if (!resolvedCliOptions.ok) {
      return c.json({ error: resolvedCliOptions.error }, 400);
    }

    const runModeValue = runMode ?? "main-run";
    const slugValue = slug ?? "main";
    if (!slug) {
      return c.json({ error: "Slug required" }, 400);
    }
    const baseBranchValue = baseBranch ?? "main";
    const namePrefix = hasText(startInput.name)
      ? startInput.name.trim()
      : undefined;
    const resolvedName = resolveRunName(
      namePrefix,
      slugValue,
      userExplicitName
    );

    const result = await spawnSubagent(config, {
      projectId: project.id,
      slug: slugValue,
      cli: runCli,
      name: resolvedName,
      prompt,
      model: resolvedCliOptions.data.model,
      reasoningEffort: resolvedCliOptions.data.reasoningEffort,
      thinking: resolvedCliOptions.data.thinking,
      mode: runModeValue,
      baseBranch: baseBranchValue,
    });
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }

    if (normalizedStatus === "todo") {
      updates.status = "in_progress";
    }
    if (Object.keys(updates).length > 0 || hasLegacyRunConfig) {
      await updateProject(config, project.id, updates);
    }

    return c.json({ ok: true, type: "cli", slug, runMode });
  });

  app.get("/config/spawn-options", (c) => {
    const agents = getProjectsContext()
      .getAgents()
      .map((a) => ({ id: a.id, name: a.name }));
    const subagentTemplates = getProjectsContext().getSubagentTemplates();
    return c.json({ agents, subagentTemplates });
  });

  app.get("/projects", async (c) => {
    const config = getProjectsConfig();
    const area = c.req.query("area");
    const result = await listProjects(config, { area });
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    return c.json(result.data);
  });

  app.get("/projects/archived", async (c) => {
    const config = getProjectsConfig();
    const result = await listArchivedProjects(config);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    return c.json(result.data);
  });

  app.post("/projects", async (c) => {
    const body = await c.req.json();
    const parsed = CreateProjectRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const config = getProjectsConfig();
    const result = await createProject(config, parsed.data);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    emitProjectFileChanged(result.data.id, result.data.path, "README.md");
    return c.json(result.data, 201);
  });

  app.get("/projects/:id", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    const result = await getProject(config, id);
    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }
    return c.json(result.data);
  });

  // ── Slice endpoints ────────────────────────────────────────────────────────

  app.get("/projects/:id/slices", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    const project = await getProject(config, id);
    if (!project.ok) {
      return c.json({ error: project.error }, 404);
    }
    const slices = await listSlices(project.data.absolutePath);
    return c.json({ slices });
  });

  app.post("/projects/:id/slices", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return c.json({ error: "title is required" }, 400);
    }
    const config = getProjectsConfig();
    const project = await getProject(config, id);
    if (!project.ok) {
      return c.json({ error: project.error }, 404);
    }
    const slice = await createSlice(project.data.absolutePath, {
      projectId: id,
      title,
      status:
        typeof body.status === "string" ? (body.status as SliceStatus) : "todo",
      hillPosition:
        typeof body.hill_position === "string"
          ? (body.hill_position as SliceHillPosition)
          : "figuring",
      readme: typeof body.readme === "string" ? body.readme : undefined,
      specs: typeof body.specs === "string" ? body.specs : undefined,
      tasks: typeof body.tasks === "string" ? body.tasks : undefined,
      validation:
        typeof body.validation === "string" ? body.validation : undefined,
      thread: typeof body.thread === "string" ? body.thread : undefined,
    });
    return c.json(slice, 201);
  });

  app.get("/projects/:id/slices/:sliceId", async (c) => {
    const id = c.req.param("id");
    const sliceId = c.req.param("sliceId");
    const config = getProjectsConfig();
    const project = await getProject(config, id);
    if (!project.ok) {
      return c.json({ error: project.error }, 404);
    }
    try {
      const slice = await getSlice(project.data.absolutePath, sliceId);
      return c.json(slice);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "not found";
      return c.json({ error: msg }, 404);
    }
  });

  app.patch("/projects/:id/slices/:sliceId", async (c) => {
    const id = c.req.param("id");
    const sliceId = c.req.param("sliceId");
    const body = await c.req.json().catch(() => ({}));
    const config = getProjectsConfig();
    const project = await getProject(config, id);
    if (!project.ok) {
      return c.json({ error: project.error }, 404);
    }
    try {
      const slice = await updateSlice(project.data.absolutePath, sliceId, {
        title: typeof body.title === "string" ? body.title : undefined,
        status:
          typeof body.status === "string"
            ? (body.status as SliceStatus)
            : undefined,
        hillPosition:
          typeof body.hill_position === "string"
            ? (body.hill_position as SliceHillPosition)
            : undefined,
        readme: typeof body.readme === "string" ? body.readme : undefined,
        specs: typeof body.specs === "string" ? body.specs : undefined,
        tasks: typeof body.tasks === "string" ? body.tasks : undefined,
        validation:
          typeof body.validation === "string" ? body.validation : undefined,
        thread: typeof body.thread === "string" ? body.thread : undefined,
      });
      return c.json(slice);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "not found";
      return c.json({ error: msg }, 404);
    }
  });

  app.get("/projects/:id/spec", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    const project = await getProject(config, id);
    if (!project.ok) {
      return c.json({ error: project.error }, 404);
    }
    const content = await readSpec(config, id);
    return c.json({ content });
  });

  app.put("/projects/:id/spec", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = PutSpecRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const config = getProjectsConfig();
    const project = await getProject(config, id);
    if (!project.ok) {
      return c.json({ error: project.error }, 404);
    }
    await writeSpec(config, id, parsed.data.content);
    return c.json({ ok: true });
  });

  app.get("/projects/:id/tasks", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    const project = await getProject(config, id);
    if (!project.ok) {
      return c.json({ error: project.error }, 404);
    }
    const specs = await readSpec(config, id);
    const tasks = parseTasks(specs);
    const done = tasks.filter((task) => task.checked).length;
    return c.json({
      tasks,
      progress: { done, total: tasks.length },
    });
  });

  app.post("/projects/:id/tasks", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = CreateTaskRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const config = getProjectsConfig();
    const project = await getProject(config, id);
    if (!project.ok) {
      return c.json({ error: project.error }, 404);
    }

    const specs = await readSpec(config, id);
    const tasks = parseTasks(specs);
    const status = parsed.data.status ?? "todo";
    const checked = status === "done";
    tasks.push({
      title: parsed.data.title,
      description: parsed.data.description,
      status,
      checked,
      order: tasks.length,
    });
    const nextSpecs = serializeTasks(tasks, specs);
    await writeSpec(config, id, nextSpecs);
    return c.json({ task: tasks[tasks.length - 1] }, 201);
  });

  app.patch("/projects/:id/tasks/:order", async (c) => {
    const id = c.req.param("id");
    const order = Number(c.req.param("order"));
    if (!Number.isInteger(order) || order < 0) {
      return c.json({ error: "Invalid task order" }, 400);
    }
    const body = await c.req.json();
    const parsed = UpdateTaskRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const config = getProjectsConfig();
    const project = await getProject(config, id);
    if (!project.ok) {
      return c.json({ error: project.error }, 404);
    }

    const specs = await readSpec(config, id);
    const tasks = parseTasks(specs);
    const task = tasks[order];
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    let checked = parsed.data.checked ?? task.checked;
    let status = parsed.data.status ?? task.status;
    if (parsed.data.checked !== undefined && parsed.data.status === undefined) {
      status = parsed.data.checked ? "done" : "todo";
    }
    if (parsed.data.status !== undefined && parsed.data.checked === undefined) {
      checked = parsed.data.status === "done";
    }

    const agentId =
      parsed.data.agentId === undefined
        ? task.agentId
        : parsed.data.agentId === null
          ? undefined
          : parsed.data.agentId;

    tasks[order] = {
      ...task,
      checked,
      status,
      agentId,
      order,
    };
    const nextSpecs = serializeTasks(tasks, specs);
    await writeSpec(config, id, nextSpecs);
    emitProjectFileChanged(
      id,
      projectDirNameFromPath(project.data.path),
      "SPECS.md"
    );
    return c.json({ task: tasks[order] });
  });

  app.delete("/projects/:id/tasks/:order", async (c) => {
    const id = c.req.param("id");
    const order = Number(c.req.param("order"));
    if (!Number.isInteger(order) || order < 0) {
      return c.json({ error: "Invalid task order" }, 400);
    }
    const config = getProjectsConfig();
    const project = await getProject(config, id);
    if (!project.ok) {
      return c.json({ error: project.error }, 404);
    }

    const specs = await readSpec(config, id);
    const tasks = parseTasks(specs);
    if (!tasks[order]) {
      return c.json({ error: "Task not found" }, 404);
    }
    tasks.splice(order, 1);
    const nextSpecs = serializeTasks(tasks, specs);
    await writeSpec(config, id, nextSpecs);
    return c.json({ ok: true });
  });

  app.patch("/projects/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    if ("runAgent" in body || "runMode" in body || "baseBranch" in body) {
      return c.json(
        { error: "runAgent/runMode/baseBranch not supported on projects" },
        400
      );
    }
    const parsed = UpdateProjectRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const config = getProjectsConfig();
    let prevStatus: string | null = null;
    if (parsed.data.status) {
      const prev = await getProject(config, id);
      if (prev.ok) {
        prevStatus = normalizeProjectStatus(
          String(prev.data.frontmatter?.status ?? "")
        );
      }
    }
    if (parsed.data.status === "archived") {
      const rest = { ...parsed.data };
      delete rest.status;
      if (Object.keys(rest).length > 0) {
        const updated = await updateProject(config, id, rest);
        if (!updated.ok) {
          const status = updated.error.startsWith("Project already exists")
            ? 409
            : 404;
          return c.json({ error: updated.error }, status);
        }
        emitUpdatedProjectFiles(
          id,
          projectDirNameFromPath(updated.data.path),
          rest
        );
      }
      const archived = await archiveProject(config, id);
      if (!archived.ok) {
        const status = archived.error.startsWith("Archive already contains")
          ? 409
          : 404;
        return c.json({ error: archived.error }, status);
      }
      const detail = await getProject(config, id);
      if (!detail.ok) {
        return c.json({ error: detail.error }, 404);
      }
      if (prevStatus === null || prevStatus !== "archived") {
        await recordProjectStatusActivity({
          actor: parsed.data.agent,
          projectId: detail.data.id ?? id,
          status: "archived",
        });
      }
      return c.json(detail.data);
    }
    const result = await updateProjectWithCancelInterrupt(
      config,
      id,
      parsed.data
    );
    if (!result.ok) {
      const status = result.error.startsWith("Project already exists")
        ? 409
        : 404;
      return c.json({ error: result.error }, status);
    }
    emitUpdatedProjectFiles(
      id,
      projectDirNameFromPath(result.data.path),
      parsed.data
    );
    if (parsed.data.status) {
      const nextStatus = normalizeProjectStatus(
        String(result.data.frontmatter?.status ?? "")
      );
      if (prevStatus === null || prevStatus !== nextStatus) {
        await recordProjectStatusActivity({
          actor: parsed.data.agent,
          projectId: result.data.id ?? id,
          status: nextStatus,
        });
      }
    }
    return c.json(result.data);
  });

  app.delete("/projects/:id", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    const result = await deleteProject(config, id);
    if (!result.ok) {
      const status = result.error.startsWith("Trash already contains")
        ? 409
        : 404;
      return c.json({ error: result.error }, status);
    }
    return c.json(result.data);
  });

  app.post("/projects/:id/archive", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    const result = await archiveProject(config, id);
    if (!result.ok) {
      const status = result.error.startsWith("Archive already contains")
        ? 409
        : 404;
      return c.json({ error: result.error }, status);
    }
    await recordProjectStatusActivity({ projectId: id, status: "archived" });
    return c.json(result.data);
  });

  app.post("/projects/:id/unarchive", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    const result = await unarchiveProject(config, id, "shaping");
    if (!result.ok) {
      const status = result.error.startsWith("Project already exists")
        ? 409
        : 404;
      return c.json({ error: result.error }, status);
    }
    await recordProjectStatusActivity({ projectId: id, status: "shaping" });
    return c.json(result.data);
  });

  app.post("/projects/:id/comments", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = ProjectCommentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const entry = {
      author: parsed.data.author,
      date: formatThreadDate(new Date()),
      body: parsed.data.message,
    };

    const config = getProjectsConfig();
    const result = await appendProjectComment(config, id, entry);
    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }
    await recordCommentActivity({
      actor: parsed.data.author,
      projectId: id,
      commentExcerpt: parsed.data.message,
    });
    return c.json(result.data, 201);
  });

  app.patch("/projects/:id/comments/:index", async (c) => {
    const id = c.req.param("id");
    const index = parseInt(c.req.param("index"), 10);
    if (Number.isNaN(index) || index < 0) {
      return c.json({ error: "Invalid comment index" }, 400);
    }

    const body = await c.req.json();
    const parsed = UpdateProjectCommentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const config = getProjectsConfig();
    const result = await updateProjectComment(
      config,
      id,
      index,
      parsed.data.body
    );
    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }
    return c.json(result.data);
  });

  app.delete("/projects/:id/comments/:index", async (c) => {
    const id = c.req.param("id");
    const index = parseInt(c.req.param("index"), 10);
    if (Number.isNaN(index) || index < 0) {
      return c.json({ error: "Invalid comment index" }, 400);
    }

    const config = getProjectsConfig();
    const result = await deleteProjectComment(config, id, index);
    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }
    return c.json(result.data);
  });

  app.post("/projects/:id/attachments", async (c) => {
    const id = c.req.param("id");

    const formData = await c.req.formData();
    const files: Array<{ name: string; data: Buffer }> = [];

    for (const [, value] of formData.entries()) {
      if (!isUploadedFile(value)) continue;
      const arrayBuffer = await value.arrayBuffer();
      files.push({
        name: value.name,
        data: Buffer.from(arrayBuffer),
      });
    }

    if (files.length === 0) {
      return c.json({ error: "No files provided" }, 400);
    }

    const config = getProjectsConfig();
    const result = await saveAttachments(config, id, files);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }

    return c.json(result.data);
  });

  app.get("/projects/:id/attachments/:name", async (c) => {
    const id = c.req.param("id");
    const name = c.req.param("name");

    const config = getProjectsConfig();
    const result = await resolveAttachmentFile(config, id, name);
    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }

    const type = attachmentContentType(result.data.name);
    c.header("Content-Type", type);
    return c.body(
      Readable.toWeb(
        createReadStream(result.data.path)
      ) as unknown as ReadableStream
    );
  });

  app.get("/projects/:id/subagents", async (c) => {
    const id = c.req.param("id");
    const includeArchived = c.req.query("includeArchived") === "true";
    const config = getProjectsConfig();
    const result = await listSubagents(config, id, includeArchived);
    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }
    return c.json(result.data);
  });

  app.delete("/projects/:id/lead-sessions/:agentId", async (c) => {
    const id = c.req.param("id");
    const agentId = c.req.param("agentId");
    const config = getProjectsConfig();
    const projectResult = await getProject(config, id);
    if (!projectResult.ok) {
      return c.json({ error: projectResult.error }, 404);
    }
    const project = projectResult.data;
    const frontmatter = project.frontmatter ?? {};
    const sessionKeys =
      typeof frontmatter.sessionKeys === "object" &&
      frontmatter.sessionKeys !== null
        ? { ...(frontmatter.sessionKeys as Record<string, string>) }
        : {};
    const sessionKey = sessionKeys[agentId];
    if (!sessionKey) {
      return c.json({ error: "Lead session not found" }, 404);
    }
    delete sessionKeys[agentId];
    await clearLeadSessionState(agentId, sessionKey);
    const updateResult = await updateProject(config, id, {
      sessionKeys: Object.keys(sessionKeys).length > 0 ? sessionKeys : null,
    });
    if (!updateResult.ok) {
      return c.json({ error: updateResult.error }, 400);
    }
    emitProjectFileChanged(
      id,
      projectDirNameFromPath(project.path),
      "README.md"
    );
    return c.json({ ok: true, agentId });
  });

  app.post("/projects/:id/lead-sessions/:agentId/reset", async (c) => {
    const id = c.req.param("id");
    const agentId = c.req.param("agentId");
    const config = getProjectsConfig();
    const projectResult = await getProject(config, id);
    if (!projectResult.ok) {
      return c.json({ error: projectResult.error }, 404);
    }
    const project = projectResult.data;
    const frontmatter = project.frontmatter ?? {};
    const sessionKeys =
      typeof frontmatter.sessionKeys === "object" &&
      frontmatter.sessionKeys !== null
        ? { ...(frontmatter.sessionKeys as Record<string, string>) }
        : {};
    const sessionKey = sessionKeys[agentId];
    if (!sessionKey) {
      return c.json({ error: "Lead session not found" }, 404);
    }
    await clearLeadSessionState(agentId, sessionKey);
    const nextSessionKey = `project:${id}:${agentId}`;
    sessionKeys[agentId] = nextSessionKey;
    const updateResult = await updateProject(config, id, { sessionKeys });
    if (!updateResult.ok) {
      return c.json({ error: updateResult.error }, 400);
    }
    emitProjectFileChanged(
      id,
      projectDirNameFromPath(project.path),
      "README.md"
    );
    return c.json({ ok: true, agentId, sessionKey: nextSessionKey });
  });

  app.get("/subagents", async (c) => {
    const config = getProjectsConfig();
    const items = await listAllSubagents(config);
    return c.json({ items });
  });

  app.get("/activity", async (c) => {
    const config = getProjectsConfig();
    const offsetParam = c.req.query("offset") ?? "0";
    const limitParam = c.req.query("limit") ?? "20";
    const offset = Number(offsetParam);
    const limit = Number(limitParam);
    if (
      !Number.isFinite(offset) ||
      offset < 0 ||
      !Number.isFinite(limit) ||
      limit < 1
    ) {
      return c.json({ error: "Invalid pagination params" }, 400);
    }
    const events = await getRecentActivity(config, { offset, limit });
    return c.json({ events });
  });

  app.post("/projects/:id/subagents", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const slug = typeof body.slug === "string" ? body.slug : "";
    const cli = typeof body.cli === "string" ? body.cli : "";
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const mode = typeof body.mode === "string" ? body.mode : undefined;
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : undefined;
    let model =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : undefined;
    let reasoningEffort =
      typeof body.reasoningEffort === "string" && body.reasoningEffort.trim()
        ? body.reasoningEffort.trim()
        : undefined;
    let thinking =
      typeof body.thinking === "string" && body.thinking.trim()
        ? body.thinking.trim()
        : undefined;
    const baseBranch =
      typeof body.baseBranch === "string" ? body.baseBranch : undefined;
    const sliceId =
      typeof body.sliceId === "string" && body.sliceId.trim()
        ? body.sliceId.trim()
        : undefined;
    const resume = typeof body.resume === "boolean" ? body.resume : undefined;
    const attachments = Array.isArray(body.attachments)
      ? (
          body.attachments as Array<{
            path?: unknown;
            mimeType?: unknown;
            filename?: unknown;
          }>
        ).filter(
          (
            attachment
          ): attachment is {
            path: string;
            mimeType: string;
            filename?: string;
          } =>
            typeof attachment.path === "string" &&
            typeof attachment.mimeType === "string"
        )
      : undefined;

    // Lead agent session: route to runAgent instead of spawnSubagent
    const agentId =
      typeof body.agentId === "string" && body.agentId.trim()
        ? body.agentId.trim()
        : undefined;
    if (agentId) {
      const agent = getProjectsContext().getAgent(agentId);
      if (!agent || !getProjectsContext().isAgentActive(agentId)) {
        return c.json({ error: "Agent not found" }, 404);
      }
      const config = getProjectsConfig();
      const projectResult = await getProject(config, id);
      if (!projectResult.ok) {
        return c.json({ error: projectResult.error }, 404);
      }
      const project = projectResult.data;
      const frontmatter = project.frontmatter ?? {};
      const sessionKeys =
        typeof frontmatter.sessionKeys === "object" &&
        frontmatter.sessionKeys !== null
          ? (frontmatter.sessionKeys as Record<string, string>)
          : {};
      const sessionKey =
        sessionKeys[agent.id] ?? `project:${project.id}:${agent.id}`;
      const normalizedStatus = normalizeProjectStatus(
        typeof frontmatter.status === "string" ? frontmatter.status : ""
      );
      const updates: Partial<UpdateProjectRequest> = {};
      if (!sessionKeys[agent.id]) {
        updates.sessionKeys = { ...sessionKeys, [agent.id]: sessionKey };
      }
      if (normalizedStatus === "todo") {
        updates.status = "in_progress";
      }

      // Read project docs for prompt context
      const basePath = (project.absolutePath || project.path).replace(
        /\/$/,
        ""
      );
      const docKeys = Object.keys(project.docs ?? {}).sort((a, b) => {
        if (a === "README") return -1;
        if (b === "README") return 1;
        return a.localeCompare(b);
      });
      let fullContent = project.docs?.README ?? "";
      for (const key of docKeys) {
        if (key === "README") continue;
        const docContent = project.docs?.[key];
        if (docContent) {
          fullContent += `\n\n## ${key}\n\n${docContent}`;
        }
      }

      const includeDefaultPrompt =
        typeof body.includeDefaultPrompt === "boolean"
          ? body.includeDefaultPrompt
          : true;
      const includeRoleInstructions =
        typeof body.includeRoleInstructions === "boolean"
          ? body.includeRoleInstructions
          : true;
      const includePostRun =
        typeof body.includePostRun === "boolean" ? body.includePostRun : false;

      const repo =
        typeof frontmatter.repo === "string" ? frontmatter.repo : undefined;
      const status =
        typeof frontmatter.status === "string" ? frontmatter.status : "";

      // Build coordinator prompt with subagent types
      const coordinatorPrompt = buildRolePrompt({
        role: "coordinator",
        title: project.title,
        status,
        path: basePath,
        content: fullContent,
        specsPath: `${basePath}/SPECS.md`,
        projectId: project.id,
        projectFiles: [
          "README.md",
          "THREAD.md",
          ...docKeys.map((key) => `${key}.md`),
        ],
        repo,
        runAgentLabel: agent.name,
        customPrompt: prompt || undefined,
        subagentTypes: getProjectsContext().getSubagentTemplates(),
        includeDefaultPrompt,
        includeRoleInstructions,
        includePostRun,
      });

      const leadSlug = `lead-${agent.id.replace(/[^a-z0-9]/gi, "-")}`;

      getProjectsContext()
        .runAgent({
          agentId: agent.id,
          message: coordinatorPrompt,
          sessionKey,
        })
        .catch((err) => {
          console.error(
            `[projects:${project.id}] lead agent session failed:`,
            err
          );
        });

      if (Object.keys(updates).length > 0) {
        await updateProject(config, project.id, updates);
      }

      return c.json({ slug: leadSlug, agentId: agent.id, sessionKey }, 201);
    }

    if (!slug || !cli || !prompt) {
      return c.json({ error: "Missing required fields" }, 400);
    }
    if (!isSupportedSubagentCli(cli)) {
      return c.json({ error: getUnsupportedSubagentCliError(cli) }, 400);
    }
    const config = getProjectsConfig();
    let resolvedName = name;
    if (resume) {
      const persisted = await readSubagentConfig(config, id, slug);
      if (persisted.ok) {
        if (!resolvedName && typeof persisted.data.name === "string") {
          const saved = persisted.data.name.trim();
          if (saved) resolvedName = saved;
        }
        if (!model && typeof persisted.data.model === "string") {
          const saved = persisted.data.model.trim();
          if (saved) model = saved;
        }
        if (
          !reasoningEffort &&
          typeof persisted.data.reasoningEffort === "string"
        ) {
          const saved = persisted.data.reasoningEffort.trim();
          if (saved) reasoningEffort = saved;
        }
        if (!thinking && typeof persisted.data.thinking === "string") {
          const saved = persisted.data.thinking.trim();
          if (saved) thinking = saved;
        }
      }
    }
    const resolvedCliOptions = resolveCliSpawnOptions(
      cli as CliHarness,
      model,
      reasoningEffort,
      thinking
    );
    if (!resolvedCliOptions.ok) {
      return c.json({ error: resolvedCliOptions.error }, 400);
    }
    if (!resolvedName) {
      resolvedName = resolveRunName(name, slug, name);
    }
    const result = await spawnSubagent(config, {
      projectId: id,
      slug,
      cli,
      name: resolvedName,
      prompt,
      model: resolvedCliOptions.data.model,
      reasoningEffort: resolvedCliOptions.data.reasoningEffort,
      thinking: resolvedCliOptions.data.thinking,
      mode: mode as "main-run" | "worktree" | "clone" | "none" | undefined,
      baseBranch,
      sliceId,
      resume,
      attachments,
    });
    if (!result.ok) {
      const status = result.error.startsWith("Project not found") ? 404 : 400;
      return c.json({ error: result.error }, status);
    }
    return c.json(result.data, 201);
  });

  app.patch("/projects/:id/subagents/:slug", async (c) => {
    const id = c.req.param("id");
    const slug = c.req.param("slug");
    const body = await c.req.json();
    const parsed = UpdateSubagentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const name =
      typeof parsed.data.name === "string" && parsed.data.name.trim()
        ? parsed.data.name.trim()
        : undefined;
    const model =
      typeof parsed.data.model === "string" && parsed.data.model.trim()
        ? parsed.data.model.trim()
        : undefined;
    const reasoningEffort =
      typeof parsed.data.reasoningEffort === "string" &&
      parsed.data.reasoningEffort.trim()
        ? parsed.data.reasoningEffort.trim()
        : undefined;
    const thinking =
      typeof parsed.data.thinking === "string" && parsed.data.thinking.trim()
        ? parsed.data.thinking.trim()
        : undefined;

    if (!name && !model && !reasoningEffort && !thinking) {
      return c.json(
        {
          error:
            "At least one of name/model/reasoningEffort/thinking is required",
        },
        400
      );
    }

    const config = getProjectsConfig();
    const result = await updateSubagentConfig(config, id, slug, {
      name,
      model,
      reasoningEffort,
      thinking,
    });
    if (!result.ok) {
      const status =
        result.error.startsWith("Project not found") ||
        result.error.startsWith("Subagent not found")
          ? 404
          : 400;
      return c.json({ error: result.error }, status);
    }
    return c.json(result.data);
  });

  app.post("/projects/:id/subagents/:slug/interrupt", async (c) => {
    const id = c.req.param("id");
    const slug = c.req.param("slug");
    const config = getProjectsConfig();
    const result = await interruptSubagent(config, id, slug);
    if (!result.ok) {
      const status = result.error.startsWith("Project not found") ? 404 : 400;
      return c.json({ error: result.error }, status);
    }
    return c.json(result.data);
  });

  app.post("/projects/:id/subagents/:slug/kill", async (c) => {
    const id = c.req.param("id");
    const slug = c.req.param("slug");
    const config = getProjectsConfig();
    const result = await killSubagent(config, id, slug);
    if (!result.ok) {
      const status =
        result.error.startsWith("Project not found") ||
        result.error.startsWith("Subagent not found")
          ? 404
          : 400;
      return c.json({ error: result.error }, status);
    }
    return c.json(result.data);
  });

  app.post("/projects/:id/subagents/:slug/archive", async (c) => {
    const id = c.req.param("id");
    const slug = c.req.param("slug");
    const config = getProjectsConfig();
    const result = await archiveSubagent(config, id, slug);
    if (!result.ok) {
      const status =
        result.error.startsWith("Project not found") ||
        result.error.startsWith("Subagent not found")
          ? 404
          : 400;
      return c.json({ error: result.error }, status);
    }
    return c.json(result.data);
  });

  app.post("/projects/:id/subagents/:slug/unarchive", async (c) => {
    const id = c.req.param("id");
    const slug = c.req.param("slug");
    const config = getProjectsConfig();
    const result = await unarchiveSubagent(config, id, slug);
    if (!result.ok) {
      const status =
        result.error.startsWith("Project not found") ||
        result.error.startsWith("Subagent not found")
          ? 404
          : 400;
      return c.json({ error: result.error }, status);
    }
    return c.json(result.data);
  });

  app.get("/projects/:id/subagents/:slug/logs", async (c) => {
    const id = c.req.param("id");
    const slug = c.req.param("slug");
    const sinceParam = c.req.query("since") ?? "0";
    const since = Number(sinceParam);
    if (!Number.isFinite(since) || since < 0) {
      return c.json({ error: "Invalid since cursor" }, 400);
    }
    const config = getProjectsConfig();
    const result = await getSubagentLogs(config, id, slug, since);
    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }
    return c.json(result.data);
  });

  app.get("/projects/:id/branches", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    const result = await listProjectBranches(config, id);
    if (!result.ok) {
      const status = result.error === "Project repo not set" ? 400 : 404;
      return c.json({ error: result.error }, status);
    }
    return c.json(result.data);
  });

  app.get("/projects/:id/space", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    const result = await getProjectSpace(config, id);
    if (!result.ok) {
      const status =
        result.error.startsWith("Project not found") ||
        result.error === "Project space not found"
          ? 404
          : result.error === "Project repo not set"
            ? 400
            : 500;
      return c.json({ error: result.error }, status);
    }
    return c.json(result.data);
  });

  app.get("/projects/:id/space/commits", async (c) => {
    const id = c.req.param("id");
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Number(limitParam) : 20;
    const config = getProjectsConfig();
    try {
      const commits = await getProjectSpaceCommitLog(config, id, limit);
      return c.json({ commits });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status =
        message.startsWith("Project not found") ||
        message === "Project space not found"
          ? 404
          : message === "Project repo not set"
            ? 400
            : 500;
      return c.json({ error: message }, status);
    }
  });

  app.get("/projects/:id/space/contributions/:entryId", async (c) => {
    const id = c.req.param("id");
    const entryId = c.req.param("entryId");
    const config = getProjectsConfig();
    try {
      const contribution = await getProjectSpaceContribution(
        config,
        id,
        entryId
      );
      return c.json(contribution);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status =
        message.startsWith("Project not found") ||
        message === "Project space not found" ||
        message === "Space integration entry not found"
          ? 404
          : message === "Project repo not set"
            ? 400
            : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post("/projects/:id/space/integrate", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    try {
      const result = await integrateProjectSpaceQueue(config, id, {
        resume: true,
      });
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status =
        message.startsWith("Project not found") ||
        message === "Project space not found"
          ? 404
          : message === "Project repo not set" ||
              message === "Not a git repository"
            ? 400
            : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post("/projects/:id/space/entries/skip", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const parsed = SpaceEntriesRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const config = getProjectsConfig();
    try {
      const result = await skipSpaceEntries(config, id, parsed.data.entryIds);
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status =
        message.startsWith("Project not found") ||
        message === "Project space not found"
          ? 404
          : message === "Project repo not set"
            ? 400
            : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post("/projects/:id/space/entries/integrate", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const parsed = SpaceEntriesRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const config = getProjectsConfig();
    try {
      const result = await integrateSpaceEntries(
        config,
        id,
        parsed.data.entryIds
      );
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status =
        message.startsWith("Project not found") ||
        message === "Project space not found"
          ? 404
          : message === "Project repo not set" ||
              message === "Not a git repository"
            ? 400
            : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post("/projects/:id/space/rebase", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    try {
      const space = await rebaseSpaceOntoMain(config, id);
      return c.json(space);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status =
        message.startsWith("Project not found") ||
        message === "Project space not found"
          ? 404
          : message === "Project repo not set" ||
              message === "Not a git repository"
            ? 400
            : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post("/projects/:id/space/merge", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const parsed = MergeSpaceRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const config = getProjectsConfig();
    try {
      const merge = await mergeSpaceIntoBase(config, id, {
        cleanup: parsed.data.cleanup ?? true,
      });
      const updated = await updateProject(config, id, { status: "done" });
      if (!updated.ok) {
        throw new Error(updated.error);
      }
      await recordProjectStatusActivity({ projectId: id, status: "done" });
      emitProjectFileChanged(id, updated.data.path, "README.md");
      return c.json({ merge, project: updated.data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status =
        message.startsWith("Project not found") ||
        message === "Project space not found"
          ? 404
          : message.startsWith("Space queue has unresolved entries") ||
              message.startsWith("Space merge failed")
            ? 409
            : message === "Project repo not set" ||
                message === "Not a git repository"
              ? 400
              : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post("/projects/:id/space/rebase/fix", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    try {
      const spaceResult = await getProjectSpace(config, id);
      if (!spaceResult.ok) {
        const status =
          spaceResult.error.startsWith("Project not found") ||
          spaceResult.error === "Project space not found"
            ? 404
            : spaceResult.error === "Project repo not set"
              ? 400
              : 500;
        return c.json({ error: spaceResult.error }, status);
      }
      const space = spaceResult.data;
      if (!space.rebaseConflict) {
        return c.json({ error: "Space rebase conflict not found" }, 409);
      }

      const reviewerConfig = getProjectsContext()
        .getSubagentTemplates()
        .find((t) => t.type === "reviewer");
      if (!reviewerConfig) {
        return c.json({ error: "No reviewer subagent configured" }, 400);
      }
      const reviewerRunAgent = normalizeRunAgent(`cli:${reviewerConfig.cli}`);
      if (
        !reviewerRunAgent ||
        reviewerRunAgent.type !== "cli" ||
        !isSupportedSubagentCli(reviewerRunAgent.id)
      ) {
        return c.json(
          { error: "Reviewer subagent cli is missing or unsupported" },
          400
        );
      }

      const resolvedCliOptions = resolveCliSpawnOptions(
        reviewerRunAgent.id,
        reviewerConfig.model,
        reviewerConfig.reasoning,
        undefined
      );
      if (!resolvedCliOptions.ok) {
        return c.json({ error: resolvedCliOptions.error }, 400);
      }

      const slug = "space-rebase-fixer";
      const prompt = [
        "Space branch rebase onto base branch has conflicts.",
        "Resolve all rebase conflicts in this workspace and continue the rebase.",
        "",
        `Base branch: ${space.baseBranch}`,
        `Target base SHA: ${space.rebaseConflict.baseSha || "(unknown)"}`,
        `Rebase error: ${space.rebaseConflict.error}`,
        "",
        "Required commands:",
        "  git status",
        "  # resolve conflicts",
        "  git add <resolved-files>",
        "  git rebase --continue",
        "",
        "Repeat until rebase finishes cleanly. Then summarize what changed.",
      ].join("\n");
      const spawned = await spawnSubagent(config, {
        projectId: id,
        slug,
        cli: reviewerRunAgent.id,
        name: resolveRunName(reviewerConfig.name, slug, undefined),
        prompt,
        model: resolvedCliOptions.data.model,
        reasoningEffort: resolvedCliOptions.data.reasoningEffort,
        thinking: resolvedCliOptions.data.thinking,
        mode: "main-run",
        baseBranch: space.baseBranch,
        resume: true,
      });
      if (!spawned.ok) {
        const status = spawned.error.startsWith("Project not found")
          ? 404
          : 400;
        return c.json({ error: spawned.error }, status);
      }

      await clearProjectSpaceRebaseConflict(config, id);
      return c.json({ slug }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status =
        message.startsWith("Project not found") ||
        message === "Project space not found"
          ? 404
          : message === "Space rebase conflict not found"
            ? 409
            : message === "Project repo not set"
              ? 400
              : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post("/projects/:id/space/conflicts/:entryId/fix", async (c) => {
    const id = c.req.param("id");
    const entryId = c.req.param("entryId");
    const config = getProjectsConfig();
    try {
      const context = await getProjectSpaceConflictContext(config, id, entryId);
      await execFileAsync("git", ["cherry-pick", "--abort"], {
        cwd: context.space.worktreePath,
      }).catch(() => {});
      const spaceHead = await getGitHead(context.space.worktreePath);
      if (!spaceHead) {
        return c.json({ error: "Failed to resolve Space HEAD SHA" }, 400);
      }
      const persisted = await readSubagentConfig(
        config,
        id,
        context.entry.workerSlug
      );
      if (!persisted.ok) {
        const status =
          persisted.error.startsWith("Project not found") ||
          persisted.error.startsWith("Subagent not found")
            ? 404
            : 400;
        return c.json({ error: persisted.error }, status);
      }
      const cliRaw =
        typeof persisted.data.cli === "string" ? persisted.data.cli.trim() : "";
      if (!isSupportedSubagentCli(cliRaw)) {
        return c.json(
          { error: "Original worker CLI is missing or unsupported" },
          400
        );
      }
      const model =
        typeof persisted.data.model === "string"
          ? persisted.data.model.trim() || undefined
          : undefined;
      const reasoningEffort =
        typeof persisted.data.reasoningEffort === "string"
          ? persisted.data.reasoningEffort.trim() || undefined
          : undefined;
      const thinking =
        typeof persisted.data.thinking === "string"
          ? persisted.data.thinking.trim() || undefined
          : undefined;
      const name =
        typeof persisted.data.name === "string"
          ? persisted.data.name.trim() || undefined
          : undefined;
      const prompt = [
        "Your previous delivery caused a conflict when Space tried to cherry-pick it.",
        "",
        "Rebase your branch onto the current Space HEAD to resolve conflicts:",
        "",
        "  git fetch origin",
        `  git rebase --onto ${spaceHead} ${context.entry.startSha ?? "<start-sha-missing>"} HEAD`,
        "",
        "If rebase conflicts occur, resolve them manually, then git rebase --continue.",
        "After rebase is complete, verify your changes still work, then deliver.",
        "",
        `Space HEAD: ${spaceHead}`,
        `Your original start SHA: ${context.entry.startSha ?? "(missing)"}`,
        `Your original end SHA: ${context.entry.endSha ?? "(missing)"}`,
        "Conflicted files:",
        ...(context.conflictFiles.length > 0
          ? context.conflictFiles.map((file) => `- ${file}`)
          : ["- (no unmerged files reported)"]),
      ].join("\n");
      const spawned = await spawnSubagent(config, {
        projectId: id,
        slug: context.entry.workerSlug,
        cli: cliRaw,
        name,
        prompt,
        model,
        reasoningEffort,
        thinking,
        resume: true,
        replaces: [entryId],
      });
      if (!spawned.ok) {
        const status = spawned.error.startsWith("Project not found")
          ? 404
          : 400;
        return c.json({ error: spawned.error }, status);
      }
      return c.json({ entryId, slug: context.entry.workerSlug }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status =
        message.startsWith("Project not found") ||
        message === "Project space not found" ||
        message === "Space conflict entry not found"
          ? 404
          : message === "Project repo not set"
            ? 400
            : 500;
      return c.json({ error: message }, status);
    }
  });

  app.get("/projects/:id/space/lease", async (c) => {
    const id = c.req.param("id");
    if (!isSpaceWriteLeaseEnabled()) {
      return c.json({ enabled: false, lease: null });
    }
    const config = getProjectsConfig();
    const lease = await getProjectSpaceWriteLease(config, id);
    if (!lease.ok) {
      const status = lease.error.startsWith("Project not found") ? 404 : 400;
      return c.json({ error: lease.error }, status);
    }
    return c.json({ enabled: true, lease: lease.data });
  });

  app.post("/projects/:id/space/lease", async (c) => {
    const id = c.req.param("id");
    if (!isSpaceWriteLeaseEnabled()) {
      return c.json({ error: "Space write lease is disabled" }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = AcquireSpaceLeaseRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const config = getProjectsConfig();
    const lease = await acquireProjectSpaceWriteLease(config, id, parsed.data);
    if (!lease.ok) {
      const status = lease.error.startsWith("Project not found")
        ? 404
        : lease.error.includes("held by")
          ? 409
          : 400;
      return c.json({ error: lease.error }, status);
    }
    return c.json({ enabled: true, lease: lease.data });
  });

  app.delete("/projects/:id/space/lease", async (c) => {
    const id = c.req.param("id");
    if (!isSpaceWriteLeaseEnabled()) {
      return c.json({ enabled: false, lease: null });
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = ReleaseSpaceLeaseRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const config = getProjectsConfig();
    const released = await releaseProjectSpaceWriteLease(
      config,
      id,
      parsed.data
    );
    if (!released.ok) {
      const status = released.error.startsWith("Project not found")
        ? 404
        : released.error.includes("held by")
          ? 409
          : 400;
      return c.json({ error: released.error }, status);
    }
    return c.json({ enabled: true, lease: null });
  });

  app.get("/projects/:id/changes", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    try {
      const result = await getProjectChanges(config, id);
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status =
        message === "Project repo not set" || message === "Not a git repository"
          ? 400
          : message.startsWith("Project not found")
            ? 404
            : 500;
      return c.json({ error: message }, status);
    }
  });

  app.get("/projects/:id/pr-target", async (c) => {
    const id = c.req.param("id");
    const config = getProjectsConfig();
    try {
      const target = await getProjectPullRequestTarget(config, id);
      return c.json(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status =
        message === "Project repo not set" || message === "Not a git repository"
          ? 400
          : message.startsWith("Project not found")
            ? 404
            : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post("/projects/:id/commit", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const parsed = CommitProjectChangesRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const config = getProjectsConfig();
    try {
      const result = await commitProjectChanges(
        config,
        id,
        parsed.data.message
      );
      if (!result.ok) {
        const status =
          result.error === "Project repo not set" ||
          result.error === "Not a git repository" ||
          result.error === "Nothing to commit"
            ? 400
            : result.error.startsWith("Project not found")
              ? 404
              : 500;
        return c.json({ error: result.error }, status);
      }
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status =
        message === "Project repo not set" || message === "Not a git repository"
          ? 400
          : message.startsWith("Project not found")
            ? 404
            : 500;
      return c.json({ error: message }, status);
    }
  });

  app.get("/taskboard", async (c) => {
    const config = getProjectsConfig();
    const result = await scanTaskboard(config.taskboard);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    return c.json(result.data);
  });

  app.get("/taskboard/:type/:id", async (c) => {
    const type = c.req.param("type");
    const id = c.req.param("id");
    const companion = c.req.query("companion");

    if (type !== "todo" && type !== "project") {
      return c.json(
        { error: "Invalid type. Must be 'todo' or 'project'" },
        400
      );
    }

    const config = getProjectsConfig();
    const result = await getTaskboardItem(
      config.taskboard,
      type,
      id,
      companion
    );
    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }
    return c.json(result.data);
  });
}

// Re-exports for gateway/internal consumers
export { recordCommentActivity } from "./activity/index.js";
export * from "./projects/index.js";
export { listAllSubagents } from "./subagents/index.js";
export { interruptSubagent } from "./subagents/runner.js";
export {
  createProjectCommentHandler,
  createProjectsCommand,
  registerProjectsCommands,
  registerSlicesCommands,
} from "./cli/index.js";

const projectsExtension: Extension = {
  id: "projects",
  displayName: "Projects",
  description: "Project planning, taskboard, and subagent orchestration APIs",
  dependencies: [],
  configSchema: ProjectsExtensionConfigSchema,
  routePrefixes: [
    "/api/areas",
    "/api/config",
    "/api/projects",
    "/api/subagents",
    "/api/activity",
    "/api/taskboard",
  ],
  validateConfig(raw) {
    const result = ProjectsExtensionConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success
        ? []
        : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes(app) {
    registerProjectRoutes(app);
  },
  async start(ctx) {
    setProjectsContext(ctx);
    const config = getProjectsConfig();
    watcher = startProjectWatcher(config);
    orchestrator = startOrchestratorDaemon(config);
  },
  async stop() {
    await orchestrator?.stop();
    orchestrator = null;
    await watcher?.close();
    watcher = null;
    clearProjectsContext();
  },
  capabilities() {
    return ["projects", "subagents", "areas", "activity", "taskboard"];
  },
  getAgentTools() {
    return createProjectAgentTools();
  },
};

export { projectsExtension };
