export function normalizeProjectStatus(raw?: string): string {
  if (!raw) return "maybe";
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

export function buildProjectSummary(
  title: string,
  status: string,
  path: string,
  content: string
): string {
  return [
    "Let's tackle the following project:",
    "",
    title,
    status,
    "## Project Documentation",
    `Path: ${path}`,
    "(Read-only context: README, SPECS.md, docs. Do NOT implement code here.)",
    content,
  ]
    .join("\n")
    .trimEnd();
}

export function buildStartPrompt(summary: string): string {
  return summary;
}

export type RalphPromptTemplateVars = {
  PROJECT_FILE: string;
  SCOPES_FILE: string;
  PROGRESS_FILE: string;
  SOURCE_DIR: string;
};

export type PromptRole = "coordinator" | "worker" | "reviewer" | "legacy";

export type WorkerWorkspaceRef = {
  name: string;
  cli?: string;
  path: string;
};

export type RolePromptInput = {
  role: PromptRole;
  title: string;
  status: string;
  path: string;
  projectId?: string;
  repo?: string;
  customPrompt?: string;
  runAgentLabel?: string;
  owner?: string;
  specsPath?: string;
  content?: string;
  projectFiles?: readonly string[];
  workerWorkspaces?: WorkerWorkspaceRef[];
  includeDefaultPrompt?: boolean;
  includePostRun?: boolean;
};

export function renderTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let output = template;
  for (const [key, value] of Object.entries(vars)) {
    output = output.split(`{{${key}}}`).join(value);
  }
  return output;
}

