import { Command } from "commander";
import { resolveBindHost, type SubagentRuntimeProfile } from "@aihub/shared";
import { loadConfig } from "../config/index.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type SpawnArgs = {
  projectId: string;
  slug: string;
  cli: string;
  prompt: string;
  mode?: string;
  baseBranch?: string;
  resume?: boolean;
};

type LogsArgs = {
  projectId: string;
  slug: string;
  since?: number;
};

type StatusArgs = {
  projectId: string;
  slug: string;
};

type InterruptArgs = {
  projectId: string;
  slug: string;
};

type KillArgs = {
  projectId: string;
  slug: string;
};

type RuntimeStartArgs = {
  cli?: string;
  profile?: string;
  cwd: string;
  prompt: string;
  label: string;
  parent?: string;
  model?: string;
  reasoningEffort?: string;
};

type RuntimeRunArgs = {
  runId: string;
};

type RuntimeLogsArgs = RuntimeRunArgs & {
  since?: number;
};

type RuntimeResumeArgs = RuntimeRunArgs & {
  prompt: string;
};

type Handlers = {
  spawn: (args: SpawnArgs) => Promise<Response>;
  logs: (args: LogsArgs) => Promise<Response>;
  status: (args: StatusArgs) => Promise<Response>;
  interrupt: (args: InterruptArgs) => Promise<Response>;
  kill: (args: KillArgs) => Promise<Response>;
};

type RuntimeHandlers = {
  start: (args: RuntimeStartArgs) => Promise<Response>;
  list: (args: {
    parent?: string;
    status?: string;
    includeArchived?: boolean;
  }) => Promise<Response>;
  status: (args: RuntimeRunArgs) => Promise<Response>;
  logs: (args: RuntimeLogsArgs) => Promise<Response>;
  resume: (args: RuntimeResumeArgs) => Promise<Response>;
  interrupt: (args: RuntimeRunArgs) => Promise<Response>;
  archive: (args: RuntimeRunArgs) => Promise<Response>;
  unarchive: (args: RuntimeRunArgs) => Promise<Response>;
  delete: (args: RuntimeRunArgs) => Promise<Response>;
};

type SubagentProfileRow = {
  name?: string;
  cli?: string;
  model?: string;
  type?: string;
  runMode?: string;
};

function normalizeProjectId(id: string): string {
  return id.trim().toUpperCase();
}

function getApiBaseUrl(): string {
  const envUrl = process.env.AIHUB_API_URL;
  if (envUrl) return envUrl;

  const config = loadConfig();
  const host = config.gateway?.host ?? resolveBindHost(config.gateway?.bind);
  const port = config.gateway?.port ?? 4000;
  return `http://${host}:${port}`;
}

export function createSubagentHandlers(options?: {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}): Handlers {
  const baseUrl = options?.baseUrl ?? getApiBaseUrl();
  const fetchImpl = options?.fetchImpl ?? fetch;

  const requestJson = (path: string, init?: RequestInit) => {
    const url = new URL(`/api${path}`, baseUrl).toString();
    return fetchImpl(url, init);
  };

  return {
    spawn: (args) =>
      requestJson(`/projects/${normalizeProjectId(args.projectId)}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: args.slug,
          cli: args.cli,
          prompt: args.prompt,
          mode: args.mode,
          baseBranch: args.baseBranch,
          resume: args.resume,
        }),
      }),
    logs: (args) => {
      const projectId = normalizeProjectId(args.projectId);
      const since = args.since ?? 0;
      return requestJson(
        `/projects/${projectId}/subagents/${args.slug}/logs?since=${since}`
      );
    },
    status: async (args) => {
      const projectId = normalizeProjectId(args.projectId);
      const res = await requestJson(`/projects/${projectId}/subagents`);
      if (!res.ok) return res;
      const body = (await res.json()) as { items?: Array<{ slug?: string }> };
      const item = body.items?.find((entry) => entry.slug === args.slug);
      return new Response(JSON.stringify(item ?? null), { status: 200 });
    },
    interrupt: (args) =>
      requestJson(
        `/projects/${normalizeProjectId(args.projectId)}/subagents/${args.slug}/interrupt`,
        { method: "POST" }
      ),
    kill: (args) =>
      requestJson(
        `/projects/${normalizeProjectId(args.projectId)}/subagents/${args.slug}/kill`,
        { method: "POST" }
      ),
  };
}

export function createRuntimeSubagentHandlers(options?: {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}): RuntimeHandlers {
  const baseUrl = options?.baseUrl ?? getApiBaseUrl();
  const fetchImpl = options?.fetchImpl ?? fetch;

  const requestJson = (path: string, init?: RequestInit) => {
    const url = new URL(`/api${path}`, baseUrl).toString();
    return fetchImpl(url, init);
  };

  return {
    start: (args) =>
      requestJson("/subagents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cli: args.cli,
          profile: args.profile,
          cwd: args.cwd,
          prompt: args.prompt,
          label: args.label,
          parent: args.parent,
          model: args.model,
          reasoningEffort: args.reasoningEffort,
        }),
      }),
    list: (args) => {
      const params = new URLSearchParams();
      if (args.parent) params.set("parent", args.parent);
      if (args.status) params.set("status", args.status);
      if (args.includeArchived) params.set("includeArchived", "true");
      const query = params.toString();
      return requestJson(`/subagents${query ? `?${query}` : ""}`);
    },
    status: (args) =>
      requestJson(`/subagents/${encodeURIComponent(args.runId)}`),
    logs: (args) =>
      requestJson(
        `/subagents/${encodeURIComponent(args.runId)}/logs?since=${args.since ?? 0}`
      ),
    resume: (args) =>
      requestJson(`/subagents/${encodeURIComponent(args.runId)}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: args.prompt }),
      }),
    interrupt: (args) =>
      requestJson(`/subagents/${encodeURIComponent(args.runId)}/interrupt`, {
        method: "POST",
      }),
    archive: (args) =>
      requestJson(`/subagents/${encodeURIComponent(args.runId)}/archive`, {
        method: "POST",
      }),
    unarchive: (args) =>
      requestJson(`/subagents/${encodeURIComponent(args.runId)}/unarchive`, {
        method: "POST",
      }),
    delete: (args) =>
      requestJson(`/subagents/${encodeURIComponent(args.runId)}`, {
        method: "DELETE",
      }),
  };
}

