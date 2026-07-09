import { describe, expect, it, vi } from "vitest";
import { PlaneTracker, isRelevantPlaneWebhook } from "./tracker.js";
import type { PlaneTrackerConfig } from "../types.js";

const BASE_CONFIG: PlaneTrackerConfig = {
  kind: "plane",
  baseUrl: "https://api.plane.so",
  apiKey: "plane_key",
  authKind: "api_key",
  workspaceSlug: "my-ws",
  projectId: "proj-uuid",
  activeStates: ["Todo", "In Progress"],
  terminalStates: ["Done"],
  needsHuman: "Needs Human",
};

const PROJECT = { id: "proj-uuid", identifier: "PROJ", name: "Proj" };
const STATES = [
  { id: "s1", name: "Todo" },
  { id: "s2", name: "In Progress" },
  { id: "s3", name: "Done" },
];
const I1 = { id: "i1", sequence_id: 42, name: "First", state: "s1", project: "proj-uuid", description_stripped: "body", created_at: "t0", updated_at: "t1", parent: null };
const I2 = { id: "i2", sequence_id: 43, name: "Second", state: "s3", project: "proj-uuid" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Call = { path: string; method: string; query: string };

function mockFetch(handle: (path: string, method: string, url: URL) => Response | undefined): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ path: url.pathname, method, query: url.search });
    const response = handle(url.pathname, method, url);
    if (!response) throw new Error(`unexpected ${method} ${url.pathname}`);
    return response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function baseHandle(path: string): Response | undefined {
  if (path.endsWith("/projects/proj-uuid/states/")) return json({ results: STATES, next_page_results: false });
  if (path.endsWith("/projects/proj-uuid/")) return json(PROJECT);
  if (path.endsWith("/relations/")) return json({ blocked_by: [] });
  return undefined;
}

describe("PlaneTracker polling scope", () => {
  it("hits the project work-items endpoint in project scope", async () => {
    const { fetchImpl, calls } = mockFetch((path) => baseHandle(path) ?? (path.endsWith("/work-items/") ? json({ results: [I1, I2], next_page_results: false }) : undefined));
    const tracker = new PlaneTracker(BASE_CONFIG, { fetchImpl });
    const issues = await tracker.pollIssues({ states: ["Todo"] });
    expect(issues.map((issue) => issue.identifier)).toEqual(["PROJ-42"]);
    expect(calls.some((call) => call.path.endsWith("/projects/proj-uuid/work-items/"))).toBe(true);
    expect(calls.some((call) => call.path.includes("/module-issues/"))).toBe(false);
  });

  it("hits the module-issues endpoint in module scope", async () => {
    const { fetchImpl, calls } = mockFetch((path) => baseHandle(path) ?? (path.endsWith("/module-issues/") ? json({ results: [I1], next_page_results: false }) : undefined));
    const tracker = new PlaneTracker({ ...BASE_CONFIG, moduleId: "mod-uuid" }, { fetchImpl });
    const issues = await tracker.pollIssues({ states: ["Todo"] });
    expect(issues.map((issue) => issue.identifier)).toEqual(["PROJ-42"]);
    expect(calls.some((call) => call.path.endsWith("/projects/proj-uuid/modules/mod-uuid/module-issues/"))).toBe(true);
    expect(calls.some((call) => call.path.endsWith("/projects/proj-uuid/work-items/"))).toBe(false);
  });

  it("filters Plane polls to mentioned or assigned bot work items", async () => {
    const assignedI3 = { ...I1, id: "i3", sequence_id: 44, assignees: ["bot-uuid"] };
    const { fetchImpl, calls } = mockFetch((path, _method, url) => {
      const base = baseHandle(path);
      if (base) return base;
      if (path.endsWith("/members/")) return json([{ id: "bot-uuid", display_name: "Worker Agent", is_bot: true }]);
      if (!path.endsWith("/work-items/")) return undefined;
      return json({ results: [I1, I2, assignedI3], next_page_results: false });
    });
    const tracker = new PlaneTracker({ ...BASE_CONFIG, mention: "Worker Agent" }, { fetchImpl });
    const issues = await tracker.pollIssues({ states: ["Todo"] });
    await tracker.pollIssues({ states: ["Todo"] });

    expect(issues.map((issue) => issue.identifier)).toEqual(["PROJ-44"]);
    expect(calls.filter((call) => call.path.endsWith("/members/")).length).toBe(1);
    const membersCall = calls.find((call) => call.path.endsWith("/members/"));
    expect(membersCall?.query).toBe("");
    expect(calls.some((call) => call.query.includes("pql"))).toBe(false);
  });

  it("fails clearly when Plane mention target is ambiguous", async () => {
    const { fetchImpl } = mockFetch((path) => {
      const base = baseHandle(path);
      if (base) return base;
      if (path.endsWith("/members/")) return json([
        { id: "bot-1", display_name: "Worker Agent" },
        { id: "bot-2", display_name: "Worker Agent Backup" },
      ]);
      return undefined;
    });
    const tracker = new PlaneTracker({ ...BASE_CONFIG, mention: "Worker Agent" }, { fetchImpl });
    await expect(tracker.pollIssues({ states: ["Todo"] })).rejects.toThrow("Plane bot mention target is ambiguous: Worker Agent");
  });
});

