import type { RepoConfig } from "../types.js";

export type RepoResolution =
  | { repo: RepoConfig; warning?: string }
  | { repo: null; warning?: string };

export function resolveRepo(input: {
  labels: string[];
  repos?: Record<string, string | { path: string; baseBranch?: string }>;
  defaultRepo?: string;
}): RepoResolution {
  const repoLabels = input.labels
    .filter((label) => label.toLowerCase().startsWith("repo:"))
    .map((label) => label.slice(5).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const name = repoLabels[0] ?? input.defaultRepo;
  const warning = repoLabels.length > 1 ? `Multiple repo labels found; using repo:${name}` : undefined;
  if (!name) return { repo: null, warning };
  const raw = input.repos?.[name];
  if (!raw) return { repo: null, warning: warning ?? `Repo not configured: ${name}` };
  const repo = typeof raw === "string" ? { name, path: raw } : { name, ...raw };
  return { repo, warning };
}
