#!/usr/bin/env node
import { Command } from "commander";
import os from "node:os";
import { execSync } from "node:child_process";
import { loadConfig, getAgents } from "../config/index.js";

type ProjectItem = {
  id: string;
  title: string;
  path: string;
  frontmatter: Record<string, unknown>;
  content?: string;
};

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
  const rows = items.map((item) => {
    const normalized = normalizeItem(item);
    return headers.map((key) => String(normalized[key as keyof typeof normalized] ?? ""));
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

const program = new Command();

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
    const res = await requestJson(`/projects/${id}`);
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
  .option("--content <content>", "Content string or '-' for stdin")
  .option("-j, --json", "JSON output")
  .action(async (id, opts) => {
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
      body.content = opts.content === "-" ? await readStdin() : opts.content;
    }

    const res = await requestJson(`/projects/${id}`, {
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
  .command("move")
  .argument("<id>", "Project ID")
  .argument("<status>", "New status")
  .option("-j, --json", "JSON output")
  .action(async (id, status, opts) => {
    const res = await requestJson(`/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
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

program.parseAsync(process.argv);
