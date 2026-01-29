const SUBAGENT_TOOL_DOC = [
  "You can spawn subagents:",
  "- subagent.spawn { projectId, slug, cli, prompt, mode?, baseBranch? }",
  "- subagent.status { projectId, slug }",
  "- subagent.logs { projectId, slug, since }",
  "- subagent.interrupt { projectId, slug }",
].join("\n");

export function normalizeProjectStatus(raw?: string): string {
  if (!raw) return "maybe";
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

export function buildProjectSummary(title: string, status: string, path: string, content: string): string {
  return [
    "Let's tackle the following project:",
    "",
    title,
    status,
    `Project folder: ${path}`,
    content,
  ]
    .join("\n")
    .trimEnd();
}

export function buildStartPrompt(summary: string): string {
  if (!summary) return SUBAGENT_TOOL_DOC;
  return `${summary}\n\n${SUBAGENT_TOOL_DOC}`;
}

export function buildProjectStartPrompt(input: {
  title: string;
  status: string;
  path: string;
  content: string;
  readmePath: string;
  repo?: string;
  customPrompt?: string;
}): string {
  const normalized = normalizeProjectStatus(input.status);
  let prompt =
    normalized === "shaping"
      ? `/drill-specs ${input.readmePath}`
      : buildStartPrompt(buildProjectSummary(input.title, input.status, input.path, input.content));
  const custom = input.customPrompt?.trim();
  if (normalized !== "shaping" && custom) {
    prompt = `${prompt}\n\n${custom}`;
  }
  const repo = input.repo?.trim();
  if (repo) {
    prompt = `${prompt}\n\nRepo path: ${repo}`;
  }
  return prompt;
}

