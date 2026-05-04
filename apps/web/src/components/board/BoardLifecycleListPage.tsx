import { useNavigate } from "@solidjs/router";
import { createResource, createEffect, onCleanup } from "solid-js";
import {
  fetchBoardProjects,
  fetchAreaSummaries,
  subscribeToFileChanges,
  subscribeToSubagentChanges,
} from "../../api/client";
import { ProjectListGrouped } from "./ProjectListGrouped";

export function BoardLifecycleListPage() {
  const navigate = useNavigate();
  const [projects, { refetch: refetchProjects }] = createResource(() =>
    fetchBoardProjects(true)
  );
  const [areas] = createResource(fetchAreaSummaries);

  createEffect(() => {
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void refetchProjects();
      }, 250);
    };
    const offFiles = subscribeToFileChanges({
      onFileChanged: scheduleRefresh,
    });
    const offRuns = subscribeToSubagentChanges({
      onSubagentChanged: scheduleRefresh,
    });
    onCleanup(() => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      offFiles();
      offRuns();
    });
  });

  return (
    <div class="board-lifecycle-page" data-testid="board-lifecycle-page">
      <ProjectListGrouped
        projects={projects() ?? []}
        areas={(areas() ?? []).map((area) => ({ id: area.id, name: area.title }))}
        loading={projects.loading}
        error={projects.error ? "Failed to load projects" : undefined}
        onRetry={() => void refetchProjects()}
        onProjectClick={(project) => navigate(`/board/projects/${encodeURIComponent(project.id)}`)}
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
