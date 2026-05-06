import { useNavigate } from "@solidjs/router";
import {
  createResource,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  fetchBoardProjects,
  fetchAreaSummaries,
  subscribeToFileChanges,
  subscribeToSubagentChanges,
} from "../../api";
import type { BoardProject } from "../../api/types";
import { ProjectListGrouped } from "./ProjectListGrouped";

export type BoardLifecycleListPageProps = {
  /** Override default navigate-to-route behavior for project clicks (e.g. inline embedding). */
  onProjectClick?: (project: BoardProject) => void;
};

export function BoardLifecycleListPage(
  props: BoardLifecycleListPageProps = {}
) {
  const navigate = useNavigate();
  const [doneExpanded, setDoneExpanded] = createSignal(false);
  const [doneLoaded, setDoneLoaded] = createSignal(false);
  const [doneLoading, setDoneLoading] = createSignal(false);
  const [doneProjects, setDoneProjects] = createSignal<BoardProject[]>([]);
  const [projects, { refetch: refetchProjects, mutate: mutateProjects }] =
    createResource(() => fetchBoardProjects(false));
  const [areas] = createResource(fetchAreaSummaries);
  const projectResponse = createMemo(() => {
    const response = projects.latest as unknown;
    if (Array.isArray(response)) {
      const counts = {
        shaping: 0,
        active: 0,
        done: 0,
        cancelled: 0,
        archived: 0,
      };
      for (const project of response as BoardProject[]) {
        counts[project.lifecycleStatus] += 1;
      }
      return {
        projects: response as BoardProject[],
        lifecycleCounts: counts,
      };
    }
    return response as
      | {
          projects: BoardProject[];
          lifecycleCounts: {
            shaping: number;
            active: number;
            done: number;
            cancelled: number;
            archived: number;
          };
        }
      | undefined;
  });
  const visibleProjects = createMemo(() =>
    doneExpanded()
      ? [
          ...(projectResponse()?.projects ?? []).filter(
            (project) => project.lifecycleStatus !== "done"
          ),
          ...doneProjects(),
        ]
      : (projectResponse()?.projects ?? []).filter(
          (project) => project.lifecycleStatus !== "done"
        )
  );
  const lifecycleCounts = createMemo(
    () =>
      projectResponse()?.lifecycleCounts ?? {
        shaping: 0,
        active: 0,
        done: doneProjects().length,
        cancelled: 0,
        archived: 0,
      }
  );

  async function refreshVisibleProjects() {
    if (!doneExpanded()) {
      await refetchProjects();
      return;
    }
    const next = await fetchBoardProjects(true);
    mutateProjects(next);
    setDoneProjects(
      next.projects.filter((project) => project.lifecycleStatus === "done")
    );
    setDoneLoaded(true);
  }

  async function showDoneProjects() {
    setDoneExpanded(true);
    if (doneLoaded()) return;
    setDoneLoading(true);
    try {
      const next = await fetchBoardProjects(true);
      mutateProjects(next);
      setDoneProjects(
        next.projects.filter((project) => project.lifecycleStatus === "done")
      );
      setDoneLoaded(true);
    } finally {
      setDoneLoading(false);
    }
  }

  createEffect(() => {
    let refreshTimer: number | undefined;
    const lastSubagentStatus = new Map<string, string>();
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void refreshVisibleProjects();
        refreshTimer = undefined;
      }, 250);
    };
    const offFiles = subscribeToFileChanges({
      onFileChanged: scheduleRefresh,
    });
    const offRuns = subscribeToSubagentChanges({
      onSubagentChanged: (event) => {
        const previous = lastSubagentStatus.get(event.runId);
        if (previous === event.status) return;
        lastSubagentStatus.set(event.runId, event.status);
        scheduleRefresh();
      },
    });
    onCleanup(() => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      lastSubagentStatus.clear();
      offFiles();
      offRuns();
    });
  });

  return (
    <div class="board-lifecycle-page" data-testid="board-lifecycle-page">
      <ProjectListGrouped
        projects={visibleProjects()}
        lifecycleCounts={lifecycleCounts()}
        doneLoading={doneLoading()}
        onDoneExpandedChange={(expanded) => {
          if (expanded) void showDoneProjects();
          else setDoneExpanded(false);
        }}
        areas={(areas.latest ?? []).map((area) => ({
          id: area.id,
          name: area.title,
        }))}
        loading={projects.loading}
        error={projects.error ? "Failed to load projects" : undefined}
        onRetry={() => void refetchProjects()}
        onProjectClick={(project) =>
          props.onProjectClick
            ? props.onProjectClick(project)
            : navigate(`/board/projects/${encodeURIComponent(project.id)}`)
        }
      />
      <style>{`
        .board-lifecycle-page {
          height: 100%;
          overflow: auto;
          padding: 16px;
        }
      `}</style>
    </div>
  );
}
