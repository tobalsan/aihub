import { useNavigate } from "@solidjs/router";
import { createResource, createEffect, onCleanup } from "solid-js";
import {
  fetchBoardProjects,
  fetchAreaSummaries,
  subscribeToFileChanges,
  subscribeToSubagentChanges,
} from "../../api/client";
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
  const [projects, { refetch: refetchProjects }] = createResource(() =>
    fetchBoardProjects(true)
  );
  const [areas] = createResource(fetchAreaSummaries);

  createEffect(() => {
    let refreshTimer: number | undefined;
    const lastSubagentStatus = new Map<string, string>();
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void refetchProjects();
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
        projects={projects.latest ?? []}
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
