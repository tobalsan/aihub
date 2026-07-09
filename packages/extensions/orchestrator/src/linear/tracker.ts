import type { TrackerClient, TrackerClientOptions, TrackerExportResult } from "../tracker/client.js";
import type { LinearTrackerConfig, TrackerIssue } from "../types.js";
import { LinearClient } from "./client.js";
import { exportLinear } from "../exporter/exporter.js";

export class LinearTracker implements TrackerClient {
  readonly kind = "linear" as const;
  readonly linearClient: LinearClient;

  constructor(private readonly config: LinearTrackerConfig, options: TrackerClientOptions = {}) {
    this.linearClient = new LinearClient(config.apiKey, { endpoint: config.endpoint, ...options });
  }

  get rateLimitRemaining(): number | undefined {
    return this.linearClient.rateLimitRemaining;
  }

  pollIssues(input: { states: string[] }): Promise<TrackerIssue[]> {
    return this.linearClient.pollIssues({ projectSlug: this.config.projectSlug, activeStates: input.states });
  }

  async getIssue(idOrIdentifier: string): Promise<TrackerIssue | undefined> {
    const issue = await this.linearClient.getIssue(idOrIdentifier);
    if (issue && issue.projectSlug && issue.projectSlug !== this.config.projectSlug) return undefined;
    return issue;
  }

  createComment(issueId: string, body: string): Promise<unknown> {
    return this.linearClient.commentCreate(issueId, body);
  }

  setIssueState(issueId: string, stateName: string): Promise<unknown> {
    return this.linearClient.issueUpdateStateByName(issueId, stateName);
  }

  export(input: { outDir: string }): Promise<TrackerExportResult> {
    return exportLinear({ client: this.linearClient, projectSlug: this.config.projectSlug, outDir: input.outDir });
  }
}

export function isRelevantLinearWebhook(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const action = String(record.action ?? "").toLowerCase();
  const type = String(record.type ?? "").toLowerCase();
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record;
  const hasIssue = Boolean(data.issue || data.issueId || data.identifier || data.id);
  const isIssueEvent = type.includes("issue") || action.includes("issue");
  const stateChanged = isIssueEvent && (action.includes("update") || action.includes("state") || "state" in data);
  const commentAdded = type.includes("comment") || action.includes("comment") || "comment" in data;
  return hasIssue && (stateChanged || commentAdded);
}
