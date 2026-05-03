import { Hono } from "hono";
import { z } from "zod";
import type {
  Extension,
  ExtensionContext,
  SubagentRuntimeCli,
  SubagentRuntimeProfile,
} from "@aihub/shared";
import { SubagentsExtensionConfigSchema } from "@aihub/shared";
import {
  deleteSubagentRun,
  getLiveSubagentRunsByCwd,
  getSubagentLogs,
  getSubagentRun,
  isSupportedSubagentCli,
  listSubagentRuns,
  parseSubagentParent,
  resumeSubagentRun,
  setSubagentArchived,
  startSubagentRun,
  interruptSubagentRun,
} from "./runtime.js";

let extensionContext: ExtensionContext | null = null;
const registeredApps = new WeakSet<object>();

function getContext(): ExtensionContext {
  if (!extensionContext) throw new Error("Subagents extension not started");
  return extensionContext;
}

function runtimeOptions() {
  const ctx = getContext();
  return {
    dataDir: ctx.getDataDir(),
    emit: (event: Parameters<ExtensionContext["emit"]>[1]) => {
      ctx.emit("subagent.changed", event);
    },
  };
}

function profiles(): SubagentRuntimeProfile[] {
  const config = getContext().getConfig();
  const raw = config.extensions?.subagents ?? {};
  const extensionProfiles =
    SubagentsExtensionConfigSchema.parse(raw).profiles ?? [];
  const legacyProfiles = (config.subagents ?? []).map((profile) => ({
    name: profile.name,
    cli: profile.cli,
    model: profile.model,
    reasoningEffort: profile.reasoning,
    labelPrefix: profile.name,
  }));
  return [
    ...extensionProfiles,
    ...legacyProfiles.filter(
      (legacy) =>
        !extensionProfiles.some((profile) => profile.name === legacy.name)
    ),
  ];
}

function resolveProfile(
  name: string | undefined
): SubagentRuntimeProfile | undefined {
  if (!name) return undefined;
  return profiles().find((profile) => profile.name === name);
}

function profileNames(): string[] {
  return profiles().map((profile) => profile.name);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readParent(value: unknown): ReturnType<typeof parseSubagentParent> {
  if (!value) return undefined;
  if (typeof value === "string") return parseSubagentParent(value);
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string" || typeof record.id !== "string") {
    return undefined;
  }
  return { type: record.type, id: record.id };
}

