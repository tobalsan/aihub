import { useNavigate, useParams } from "@solidjs/router";
import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import {
  addProjectComment,
  createTask,
  fetchAreas,
  fetchProject,
  fetchSpec,
  fetchTasks,
  saveSpec,
  updateProject,
  updateTask,
} from "../../api/client";
import type { SubagentListItem, Task } from "../../api/types";
import { AgentPanel } from "./AgentPanel";
import { CenterPanel, type SelectedProjectAgent } from "./CenterPanel";
import { SpecEditor } from "./SpecEditor";
import type { SpawnPrefill, SpawnTemplate } from "./SpawnForm";

type MergedTab = "chat" | "activity" | "changes" | "spec";

function getBaseAppTitle(): string {
  if (import.meta.env.VITE_AIHUB_DEV === "true") {
    const port = import.meta.env.VITE_AIHUB_UI_PORT ?? "?";
    return `[DEV :${port}] AIHub`;
  }
  return "AIHub";
}

function getFrontmatterString(
  frontmatter: Record<string, unknown> | undefined,
  key: string
): string {
  if (!frontmatter) return "";
  const value = frontmatter[key];
  return typeof value === "string" ? value : "";
}

function getFrontmatterRecord(
  frontmatter: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  if (!frontmatter) return undefined;
  const value = frontmatter[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function buildTaskProgress(tasks: Task[]): { done: number; total: number } {
  return {
    done: tasks.filter((task) => task.checked).length,
    total: tasks.length,
  };
}

export function ProjectDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const projectId = createMemo(() => params.id ?? "");
  const [compactLayout, setCompactLayout] = createSignal(false);
  const [mergedTab, setMergedTab] = createSignal<MergedTab>("spec");
  const [selectedAgent, setSelectedAgent] =
    createSignal<SelectedProjectAgent | null>(null);
  const [subagents, setSubagents] = createSignal<SubagentListItem[]>([]);
  const [spawnMode, setSpawnMode] = createSignal<{
    template: SpawnTemplate;
    prefill: SpawnPrefill;
  } | null>(null);
  const [isEditingTitle, setIsEditingTitle] = createSignal(false);
  const [titleDraft, setTitleDraft] = createSignal("");
  let titleInputRef: HTMLInputElement | undefined;

  const [project, { mutate: mutateProject, refetch: refetchProject }] =
    createResource(projectId, fetchProject);
  const [areas] = createResource(fetchAreas);
  const [tasks, { mutate: mutateTasks, refetch: refetchTasks }] =
    createResource(projectId, fetchTasks);
  const [spec, { refetch: refetchSpec }] = createResource(projectId, fetchSpec);

  onMount(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 1599px)");
    const update = (matches: boolean) => setCompactLayout(matches);
    update(media.matches);
    const handler = (event: MediaQueryListEvent) => update(event.matches);
    if (media.addEventListener) {
      media.addEventListener("change", handler);
      onCleanup(() => media.removeEventListener("change", handler));
      return;
    }
    media.addListener(handler);
    onCleanup(() => media.removeListener(handler));
  });

  const area = createMemo(() => {
    const current = project();
    const areaId = getFrontmatterString(current?.frontmatter, "area");
    if (!areaId) return undefined;
    return (areas() ?? []).find((item) => item.id === areaId);
  });

  const handleBack = () => {
    navigate("/projects");
  };

  const handleStatusChange = async (status: string) => {
    const id = projectId();
    if (!id) return;
    await updateProject(id, { status });
    await refetchProject();
  };

  const handleRepoChange = async (repo: string) => {
    const id = projectId();
    if (!id) return;
    await updateProject(id, { repo });
    await refetchProject();
  };

  const handleAreaChange = async (areaId: string) => {
    const id = projectId();
    if (!id) return;
    await updateProject(id, { area: areaId });
    await refetchProject();
  };

  const handleToggleTask = async (task: Task) => {
    const id = projectId();
    if (!id) return;
    const checked = !task.checked;
    const previous = tasks();

    if (previous) {
      const nextTasks: Task[] = previous.tasks.map((item) =>
        item.order === task.order
          ? { ...item, checked, status: checked ? "done" : "todo" }
          : item
      );
      mutateTasks({
        ...previous,
        tasks: nextTasks,
        progress: buildTaskProgress(nextTasks),
      });
    }

    try {
      await updateTask(id, task.order, {
        checked,
        status: checked ? "done" : "todo",
      });
    } catch (error) {
      if (previous) mutateTasks(previous);
      await refetchTasks();
      throw error;
    }
  };

  const handleAddTask = async (title: string, description?: string) => {
    const id = projectId();
    if (!id) return;
    await createTask(id, { title, description });
    await Promise.all([refetchTasks(), refetchSpec()]);
  };

  const handleSaveSpec = async (content: string) => {
    const id = projectId();
    if (!id) return;
    await saveSpec(id, content);
  };

  const handleSaveDoc = async (docKey: string, content: string) => {
    const id = projectId();
    if (!id) return;
    const updated = await updateProject(id, { docs: { [docKey]: content } });
    mutateProject(updated);
  };

  const handleAddComment = async (body: string) => {
    const id = projectId();
    if (!id) return;
    await addProjectComment(id, body);
    await refetchProject();
  };

  const handleRefreshSpec = async () => {
    await Promise.all([refetchSpec(), refetchTasks()]);
  };

  const handleTitleChange = async (title: string) => {
    const id = projectId();
    const current = project();
    if (!id || !current) return;
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === current.title) return;
    mutateProject({ ...current, title: nextTitle });
    await updateProject(id, { title: nextTitle });
    await refetchProject();
  };

  const handleStartTitleEdit = () => {
    const currentTitle = project()?.title ?? "";
    setTitleDraft(currentTitle);
    setIsEditingTitle(true);
  };

  const handleCancelTitleEdit = () => {
    setTitleDraft(project()?.title ?? "");
    setIsEditingTitle(false);
  };

  const handleSaveTitle = async () => {
    const current = project();
    const nextTitle = titleDraft().trim();
    if (!current || !nextTitle || nextTitle === current.title) {
      setIsEditingTitle(false);
      if (current) setTitleDraft(current.title);
      return;
    }
    setIsEditingTitle(false);
    await handleTitleChange(nextTitle);
  };

  createEffect(() => {
    if (isEditingTitle()) {
      queueMicrotask(() => titleInputRef?.focus());
    }
  });

  createEffect(() => {
    const current = project();
    const selected = selectedAgent();
    if (!current) return;
    if (selected && selected.projectId === current.id) return;
    const sessionKeys = getFrontmatterRecord(
      current.frontmatter,
      "sessionKeys"
    );
    const leadAgentId = sessionKeys
      ? Object.keys(sessionKeys).find(
          (key) => typeof sessionKeys[key] === "string"
        )
      : undefined;
    if (!leadAgentId) {
      setSelectedAgent(null);
      return;
    }
    setSelectedAgent({
      type: "lead",
      projectId: current.id,
      agentId: leadAgentId,
      agentName: leadAgentId,
    });
  });

  createEffect(() => {
    const current = project();
    if (!current) return;
    document.title = `${current.title} · ${getBaseAppTitle()}`;
  });

  onCleanup(() => {
    document.title = getBaseAppTitle();
  });

  return (
    <>
      <Show when={project.loading && !project()}>
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
              <Show
                when={isEditingTitle()}
                fallback={
                  <span
                    class="project-detail-title"
                    onDblClick={handleStartTitleEdit}
                    title="Double-click to edit title"
                  >
                    {detail().title}
                  </span>
                }
              >
                <form
                  class="project-detail-title-edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSaveTitle();
                  }}
                >
                  <input
                    ref={(el) => (titleInputRef = el)}
                    class="project-detail-title-input"
                    value={titleDraft()}
                    onInput={(event) =>
                      setTitleDraft(event.currentTarget.value)
                    }
                  />
                  <button type="submit" class="project-detail-title-save">
                    Save
                  </button>
                  <button
                    type="button"
                    class="project-detail-title-cancel"
                    onClick={handleCancelTitleEdit}
                  >
                    Cancel
                  </button>
                </form>
              </Show>
            </header>
            <div class="project-detail">
              <div class="project-detail__left">
                <AgentPanel
                  project={detail()}
                  area={area()}
                  areas={areas() ?? []}
                  subagents={subagents()}
                  onSubagentsChange={(items) => setSubagents(items)}
                  onOpenSpawn={(input) => {
                    setSpawnMode(input);
                    setMergedTab("chat");
                  }}
                  onTitleChange={handleTitleChange}
                  onStatusChange={handleStatusChange}
                  onAreaChange={handleAreaChange}
                  onRepoChange={handleRepoChange}
                  selectedAgentSlug={
                    selectedAgent()?.type === "lead"
                      ? `lead:${selectedAgent()?.agentId ?? ""}`
                      : (selectedAgent()?.slug ?? null)
                  }
                  onSelectAgent={(info) => {
                    if (info.type === "lead") {
                      setSelectedAgent({
                        type: "lead",
                        projectId: info.projectId,
                        agentId: info.agentId,
                        agentName: info.agentId,
                      });
                      return;
                    }
                    setSelectedAgent({
                      type: "subagent",
                      projectId: info.projectId,
                      slug: info.slug,
                      cli: info.cli,
                      status: info.status,
                    });
                  }}
                />
              </div>
              <Show when={!compactLayout()}>
                <div class="project-detail__center">
                  <CenterPanel
                    project={detail()}
                    onAddComment={handleAddComment}
                    selectedAgent={selectedAgent()}
                    spawnMode={spawnMode()}
                    subagents={subagents()}
                    onCancelSpawn={() => setSpawnMode(null)}
                    onSpawned={(slug) => {
                      setSpawnMode(null);
                      setSelectedAgent({
                        type: "subagent",
                        projectId: detail().id,
                        slug,
                        cli: undefined,
                        status: "running",
                      });
                    }}
                  />
                </div>
                <div class="project-detail__right">
                  <SpecEditor
                    specContent={spec()?.content ?? ""}
                    docs={detail().docs}
                    tasks={tasks()?.tasks ?? []}
                    progress={tasks()?.progress ?? { done: 0, total: 0 }}
                    areaColor={area()?.color}
                    onToggleTask={handleToggleTask}
                    onAddTask={handleAddTask}
                    onSaveSpec={handleSaveSpec}
                    onSaveDoc={handleSaveDoc}
                    onRefresh={handleRefreshSpec}
                  />
                </div>
              </Show>
              <Show when={compactLayout()}>
                <div class="project-detail__merged">
                  <header class="project-detail-merged-tabs">
                    <button
                      type="button"
                      classList={{ active: mergedTab() === "chat" }}
                      onClick={() => setMergedTab("chat")}
                    >
                      Chat
                    </button>
                    <button
                      type="button"
                      classList={{ active: mergedTab() === "activity" }}
                      onClick={() => setMergedTab("activity")}
                    >
                      Activity
                    </button>
                    <button
                      type="button"
                      classList={{ active: mergedTab() === "changes" }}
                      onClick={() => setMergedTab("changes")}
                    >
                      Changes
                    </button>
                    <button
                      type="button"
                      classList={{ active: mergedTab() === "spec" }}
                      onClick={() => setMergedTab("spec")}
                    >
                      Spec
                    </button>
                  </header>
                  <div class="project-detail__merged-body">
                    <Show when={mergedTab() === "spec"}>
                      <SpecEditor
                        specContent={spec()?.content ?? ""}
                        docs={detail().docs}
                        tasks={tasks()?.tasks ?? []}
                        progress={tasks()?.progress ?? { done: 0, total: 0 }}
                        areaColor={area()?.color}
                        onToggleTask={handleToggleTask}
                        onAddTask={handleAddTask}
                        onSaveSpec={handleSaveSpec}
                        onSaveDoc={handleSaveDoc}
                        onRefresh={handleRefreshSpec}
                      />
                    </Show>
                    <Show when={mergedTab() !== "spec"}>
                      <CenterPanel
                        project={detail()}
                        onAddComment={handleAddComment}
                        showTabs={false}
                        tab={mergedTab() as "chat" | "activity" | "changes"}
                        selectedAgent={selectedAgent()}
                        spawnMode={spawnMode()}
                        subagents={subagents()}
                        onCancelSpawn={() => setSpawnMode(null)}
                        onSpawned={(slug) => {
                          setSpawnMode(null);
                          setSelectedAgent({
                            type: "subagent",
                            projectId: detail().id,
                            slug,
                            cli: undefined,
                            status: "running",
                          });
                        }}
                      />
                    </Show>
                  </div>
                </div>
              </Show>
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

        .project-detail-title {
          cursor: text;
        }

        .project-detail-title-edit {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .project-detail-title-input {
          min-width: 220px;
          border: 1px solid #2a3240;
          border-radius: 6px;
          background: #111722;
          color: #e4e4e7;
          padding: 4px 8px;
          font-size: 13px;
        }

        .project-detail-title-save,
        .project-detail-title-cancel {
          border: 1px solid #2a3240;
          border-radius: 6px;
          background: #111722;
          color: #e4e4e7;
          font-size: 12px;
          padding: 4px 8px;
          cursor: pointer;
        }

        .project-detail {
          display: flex;
          height: calc(100vh - 43px);
          overflow: hidden;
        }

        .project-detail__left {
          width: 480px;
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
          width: 33vw;
          min-width: 420px;
          flex-shrink: 0;
          border-left: 1px solid #1c2430;
          overflow-y: auto;
        }

        .project-detail__merged {
          flex: 1;
          min-width: 0;
          display: grid;
          grid-template-rows: auto 1fr;
          background: #0a0a0f;
        }

        .project-detail-merged-tabs {
          display: flex;
          gap: 8px;
          padding: 16px 18px;
          border-bottom: 1px solid #1c2430;
          background: #0a0a0f;
        }

        .project-detail-merged-tabs button {
          border: 1px solid #2a3240;
          background: #111722;
          color: #a1a1aa;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          cursor: pointer;
        }

        .project-detail-merged-tabs button.active {
          color: #e4e4e7;
          border-color: #3b82f6;
          background: #172554;
        }

        .project-detail__merged-body {
          min-height: 0;
          overflow-y: auto;
        }

        @media (max-width: 1599px) {
          .project-detail__left {
            width: 40%;
            min-width: 0;
          }

          .project-detail__merged {
            width: 60%;
            flex: 0 0 60%;
          }
        }

        @media (min-width: 1600px) {
          .project-detail__left {
            width: 20%;
            min-width: 0;
          }

          .project-detail__center {
            width: 40%;
            flex: 0 0 40%;
          }

          .project-detail__right {
            width: 40%;
            min-width: 0;
          }
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
