#!/usr/bin/env node
import { Command } from "commander";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { ApiClient } from "./client.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type ProjectItem = {
  id: string;
  title: string;
  path: string;
  frontmatter: Record<string, unknown>;
  docs?: Record<string, string>;
};

type SimpleHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

function normalizeProjectId(id: string): string {
  return id.trim().toUpperCase();
}

function normalizeItem(item: ProjectItem) {
  const fm = item.frontmatter ?? {};
  return {
    id: item.id ?? (fm.id as string | undefined) ?? "",
    title: item.title ?? (fm.title as string | undefined) ?? "",
    status: (fm.status as string | undefined) ?? "",
    domain: (fm.domain as string | undefined) ?? "",
    owner: (fm.owner as string | undefined) ?? "",
    executionMode: (fm.executionMode as string | undefined) ?? "",
    appetite: (fm.appetite as string | undefined) ?? "",
    created: (fm.created as string | undefined) ?? "",
    path: item.path ?? "",
  };
}

function renderTable(items: ProjectItem[]): string {
  const headers = [
    "id",
    "title",
    "status",
    "domain",
    "owner",
    "executionMode",
    "appetite",
    "created",
    "path",
  ];
  const formatCell = (value: unknown) =>
    String(value ?? "")
      .replace(/\r?\n/g, "<br>")
      .replace(/\|/g, "\\|");
  const rows = items.map((item) => {
    const normalized = normalizeItem(item);
    return headers.map((key) =>
      formatCell(normalized[key as keyof typeof normalized])
    );
  });

  const headerRow = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [headerRow, separator, body].filter(Boolean).join("\n");
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

type CommentArgs = {
  projectId: string;
  author: string;
  message: string;
};

export function createProjectCommentHandler(options?: {
  baseUrl?: string;
  token?: string;
  fetchImpl?: FetchLike;
}): (args: CommentArgs) => Promise<Response> {
  const baseUrl =
    options?.baseUrl ?? process.env.AIHUB_API_URL ?? process.env.AIHUB_URL;
  if (!baseUrl) {
    throw new Error("Missing baseUrl for comment handler");
  }
  const fetchImpl = options?.fetchImpl ?? fetch;
  const token = options?.token;
  return (args) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetchImpl(
      new URL(`/api/projects/${args.projectId}/comments`, baseUrl).toString(),
      {
        method: "POST",
        headers,
        body: JSON.stringify({ author: args.author, message: args.message }),
      }
    );
  };
}

function formatMessages(items: SimpleHistoryMessage[]): string {
  if (items.length === 0) return "No messages.";
  return items.map((item) => `- ${item.role}: ${item.content}`).join("\n");
}

function mapSubagentStatus(
  status: string | undefined
): "running" | "idle" | "error" {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "idle";
}

function getClient() {
  return new ApiClient();
}

function fail(err: unknown): never {
  if (err instanceof Error) console.error(err.message);
  else console.error("Request failed");
  process.exit(1);
}

export const program = new Command();

program.name("apm").description("AIHub project manager").version("0.1.0");

