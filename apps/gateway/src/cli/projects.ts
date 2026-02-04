#!/usr/bin/env node
import { Command } from "commander";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { loadConfig, getAgents } from "../config/index.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type ProjectItem = {
  id: string;
  title: string;
  path: string;
  frontmatter: Record<string, unknown>;
  docs?: Record<string, string>;
  readme?: string;
  specs?: string;
};

type SimpleHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "project";
}

function normalizeProjectId(id: string): string {
  return id.trim().toUpperCase();
}

function pickTailnetIPv4(): string | null {
  const interfaces = os.networkInterfaces();
  for (const [, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const octets = addr.address.split(".").map(Number);
      if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) {
        return addr.address;
      }
    }
  }
  return null;
}

function getTailscaleIP(): string | null {
  try {
    const output = execSync("tailscale status --json", { encoding: "utf-8", timeout: 5000 });
    const status = JSON.parse(output);
    const ips = status?.Self?.TailscaleIPs as string[] | undefined;
    return ips?.find((ip: string) => !ip.includes(":")) ?? ips?.[0] ?? null;
  } catch {
    return null;
  }
}

function resolveBindHost(bind?: string): string {
  if (!bind || bind === "loopback") return "127.0.0.1";
  if (bind === "lan") return "0.0.0.0";
  if (bind === "tailnet") {
    return pickTailnetIPv4() ?? getTailscaleIP() ?? "127.0.0.1";
  }
  return "127.0.0.1";
}

function getApiBaseUrl(): string {
  const envUrl = process.env.AIHUB_API_URL;
  if (envUrl) return envUrl;

  const config = loadConfig();
  const host = config.gateway?.host ?? resolveBindHost(config.gateway?.bind);
  const port = config.gateway?.port ?? 4000;
  return `http://${host}:${port}`;
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
  const formatCell = (value: unknown) => String(value ?? "").replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
  const rows = items.map((item) => {
    const normalized = normalizeItem(item);
    return headers.map((key) => formatCell(normalized[key as keyof typeof normalized]));
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

async function requestJson(path: string, init?: RequestInit): Promise<Response> {
  const base = getApiBaseUrl();
  const url = new URL(`/api${path}`, base).toString();
  return fetch(url, init);
}

type CommentArgs = {
  projectId: string;
  author: string;
  message: string;
};

export function createProjectCommentHandler(options?: {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}): (args: CommentArgs) => Promise<Response> {
  const baseUrl = options?.baseUrl ?? getApiBaseUrl();
  const fetchImpl = options?.fetchImpl ?? fetch;
  return (args) =>
    fetchImpl(new URL(`/api/projects/${args.projectId}/comments`, baseUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: args.author, message: args.message }),
    });
}

function formatMessages(items: SimpleHistoryMessage[]): string {
  if (items.length === 0) return "No messages.";
  return items.map((item) => `- ${item.role}: ${item.content}`).join("\n");
}

function mapSubagentStatus(status: string | undefined): "running" | "idle" | "error" {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "idle";
}

export const program = new Command();

program.name("projects").description("Projects CLI").version("0.1.0");

program
  .command("list")
  .option("--status <status>", "Filter by status")
  .option("--owner <owner>", "Filter by owner")
  .option("--domain <domain>", "Filter by domain")
  .option("-j, --json", "JSON output")
  .action(async (opts) => {
    const res = await requestJson("/projects");
    const data = await res.json();
    if (!res.ok) {
      console.error(data.error ?? "Request failed");
      process.exit(1);
    }

    let items = data as ProjectItem[];
    if (opts.status) {
      items = items.filter((item) => String(item.frontmatter?.status ?? "") === opts.status);
    }
    if (opts.owner) {
      items = items.filter((item) => String(item.frontmatter?.owner ?? "") === opts.owner);
    }
    if (opts.domain) {
      items = items.filter((item) => String(item.frontmatter?.domain ?? "") === opts.domain);
    }

    if (opts.json) {
      console.log(JSON.stringify(items, null, 2));
      return;
    }
    console.log(renderTable(items));
  });

program
  .command("agent")
  .description("Manage agents")
  .command("list")
  .description("List all configured agents")
  .action(() => {
    try {
      const agents = getAgents();
      console.log("Configured agents:");
      for (const agent of agents) {
        console.log(`  - ${agent.id}: ${agent.name} (${agent.model.provider}/${agent.model.model})`);
      }
    } catch (err) {
      console.error("Error:", err);
      process.exit(1);
    }
  });

program
  .command("create")
  .requiredOption("-t, --title <title>", "Project title")
  .option("--domain <domain>", "Domain (life|admin|coding)")
  .option("--owner <owner>", "Owner")
  .option("--execution-mode <mode>", "Execution mode (manual|exploratory|auto|full_auto)")
  .option("--appetite <appetite>", "Appetite (small|big)")
  .option("--status <status>", "Status")
  .option("-j, --json", "JSON output")
  .action(async (opts) => {
    const body: Record<string, unknown> = { title: opts.title };
    if (opts.domain) body.domain = opts.domain;
    if (opts.owner) body.owner = opts.owner;
    if (opts.executionMode) body.executionMode = opts.executionMode;
    if (opts.appetite) body.appetite = opts.appetite;
    if (opts.status) body.status = opts.status;

    const res = await requestJson("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(data.error ?? "Request failed");
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    console.log(renderTable([data as ProjectItem]));
  });

program
  .command("get")
  .argument("<id>", "Project ID")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    const normalizedId = normalizeProjectId(id);
    const res = await requestJson(`/projects/${normalizedId}`);
    const data = await res.json();
    if (!res.ok) {
      console.error(data.error ?? "Request failed");
      process.exit(1);
    }
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    const project = data as ProjectItem;
    console.log(renderTable([project]));
    const readme = project.docs?.README;
    if (typeof readme === "string" && readme.trim().length > 0) {
      console.log("");
      console.log(readme.trim());
    }
  });

