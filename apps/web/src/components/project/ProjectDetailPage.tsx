import { useNavigate, useParams } from "@solidjs/router";
import { Show, createMemo, createResource } from "solid-js";
import {
  createTask,
  fetchAreas,
  fetchProject,
  fetchSpec,
  fetchTasks,
  saveSpec,
  updateProject,
  updateTask,
} from "../../api/client";
import type { Task } from "../../api/types";
import { AgentPanel } from "./AgentPanel";
import { CenterPanel } from "./CenterPanel";
import { SpecEditor } from "./SpecEditor";

function getFrontmatterString(
  frontmatter: Record<string, unknown> | undefined,
  key: string
): string {
  if (!frontmatter) return "";
  const value = frontmatter[key];
  return typeof value === "string" ? value : "";
}

export function ProjectDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const projectId = createMemo(() => params.id ?? "");

  const [project, { refetch: refetchProject }] = createResource(
    projectId,
    fetchProject
  );
  const [areas] = createResource(fetchAreas);
  const [tasks, { refetch: refetchTasks }] = createResource(
    projectId,
    fetchTasks
  );
  const [spec, { refetch: refetchSpec }] = createResource(projectId, fetchSpec);

  const area = createMemo(() => {
    const current = project();
    const areaId = getFrontmatterString(current?.frontmatter, "area");
    if (!areaId) return undefined;
    return (areas() ?? []).find((item) => item.id === areaId);
  });

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/projects");
  };

  const handleStatusChange = async (status: string) => {
    const id = projectId();
    if (!id) return;
    await updateProject(id, { status });
    await refetchProject();
  };

  const handleToggleTask = async (task: Task) => {
    const id = projectId();
    if (!id) return;
    const checked = !task.checked;
    await updateTask(id, task.order, {
      checked,
      status: checked ? "done" : "todo",
    });
    await refetchTasks();
  };

  const handleAddTask = async (title: string) => {
    const id = projectId();
    if (!id) return;
    await createTask(id, { title });
    await Promise.all([refetchTasks(), refetchSpec()]);
  };

  const handleSaveSpec = async (content: string) => {
    const id = projectId();
    if (!id) return;
    await saveSpec(id, content);
  };

  const handleRefreshSpec = async () => {
    await Promise.all([refetchSpec(), refetchTasks()]);
  };

  return (
    <>
      <Show when={project.loading}>
        <div class="project-detail-state">Loading project...</div>
      </Show>
      <Show when={project.error}>
        <div class="project-detail-state">Failed to load project.</div>
      </Show>
      <Show when={project()}>
        {(detail) => (
          <div class="project-detail-page">
            <header class="project-detail-breadcrumb">
              <button
                type="button"
                class="project-detail-back"
                onClick={handleBack}
              >
                ← Back to Projects
              </button>
              <span>/</span>
              <span>{area()?.title ?? "Unknown area"}</span>
              <span>/</span>
              <span>{detail().title}</span>
            </header>
            <div class="project-detail">
              <div class="project-detail__left">
                <AgentPanel
                  project={detail()}
                  area={area()}
                  onStatusChange={handleStatusChange}
                />
              </div>
              <div class="project-detail__center">
                <CenterPanel project={detail()} />
              </div>
              <div class="project-detail__right">
                <SpecEditor
                  specContent={spec()?.content ?? ""}
                  tasks={tasks()?.tasks ?? []}
                  progress={tasks()?.progress ?? { done: 0, total: 0 }}
                  areaColor={area()?.color}
                  onToggleTask={handleToggleTask}
                  onAddTask={handleAddTask}
                  onSaveSpec={handleSaveSpec}
                  onRefresh={handleRefreshSpec}
                />
              </div>
            </div>
          </div>
        )}
      </Show>
      <style>{`
        .project-detail-page {
          height: 100%;
          background: #0a0a0f;
          color: #e4e4e7;
        }

        .project-detail-breadcrumb {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border-bottom: 1px solid #1c2430;
          color: #a1a1aa;
          font-size: 13px;
        }

        .project-detail-back {
          border: 0;
          background: transparent;
          color: #cbd5e1;
          cursor: pointer;
          padding: 0;
          font-size: 13px;
        }

        .project-detail {
          display: flex;
          height: calc(100vh - 43px);
          overflow: hidden;
        }

        .project-detail__left {
          width: 240px;
          flex-shrink: 0;
          border-right: 1px solid #1c2430;
          overflow-y: auto;
        }

        .project-detail__center {
          flex: 1;
          overflow-y: auto;
          min-width: 0;
        }

        .project-detail__right {
          width: 360px;
          flex-shrink: 0;
          border-left: 1px solid #1c2430;
          overflow-y: auto;
        }

        .project-detail-state {
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: #0a0a0f;
          color: #a1a1aa;
        }
      `}</style>
    </>
  );
}
