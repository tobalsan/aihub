const SUBAGENT_TOOL_DOC = [
  "You can spawn subagents:",
  "- subagent.spawn { projectId, slug, cli, prompt, mode?, baseBranch? }",
  "- subagent.status { projectId, slug }",
  "- subagent.logs { projectId, slug, since }",
  "- subagent.interrupt { projectId, slug }",
].join("\n");

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