program
  .command("update")
  .argument("<id>", "Project ID")
  .option("--title <title>", "Title")
  .option("--domain <domain>", "Domain (life|admin|coding)")
  .option("--owner <owner>", "Owner")
  .option("--execution-mode <mode>", "Execution mode (manual|exploratory|auto|full_auto)")
  .option("--appetite <appetite>", "Appetite (small|big)")
  .option("--status <status>", "Status")
  .option("--run-agent <agent>", "Run agent (aihub:<id> or cli:<name>)")
  .option("--run-mode <mode>", "Run mode (main-run|worktree)")
  .option("--repo <path>", "Repo path")
  .option("--content <content>", "Specs content string or '-' for stdin")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    const normalizedId = normalizeProjectId(id);
    const body: Record<string, unknown> = {};
    if (opts.title) body.title = opts.title;
    if (opts.domain) body.domain = opts.domain;
    if (opts.owner) body.owner = opts.owner;
    if (opts.executionMode) body.executionMode = opts.executionMode;
    if (opts.appetite) body.appetite = opts.appetite;
    if (opts.status) body.status = opts.status;
    if (opts.runAgent !== undefined) body.runAgent = opts.runAgent;
    if (opts.runMode !== undefined) body.runMode = opts.runMode;
    if (opts.repo !== undefined) body.repo = opts.repo;
    if (opts.content !== undefined) {
      body.specs = opts.content === "-" ? await readStdin() : opts.content;
    }

    const res = await requestJson(`/projects/${normalizedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(data.error ?? "Request failed");
      process.exit(1);
    }
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    console.log(renderTable([data as ProjectItem]));
  });

program
  .command("comment")
  .argument("<id>", "Project ID")
  .requiredOption("-m, --message <message>", "Comment text (use '-' for stdin)")
  .option("--author <author>", "Comment author")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    const normalizedId = normalizeProjectId(id);
    const message = opts.message === "-" ? await readStdin() : opts.message;
    const author = opts.author ?? os.userInfo().username ?? "unknown";
    const comment = createProjectCommentHandler();
    const res = await comment({ projectId: normalizedId, author, message });
    const data = await res.json();
    if (!res.ok) {
      console.error(data.error ?? "Request failed");
      process.exit(1);
    }
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    console.log("Comment added.");
  });

program
  .command("move")
  .argument("<id>", "Project ID")
  .argument("<status>", "New status")
  .option("--agent <name>", "Agent name")
  .option("-j, --json", "JSON output")
  .action(async (id, status, opts) => {
    const normalizedId = normalizeProjectId(id);
    const body: Record<string, unknown> = { status };
    if (opts.agent) body.agent = opts.agent;
    const res = await requestJson(`/projects/${normalizedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(data.error ?? "Request failed");
      process.exit(1);
    }
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    console.log(renderTable([data as ProjectItem]));
  });

program
  .command("resume")
  .argument("<id>", "Project ID")
  .requiredOption("-m, --message <message>", "Message to send (use '-' for stdin)")
  .option("--slug <slug>", "Slug override (CLI worktree resume)")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    const normalizedId = normalizeProjectId(id);
    const message = opts.message === "-" ? await readStdin() : opts.message;
    const projectRes = await requestJson(`/projects/${normalizedId}`);
    const projectData = await projectRes.json();
    if (!projectRes.ok) {
      console.error(projectData.error ?? "Request failed");
      process.exit(1);
    }

    const project = projectData as ProjectItem;
    const frontmatter = project.frontmatter ?? {};
    const runAgent = typeof frontmatter.runAgent === "string" ? frontmatter.runAgent : "";
    if (!runAgent) {
      console.error("runAgent not set. Use `apm update <id> --run-agent ...` or `apm start <id>` first.");
      process.exit(1);
    }

    if (runAgent.startsWith("aihub:")) {
      const agentId = runAgent.slice(6);
      const sessionKeys =
        typeof frontmatter.sessionKeys === "object" && frontmatter.sessionKeys !== null
          ? (frontmatter.sessionKeys as Record<string, string>)
          : {};
      const sessionKey = sessionKeys[agentId] ?? `project:${project.id}:${agentId}`;
      const res = await requestJson(`/agents/${agentId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sessionKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error(data.error ?? "Request failed");
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(`Sent message (sessionKey: ${sessionKey})`);
      return;
    }

    if (runAgent.startsWith("cli:")) {
      const cli = runAgent.slice(4);
      const runMode = typeof frontmatter.runMode === "string" ? frontmatter.runMode : "main-run";
      const slug = runMode === "worktree" ? (opts.slug ?? slugifyTitle(project.title)) : "main";
      const res = await requestJson(`/projects/${normalizedId}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          cli,
          prompt: message,
          mode: runMode === "worktree" ? "worktree" : "main-run",
          resume: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error(data.error ?? "Request failed");
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(`Resumed CLI run (slug: ${slug})`);
      return;
    }

    console.error(`Unsupported runAgent: ${runAgent}`);
    process.exit(1);
  });

