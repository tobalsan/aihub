import {
  UpdateProjectRequestSchema,
  normalizeProjectStatus,
  type GatewayConfig,
  type UpdateProjectRequest,
} from "@aihub/shared";
import { recordProjectStatusActivity } from "../activity/index.js";
import {
  archiveProject,
  getProject,
  listSlices,
  unarchiveProject,
  updateProject,
} from "../projects/index.js";
import { listSubagents } from "../subagents/index.js";
import { interruptSubagent } from "../subagents/runner.js";

type CancelInterruptDeps = {
  listSubagentsFn?: typeof listSubagents;
  interruptSubagentFn?: typeof interruptSubagent;
};

export type ProjectLifecycleResult =
  | { ok: true; data: unknown; files?: string[]; projectDirName?: string }
  | { ok: false; error: string; status: 400 | 404 | 409 };

async function getCancelledSliceIdsForProject(
  config: GatewayConfig,
  id: string
): Promise<string[]> {
  const prev = await getProject(config, id);
  if (!prev.ok) return [];
  const slices = await listSlices(prev.data.absolutePath);
  return slices
    .filter(
      (slice) =>
        slice.frontmatter.status !== "done" &&
        slice.frontmatter.status !== "cancelled"
    )
    .map((slice) => slice.id);
}

export async function interruptCancelledOrchestratorRuns(
  config: GatewayConfig,
  projectId: string,
  cancelledSliceIds: string[],
  deps: CancelInterruptDeps = {}
): Promise<void> {
  if (cancelledSliceIds.length === 0) return;
  const listSubagentsFn = deps.listSubagentsFn ?? listSubagents;
  const interruptSubagentFn = deps.interruptSubagentFn ?? interruptSubagent;
  const runs = await listSubagentsFn(config, projectId, true);
  if (!runs.ok) return;
  await Promise.all(
    runs.data.items
      .filter(
        (item) =>
          item.source === "orchestrator" &&
          item.status === "running" &&
          item.sliceId &&
          cancelledSliceIds.includes(item.sliceId)
      )
      .map((item) =>
        interruptSubagentFn(config, projectId, item.slug).catch(() => undefined)
      )
  );
}

export async function updateProjectWithCancelInterrupt(
  config: GatewayConfig,
  projectId: string,
  input: UpdateProjectRequest
) {
  const cancelledSliceIds =
    input.status === "cancelled"
      ? await getCancelledSliceIdsForProject(config, projectId)
      : [];
  const result = await updateProject(config, projectId, input);
  if (result.ok && input.status === "cancelled") {
    await interruptCancelledOrchestratorRuns(
      config,
      projectId,
      cancelledSliceIds
    );
  }
  return result;
}

export function projectMutationErrorStatus(error: string): 400 | 404 | 409 {
  if (error.startsWith("Project already exists")) return 409;
  if (error.startsWith("Cannot clear project repo")) return 400;
  return 404;
}

function updatedProjectFiles(input: UpdateProjectRequest): string[] {
  const updatedFiles = new Set<string>(["README.md"]);
  if (input.specs !== undefined) updatedFiles.add("SPECS.md");
  if (input.readme !== undefined) updatedFiles.add("README.md");
  if (input.docs) {
    for (const key of Object.keys(input.docs)) {
      const normalized = key.replace(/\.md$/i, "");
      updatedFiles.add(`${normalized}.md`);
    }
  }
  return [...updatedFiles];
}

export async function updateProjectLifecycle(
  config: GatewayConfig,
  projectId: string,
  body: unknown
): Promise<ProjectLifecycleResult> {
  if (typeof body === "object" && body !== null) {
    const raw = body as Record<string, unknown>;
    if ("runAgent" in raw || "runMode" in raw || "baseBranch" in raw) {
      return {
        ok: false,
        error: "runAgent/runMode/baseBranch not supported on projects",
        status: 400,
      };
    }
  }
  const parsed = UpdateProjectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message, status: 400 };
  }

  let prevStatus: string | null = null;
  if (parsed.data.status) {
    const prev = await getProject(config, projectId);
    if (prev.ok) {
      prevStatus = normalizeProjectStatus(
        String(prev.data.frontmatter?.status ?? "")
      );
    }
  }

  if (parsed.data.status === "archived") {
    const rest = { ...parsed.data };
    delete rest.status;
    if (Object.keys(rest).length > 0) {
      const updated = await updateProject(config, projectId, rest);
      if (!updated.ok) {
        return {
          ok: false,
          error: updated.error,
          status: projectMutationErrorStatus(updated.error),
        };
      }
    }
    const archived = await archiveProject(config, projectId);
    if (!archived.ok) {
      return {
        ok: false,
        error: archived.error,
        status: archived.error.startsWith("Archive already contains") ? 409 : 404,
      };
    }
    const detail = await getProject(config, projectId);
    if (!detail.ok) {
      return { ok: false, error: detail.error, status: 404 };
    }
    if (prevStatus === null || prevStatus !== "archived") {
      await recordProjectStatusActivity({
        actor: parsed.data.agent,
        projectId: detail.data.id ?? projectId,
        status: "archived",
      });
    }
    return {
      ok: true,
      data: detail.data,
      files: updatedProjectFiles(rest),
      projectDirName: detail.data.path,
    };
  }

  const result = await updateProjectWithCancelInterrupt(
    config,
    projectId,
    parsed.data
  );
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      status: projectMutationErrorStatus(result.error),
    };
  }
  if (parsed.data.status) {
    const nextStatus = normalizeProjectStatus(
      String(result.data.frontmatter?.status ?? "")
    );
    if (prevStatus === null || prevStatus !== nextStatus) {
      await recordProjectStatusActivity({
        actor: parsed.data.agent,
        projectId: result.data.id ?? projectId,
        status: nextStatus,
      });
    }
  }
  return {
    ok: true,
    data: result.data,
    files: updatedProjectFiles(parsed.data),
    projectDirName: result.data.path,
  };
}

export async function archiveProjectLifecycle(
  config: GatewayConfig,
  projectId: string
): Promise<ProjectLifecycleResult> {
  const result = await archiveProject(config, projectId);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      status: result.error.startsWith("Archive already contains") ? 409 : 404,
    };
  }
  await recordProjectStatusActivity({ projectId, status: "archived" });
  return { ok: true, data: result.data };
}

export async function unarchiveProjectLifecycle(
  config: GatewayConfig,
  projectId: string
): Promise<ProjectLifecycleResult> {
  const result = await unarchiveProject(config, projectId, "shaping");
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      status: result.error.startsWith("Project already exists") ? 409 : 404,
    };
  }
  await recordProjectStatusActivity({ projectId, status: "shaping" });
  return { ok: true, data: result.data };
}
