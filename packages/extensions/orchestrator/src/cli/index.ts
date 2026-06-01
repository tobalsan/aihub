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
    .command("runs")
    .description("List orchestrator runs")
    .option("--issue <id>", "filter by issue id")
    .option("--limit <n>", "limit recent rows", (value) => Number(value))
    .option("--json", "print raw JSON")
    .action(async (opts) => {
      const data = await api().runs(opts.limit, opts.issue);
      opts.json ? printJson(data) : console.log(renderRuns(data));
    });

  command
    .command("events <runId>")
    .description("Show run events")
    .action(async (runId) => printJson(await api().events(runId)));

  command
    .command("workflow")
    .description("Print resolved workflow")
    .option("--repo <name>", "repo name")
    .action(async (opts) => printJson(await api().workflow(opts.repo)));

  for (const verb of ["claim", "release", "interrupt", "kill"] as const) {
    command
      .command(`${verb} <issueId>`)
      .description(`${verb} issue/run`)
      .action(async (issueId) => printJson(await api()[verb](issueId)));
  }

  command
    .command("logs <id>")
    .description("Stream run logs")
    .option("--since <n>", "start offset", (value) => Number(value))
    .option("--follow", "follow logs")
    .action(async (id, opts) => pipeResponse(await api().logs(id, opts.since, opts.follow)));

  command
    .command("export")
    .description("Export Linear issues to markdown")
    .option("--team <key>", "Linear team key")
    .option("--out <dir>", "output directory")
    .action(async (opts) => printJson(await api().export(opts.team, opts.out)));

  command
    .command("tick")
    .description("Force one orchestrator poll tick")
    .action(async () => printJson(await api().tick()));
}

export { OrchestratorApiClient } from "./client.js";
