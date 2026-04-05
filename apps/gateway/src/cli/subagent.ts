import { Command } from "commander";
import { resolveBindHost } from "@aihub/shared";
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

type Handlers = {
  spawn: (args: SpawnArgs) => Promise<Response>;
  logs: (args: LogsArgs) => Promise<Response>;
  status: (args: StatusArgs) => Promise<Response>;
  interrupt: (args: InterruptArgs) => Promise<Response>;
  kill: (args: KillArgs) => Promise<Response>;
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

export function registerSubagentCommands(program: Command): void {
  const handlers = createSubagentHandlers();

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
