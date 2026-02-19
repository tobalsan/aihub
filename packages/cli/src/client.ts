import { resolveConfig } from "./config.js";

type HttpMethod = "GET" | "POST" | "PATCH";

type RequestOptions = {
  method?: HttpMethod;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

function buildQuery(
  query?: Record<string, string | number | boolean | undefined>
): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(config = resolveConfig()) {
    this.baseUrl = config.apiUrl;
    this.token = config.token;
  }

  async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const query = buildQuery(options.query);
    const url = new URL(`/api${path}${query}`, this.baseUrl).toString();
    const headers: Record<string, string> = {};

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error =
        typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof data.error === "string"
          ? data.error
          : "Request failed";
      throw new Error(error);
    }
    return data;
  }

  listProjects() {
    return this.request("/projects");
  }

  createProject(body: Record<string, unknown>) {
    return this.request("/projects", { method: "POST", body });
  }

  getProject(id: string) {
    return this.request(`/projects/${id}`);
  }

  updateProject(id: string, body: Record<string, unknown>) {
    return this.request(`/projects/${id}`, { method: "PATCH", body });
  }

  addComment(id: string, body: { author: string; message: string }) {
    return this.request(`/projects/${id}/comments`, { method: "POST", body });
  }

  startProject(id: string, body: Record<string, unknown>) {
    return this.request(`/projects/${id}/start`, { method: "POST", body });
  }

  listProjectSubagents(id: string) {
    return this.request(`/projects/${id}/subagents`);
  }

  spawnProjectSubagent(id: string, body: Record<string, unknown>) {
    return this.request(`/projects/${id}/subagents`, { method: "POST", body });
  }

  getAgentStatus(id: string) {
    return this.request(`/agents/${id}/status`);
  }

  getAgentHistory(id: string, sessionKey: string) {
    return this.request(`/agents/${id}/history`, {
      query: { sessionKey, view: "simple" },
    });
  }

  getSubagentLogs(id: string, slug: string) {
    return this.request(`/projects/${id}/subagents/${slug}/logs`, {
      query: { since: 0 },
    });
  }

  archiveProject(id: string) {
    return this.request(`/projects/${id}/archive`, { method: "POST" });
  }

  unarchiveProject(id: string) {
    return this.request(`/projects/${id}/unarchive`, { method: "POST" });
  }

  startRalphLoop(id: string, body: Record<string, unknown>) {
    return this.request(`/projects/${id}/ralph-loop`, { method: "POST", body });
  }

  listAgents() {
    return this.request("/agents");
  }
}
