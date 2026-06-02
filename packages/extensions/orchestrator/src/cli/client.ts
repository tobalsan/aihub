import { resolveConfig } from "./config.js";

type RequestOptions = {
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  raw?: boolean;
};

function queryString(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export class OrchestratorApiClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(config = resolveConfig(), private readonly fetchImpl: typeof fetch = fetch) {
    this.baseUrl = config.apiUrl;
    this.token = config.token;
  }

  async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const url = new URL(`/api/orchestrator${path}${queryString(options.query)}`, this.baseUrl).toString();
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await this.fetchImpl(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (options.raw) return response;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string" ? data.error : "Request failed";
      throw new Error(error);
    }
    return data;
  }

  health() { return this.request("/health"); }
  projects() { return this.request("/projects"); }
  runs(limit?: number, issue?: string, project?: string) { return this.request("/runs", { query: { limit, issue, project } }); }
  run(issueId: string, project?: string) { return this.request(`/runs/${encodeURIComponent(issueId)}`, { query: { project } }); }
  logs(issueId: string, since?: number, follow?: boolean, project?: string) { return this.request(`/runs/${encodeURIComponent(issueId)}/logs`, { query: { since, follow, project }, raw: true }) as Promise<Response>; }
  workflow(project?: string) { return this.request("/workflow", { query: { project } }); }
  claim(issueId: string, project?: string) { return this.request(`/issues/${encodeURIComponent(issueId)}/claim`, { method: "POST", query: { project } }); }
  release(issueId: string, project?: string) { return this.request(`/runs/${encodeURIComponent(issueId)}/release`, { method: "POST", query: { project } }); }
  interrupt(issueId: string, project?: string) { return this.request(`/runs/${encodeURIComponent(issueId)}/interrupt`, { method: "POST", query: { project } }); }
  kill(issueId: string, project?: string) { return this.request(`/runs/${encodeURIComponent(issueId)}/kill`, { method: "POST", query: { project } }); }
  export(project?: string, out?: string) { return this.request("/export", { method: "POST", query: { project, out } }); }
  tick(project?: string) { return this.request("/tick", { method: "POST", query: { project } }); }
  events(runId: string, project?: string) { return this.request(`/runs/${encodeURIComponent(runId)}`, { query: { project } }); }
}
