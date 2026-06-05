import { API_BASE, apiFetch } from "./core";

export type OrchestratorHealth = {
  status: string;
  lastTickAt?: string;
  activeClaims?: number;
  rateLimitRemaining?: number;
};

export type OrchestratorProject = {
  id: string;
  path: string;
  workflowPath: string;
};

export type OrchestratorClaim = {
  projectId?: string;
  issueId: string;
  runId: string;
  identifier?: string;
  worker_id?: string;
  workerId?: string;
  worker_status?: string;
  workerStatus?: string;
  claimedAt?: string;
  lastEventAt?: string;
  [key: string]: unknown;
};

export type OrchestratorRun = {
  project_id?: string;
  projectId?: string;
  run_id?: string;
  runId?: string;
  worker_id?: string;
  workerId?: string;
  issue_id?: string;
  issueId?: string;
  identifier?: string;
  workspace?: string;
  started_at?: string;
  startedAt?: string;
  finished_at?: string | null;
  finishedAt?: string | null;
  outcome?: string | null;
  exit_code?: number | null;
  exitCode?: number | null;
  [key: string]: unknown;
};

export type OrchestratorEvent = {
  id?: number;
  project_id?: string;
  run_id?: string;
  type?: string;
  payload?: string;
  created_at?: string;
  [key: string]: unknown;
};

export type OrchestratorRunDetail = {
  claim?: OrchestratorClaim;
  run?: OrchestratorRun;
  events?: OrchestratorEvent[];
};

export type OrchestratorLogEvent = {
  type?: string;
  text?: string;
  timestamp?: string;
  [key: string]: unknown;
};

export type OrchestratorLogsResponse = {
  cursor: number;
  events: OrchestratorLogEvent[];
};

export type OrchestratorRunsResponse = {
  active: OrchestratorClaim[];
  recent: OrchestratorRun[];
};

export type OrchestratorWorkflow = {
  frontmatter?: Record<string, unknown>;
  config?: Record<string, unknown>;
  body?: string;
  path?: string;
  sha?: string;
  [key: string]: unknown;
};

async function parseJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${response.status}`);
  return body;
}

function projectQuery(project?: string): string {
  return project ? `project=${encodeURIComponent(project)}` : "";
}

export async function fetchOrchestratorHealth(): Promise<OrchestratorHealth> {
  return parseJson(await apiFetch(`${API_BASE}/orchestrator/health`));
}

export async function fetchOrchestratorProjects(): Promise<{ items: OrchestratorProject[] }> {
  return parseJson(await apiFetch(`${API_BASE}/orchestrator/projects`));
}

export async function fetchOrchestratorRuns(limit = 50, project?: string): Promise<OrchestratorRunsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (project) params.set("project", project);
  return parseJson(await apiFetch(`${API_BASE}/orchestrator/runs?${params.toString()}`));
}

export async function fetchOrchestratorRun(runOrIssueId: string, since = 0, project?: string): Promise<OrchestratorRunDetail> {
  const params = new URLSearchParams({ since: String(since) });
  if (project) params.set("project", project);
  return parseJson(await apiFetch(`${API_BASE}/orchestrator/runs/${encodeURIComponent(runOrIssueId)}?${params.toString()}`));
}

export async function fetchOrchestratorLogs(runOrIssueId: string, since = 0, project?: string): Promise<OrchestratorLogsResponse> {
  const params = new URLSearchParams({ since: String(since) });
  if (project) params.set("project", project);
  return parseJson(await apiFetch(`${API_BASE}/orchestrator/runs/${encodeURIComponent(runOrIssueId)}/logs?${params.toString()}`));
}

export async function fetchOrchestratorWorkflow(project?: string): Promise<OrchestratorWorkflow> {
  const query = projectQuery(project);
  return parseJson(await apiFetch(`${API_BASE}/orchestrator/workflow${query ? `?${query}` : ""}`));
}

export async function interruptOrchestratorRun(issueId: string, project?: string): Promise<unknown> {
  const query = projectQuery(project);
  return parseJson(await apiFetch(`${API_BASE}/orchestrator/runs/${encodeURIComponent(issueId)}/interrupt${query ? `?${query}` : ""}`, { method: "POST" }));
}

export async function killOrchestratorRun(issueId: string, project?: string): Promise<unknown> {
  const query = projectQuery(project);
  return parseJson(await apiFetch(`${API_BASE}/orchestrator/runs/${encodeURIComponent(issueId)}/kill${query ? `?${query}` : ""}`, { method: "POST" }));
}