describe("PlaneTracker mapping", () => {
  it("composes the human identifier from project identifier and sequence id", async () => {
    const { fetchImpl } = mockFetch((path) => baseHandle(path) ?? (path.endsWith("/work-items/") ? json({ results: [I1], next_page_results: false }) : undefined));
    const tracker = new PlaneTracker(BASE_CONFIG, { fetchImpl });
    const [issue] = await tracker.pollIssues({ states: ["Todo"] });
    expect(issue?.identifier).toBe("PROJ-42");
    expect(issue?.state).toBe("Todo");
    expect(issue?.projectSlug).toBe("proj-uuid");
    expect(issue?.url).toBe("https://app.plane.so/my-ws/projects/proj-uuid/issues/i1");
  });

  it("maps blocked_by relations, resolving state from the polled page", async () => {
    const blocker = { ...I2, state: "s3" };
    const active = { ...I1, id: "i9", sequence_id: 44 };
    const { fetchImpl } = mockFetch((path) => {
      if (path.endsWith("/relations/")) return json({ blocked_by: ["i2"] });
      return baseHandle(path) ?? (path.endsWith("/work-items/") ? json({ results: [active, blocker], next_page_results: false }) : undefined);
    });
    const tracker = new PlaneTracker(BASE_CONFIG, { fetchImpl });
    const [issue] = await tracker.pollIssues({ states: ["Todo"] });
    expect(issue?.blocked_by).toEqual([{ id: "i2", identifier: "PROJ-43", state: "Done" }]);
  });
});

describe("PlaneTracker caching", () => {
  it("fetches project and states once per instance", async () => {
    const { fetchImpl, calls } = mockFetch((path) => baseHandle(path) ?? (path.endsWith("/work-items/") ? json({ results: [], next_page_results: false }) : undefined));
    const tracker = new PlaneTracker(BASE_CONFIG, { fetchImpl });
    await tracker.pollIssues({ states: ["Todo"] });
    await tracker.pollIssues({ states: ["Todo"] });
    expect(calls.filter((call) => call.path.endsWith("/projects/proj-uuid/states/")).length).toBe(1);
    expect(calls.filter((call) => call.path.endsWith("/projects/proj-uuid/")).length).toBe(1);
  });

  it("resolves and reuses cached states for setIssueState", async () => {
    const { fetchImpl, calls } = mockFetch((path, method) => {
      if (method === "PATCH" && path.endsWith("/work-items/i1/")) return json({ id: "i1" });
      return baseHandle(path);
    });
    const tracker = new PlaneTracker(BASE_CONFIG, { fetchImpl });
    await tracker.setIssueState("i1", "In Progress");
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.path).toBe("/api/v1/workspaces/my-ws/projects/proj-uuid/work-items/i1/");
    await expect(tracker.setIssueState("i1", "Nope")).rejects.toThrow("Plane state not found: Nope");
    expect(calls.filter((call) => call.path.endsWith("/projects/proj-uuid/states/")).length).toBe(1);
  });
});

