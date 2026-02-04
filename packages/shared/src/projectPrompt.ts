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

export function buildProjectStartPrompt(input: {
  title: string;
  status: string;
  path: string;
  content: string;
  specsPath: string;
  repo?: string;
  customPrompt?: string;
}): string {
  const normalized = normalizeProjectStatus(input.status);
  const custom = input.customPrompt?.trim();
  let prompt =
    normalized === "shaping"
      ? custom || `/drill-specs ${input.specsPath}`
      : buildStartPrompt(buildProjectSummary(input.title, input.status, input.path, input.content));
  if (normalized !== "shaping" && custom) {
    prompt = `${prompt}\n\n${custom}`;
  }
  const repo = input.repo?.trim();
  if (repo) {
    prompt = `${prompt}\n\n## Implementation Repository\nPath: ${repo}\n(This is your working directory. Implement all code changes here.)`;
  }
  return prompt;
}
