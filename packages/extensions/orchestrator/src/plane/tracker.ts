import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { TrackerClient, TrackerClientOptions, TrackerExportResult } from "../tracker/client.js";
import type { PlaneTrackerConfig, TrackerIssue } from "../types.js";
import { PlaneClient } from "./client.js";

const IDENTIFIER_RE = /^[A-Z][A-Z0-9]*-\d+$/;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export class PlaneTracker implements TrackerClient {
  readonly kind = "plane" as const;
  readonly client: PlaneClient;

  constructor(private readonly config: PlaneTrackerConfig, options: TrackerClientOptions = {}) {
    this.client = new PlaneClient(config, options);
  }

  get rateLimitRemaining(): number | undefined {
    return this.client.rateLimitRemaining;
  }

  private issuesPath(): string {
    return this.config.moduleId
      ? `/projects/${this.config.projectId}/modules/${this.config.moduleId}/module-issues/`
      : `/projects/${this.config.projectId}/work-items/`;
  }

  private mapIssue(raw: any, project: { identifier: string; name: string }, stateNameById: Map<string, string>): TrackerIssue {
    const host = new URL(this.config.baseUrl).host;
    const appBase = host === "api.plane.so" ? "https://app.plane.so" : this.config.baseUrl;
    const stateValue = raw.state;
    const state = stateValue && typeof stateValue === "object" ? stateValue.name ?? "" : stateNameById.get(stateValue) ?? "";
    return {
      id: raw.id,
      identifier: `${project.identifier}-${raw.sequence_id}`,
      title: raw.name,
      description: raw.description_stripped ?? null,
      priority: null,
      url: `${appBase}/${this.config.workspaceSlug}/projects/${this.config.projectId}/issues/${raw.id}`,
      state,
      labels: [],
      blocked_by: [],
      created_at: raw.created_at ?? null,
      updated_at: raw.updated_at ?? null,
      projectName: project.name,
      projectSlug: this.config.projectId,
      parentId: raw.parent ?? null,
    };
  }

  private async resolveBlocker(
    id: string,
    seed: Map<string, TrackerIssue>,
    stateNameById: Map<string, string>,
    project: { identifier: string }
  ): Promise<{ id: string; identifier: string | null; state: string | null }> {
    const found = seed.get(id);
    if (found) return { id: found.id, identifier: found.identifier, state: found.state };
    const raw = await this.client.getMaybe<any>(`/projects/${this.config.projectId}/work-items/${id}/`);
    if (!raw) return { id, identifier: null, state: null };
    return { id, identifier: `${project.identifier}-${raw.sequence_id}`, state: stateNameById.get(raw.state) ?? null };
  }

  private async enrichBlockedBy(
    issues: TrackerIssue[],
    seedList: TrackerIssue[],
    stateNameById: Map<string, string>,
    project: { identifier: string }
  ): Promise<void> {
    const seed = new Map(seedList.map((issue) => [issue.id, issue]));
    for (const issue of issues) {
      const relations = await this.client.request<{ blocked_by?: string[] }>(
        "GET",
        `/projects/${this.config.projectId}/work-items/${issue.id}/relations/`
      );
      const ids = relations?.blocked_by ?? [];
      issue.blocked_by = await Promise.all(ids.map((id) => this.resolveBlocker(id, seed, stateNameById, project)));
    }
  }

  private inModule(raw: any): boolean {
    const moduleId = this.config.moduleId;
    if (raw.module === moduleId) return true;
    return Array.isArray(raw.modules) && raw.modules.includes(moduleId);
  }

  async pollIssues(input: { states: string[] }): Promise<TrackerIssue[]> {
    const [project, stateList] = await Promise.all([this.client.project(), this.client.states()]);
    const stateNameById = new Map(stateList.map((state) => [state.id, state.name]));
    const userId = this.config.mention ? await this.client.resolveMentionUserId(this.config.mention) : undefined;
    let raws: any[] = await this.client.listPaginated<any>(this.issuesPath());
    if (userId) {
      raws = raws.filter((raw) => Array.isArray(raw.assignees) && raw.assignees.some((a: any) => a === userId || a?.id === userId));
    }
    const mapped = raws.map((raw) => this.mapIssue(raw, project, stateNameById));
    const active = mapped.filter((issue) => input.states.includes(issue.state));
    await this.enrichBlockedBy(active, mapped, stateNameById, project);
    return active;
  }

  async getIssue(idOrIdentifier: string): Promise<TrackerIssue | undefined> {
    const [project, stateList] = await Promise.all([this.client.project(), this.client.states()]);
    const stateNameById = new Map(stateList.map((state) => [state.id, state.name]));
    const raw = IDENTIFIER_RE.test(idOrIdentifier)
      ? await this.client.getMaybe<any>(`/work-items/${idOrIdentifier}/`)
      : await this.client.getMaybe<any>(`/projects/${this.config.projectId}/work-items/${idOrIdentifier}/`);
    if (!raw) return undefined;
    if (raw.project !== this.config.projectId) return undefined;
    if (this.config.moduleId && !this.inModule(raw)) return undefined;
    const issue = this.mapIssue(raw, project, stateNameById);
    await this.enrichBlockedBy([issue], [issue], stateNameById, project);
    return issue;
  }

  createComment(issueId: string, body: string): Promise<unknown> {
    const html = `<p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p>`;
    return this.client.request("POST", `/projects/${this.config.projectId}/work-items/${issueId}/comments/`, { comment_html: html });
  }

  async setIssueState(issueId: string, stateName: string): Promise<unknown> {
    const state = (await this.client.states()).find((item) => item.name === stateName);
    if (!state) throw new Error(`Plane state not found: ${stateName}`);
    return this.client.request("PATCH", `/projects/${this.config.projectId}/work-items/${issueId}/`, { state: state.id });
  }

  async export(input: { outDir: string }): Promise<TrackerExportResult> {
    const start = Date.now();
    const [project, stateList] = await Promise.all([this.client.project(), this.client.states()]);
    const stateNameById = new Map(stateList.map((state) => [state.id, state.name]));
    const raws = await this.client.listPaginated<any>(this.issuesPath());
    await fs.mkdir(input.outDir, { recursive: true });
    let exported = 0;
    for (const raw of raws) {
      const issue = this.mapIssue(raw, project, stateNameById);
      const comments = await this.client.listPaginated<any>(`/projects/${this.config.projectId}/work-items/${raw.id}/comments/`);
      const fm = {
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        state: issue.state,
        labels: issue.labels,
        project: issue.projectName,
        projectSlug: issue.projectSlug,
        parent: issue.parentId,
        assignee: null,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
      };
      const commentMd = comments
        .map((c) => `\n## Comment — ${c.created_at} — ${c.actor ?? c.created_by ?? "unknown"}\n\n${c.comment_stripped ?? c.comment_html ?? ""}`)
        .join("\n");
      const content = `---\n${yaml.dump(fm)}---\n\n${raw.description_stripped ?? ""}\n${commentMd}\n`;
      const file = path.join(input.outDir, `${issue.identifier}.md`);
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, content);
      await fs.rename(tmp, file);
      exported++;
    }
    return { exported, skipped: 0, durationMs: Date.now() - start };
  }
}

export function isRelevantPlaneWebhook(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const event = String(record.event ?? "").toLowerCase();
  const action = String(record.action ?? "").toLowerCase();
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record;
  const hasId = Boolean(data.id || data.issue);
  const isIssueEvent = event.includes("issue") || action.includes("issue");
  const isCommentEvent = event.includes("comment") || action.includes("comment") || "comment" in data;
  const issueChanged = isIssueEvent && (!action || action.includes("update") || action.includes("create") || action.includes("delete") || "state" in data);
  return hasId && (issueChanged || isCommentEvent);
}