program
  .command("list")
  .option("--status <status>", "Filter by status")
  .option("--owner <owner>", "Filter by owner")
  .option("--domain <domain>", "Filter by domain")
  .option("-j, --json", "JSON output")
  .action(async (opts) => {
    try {
      const items = (await getClient().listProjects()) as ProjectItem[];
      let filtered = items;
      if (opts.status) {
        filtered = filtered.filter(
          (item) => String(item.frontmatter?.status ?? "") === opts.status
        );
      }
      if (opts.owner) {
        filtered = filtered.filter(
          (item) => String(item.frontmatter?.owner ?? "") === opts.owner
        );
      }
      if (opts.domain) {
        filtered = filtered.filter(
          (item) => String(item.frontmatter?.domain ?? "") === opts.domain
        );
      }

      if (opts.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }
      console.log(renderTable(filtered));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("agent")
  .description("Manage agents")
  .command("list")
  .description("List all configured agents")
  .action(async () => {
    try {
      const agents = (await getClient().listAgents()) as Array<{
        id: string;
        name: string;
        model?: { provider?: string; model?: string };
      }>;
      console.log("Configured agents:");
      for (const agent of agents) {
        const provider = agent.model?.provider ?? "unknown";
        const model = agent.model?.model ?? "unknown";
        console.log(`  - ${agent.id}: ${agent.name} (${provider}/${model})`);
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command("create")
  .argument("[description]", "Project description for README")
  .requiredOption("-t, --title <title>", "Project title")
  .option("--domain <domain>", "Domain (life|admin|coding)")
  .option("--owner <owner>", "Owner")
  .option("--execution-mode <mode>", "Execution mode (subagent|ralph_loop)")
  .option("--appetite <appetite>", "Appetite (small|big)")
  .option("--status <status>", "Status")
  .option("-j, --json", "JSON output")
  .action(async (description, opts) => {
    try {
      const body: Record<string, unknown> = { title: opts.title };
      if (description) body.description = description;
      if (opts.domain) body.domain = opts.domain;
      if (opts.owner) body.owner = opts.owner;
      if (opts.executionMode) body.executionMode = opts.executionMode;
      if (opts.appetite) body.appetite = opts.appetite;
      if (opts.status) body.status = opts.status;

      const data = (await getClient().createProject(body)) as ProjectItem;
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(renderTable([data]));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("get")
  .argument("<id>", "Project ID")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    try {
      const normalizedId = normalizeProjectId(id);
      const project = (await getClient().getProject(
        normalizedId
      )) as ProjectItem;
      if (opts.json) {
        console.log(JSON.stringify(project, null, 2));
        return;
      }
      console.log(renderTable([project]));
      const readme = project.docs?.README;
      if (typeof readme === "string" && readme.trim().length > 0) {
        console.log("");
        console.log(readme.trim());
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command("update")
  .argument("<id>", "Project ID")
  .option("--title <title>", "Title")
  .option("--domain <domain>", "Domain (life|admin|coding)")
  .option("--owner <owner>", "Owner")
  .option("--execution-mode <mode>", "Execution mode (subagent|ralph_loop)")
  .option("--appetite <appetite>", "Appetite (small|big)")
  .option("--status <status>", "Status")
  .option("--repo <path>", "Repo path")
  .option("--content <content>", "README content string or '-' for stdin")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    try {
      const normalizedId = normalizeProjectId(id);
      const body: Record<string, unknown> = {};
      if (opts.title) body.title = opts.title;
      if (opts.domain) body.domain = opts.domain;
      if (opts.owner) body.owner = opts.owner;
      if (opts.executionMode) body.executionMode = opts.executionMode;
      if (opts.appetite) body.appetite = opts.appetite;
      if (opts.status) body.status = opts.status;
      if (opts.repo !== undefined) body.repo = opts.repo;
      if (opts.content !== undefined) {
        body.readme = opts.content === "-" ? await readStdin() : opts.content;
      }

      const data = (await getClient().updateProject(
        normalizedId,
        body
      )) as ProjectItem;
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(renderTable([data]));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("comment")
  .argument("<id>", "Project ID")
  .requiredOption("-m, --message <message>", "Comment text (use '-' for stdin)")
  .option("--author <author>", "Comment author")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    try {
      const normalizedId = normalizeProjectId(id);
      const raw = opts.message === "-" ? await readStdin() : opts.message;
      const message = raw.replace(/\\n/g, "\n");
      const author = opts.author ?? os.userInfo().username ?? "unknown";
      const data = await getClient().addComment(normalizedId, {
        author,
        message,
      });
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log("Comment added.");
    } catch (err) {
      fail(err);
    }
  });

program
  .command("move")
  .argument("<id>", "Project ID")
  .argument("<status>", "New status")
  .option("--agent <name>", "Agent name")
  .option("-j, --json", "JSON output")
  .action(async (id, status, opts) => {
    try {
      const normalizedId = normalizeProjectId(id);
      const body: Record<string, unknown> = { status };
      if (opts.agent) body.agent = opts.agent;
      const data = (await getClient().updateProject(
        normalizedId,
        body
      )) as ProjectItem;
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(renderTable([data]));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("resume")
  .argument("<id>", "Project ID")
  .requiredOption(
    "-m, --message <message>",
    "Message to send (use '-' for stdin)"
  )
  .option("--slug <slug>", "Slug override (CLI clone/worktree resume)")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    try {
      const normalizedId = normalizeProjectId(id);
      const message = opts.message === "-" ? await readStdin() : opts.message;
      const project = (await getClient().getProject(
        normalizedId
      )) as ProjectItem;
      const frontmatter = project.frontmatter ?? {};
      const sessionKeys =
        typeof frontmatter.sessionKeys === "object" &&
        frontmatter.sessionKeys !== null
          ? (frontmatter.sessionKeys as Record<string, string>)
          : {};
      const requestedSlug =
        typeof opts.slug === "string" ? opts.slug.trim() : "";

      if (!requestedSlug && Object.keys(sessionKeys).length > 0) {
        const [agentId, sessionKey] = Object.entries(sessionKeys)[0] ?? [];
        if (!agentId || !sessionKey) {
          console.error("No sessionKey available for resume.");
          process.exit(1);
        }
        const data = await getClient().request(`/agents/${agentId}/messages`, {
          method: "POST",
          body: { message, sessionKey },
        });
        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        console.log(`Sent message (sessionKey: ${sessionKey})`);
        return;
      }

      const subagentsData = (await getClient().listProjectSubagents(
        normalizedId
      )) as {
        items?: Array<{ slug?: string; cli?: string; runMode?: string }>;
      };
      const items = Array.isArray(subagentsData.items)
        ? subagentsData.items
        : [];
      const fallbackSlug =
        items.find((entry) => entry.slug === "main")?.slug ??
        (items.length === 1 ? items[0]?.slug : "");
      const slug = requestedSlug || fallbackSlug;
      if (!slug) {
        console.error("Slug required to resume CLI run.");
        process.exit(1);
      }
      const item = items.find((entry) => entry.slug === slug);
      if (!item?.cli) {
        console.error("CLI not found for slug.");
        process.exit(1);
      }
      const runMode =
        item.runMode === "clone"
          ? "clone"
          : item.runMode === "worktree"
            ? "worktree"
            : "main-run";
      const data = await getClient().spawnProjectSubagent(normalizedId, {
        slug,
        cli: item.cli,
        prompt: message,
        mode: runMode,
        resume: true,
      });
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(`Resumed CLI run (slug: ${slug})`);
      return;
    } catch (err) {
      fail(err);
    }
  });

program
  .command("status")
  .argument("<id>", "Project ID")
  .option("--limit <n>", "Number of messages to return", "10")
  .option("--slug <slug>", "Slug override (CLI clone/worktree)")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    try {
      const normalizedId = normalizeProjectId(id);
      const limit = Math.max(0, Number(opts.limit) || 10);
      const project = (await getClient().getProject(
        normalizedId
      )) as ProjectItem;
      const frontmatter = project.frontmatter ?? {};
      const sessionKeys =
        typeof frontmatter.sessionKeys === "object" &&
        frontmatter.sessionKeys !== null
          ? (frontmatter.sessionKeys as Record<string, string>)
          : {};
      const requestedSlug =
        typeof opts.slug === "string" ? opts.slug.trim() : "";

      if (!requestedSlug && Object.keys(sessionKeys).length > 0) {
        const [agentId, sessionKey] = Object.entries(sessionKeys)[0] ?? [];
        if (!agentId || !sessionKey) {
          console.error("No sessionKey available for status.");
          process.exit(1);
        }
        const statusData = (await getClient().getAgentStatus(agentId)) as {
          isStreaming?: boolean;
        };
        const historyData = (await getClient().getAgentHistory(
          agentId,
          sessionKey
        )) as {
          messages?: SimpleHistoryMessage[];
        };
        const messages = Array.isArray(historyData.messages)
          ? historyData.messages
          : [];
        const recent = messages.slice(-limit);
        const payload = {
          type: "aihub",
          agentId,
          sessionKey,
          status: statusData.isStreaming ? "running" : "idle",
          messages: recent,
        };
        if (opts.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }
        console.log(`Status: ${payload.status}`);
        console.log(formatMessages(recent));
        return;
      }

      const subagentsData = (await getClient().listProjectSubagents(
        normalizedId
      )) as {
        items?: Array<{ slug?: string; status?: string; cli?: string }>;
      };
      const items = Array.isArray(subagentsData.items)
        ? subagentsData.items
        : [];
      const fallbackSlug =
        items.find((entry) => entry.slug === "main")?.slug ??
        (items.length === 1 ? items[0]?.slug : "");
      const slug = requestedSlug || fallbackSlug;
      if (!slug) {
        console.error("Slug required to fetch CLI status.");
        process.exit(1);
      }
      const item = items.find((entry) => entry.slug === slug);
      const status = mapSubagentStatus(item?.status);
      const logsData = (await getClient().getSubagentLogs(
        normalizedId,
        slug
      )) as {
        events?: Array<{ type?: string; text?: string }>;
      };
      const events = Array.isArray(logsData.events) ? logsData.events : [];
      const messages = events
        .filter((ev) => ev.type === "user" || ev.type === "assistant")
        .map((ev) => ({
          role: ev.type === "user" ? "user" : "assistant",
          content: ev.text ?? "",
        }))
        .filter((ev) => ev.content.length > 0) as SimpleHistoryMessage[];
      const recent = messages.slice(-limit);
      const payload = {
        type: "cli",
        cli: item?.cli,
        slug,
        status,
        messages: recent,
      };
      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      console.log(`Status: ${payload.status}`);
      console.log(formatMessages(recent));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("archive")
  .argument("<id>", "Project ID")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    try {
      const normalizedId = normalizeProjectId(id);
      const data = await getClient().archiveProject(normalizedId);
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(`Archived project ${normalizedId}`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("unarchive")
  .argument("<id>", "Project ID")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    try {
      const normalizedId = normalizeProjectId(id);
      const data = await getClient().unarchiveProject(normalizedId);
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(`Unarchived project ${normalizedId}`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("ralph")
  .argument("<id>", "Project ID")
  .option("--cli <cli>", "CLI (codex|claude)", "codex")
  .option("--iterations <n>", "Number of loop iterations", "20")
  .option(
    "--prompt-file <path>",
    "Prompt file path (optional; otherwise generated from ralph template)"
  )
  .option("--mode <mode>", "Run mode (main-run|clone|worktree)")
  .option("--branch <branch>", "Base branch for clone/worktree")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    try {
      const normalizedId = normalizeProjectId(id);
      const iterations = Number(opts.iterations);
      const body: Record<string, unknown> = {
        cli: opts.cli,
        iterations: Number.isFinite(iterations) ? iterations : 20,
      };
      if (typeof opts.promptFile === "string" && opts.promptFile.trim()) {
        body.promptFile = opts.promptFile.trim();
      }
      if (typeof opts.mode === "string" && opts.mode.trim()) {
        body.mode = opts.mode.trim();
      }
      if (typeof opts.branch === "string" && opts.branch.trim()) {
        body.baseBranch = opts.branch.trim();
      }

      const data = (await getClient().startRalphLoop(normalizedId, body)) as {
        slug?: string;
      };
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(`Started Ralph loop (slug: ${data.slug})`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("start")
  .argument("<id>", "Project ID")
  .option("--agent <agent>", "Agent name (cli name or aihub:<id>)")
  .option("--name <name>", "Optional spawned CLI run name")
  .option("--model <model>", "Model override for CLI harness")
  .option(
    "--reasoning-effort <level>",
    "Reasoning effort (codex|claude)"
  )
  .option("--thinking <level>", "Thinking level (pi)")
  .option("--mode <mode>", "Run mode (main-run|clone|worktree)")
  .option("--branch <branch>", "Base branch for clone/worktree")
  .option("--slug <slug>", "Slug override (clone/worktree)")
  .option("--custom-prompt <prompt>", "Custom prompt (use '-' for stdin)")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    try {
      const normalizedId = normalizeProjectId(id);
      const body: Record<string, unknown> = {};
      if (typeof opts.agent === "string" && opts.agent.trim()) {
        const agentValue = opts.agent.trim();
        body.runAgent = agentValue.includes(":")
          ? agentValue
          : `cli:${agentValue}`;
      }
      if (typeof opts.name === "string" && opts.name.trim()) {
        body.name = opts.name.trim();
      }
      if (typeof opts.model === "string" && opts.model.trim()) {
        body.model = opts.model.trim();
      }
      if (
        typeof opts.reasoningEffort === "string" &&
        opts.reasoningEffort.trim()
      ) {
        body.reasoningEffort = opts.reasoningEffort.trim();
      }
      if (typeof opts.thinking === "string" && opts.thinking.trim()) {
        body.thinking = opts.thinking.trim();
      }
      if (typeof opts.mode === "string" && opts.mode.trim()) {
        body.runMode = opts.mode.trim();
      }
      if (typeof opts.branch === "string" && opts.branch.trim()) {
        body.baseBranch = opts.branch.trim();
      }
      if (typeof opts.slug === "string" && opts.slug.trim()) {
        body.slug = opts.slug.trim();
      }
      if (opts.customPrompt !== undefined) {
        body.customPrompt =
          opts.customPrompt === "-" ? await readStdin() : opts.customPrompt;
      }

      const data = (await getClient().startProject(normalizedId, body)) as {
        type?: string;
        sessionKey?: string;
        slug?: string;
        runMode?: string;
      };
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      if (data.type === "aihub") {
        console.log(`Started AIHub run (sessionKey: ${data.sessionKey})`);
        return;
      }
      if (data.type === "cli") {
        console.log(
          `Started CLI run (slug: ${data.slug}, mode: ${data.runMode})`
        );
        return;
      }
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      fail(err);
    }
  });

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  program.parseAsync(process.argv);
}
