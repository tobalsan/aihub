import { API_BASE, apiFetch } from "./core";

export type OrchestratorHealth = {
  status: string;
  lastTickAt?: string;
  rateLimitRemaining?: number;
  activeClaims?: number;
};

export type OrchestratorClaim = {
  issueId: string;
  runId: string;
  claimedAt?: string;
  [key: string]: unknown;
};

export type OrchestratorRun = {
  run_id?: string;
  runId?: string;
  issue_id?: string;
  issueId?: string;
  identifier?: string;
  workspace?: string;
  repo?: string;
  branch?: string;
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

export async function fetchOrchestratorHealth(): Promise<OrchestratorHealth> {
  return parseJson(await apiFetch(`${API_BASE}/orchestrator/health`));
}

export async function fetchOrchestratorRuns(limit = 50): Promise<OrchestratorRunsResponse> {
  return parseJson(await apiFetch(`${API_BASE}/orchestrator/runs?limit=${limit}`));
}

export async function fetchOrchestratorRun(runOrIssueId: string, since = 0): Promise<OrchestratorRunDetail> {
  return parseJson(
    await apiFetch(
      `${API_BASE}/orchestrator/runs/${encodeURIComponent(runOrIssueId)}?since=${encodeURIComponent(String(since))}`
    )
  );
}

export async function fetchOrchestratorLogs(runOrIssueId: string, since = 0): Promise<OrchestratorLogsResponse> {
  return parseJson(
    await apiFetch(
      `${API_BASE}/orchestrator/runs/${encodeURIComponent(runOrIssueId)}/logs?since=${encodeURIComponent(String(since))}`
    )
  );
}

export async function fetchOrchestratorWorkflow(repo?: string): Promise<OrchestratorWorkflow> {
  const query = repo ? `?repo=${encodeURIComponent(repo)}` : "";
  return parseJson(await apiFetch(`${API_BASE}/orchestrator/workflow${query}`));
}

export async function interruptOrchestratorRun(issueId: string): Promise<unknown> {
  return parseJson(
    await apiFetch(`${API_BASE}/orchestrator/runs/${encodeURIComponent(issueId)}/interrupt`, {
      method: "POST",
    })
  );
}

export async function killOrchestratorRun(issueId: string): Promise<unknown> {
  return parseJson(
    await apiFetch(`${API_BASE}/orchestrator/runs/${encodeURIComponent(issueId)}/kill`, {
      method: "POST",
    })
  );
}
