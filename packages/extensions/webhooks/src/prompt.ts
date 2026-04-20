import fs from "node:fs/promises";
import path from "node:path";

export type WebhookPromptVariables = {
  originUrl: string;
  headers: Record<string, string>;
  payload: string;
};

const PROMPT_FILE_EXTENSIONS = new Set([".md", ".txt"]);

export async function resolveWebhookPrompt(
  prompt: string,
  workspaceDir: string
): Promise<string> {
  const ext = path.extname(prompt).toLowerCase();
  if (!PROMPT_FILE_EXTENSIONS.has(ext)) return prompt;

  return fs.readFile(path.resolve(workspaceDir, prompt), "utf8");
}

export function interpolateWebhookPrompt(
  prompt: string,
  variables: WebhookPromptVariables
): string {
  return prompt
    .replaceAll("$WEBHOOK_ORIGIN_URL", variables.originUrl)
    .replaceAll("$WEBHOOK_HEADERS", JSON.stringify(variables.headers))
    .replaceAll("$WEBHOOK_PAYLOAD", variables.payload);
}
