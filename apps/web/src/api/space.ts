import type {
  CommitResult,
  ProjectBranchesResponse,
  ProjectChanges,
  ProjectPullRequestTarget,
  ProjectSpaceState,
  SpaceCommitSummary,
  SpaceContribution,
  SpaceLeaseState,
  SpaceWriteLease,
} from "./types";
import { API_BASE, apiFetch as fetch } from "./core";

export type ProjectBranchesResult =
  | { ok: true; data: ProjectBranchesResponse }
  | { ok: false; error: string };

export async function fetchProjectBranches(
  projectId: string
): Promise<ProjectBranchesResult> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/branches`);
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch branches" }));
    return { ok: false, error: data.error ?? "Failed to fetch branches" };
  }
  const data = (await res.json()) as ProjectBranchesResponse;
  return { ok: true, data };
}

export async function fetchProjectChanges(
  projectId: string
): Promise<ProjectChanges> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/changes`);
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch changes" }));
    throw new Error(data.error ?? "Failed to fetch changes");
  }
  return (await res.json()) as ProjectChanges;
}

export async function fetchProjectSpace(
  projectId: string
): Promise<ProjectSpaceState> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/space`);
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch project space" }));
    throw new Error(data.error ?? "Failed to fetch project space");
  }
  return (await res.json()) as ProjectSpaceState;
}

export async function integrateProjectSpace(
  projectId: string
): Promise<ProjectSpaceState> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/space/integrate`, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to integrate project space" }));
    throw new Error(data.error ?? "Failed to integrate project space");
  }
  return (await res.json()) as ProjectSpaceState;
}

export async function skipSpaceEntries(
  projectId: string,
  entryIds: string[]
): Promise<ProjectSpaceState> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/space/entries/skip`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryIds }),
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to skip space entries" }));
    throw new Error(data.error ?? "Failed to skip space entries");
  }
  return (await res.json()) as ProjectSpaceState;
}

export async function integrateSpaceEntries(
  projectId: string,
  entryIds: string[]
): Promise<ProjectSpaceState> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/space/entries/integrate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryIds }),
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to integrate space entries" }));
    throw new Error(data.error ?? "Failed to integrate space entries");
  }
  return (await res.json()) as ProjectSpaceState;
}

export async function rebaseSpaceOntoMain(
  projectId: string
): Promise<ProjectSpaceState> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/space/rebase`, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to rebase project space" }));
    throw new Error(data.error ?? "Failed to rebase project space");
  }
  return (await res.json()) as ProjectSpaceState;
}

export type MergeSpaceIntoMainResult = {
  sha?: string;
  commitSha?: string;
  mergedCommitSha?: string;
  cleanupSummary?: string;
  message?: string;
  cleanup?: {
    summary?: string;
    errors?: string[];
    removedWorktrees?: string[];
    removedBranches?: string[];
  };
};

type MergeSpaceApiResponse = {
  merge?: {
    afterSha?: string;
    cleanup?: MergeSpaceCleanupPayload;
  };
} & MergeSpaceIntoMainResult;

type MergeSpaceCleanupPayload = {
  workerWorktreesRemoved?: number;
  workerBranchesDeleted?: number;
  spaceWorktreeRemoved?: boolean;
  spaceBranchDeleted?: boolean;
  errors?: string[];
};

function buildCleanupSummary(
  cleanup?: MergeSpaceCleanupPayload
): string | undefined {
  if (!cleanup) return undefined;
  const parts: string[] = [];
  if (typeof cleanup.workerWorktreesRemoved === "number") {
    parts.push(`worktrees removed: ${cleanup.workerWorktreesRemoved}`);
  }
  if (typeof cleanup.workerBranchesDeleted === "number") {
    parts.push(`branches deleted: ${cleanup.workerBranchesDeleted}`);
  }
  if (cleanup.spaceWorktreeRemoved) parts.push("space worktree removed");
  if (cleanup.spaceBranchDeleted) parts.push("space branch deleted");
  return parts.length > 0 ? parts.join(", ") : undefined;
}

