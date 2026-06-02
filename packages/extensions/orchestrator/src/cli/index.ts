import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { OrchestratorApiClient } from "./client.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function renderStatus(value: any): string {
  return [
    `Status: ${value.status ?? "unknown"}`,
    `Active claims: ${value.activeClaims ?? 0}`,
    `Last tick: ${value.lastTickAt ?? "never"}`,
    `Rate limit remaining: ${value.rateLimitRemaining ?? "unknown"}`,
  ].join("\n");
}

function renderRuns(value: any): string {
  const active = Array.isArray(value.active) ? value.active : [];
  const recent = Array.isArray(value.recent) ? value.recent : [];
  const lines = ["Active runs:"];
  if (active.length === 0) lines.push("  none");
  for (const item of active) lines.push(`  ${item.issueId ?? "?"} ${item.runId ?? ""}`.trimEnd());
  lines.push("Recent runs:");
  if (recent.length === 0) lines.push("  none");
  for (const item of recent) lines.push(`  ${item.issue_id ?? item.issueId ?? "?"} ${item.run_id ?? item.runId ?? ""} ${item.outcome ?? ""}`.trimEnd());
  return lines.join("\n");
}

function workflowTemplate(input: { projectSlug?: string; profile?: string }): string {
  return `---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: ${input.projectSlug ?? "REPLACE_ME"}
  active_states: [Todo, In Progress]
  terminal_states: [Closed, Cancelled, Canceled, Duplicate, Done]
  needs_human: Needs Human
polling:
  interval_ms: 30000
  jitter_ms: 5000
workspace:
  root: ./workspaces
  cleanup_on_terminal: false
agent:
  profile: ${input.profile ?? "worker"}
  max_concurrent: 3
---
You are working on Linear issue {{issue.identifier}}.

Work only inside the issue workspace. If repositories are needed, clone or use them inside this workspace unless hooks prepared them already.

Update Linear with concise progress, validation results, and final handoff.
`;
}

async function initWorkflow(projectPath: string, opts: { projectSlug?: string; profile?: string; force?: boolean }): Promise<string> {
  const workflowPath = path.join(path.resolve(projectPath), "WORKFLOW.md");
  await fs.mkdir(path.dirname(workflowPath), { recursive: true });
  if (!opts.force) {
    await fs.access(workflowPath).then(() => { throw new Error(`WORKFLOW.md already exists: ${workflowPath}`); }).catch((error) => {
      if (error instanceof Error && error.message.startsWith("WORKFLOW.md already exists")) throw error;
    });
  }
  await fs.writeFile(workflowPath, workflowTemplate({ projectSlug: opts.projectSlug, profile: opts.profile }), "utf8");
  return workflowPath;
}

async function pipeResponse(response: Response): Promise<void> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Request failed: ${response.status}`);
  }
  if (!response.body) {
    process.stdout.write(await response.text());
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    process.stdout.write(Buffer.from(value));
  }
}

export function registerOrchestratorCommands(command: Command, client?: OrchestratorApiClient): void {
  const api = () => client ?? new OrchestratorApiClient();
  command
    .command("status")
    .description("Show orchestrator daemon status")
    .action(async () => console.log(renderStatus(await api().health())));

  command
    .command("projects")
    .description("List orchestrator projects")
    .action(async () => printJson(await api().projects()));

  command
    .command("init-workflow")
    .description("Create a project WORKFLOW.md template")
    .requiredOption("--project <path>", "project folder")
    .option("--project-slug <slug>", "Linear project slugId")
    .option("--profile <name>", "subagent profile", "worker")
    .option("--force", "overwrite existing WORKFLOW.md")
    .action(async (opts) => console.log(`Created ${await initWorkflow(opts.project, { projectSlug: opts.projectSlug, profile: opts.profile, force: opts.force })}`));

  command
    .command("runs")
    .description("List orchestrator runs")
    .option("--project <id>", "filter by project id")
    .option("--issue <id>", "filter by issue id")
    .option("--limit <n>", "limit recent rows", (value) => Number(value))
    .option("--json", "print raw JSON")
    .action(async (opts) => {
      const data = await api().runs(opts.limit, opts.issue, opts.project);
      opts.json ? printJson(data) : console.log(renderRuns(data));
    });

  command
    .command("events <runId>")
    .description("Show run events")
    .option("--project <id>", "filter by project id")
    .action(async (runId, opts) => printJson(await api().events(runId, opts.project)));

  command
    .command("workflow")
    .description("Print resolved workflow")
    .option("--project <id>", "project id")
    .action(async (opts) => printJson(await api().workflow(opts.project)));

  for (const verb of ["claim", "release", "interrupt", "kill"] as const) {
    command
      .command(`${verb} <issueId>`)
      .description(`${verb} issue/run`)
      .option("--project <id>", "project id")
      .action(async (issueId, opts) => printJson(await api()[verb](issueId, opts.project)));
  }

  command
    .command("logs <id>")
    .description("Stream run logs")
    .option("--project <id>", "project id")
    .option("--since <n>", "start offset", (value) => Number(value))
    .option("--follow", "follow logs")
    .action(async (id, opts) => pipeResponse(await api().logs(id, opts.since, opts.follow, opts.project)));

  command
    .command("export")
    .description("Export Linear issues to markdown")
    .option("--project <id>", "project id")
    .option("--out <dir>", "output directory")
    .action(async (opts) => printJson(await api().export(opts.project, opts.out)));

  command
    .command("tick")
    .description("Force one orchestrator poll tick")
    .option("--project <id>", "project id")
    .action(async (opts) => printJson(await api().tick(opts.project)));
}

export { OrchestratorApiClient } from "./client.js";
export { initWorkflow, workflowTemplate };