program
  .command("status")
  .argument("<id>", "Project ID")
  .option("--limit <n>", "Number of messages to return", "10")
  .option("--slug <slug>", "Slug override (CLI worktree)")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    const normalizedId = normalizeProjectId(id);
    const limit = Math.max(0, Number(opts.limit) || 10);
    const projectRes = await requestJson(`/projects/${normalizedId}`);
    const projectData = await projectRes.json();
    if (!projectRes.ok) {
      console.error(projectData.error ?? "Request failed");
      process.exit(1);
    }

    const project = projectData as ProjectItem;
    const frontmatter = project.frontmatter ?? {};
    const runAgent = typeof frontmatter.runAgent === "string" ? frontmatter.runAgent : "";
    if (!runAgent) {
      console.error("runAgent not set. Use `apm update <id> --run-agent ...` or `apm start <id>` first.");
      process.exit(1);
    }

    if (runAgent.startsWith("aihub:")) {
      const agentId = runAgent.slice(6);
      const sessionKeys =
        typeof frontmatter.sessionKeys === "object" && frontmatter.sessionKeys !== null
          ? (frontmatter.sessionKeys as Record<string, string>)
          : {};
      const sessionKey = sessionKeys[agentId] ?? `project:${project.id}:${agentId}`;
      const statusRes = await requestJson(`/agents/${agentId}/status`);
      const statusData = await statusRes.json();
      if (!statusRes.ok) {
        console.error(statusData.error ?? "Failed to fetch agent status");
        process.exit(1);
      }
      const historyRes = await requestJson(
        `/agents/${agentId}/history?sessionKey=${encodeURIComponent(sessionKey)}&view=simple`
      );
      const historyData = await historyRes.json();
      const messages = Array.isArray(historyData.messages) ? (historyData.messages as SimpleHistoryMessage[]) : [];
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

    if (runAgent.startsWith("cli:")) {
      const cli = runAgent.slice(4);
      const runMode = typeof frontmatter.runMode === "string" ? frontmatter.runMode : "main-run";
      const slug = runMode === "worktree" ? (opts.slug ?? slugifyTitle(project.title)) : "main";
      const subagentsRes = await requestJson(`/projects/${normalizedId}/subagents`);
      const subagentsData = await subagentsRes.json();
      if (!subagentsRes.ok) {
        console.error(subagentsData.error ?? "Failed to fetch subagents");
        process.exit(1);
      }
      const items = Array.isArray(subagentsData.items) ? subagentsData.items : [];
      const item = items.find((entry: { slug?: string }) => entry.slug === slug);
      const status = mapSubagentStatus(item?.status);
      const logsRes = await requestJson(`/projects/${normalizedId}/subagents/${slug}/logs?since=0`);
      const logsData = await logsRes.json();
      if (!logsRes.ok) {
        console.error(logsData.error ?? "Failed to fetch logs");
        process.exit(1);
      }
      const events = Array.isArray(logsData.events) ? logsData.events : [];
      const messages = events
        .filter((ev: { type?: string; text?: string }) => ev.type === "user" || ev.type === "assistant")
        .map((ev: { type?: string; text?: string }) => ({
          role: ev.type === "user" ? "user" : "assistant",
          content: ev.text ?? "",
        }))
        .filter((ev: SimpleHistoryMessage) => ev.content.length > 0);
      const recent = messages.slice(-limit);
      const payload = {
        type: "cli",
        cli,
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
      return;
    }

    console.error(`Unsupported runAgent: ${runAgent}`);
    process.exit(1);
  });

program
  .command("start")
  .argument("<id>", "Project ID")
  .option("--custom-prompt <prompt>", "Custom prompt (use '-' for stdin)")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
    const normalizedId = normalizeProjectId(id);
    const body: Record<string, unknown> = {};
    if (opts.customPrompt !== undefined) {
      body.customPrompt = opts.customPrompt === "-" ? await readStdin() : opts.customPrompt;
    }

    const res = await requestJson(`/projects/${normalizedId}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(data.error ?? "Request failed");
      process.exit(1);
    }
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (data.type === "aihub") {
      console.log(`Started AIHub run (sessionKey: ${data.sessionKey})`);
      return;
    }
    if (data.type === "cli") {
      console.log(`Started CLI run (slug: ${data.slug}, mode: ${data.runMode})`);
      return;
    }
    console.log(JSON.stringify(data, null, 2));
  });

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  program.parseAsync(process.argv);
}