function statusFromQuery(value: string | undefined) {
  const parsed = z
    .enum(["starting", "running", "done", "error", "interrupted"])
    .safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function registerSubagentRoutes(app: Hono): void {
  if (registeredApps.has(app)) return;
  registeredApps.add(app);

  app.get("/subagents", async (c) => {
    const parent = parseSubagentParent(c.req.query("parent"));
    const status = statusFromQuery(c.req.query("status"));
    const includeArchived = ["1", "true"].includes(
      c.req.query("includeArchived") ?? ""
    );
    const cwd = readOptionalString(c.req.query("cwd"));
    const items = await listSubagentRuns(runtimeOptions(), {
      parent,
      status,
      includeArchived,
      cwd,
    });
    return c.json({ items });
  });

  app.post("/subagents", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const profileName = readOptionalString(body.profile);
    const profile = resolveProfile(profileName);
    if (profileName && !profile) {
      const available = profileNames();
      return c.json(
        {
          error: `Unknown subagent profile: ${profileName}${
            available.length
              ? `. Available profiles: ${available.join(", ")}`
              : ""
          }`,
        },
        400
      );
    }
    const cli = readOptionalString(body.cli) ?? profile?.cli;
    const cwd = readOptionalString(body.cwd);
    const prompt = readOptionalString(body.prompt);
    const label = readOptionalString(body.label) ?? profile?.labelPrefix;
    const model = readOptionalString(body.model) ?? profile?.model;
    const reasoningEffort =
      readOptionalString(body.reasoningEffort) ?? profile?.reasoningEffort;
    const parent = readParent(body.parent);
    const projectId = readOptionalString(body.projectId);
    const sliceId = readOptionalString(body.sliceId);

    if (!cli || !isSupportedSubagentCli(cli)) {
      return c.json({ error: "cli must be codex, claude, or pi" }, 400);
    }
    if (!cwd || !prompt || !label) {
      return c.json({ error: "cwd, prompt, and label are required" }, 400);
    }

    try {
      const run = await startSubagentRun(runtimeOptions(), {
        cli: cli as SubagentRuntimeCli,
        cwd,
        prompt,
        label,
        parent,
        projectId,
        sliceId,
        model,
        reasoningEffort,
      });
      return c.json(run, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400
      );
    }
  });

  app.get("/subagents/:runId", async (c) => {
    const run = await getSubagentRun(runtimeOptions(), c.req.param("runId"));
    if (!run) return c.json({ error: "Subagent not found" }, 404);
    return c.json(run);
  });

  app.post("/subagents/:runId/resume", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const prompt = readOptionalString(body.prompt);
    if (!prompt) return c.json({ error: "prompt is required" }, 400);
    try {
      const run = await resumeSubagentRun(
        runtimeOptions(),
        c.req.param("runId"),
        {
          prompt,
        }
      );
      return c.json(run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Subagent not found") ? 404 : 400;
      return c.json({ error: message }, status);
    }
  });

  app.post("/subagents/:runId/interrupt", async (c) => {
    try {
      const run = await interruptSubagentRun(
        runtimeOptions(),
        c.req.param("runId")
      );
      return c.json(run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Subagent not found") ? 404 : 400;
      return c.json({ error: message }, status);
    }
  });

  app.post("/subagents/:runId/archive", async (c) => {
    try {
      const run = await setSubagentArchived(
        runtimeOptions(),
        c.req.param("runId"),
        true
      );
      return c.json(run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Subagent not found") ? 404 : 400;
      return c.json({ error: message }, status);
    }
  });

  app.post("/subagents/:runId/unarchive", async (c) => {
    try {
      const run = await setSubagentArchived(
        runtimeOptions(),
        c.req.param("runId"),
        false
      );
      return c.json(run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Subagent not found") ? 404 : 400;
      return c.json({ error: message }, status);
    }
  });

  app.delete("/subagents/:runId", async (c) => {
    try {
      await deleteSubagentRun(runtimeOptions(), c.req.param("runId"));
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Subagent not found") ? 404 : 400;
      return c.json({ error: message }, status);
    }
  });

  app.get("/subagents/:runId/logs", async (c) => {
    const since = Number(c.req.query("since") ?? "0");
    if (!Number.isFinite(since) || since < 0) {
      return c.json({ error: "Invalid since cursor" }, 400);
    }
    const run = await getSubagentRun(runtimeOptions(), c.req.param("runId"));
    if (!run) return c.json({ error: "Subagent not found" }, 404);
    const logs = await getSubagentLogs(
      runtimeOptions(),
      c.req.param("runId"),
      since
    );
    return c.json(logs);
  });
}

const subagentsExtension: Extension = {
  id: "subagents",
  displayName: "Subagents",
  description: "Project-agnostic runtime for CLI-backed subagent runs.",
  dependencies: [],
  configSchema: SubagentsExtensionConfigSchema,
  routePrefixes: ["/api/subagents"],
  validateConfig(raw) {
    const result = SubagentsExtensionConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success
        ? []
        : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes(app) {
    registerSubagentRoutes(app);
  },
  getSystemPromptContributions() {
    return [
      "Subagent runtime commands:",
      "- Use `aihub subagents start --cwd <repo> --label <name> --prompt <task>` with either `--cli codex|claude|pi` or `--profile <name>` to delegate scoped work.",
      "- Use `aihub subagents list --status running` and `aihub subagents status <runId>` to monitor runs.",
      "- Use `aihub subagents logs <runId> --since 0` to inspect run output.",
      "- Use `aihub subagents resume <runId> --prompt <follow-up>` for follow-up work.",
      "- Use `aihub subagents interrupt|archive|unarchive|delete <runId>` to manage run lifecycle.",
    ].join("\n");
  },
  async start(ctx) {
    extensionContext = ctx;
    console.log("[subagents] extension started");
  },
  async stop() {
    extensionContext = null;
    console.log("[subagents] extension stopped");
  },
  capabilities() {
    return ["subagents"];
  },
};

export { getLiveSubagentRunsByCwd, subagentsExtension };
