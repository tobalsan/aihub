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
  runAgentLabel?: string;
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
  const cliUsed = input.runAgentLabel?.trim() || "{cli_used}";
  prompt = `${prompt}\n\n## IMPORTANT: MUST DO AFTER IMPLEMENTATION\n\n- Run the test suite after changes\n- Run linter/formatter (if any)\n- Fix any failure/error before committing\n- Once everything is green, perform atomic commit(s)\n- Add a project comment using \`apm comment <project_id> --message "<your summary>" --author "${cliUsed}"\`\n- Move the project to review status using \`apm move <project_id> review --agent ${cliUsed}\`\n- When done, if project owner is \`Cloud\`, also run \`openclaw system event --text "Done: <your summary>" --mode now\``;
  return prompt;
}