export function buildRalphPromptFromTemplate(input: {
  template: string;
  vars: Partial<RalphPromptTemplateVars>;
}): string {
  const requiredKeys: Array<keyof RalphPromptTemplateVars> = [
    "PROJECT_FILE",
    "SCOPES_FILE",
    "PROGRESS_FILE",
    "SOURCE_DIR",
  ];
  const missing = requiredKeys.filter((key) => {
    const value = input.vars[key];
    return typeof value !== "string" || value.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(`Missing required template vars: ${missing.join(", ")}`);
  }
  return renderTemplate(input.template, input.vars as Record<string, string>);
}

export function buildProjectStartPrompt(input: {
  title: string;
  status: string;
  path: string;
  content: string;
  specsPath: string;
  repo?: string;
  customPrompt?: string;
  runAgentLabel?: string;
}): string {
  const normalized = normalizeProjectStatus(input.status);
  const custom = input.customPrompt?.trim();
  let prompt =
    normalized === "shaping"
      ? custom || `/drill-specs ${input.specsPath}`
      : buildStartPrompt(
          buildProjectSummary(
            input.title,
            input.status,
            input.path,
            input.content
          )
        );
  if (normalized !== "shaping" && custom) {
    prompt = `${prompt}\n\n${custom}`;
  }
  const repo = input.repo?.trim();
  if (repo) {
    prompt = `${prompt}\n\n## Implementation Repository\nPath: ${repo}\n(This is your working directory. Implement all code changes here.)`;
  }
  const cliUsed = input.runAgentLabel?.trim() || "{cli_used}";
  prompt = `${prompt}\n\n## IMPORTANT: MUST DO AFTER IMPLEMENTATION\n\n- Run the test suite after changes\n- Run linter/formatter (if any)\n- Fix any failure/error before committing\n- Once everything is green, perform atomic commit(s)\n- Add a project comment using \`apm comment <project_id> --message "<your summary>" --author "${cliUsed}"\`. Write a clear summary of what you did — use paragraphs, newlines, and bullet points as appropriate for readability (don't force everything into bullets). Use \\n for newlines in the message string.\n- Move the project to review status using \`apm move <project_id> review --agent ${cliUsed}\`\n- When done, if project owner is \`Cloud\`, also run \`openclaw system event --text "Done: <your summary>" --mode now\``;
  return prompt;
}

function normalizeDocFilename(name: string): string {
  return name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
}

function sortProjectFiles(files: readonly string[]): string[] {
  return [...new Set(files)]
    .map((file) => file.trim())
    .filter((file) => file.length > 0)
    .sort((a, b) => {
      if (a.toUpperCase() === "README.MD") return -1;
      if (b.toUpperCase() === "README.MD") return 1;
      return a.localeCompare(b);
    });
}

function listProjectFileLinks(path: string, files: readonly string[]): string {
  const basePath = path.replace(/\/$/, "");
  const normalized = sortProjectFiles(files).map(normalizeDocFilename);
  return normalized.map((file) => `- [${file}](${basePath}/${file})`).join("\n");
}

function buildProjectFilesBlock(input: {
  title: string;
  status: string;
  path: string;
  projectFiles: readonly string[];
  repo?: string;
  includeRepo?: boolean;
}): string {
  const lines = [
    "Let's tackle the following project:",
    "",
    `Project: ${input.title}`,
    `Status: ${input.status || "unknown"}`,
    "",
    "## Project Files",
    listProjectFileLinks(input.path, input.projectFiles),
  ];
  if (input.includeRepo && input.repo?.trim()) {
    lines.push(
      "",
      "## Implementation Repository",
      `Path: ${input.repo.trim()}`,
      "(Implement code changes here.)"
    );
  }
  lines.push(
    "",
    "Use project files as source context. Keep changes scoped to requested work."
  );
  return lines.join("\n").trimEnd();
}

function postRunCommitBlock(): string {
  return [
    "- Run relevant tests after changes.",
    "- Run linter/formatter (if any).",
    "- Fix failures before finishing.",
  ].join("\n");
}

function postRunApmCommentBlock(projectId: string, agentLabel: string): string {
  return `- Add a project comment: \`apm comment ${projectId} --message "<your summary>" --author "${agentLabel}"\``;
}

function postRunMoveReviewBlock(projectId: string, agentLabel: string): string {
  return `- Move project to review: \`apm move ${projectId} review --agent ${agentLabel}\``;
}

function postRunNotifyCloudBlock(): string {
  return '- When done, if project owner is `Cloud`, also run `openclaw system event --text "Done: <your summary>" --mode now`';
}

function postRunUpdateSpecBlock(specsPath: string): string {
  return [
    `- Update task statuses in ${specsPath} as you complete them.`,
    "- Add blockers or discovered sub-tasks back into project docs.",
  ].join("\n");
}

function reviewerWorkspaceBlock(workspaces: WorkerWorkspaceRef[]): string {
  if (workspaces.length === 0) {
    return "## Active Worker Workspaces\nNo active worker workspaces found.";
  }
  const lines = workspaces.map(
    (item) => `- ${item.name} (${item.cli || "agent"}): ${item.path}`
  );
  return ["## Active Worker Workspaces", ...lines].join("\n");
}

function runAuthorLabel(input: RolePromptInput): string {
  return input.runAgentLabel?.trim() || "{cli_used}";
}

function runProjectId(input: RolePromptInput): string {
  return input.projectId?.trim() || "<project_id>";
}

function joinPromptParts(parts: Array<string | undefined | null>): string {
  return parts
    .map((part) => (part || "").trim())
    .filter((part) => part.length > 0)
    .join("\n\n")
    .trimEnd();
}

function roleDefaultPrompt(
  input: RolePromptInput,
  includeRepo: boolean
): string {
  const files =
    input.projectFiles && input.projectFiles.length > 0
      ? input.projectFiles
      : ["README.md", "THREAD.md"];
  return buildProjectFilesBlock({
    title: input.title,
    status: input.status,
    path: input.path,
    projectFiles: files,
    repo: input.repo,
    includeRepo,
  });
}

export function buildCoordinatorPrompt(input: RolePromptInput): string {
  const includeDefault = input.includeDefaultPrompt !== false;
  const includePostRun = input.includePostRun !== false;
  const projectId = runProjectId(input);
  const agentLabel = runAuthorLabel(input);
  const postRun = includePostRun
    ? [
        "## IMPORTANT: MUST DO AFTER IMPLEMENTATION",
        postRunUpdateSpecBlock(input.specsPath || `${input.path}/README.md`),
        postRunApmCommentBlock(projectId, agentLabel),
        postRunNotifyCloudBlock(),
      ].join("\n")
    : "";
  return joinPromptParts([
    includeDefault ? roleDefaultPrompt(input, false) : "",
    [
      "## Your Role: Coordinator",
      "You manage this project's execution. You do NOT implement code yourself.",
      "- Review the spec and break it into discrete tasks if needed",
      "- Delegate implementation to worker agents",
      "- Track progress and keep project docs updated",
      "- Verify acceptance criteria before signaling completion",
    ].join("\n"),
    postRun,
    input.customPrompt,
  ]);
}

export function buildWorkerPrompt(input: RolePromptInput): string {
  const includeDefault = input.includeDefaultPrompt !== false;
  const includePostRun = input.includePostRun !== false;
  const projectId = runProjectId(input);
  const agentLabel = runAuthorLabel(input);
  const postRun = includePostRun
    ? [
        "## IMPORTANT: MUST DO AFTER IMPLEMENTATION",
        postRunCommitBlock(),
        postRunApmCommentBlock(projectId, agentLabel),
      ].join("\n")
    : "";
  return joinPromptParts([
    includeDefault ? roleDefaultPrompt(input, true) : "",
    [
      "## Your Role: Worker",
      "Implement the assigned tasks in the repository workspace.",
    ].join("\n"),
    postRun,
    input.customPrompt,
  ]);
}

export function buildReviewerPrompt(input: RolePromptInput): string {
  const includeDefault = input.includeDefaultPrompt !== false;
  const includePostRun = input.includePostRun !== false;
  const projectId = runProjectId(input);
  const agentLabel = runAuthorLabel(input);
  const postRun = includePostRun
    ? [
        "## IMPORTANT: MUST DO AFTER REVIEW",
        postRunApmCommentBlock(projectId, agentLabel),
      ].join("\n")
    : "";
  return joinPromptParts([
    includeDefault ? roleDefaultPrompt(input, false) : "",
    [
      "## Your Role: Reviewer",
      "Review implementation done by worker agents.",
      "- Read code changes in each worker workspace",
      "- Run tests and verify spec alignment",
      "- Report findings and remaining issues clearly",
    ].join("\n"),
    reviewerWorkspaceBlock(input.workerWorkspaces ?? []),
    postRun,
    input.customPrompt,
  ]);
}

export function buildLegacyPrompt(input: RolePromptInput): string {
  return buildProjectStartPrompt({
    title: input.title,
    status: input.status,
    path: input.path,
    content: input.content || "",
    specsPath: input.specsPath || `${input.path}/README.md`,
    repo: input.repo,
    customPrompt: input.customPrompt,
    runAgentLabel: input.runAgentLabel,
  });
}

export function buildRolePrompt(input: RolePromptInput): string {
  switch (input.role) {
    case "coordinator":
      return buildCoordinatorPrompt(input);
    case "worker":
      return buildWorkerPrompt(input);
    case "reviewer":
      return buildReviewerPrompt(input);
    case "legacy":
    default:
      return buildLegacyPrompt(input);
  }
}