describe("PlaneTracker pagination", () => {
  it("follows the cursor across pages", async () => {
    const { fetchImpl, calls } = mockFetch((path, _method, url) => {
      const base = baseHandle(path);
      if (base) return base;
      if (!path.endsWith("/work-items/")) return undefined;
      return url.searchParams.get("cursor") === "100:1:0"
        ? json({ results: [I2], next_page_results: false })
        : json({ results: [I1], next_page_results: true, next_cursor: "100:1:0" });
    });
    const tracker = new PlaneTracker(BASE_CONFIG, { fetchImpl });
    const issues = await tracker.pollIssues({ states: ["Todo", "Done"] });
    expect(issues.map((issue) => issue.identifier)).toEqual(["PROJ-42", "PROJ-43"]);
    expect(calls.some((call) => call.path.endsWith("/work-items/") && call.query.includes("cursor=100"))).toBe(true);
  });
});

describe("PlaneTracker getIssue", () => {
  it("returns undefined on a 404 by opaque id", async () => {
    const { fetchImpl } = mockFetch((path) => baseHandle(path) ?? (path.endsWith("/work-items/missing/") ? json({ error: "not found" }, 404) : undefined));
    const tracker = new PlaneTracker(BASE_CONFIG, { fetchImpl });
    expect(await tracker.getIssue("missing")).toBeUndefined();
  });

  it("fetches by human identifier and returns the issue", async () => {
    const { fetchImpl, calls } = mockFetch((path) => baseHandle(path) ?? (path.endsWith("/work-items/PROJ-42/") ? json(I1) : undefined));
    const tracker = new PlaneTracker(BASE_CONFIG, { fetchImpl });
    const issue = await tracker.getIssue("PROJ-42");
    expect(issue?.identifier).toBe("PROJ-42");
    expect(calls.some((call) => call.path === "/api/v1/workspaces/my-ws/work-items/PROJ-42/")).toBe(true);
  });

  it("returns undefined when the issue belongs to another project scope", async () => {
    const { fetchImpl } = mockFetch((path) => baseHandle(path) ?? (path.endsWith("/work-items/i1/") ? json({ ...I1, project: "other-project" }) : undefined));
    const tracker = new PlaneTracker(BASE_CONFIG, { fetchImpl });
    expect(await tracker.getIssue("i1")).toBeUndefined();
  });

  it("returns undefined when the issue is outside the configured module", async () => {
    const { fetchImpl } = mockFetch((path) => baseHandle(path) ?? (path.endsWith("/work-items/i1/") ? json({ ...I1, module: "other-module" }) : undefined));
    const tracker = new PlaneTracker({ ...BASE_CONFIG, moduleId: "mod-uuid" }, { fetchImpl });
    expect(await tracker.getIssue("i1")).toBeUndefined();
  });
});

describe("isRelevantPlaneWebhook", () => {
  it("accepts issue updates and comment events, rejects unrelated payloads", () => {
    expect(isRelevantPlaneWebhook({ event: "issue", action: "update", data: { id: "i1", state: "s1" } })).toBe(true);
    expect(isRelevantPlaneWebhook({ event: "issue_comment", action: "create", data: { id: "c1", issue: "i1" } })).toBe(true);
    expect(isRelevantPlaneWebhook({ event: "issue", action: "delete", data: { id: "i1" } })).toBe(true);
    expect(isRelevantPlaneWebhook({ event: "project", action: "update", data: { id: "p1" } })).toBe(false);
    expect(isRelevantPlaneWebhook({ event: "issue", action: "update", data: {} })).toBe(false);
    expect(isRelevantPlaneWebhook(null)).toBe(false);
  });
});
