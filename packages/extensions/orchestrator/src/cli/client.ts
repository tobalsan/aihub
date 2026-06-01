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
  runs(limit?: number, issue?: string) { return this.request("/runs", { query: { limit, issue } }); }
  run(issueId: string) { return this.request(`/runs/${encodeURIComponent(issueId)}`); }
  logs(issueId: string, since?: number, follow?: boolean) { return this.request(`/runs/${encodeURIComponent(issueId)}/logs`, { query: { since, follow }, raw: true }) as Promise<Response>; }
  workflow(repo?: string) { return this.request("/workflow", { query: { repo } }); }
  claim(issueId: string) { return this.request(`/issues/${encodeURIComponent(issueId)}/claim`, { method: "POST" }); }
  release(issueId: string) { return this.request(`/runs/${encodeURIComponent(issueId)}/release`, { method: "POST" }); }
  interrupt(issueId: string) { return this.request(`/runs/${encodeURIComponent(issueId)}/interrupt`, { method: "POST" }); }
  kill(issueId: string) { return this.request(`/runs/${encodeURIComponent(issueId)}/kill`, { method: "POST" }); }
  export(team?: string, out?: string) { return this.request("/export", { method: "POST", query: { team, out } }); }
  tick() { return this.request("/tick", { method: "POST" }); }
  events(runId: string) { return this.request(`/runs/${encodeURIComponent(runId)}`); }
}