async function printResponse(res: Response, json: boolean): Promise<void> {
  const text = await res.text();
  if (!res.ok) {
    console.error(text);
    process.exit(1);
  }
  if (json) {
    console.log(text);
    return;
  }
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (Array.isArray((data as { items?: unknown[] })?.items)) {
    for (const item of (data as { items: Array<Record<string, unknown>> })
      .items) {
      console.log(
        [
          item.id,
          item.status,
          item.label,
          item.cli,
          item.latestOutput ? `- ${item.latestOutput}` : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
    }
    return;
  }
  if (data && typeof data === "object" && "id" in data) {
    const run = data as Record<string, unknown>;
    console.log(`${run.id} ${run.status} ${run.label ?? ""}`.trim());
    if (run.latestOutput) console.log(String(run.latestOutput));
    return;
  }
  console.log(text);
}

function profileCell(value: string | undefined): string {
  return value?.trim() ? value : "-";
}

function formatProfileRows(profiles: SubagentProfileRow[]): string[] {
  const rows = profiles.map((profile) => [
    profileCell(profile.name),
    profileCell(profile.cli),
    profileCell(profile.model),
    profileCell(profile.type),
    profileCell(profile.runMode),
  ]);
  const widths = [0, 1, 2, 3, 4].map((index) =>
    Math.max(...rows.map((row) => row[index].length))
  );
  return rows.map((row) =>
    row
      .map((cell, index) => cell.padEnd(widths[index]))
      .join("  ")
      .trimEnd()
  );
}

export function printSubagentProfiles(json: boolean): void {
  const config = loadConfig();
  const extensionProfiles =
    (config.extensions?.subagents?.profiles as
      | SubagentRuntimeProfile[]
      | undefined) ?? [];
  const legacyProfiles = (config.subagents ?? []).map((profile) => ({
    name: profile.name,
    cli: profile.cli,
    model: profile.model,
    reasoningEffort: profile.reasoning,
    type: profile.type,
    runMode: profile.runMode,
  }));
  const profiles = [
    ...extensionProfiles,
    ...legacyProfiles.filter(
      (legacy) =>
        !extensionProfiles.some((profile) => profile.name === legacy.name)
    ),
  ];

  if (json) {
    console.log(JSON.stringify(profiles));
    return;
  }

  if (profiles.length === 0) {
    console.log("No profiles configured");
    return;
  }

  for (const row of formatProfileRows(profiles)) {
    console.log(row);
  }
}

export function registerSubagentCommands(program: Command): void {
  const handlers = createSubagentHandlers();
  const runtimeHandlers = createRuntimeSubagentHandlers();

  const runtime = program
    .command("subagents")
    .description("Manage CLI subagent runtime runs");

  runtime
    .command("profiles")
    .description("List configured subagent profiles")
    .option("--json", "Print raw JSON")
    .action((opts) => {
      printSubagentProfiles(Boolean(opts.json));
    });

  runtime
    .command("start")
    .option("--cli <cli>", "CLI harness (codex|claude|pi)")
    .option("--profile <name>", "Subagent profile name")
    .requiredOption("--cwd <path>", "Run working directory")
    .requiredOption("--prompt <text>", "Prompt")
    .requiredOption("--label <label>", "Run label")
    .option("--parent <type:id>", "Parent scope")
    .option("--model <model>", "Harness model")
    .option("--reasoning-effort <effort>", "Harness reasoning effort")
    .option("--json", "Print raw JSON")
    .action(async (opts) => {
      const res = await runtimeHandlers.start({
        cli: opts.cli,
        profile: opts.profile,
        cwd: opts.cwd,
        prompt: opts.prompt,
        label: opts.label,
        parent: opts.parent,
        model: opts.model,
        reasoningEffort: opts.reasoningEffort,
      });
      await printResponse(res, Boolean(opts.json));
    });

  runtime
    .command("list")
    .option("--parent <type:id>", "Parent scope")
    .option("--status <status>", "Status filter")
    .option("--include-archived", "Include archived runs")
    .option("--json", "Print raw JSON")
    .action(async (opts) => {
      const res = await runtimeHandlers.list({
        parent: opts.parent,
        status: opts.status,
        includeArchived: Boolean(opts.includeArchived),
      });
      await printResponse(res, Boolean(opts.json));
    });

  runtime
    .command("status")
    .argument("<runId>", "Run ID")
    .option("--json", "Print raw JSON")
    .action(async (runId, opts) => {
      const res = await runtimeHandlers.status({ runId });
      await printResponse(res, Boolean(opts.json));
    });

  runtime
    .command("logs")
    .argument("<runId>", "Run ID")
    .option("--since <cursor>", "Byte cursor", "0")
    .option("--json", "Print raw JSON")
    .action(async (runId, opts) => {
      const res = await runtimeHandlers.logs({
        runId,
        since: Number(opts.since),
      });
      await printResponse(res, Boolean(opts.json));
    });

  runtime
    .command("resume")
    .argument("<runId>", "Run ID")
    .requiredOption("--prompt <text>", "Prompt")
    .option("--json", "Print raw JSON")
    .action(async (runId, opts) => {
      const res = await runtimeHandlers.resume({
        runId,
        prompt: opts.prompt,
      });
      await printResponse(res, Boolean(opts.json));
    });

  for (const commandName of [
    "interrupt",
    "archive",
    "unarchive",
    "delete",
  ] as const) {
    runtime
      .command(commandName)
      .argument("<runId>", "Run ID")
      .option("--json", "Print raw JSON")
      .action(async (runId, opts) => {
        const res = await runtimeHandlers[commandName]({ runId });
        await printResponse(res, Boolean(opts.json));
      });
  }

  const subagent = program.command("subagent").description("Manage subagents");

  subagent
    .command("spawn")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-s, --slug <slug>", "Subagent slug")
    .requiredOption("-c, --cli <cli>", "CLI (claude|codex|pi)")
    .requiredOption("--prompt <text>", "Prompt")
    .option("--mode <mode>", "Mode (clone|worktree|main-run)")
    .option("--base <branch>", "Base branch")
    .option("--resume", "Resume existing session")
    .action(async (opts) => {
      const res = await handlers.spawn({
        projectId: opts.project,
        slug: opts.slug,
        cli: opts.cli,
        prompt: opts.prompt,
        mode: opts.mode,
        baseBranch: opts.base,
        resume: Boolean(opts.resume),
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(text);
        process.exit(1);
      }
      console.log(text);
    });

  subagent
    .command("status")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-s, --slug <slug>", "Subagent slug")
    .action(async (opts) => {
      const res = await handlers.status({
        projectId: opts.project,
        slug: opts.slug,
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(text);
        process.exit(1);
      }
      console.log(text);
    });

  subagent
    .command("logs")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-s, --slug <slug>", "Subagent slug")
    .option("--since <cursor>", "Byte cursor", "0")
    .action(async (opts) => {
      const res = await handlers.logs({
        projectId: opts.project,
        slug: opts.slug,
        since: Number(opts.since),
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(text);
        process.exit(1);
      }
      console.log(text);
    });

  subagent
    .command("interrupt")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-s, --slug <slug>", "Subagent slug")
    .action(async (opts) => {
      const res = await handlers.interrupt({
        projectId: opts.project,
        slug: opts.slug,
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(text);
        process.exit(1);
      }
      console.log(text);
    });

  subagent
    .command("kill")
    .argument("<projectId>", "Project ID")
    .argument("<slug>", "Subagent slug")
    .action(async (projectId, slug) => {
      const res = await handlers.kill({ projectId, slug });
      const text = await res.text();
      if (!res.ok) {
        console.error(text);
        process.exit(1);
      }
      console.log(text);
    });
}
