import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { expandPath, getDefaultConfigPath } from "@aihub/shared";
import { OrchestratorApiClient } from "./client.js";
import { LinearClient } from "../linear/client.js";

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
  const profileLine = input.profile ? `  profile: ${input.profile}\n` : "";
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
  runner: claude
${profileLine}  model: null
  max_concurrent: 3
---
You are working on Linear issue {{issue.identifier}}.

## DO THIS FIRST

1. Fetch Linear issue {{issue.identifier}}.
2. If current state is \`Todo\`, move it to \`In Progress\`.
3. Add or update one Linear comment signaling you are working on the issue.
4. Continue only after those Linear updates succeed.

Do not perform task work before this claim step.

## Workspace Rule

Work only inside the issue workspace. If repositories are needed, clone or use them inside this workspace unless hooks prepared them already.

## Linear Workflow

Update Linear with concise progress, validation results, and final handoff. Keep one Linear comment updated instead of creating a noisy comment stream.

When the work is complete and validated, move the issue to \`In Review\`. If you are blocked, move the issue to \`Needs Human\` and update the comment with the blocker, what you tried, and the decision needed.

## Code Changes and Review Flow

If, and only if, you need to make code changes:

1. Create a worktree from the \`main\` branch and work there.
2. Spawn a reviewer subagent to run a code review.
3. Do not commit anything until the review comes back clean.
4. Once review is clean, commit inside the worktree, create a PR using \`gh\`, link the PR to the Linear issue, and move the issue to \`In Review\`.

## Golden Rule: Clarification Over Assumption

Ask rather than assume when requirements, ownership, or risk are unclear. Involve HITL by updating the Linear comment with the question or blocker and moving the issue to \`Needs Human\`.
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

function safeProjectName(name: string): string {
  const safe = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!safe) throw new Error("Project name must contain at least one letter or number");
  return safe;
}

async function pathExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true).catch(() => false);
}

type AihubConfigFile = {
  extensions?: {
    orchestrator?: {
      projectsRoot?: string;
      projects?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type LinearProjectBootstrapClient = Pick<LinearClient, "createProject" | "deleteProject" | "findProjectByName" | "inferProjectTeamIds">;

async function readAihubConfig(configPath = getDefaultConfigPath()): Promise<{ path: string; config: AihubConfigFile }> {
  try {
    return { path: configPath, config: JSON.parse(await fs.readFile(configPath, "utf8")) as AihubConfigFile };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: configPath, config: {} };
    throw error;
  }
}

function resolveProjectsRoot(config: AihubConfigFile): string {
  const root = config.extensions?.orchestrator?.projectsRoot?.trim() || "~/projects";
  return expandPath(root);
}

function projectRegistrationList(config: AihubConfigFile): { orchestrator: NonNullable<NonNullable<AihubConfigFile["extensions"]>["orchestrator"]>; projects: string[] } {
  config.extensions ??= {};
  config.extensions.orchestrator ??= {};
  const orchestrator = config.extensions.orchestrator;
  const projects = orchestrator.projects ?? [];
  if (!Array.isArray(projects)) throw new Error("extensions.orchestrator.projects must be an array before init-project can register a project");
  return { orchestrator, projects };
}

async function registerProject(configPath: string, config: AihubConfigFile, projectPath: string): Promise<void> {
  const { orchestrator, projects } = projectRegistrationList(config);
  if (!projects.includes(projectPath)) projects.push(projectPath);
  orchestrator.projects = projects;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function initProject(
  title: string,
  opts: { profile?: string; linearClient?: LinearProjectBootstrapClient; configPath?: string } = {}
): Promise<{ projectPath: string; workflowPath: string; linearProject: { id: string; name: string; slugId: string }; configPath: string }> {
  const projectName = title.trim();
  const { path: configPath, config } = await readAihubConfig(opts.configPath);
  const projectsRoot = resolveProjectsRoot(config);
  const projectPath = path.join(projectsRoot, safeProjectName(projectName));
  projectRegistrationList(config);
  if (await pathExists(projectPath)) throw new Error(`Project folder already exists: ${projectPath}`);
  await fs.mkdir(projectsRoot, { recursive: true });

  const apiKey = process.env.LINEAR_API_KEY?.trim();
  if (!apiKey && !opts.linearClient) throw new Error("Missing LINEAR_API_KEY for Linear project creation");
  const linear = opts.linearClient ?? new LinearClient(apiKey!);

  const duplicate = await linear.findProjectByName(projectName);
  if (duplicate) throw new Error(`Linear project already exists: ${duplicate.name} (${duplicate.slugId})`);

  const teamIds = await linear.inferProjectTeamIds();
  await fs.mkdir(projectPath, { recursive: false });
  let linearProject: { id: string; name: string; slugId: string } | undefined;
  try {
    linearProject = await linear.createProject({ name: projectName, teamIds });
    const workflowPath = await initWorkflow(projectPath, { projectSlug: linearProject.slugId, profile: opts.profile });
    await registerProject(configPath, config, projectPath);
    return { projectPath, workflowPath, linearProject, configPath };
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (linearProject) {
      await linear.deleteProject(linearProject.id).catch((rollbackError) => {
        rollbackErrors.push(`Linear rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      });
    }
    await fs.rm(projectPath, { recursive: true, force: true }).catch((rollbackError) => {
      rollbackErrors.push(`local rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    });
    if (rollbackErrors.length > 0) throw new Error(`${error instanceof Error ? error.message : String(error)} (${rollbackErrors.join("; ")})`);
    throw error;
  }
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
    .option("--profile <name>", "optional orchestrator profile")
    .option("--force", "overwrite existing WORKFLOW.md")
    .action(async (opts) => console.log(`Created ${await initWorkflow(opts.project, { projectSlug: opts.projectSlug, profile: opts.profile, force: opts.force })}`));

  command
    .command("init-project <name>")
    .description("Create a Linear project, local project folder, and WORKFLOW.md")
    .option("--profile <name>", "optional orchestrator profile")
    .action(async (name, opts) => {
      const result = await initProject(name, { profile: opts.profile });
      console.log([
        `Created Linear project ${result.linearProject.name} (${result.linearProject.slugId})`,
        `Created ${result.projectPath}`,
        `Created ${result.workflowPath}`,
        `Updated ${result.configPath}`,
        "Restart the gateway for the project registration to take effect.",
      ].join(os.EOL));
    });

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
export { initProject, initWorkflow, safeProjectName, workflowTemplate };
