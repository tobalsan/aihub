import type { PlaneTrackerConfig } from "../types.js";
import type { TrackerClientOptions } from "../tracker/client.js";
import { planeAuthHeaders } from "./auth.js";

export class PlaneHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Page<T> = { results?: T[]; next_cursor?: string; next_page_results?: boolean };

export class PlaneClient {
  rateLimitRemaining: number | undefined;
  rateLimitResetAt: number | undefined;
  private readonly apiRoot: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private projectCache: Promise<{ id: string; identifier: string; name: string }> | undefined;
  private statesCache: Promise<Array<{ id: string; name: string }>> | undefined;
  private mentionUserCache = new Map<string, Promise<string>>();

  constructor(private readonly config: PlaneTrackerConfig, options: TrackerClientOptions = {}) {
    this.apiRoot = `${config.baseUrl}/api/v1`;
    this.base = `${this.apiRoot}/workspaces/${config.workspaceSlug}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  async request<T = any>(method: string, path: string, body?: unknown): Promise<T | undefined> {
    await this.waitForBucket();
    return this.requestOnce<T>(method, path, body, true);
  }

  private async requestOnce<T>(method: string, path: string, body: unknown, retry429: boolean): Promise<T | undefined> {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...planeAuthHeaders({ kind: this.config.authKind, token: this.config.apiKey }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.updateRateLimit(response.headers);
    if (response.status === 429 && retry429) {
      await this.sleep(this.retryDelayMs());
      return this.requestOnce<T>(method, path, body, false);
    }
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!response.ok) throw new PlaneHttpError(response.status, `Plane ${method} ${path} failed: ${response.status} ${text}`);
    return text ? (JSON.parse(text) as T) : undefined;
  }

  async getMaybe<T = any>(path: string): Promise<T | undefined> {
    try {
      return await this.request<T>("GET", path);
    } catch (error) {
      if (error instanceof PlaneHttpError && error.status === 404) return undefined;
      throw error;
    }
  }

  async listPaginated<T = any>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const results: T[] = [];
    let cursor: string | undefined;
    while (true) {
      const query = new URLSearchParams({ per_page: "100", ...params });
      if (cursor) query.set("cursor", cursor);
      const sep = path.includes("?") ? "&" : "?";
      const page = await this.request<Page<T>>("GET", `${path}${sep}${query.toString()}`);
      if (!page) break;
      results.push(...(page.results ?? []));
      if (page.next_page_results && page.next_cursor) cursor = page.next_cursor;
      else break;
    }
    return results;
  }

  project(): Promise<{ id: string; identifier: string; name: string }> {
    return (this.projectCache ??= this.request<any>("GET", `/projects/${this.config.projectId}/`).then((p) => ({
      id: p.id,
      identifier: p.identifier,
      name: p.name,
    })));
  }

  states(): Promise<Array<{ id: string; name: string }>> {
    return (this.statesCache ??= this.listPaginated<any>(`/projects/${this.config.projectId}/states/`).then((rows) =>
      rows.map((state) => ({ id: state.id, name: state.name }))
    ));
  }

  resolveMentionUserId(displayName: string): Promise<string> {
    const key = displayName.trim().toLowerCase();
    return (this.mentionUserCache.get(key) ?? this.cacheMentionUserId(key, displayName));
  }

  private cacheMentionUserId(key: string, displayName: string): Promise<string> {
    const promise = this.request<any[]>("GET", "/members/").then((rows) => {
      const matches = (rows ?? []).filter((row) => String(row.display_name ?? row.member?.display_name ?? "").toLowerCase().includes(key));
      if (matches.length === 0) throw new Error(`Plane bot mention target not found: ${displayName}`);
      if (matches.length > 1) throw new Error(`Plane bot mention target is ambiguous: ${displayName}`);
      const id = matches[0]?.id ?? matches[0]?.member?.id;
      if (!id || typeof id !== "string") throw new Error(`Plane bot mention target has no user id: ${displayName}`);
      return id;
    });
    this.mentionUserCache.set(key, promise);
    return promise;
  }

  private updateRateLimit(headers: Headers): void {
    const remaining = headers.get("x-ratelimit-remaining");
    if (remaining !== null) this.rateLimitRemaining = Number(remaining);
    const reset = headers.get("x-ratelimit-reset");
    if (reset !== null) {
      const value = Number(reset);
      this.rateLimitResetAt = value > 10_000_000_000 ? value : value * 1000;
    }
  }

  private retryDelayMs(): number {
    if (!this.rateLimitResetAt) return 1_000;
    return Math.max(1_000, this.rateLimitResetAt - this.now() + 1_000);
  }

  private async waitForBucket(): Promise<void> {
    if (this.rateLimitRemaining !== undefined && this.rateLimitRemaining <= 0) await this.sleep(this.retryDelayMs());
  }
}
