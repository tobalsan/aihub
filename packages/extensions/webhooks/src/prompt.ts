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

  const workspaceRoot = path.resolve(workspaceDir);
  const promptPath = path.resolve(workspaceRoot, prompt);
  if (
    promptPath !== workspaceRoot &&
    !promptPath.startsWith(workspaceRoot + path.sep)
  ) {
    throw new Error("Webhook prompt path must stay within agent workspace");
  }

  return fs.readFile(promptPath, "utf8");
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
