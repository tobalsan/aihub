import fs from "node:fs/promises";
import path from "node:path";

export type CronRunOutputInput = {
  workspaceDir: string;
  jobId: string;
  agentId: string;
  sessionId: string;
  model?: { provider: string; model: string };
  runType: "cron" | "heartbeat";
  name: string;
  prompt: string;
  schedule?: string;
  firedAt: Date;
  finishedAt: Date;
  status: "ok" | "error";
  durationMs: number;
  response?: string;
  error?: unknown;
  resultStatus?: "ok" | "warn" | "error";
};

export async function writeCronRunOutput(
  input: CronRunOutputInput
): Promise<string> {
  const dir = path.join(input.workspaceDir, "cron", "output", input.jobId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${formatFileTimestamp(input.firedAt)}.md`);
  await fs.writeFile(filePath, renderCronRunOutput(input), "utf8");
  return filePath;
}

export function renderCronRunOutput(input: CronRunOutputInput): string {
  const title = input.runType === "heartbeat" ? "Heartbeat" : `Cron Job: ${input.name}`;
  const lines = [
    "---",
    `job_id: ${yamlString(input.jobId)}`,
    `agent_id: ${yamlString(input.agentId)}`,
    `session_id: ${yamlString(input.sessionId)}`,
    `run_type: ${input.runType}`,
    `fired_at: ${input.firedAt.toISOString()}`,
    `finished_at: ${input.finishedAt.toISOString()}`,
    `status: ${input.status}`,
    `duration_ms: ${input.durationMs}`,
  ];
  if (input.schedule) lines.push(`schedule: ${yamlString(input.schedule)}`);
  if (input.model) {
    lines.push("model:");
    lines.push(`  provider: ${yamlString(input.model.provider)}`);
    lines.push(`  name: ${yamlString(input.model.model)}`);
  }
  if (input.resultStatus) lines.push(`result_status: ${input.resultStatus}`);
  lines.push("---", "", `# ${title}`, "");
  lines.push(`**Job ID:** ${input.jobId}`);
  lines.push(`**Run Time:** ${formatDisplayTimestamp(input.firedAt)}`);
  if (input.schedule) lines.push(`**Schedule:** ${input.schedule}`);
  if (input.model) {
    lines.push(`**Model:** ${input.model.provider}/${input.model.model}`);
  }
  lines.push("", "## Prompt", "", input.prompt, "");
  if (input.status === "ok") {
    lines.push("## Response", "", input.response?.trim() || "[no response]");
  } else {
    lines.push("## Error", "", "```txt", formatError(input.error), "```");
  }
  lines.push("");
  return lines.join("\n");
}

export function latestAssistantText(payloads: Array<{ text?: string }>): string {
  for (let i = payloads.length - 1; i >= 0; i--) {
    const text = payloads[i]?.text?.trim();
    if (text) return text;
  }
  return "";
}

export function formatScheduleForOutput(schedule: {
  cron: string;
  tz: string;
  startAt?: string;
}): string {
  const base = `${schedule.cron} ${schedule.tz}`;
  return schedule.startAt ? `${base} @ ${schedule.startAt}` : base;
}

function formatFileTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
}

function formatDisplayTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