export async function mergeSpaceIntoMain(
  projectId: string,
  input: { cleanup?: boolean } = {}
): Promise<MergeSpaceIntoMainResult> {
  const cleanup = input.cleanup ?? true;
  const res = await fetch(`${API_BASE}/projects/${projectId}/space/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cleanup }),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to merge space into main" }));
    throw new Error(data.error ?? "Failed to merge space into main");
  }
  const data = (await res.json()) as MergeSpaceApiResponse;
  const mergedCommitSha =
    data.mergedCommitSha ?? data.commitSha ?? data.sha ?? data.merge?.afterSha;
  return {
    ...data,
    mergedCommitSha,
    cleanupSummary:
      data.cleanupSummary ?? buildCleanupSummary(data.merge?.cleanup),
    cleanup:
      data.cleanup ??
      (data.merge?.cleanup
        ? {
            errors: data.merge.cleanup.errors,
          }
        : undefined),
  };
}

export async function fetchProjectSpaceCommits(
  projectId: string,
  limit = 20
): Promise<SpaceCommitSummary[]> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/space/commits?limit=${limit}`
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch space commits" }));
    throw new Error(data.error ?? "Failed to fetch space commits");
  }
  const data = (await res.json()) as { commits?: SpaceCommitSummary[] };
  return data.commits ?? [];
}

export async function fetchProjectSpaceContribution(
  projectId: string,
  entryId: string
): Promise<SpaceContribution> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/space/contributions/${encodeURIComponent(entryId)}`
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch space contribution" }));
    throw new Error(data.error ?? "Failed to fetch space contribution");
  }
  return (await res.json()) as SpaceContribution;
}

export async function fixSpaceConflict(
  projectId: string,
  entryId: string
): Promise<{ entryId: string; slug: string }> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/space/conflicts/${encodeURIComponent(entryId)}/fix`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fix space conflict" }));
    throw new Error(data.error ?? "Failed to fix space conflict");
  }
  return (await res.json()) as { entryId: string; slug: string };
}

export async function fixSpaceRebaseConflict(
  projectId: string
): Promise<{ slug: string }> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/space/rebase/fix`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fix space rebase conflict" }));
    throw new Error(data.error ?? "Failed to fix space rebase conflict");
  }
  return (await res.json()) as { slug: string };
}

export async function fetchProjectSpaceLease(
  projectId: string
): Promise<SpaceLeaseState> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/space/lease`);
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch space lease" }));
    throw new Error(data.error ?? "Failed to fetch space lease");
  }
  return (await res.json()) as SpaceLeaseState;
}

export async function acquireProjectSpaceLease(
  projectId: string,
  input: { holder: string; ttlSeconds?: number; force?: boolean }
): Promise<SpaceWriteLease | null> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/space/lease`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to acquire space lease" }));
    throw new Error(data.error ?? "Failed to acquire space lease");
  }
  const data = (await res.json()) as SpaceLeaseState;
  return data.lease;
}

export async function releaseProjectSpaceLease(
  projectId: string,
  input: { holder?: string; force?: boolean }
): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/space/lease`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to release space lease" }));
    throw new Error(data.error ?? "Failed to release space lease");
  }
}

export async function fetchProjectPullRequestTarget(
  projectId: string
): Promise<ProjectPullRequestTarget> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/pr-target`);
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch PR target" }));
    throw new Error(data.error ?? "Failed to fetch PR target");
  }
  return (await res.json()) as ProjectPullRequestTarget;
}

export async function commitProjectChanges(
  projectId: string,
  message: string
): Promise<CommitResult> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to commit changes" }));
    return { ok: false, error: data.error ?? "Failed to commit changes" };
  }
  return (await res.json()) as CommitResult;
}
