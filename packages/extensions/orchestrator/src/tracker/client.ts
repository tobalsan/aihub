import type { TrackerConfig, TrackerIssue } from "../types.js";
import { LinearTracker, isRelevantLinearWebhook } from "../linear/tracker.js";
import { PlaneTracker, isRelevantPlaneWebhook } from "../plane/tracker.js";

export type TrackerExportResult = { exported: number; skipped: number; durationMs: number };

/** Minimal daemon/CLI-facing tracker contract. A client instance is scoped to one
 * orchestrator project's tracker config; all polling/lookup respects that scope. */
export interface TrackerClient {
  readonly kind: TrackerConfig["kind"];
  /** Remaining request budget as reported by the tracker's last response; undefined until first call. */
  rateLimitRemaining: number | undefined;
  /** All issues in the configured scope whose state name is in `states`. */
  pollIssues(input: { states: string[] }): Promise<TrackerIssue[]>;
  /** Fetch one issue by opaque id or human identifier (e.g. "ENG-1"). Returns undefined
   * when not found OR when the issue is outside the configured scope. */
  getIssue(idOrIdentifier: string): Promise<TrackerIssue | undefined>;
  createComment(issueId: string, body: string): Promise<unknown>;
  /** Move issue to the state with this exact name; throws if the state does not exist. */
  setIssueState(issueId: string, stateName: string): Promise<unknown>;
  /** Full-fidelity export of every issue in scope (+comments) as markdown files into outDir. */
  export(input: { outDir: string }): Promise<TrackerExportResult>;
}

export type TrackerClientOptions = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number };
export type TrackerClientFactory = (input: { config: TrackerConfig }) => TrackerClient;

export function createTrackerClient(config: TrackerConfig, options?: TrackerClientOptions): TrackerClient {
  switch (config.kind) {
    case "linear":
      return new LinearTracker(config, options);
    case "plane":
      return new PlaneTracker(config, options);
  }
}

/** Uniqueness/scoping key for one orchestrator project's tracker scope. */
export function trackerScopeKey(config: TrackerConfig): string {
  if (config.kind === "linear") return `linear:${config.projectSlug}`;
  return `plane:${config.workspaceSlug}/${config.projectId}${config.moduleId ? `/${config.moduleId}` : ""}`;
}

/** Pure per-kind webhook payload relevance (used by the webhook route without a client). */
export function isRelevantTrackerWebhook(kind: TrackerConfig["kind"], payload: unknown): boolean {
  if (kind === "linear") return isRelevantLinearWebhook(payload);
  return isRelevantPlaneWebhook(payload);
}
