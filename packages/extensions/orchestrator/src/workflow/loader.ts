import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { LinearIssue, RepoConfig, WorkflowFrontmatter, WorkflowSnapshot } from "../types.js";

const FALLBACK_WORKFLOW_FILE = "WORKFLOW.md";

const DEFAULT = `---\ntracker:\n  states:\n    active: [Todo, In Progress]\n    terminal: [Done, Canceled]\n    needs_human: Needs Human\npolling:\n  interval_ms: 30000\n  jitter_ms: 5000\nagent:\n  profile: worker\n  max_concurrent: 3\n  stall_timeout_ms: 1800000\nlinear:\n  expose_graphql_tool: true\n---\n# Linear skill\nUse orchestrator.linear_graphql to comment, update status, and inspect Linear. Never ask for LINEAR_API_KEY.\n`;

function merge(a: any, b: any): any {
  if (!b || typeof b !== "object" || Array.isArray(b)) return b ?? a;
  const out = { ...(a && typeof a === "object" && !Array.isArray(a) ? a : {}) };
  for (const [key, value] of Object.entries(b)) out[key] = merge(out[key], value);
  return out;
}

function parse(content: string): { frontmatter: WorkflowFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  return { frontmatter: (yaml.load(match[1] ?? "") as WorkflowFrontmatter) ?? {}, body: match[2] ?? "" };
}

function render(template: string, ctx: { issue?: LinearIssue; repo?: RepoConfig | null; run?: Record<string, unknown> }): string {
  return template.replace(/{{\s*([a-z]+)\.([A-Za-z0-9_]+)\s*}}/g, (_all, group, key) => {
    const source = group === "issue" ? ctx.issue : group === "repo" ? ctx.repo : ctx.run;
    const value = source ? (source as Record<string, unknown>)[key] : undefined;
    return Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
  });
}

export class WorkflowLoader {
  constructor(private readonly home: string, private readonly repos: Record<string, RepoConfig> = {}) {}

  async ensureDefault(): Promise<string> {
    const file = path.join(this.home, FALLBACK_WORKFLOW_FILE);
    try { await fs.access(file); } catch { await fs.mkdir(this.home, { recursive: true }); await fs.writeFile(file, DEFAULT); }
    return file;
  }

  watch(onChange: (event: { path: string }) => void): { close: () => void } {
    const watchers: fsSync.FSWatcher[] = [];
    const files = [path.join(this.home, FALLBACK_WORKFLOW_FILE), ...Object.values(this.repos).map((repo) => path.join(repo.path, "WORKFLOW.md"))];
    for (const file of files) {
      try {
        watchers.push(fsSync.watch(file, { persistent: false }, () => onChange({ path: file })));
      } catch {
        // File may not exist yet. Poll parent mtime cheaply as fallback.
        const dir = path.dirname(file);
        try {
          watchers.push(fsSync.watch(dir, { persistent: false }, (_event, name) => {
            if (name?.toString() === path.basename(file)) onChange({ path: file });
          }));
        } catch {}
      }
    }
    return { close: () => watchers.forEach((watcher) => watcher.close()) };
  }

  async resolve(input: { repo?: string; issue?: LinearIssue; run?: Record<string, unknown> } = {}): Promise<WorkflowSnapshot> {
    const fallbackPath = await this.ensureDefault();
    const fallback = parse(await fs.readFile(fallbackPath, "utf8"));
    const repo = input.repo ? this.repos[input.repo] : undefined;
    let filePath = fallbackPath;
    let merged = fallback.frontmatter;
    let body = fallback.body;
    if (repo) {
      const repoPath = path.join(repo.path, "WORKFLOW.md");
      try {
        const local = parse(await fs.readFile(repoPath, "utf8"));
        filePath = repoPath;
        merged = merge(fallback.frontmatter, local.frontmatter);
        body = local.body;
      } catch {}
    }
    const rendered = render(body, { issue: input.issue, repo, run: input.run });
    const sha = crypto.createHash("sha256").update(JSON.stringify(merged)).update(rendered).digest("hex");
    return { path: filePath, sha, frontmatter: merged, body: rendered };
  }
}
