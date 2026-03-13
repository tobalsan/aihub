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
  subscribeToFileChanges,
  updateProject,
  updateTask,
} from "../../api/client";
import type { SubagentListItem, Task } from "../../api/types";
import { AgentPanel } from "./AgentPanel";
import {
  CenterPanel,
  type CenterTab,
  type SelectedProjectAgent,
} from "./CenterPanel";
import { SpecEditor } from "./SpecEditor";
import type {
  SpawnFormDraft,
  SpawnPrefill,
  SpawnTemplate,
} from "./SpawnForm";

type PersistedCenterView = {
  tab: CenterTab;
  agent?: { type: "lead" | "subagent"; slug?: string; agentId?: string };
};

function centerViewKey(id: string): string {
  return `aihub:project:${id}:center-view`;
}

function readCenterView(id: string): PersistedCenterView | null {
  try {
    const raw = localStorage.getItem(centerViewKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed.tab === "chat" || parsed.tab === "activity" || parsed.tab === "changes")
    ) {
      return parsed as PersistedCenterView;
    }
  } catch {
    return null;
  }
  return null;
}

function saveCenterView(id: string, view: PersistedCenterView): void {
  try {
    localStorage.setItem(centerViewKey(id), JSON.stringify(view));
  } catch {
    return;
  }
}

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

function getRepoStatusMessage(project?: {
  frontmatter: Record<string, unknown>;
  repoValid: boolean;
}): string {
  const repoPath = getFrontmatterString(project?.frontmatter, "repo");
  if (!repoPath) return "No repo configured";
  if (project?.repoValid) return "";
  return `Repo path not found: ${repoPath}`;
}

function buildTaskProgress(tasks: Task[]): { done: number; total: number } {
  return {
    done: tasks.filter((task) => task.checked).length,
    total: tasks.length,
  };
}

function getFilename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const name = normalized.split("/").pop() ?? normalized;
  return name.toUpperCase();
}

export function ProjectDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const projectId = createMemo(() => params.id ?? "");
  const [compactLayout, setCompactLayout] = createSignal(false);
  const [mergedTab, setMergedTab] = createSignal<MergedTab>("spec");
  const savedView = readCenterView(projectId());
  const [centerTab, setCenterTab] = createSignal<CenterTab>(
    savedView?.tab ?? "chat"
  );
  const [selectedAgent, setSelectedAgent] =
    createSignal<SelectedProjectAgent | null>(null);
  const [subagents, setSubagents] = createSignal<SubagentListItem[]>([]);
  const [spawnMode, setSpawnMode] = createSignal<{
    template: SpawnTemplate;
    prefill: SpawnPrefill;
  } | null>(null);
  const [chatInputDraft, setChatInputDraft] = createSignal("");
  const [spawnFormDraft, setSpawnFormDraft] = createSignal<SpawnFormDraft>({
    includeDefaultPrompt: true,
    includeRoleInstructions: true,
    includePostRun: true,
    includeCustomInstructions: false,
    customInstructions: "",
  });
  const [isEditingTitle, setIsEditingTitle] = createSignal(false);
  const [titleDraft, setTitleDraft] = createSignal("");
  let titleInputRef: HTMLInputElement | undefined;

  const [project, { mutate: mutateProject, refetch: refetchProject }] =
    createResource(projectId, fetchProject);
  const [areas] = createResource(fetchAreas);
  const [tasks, { mutate: mutateTasks, refetch: refetchTasks }] =
    createResource(projectId, fetchTasks);
  const [spec, { refetch: refetchSpec }] = createResource(projectId, fetchSpec);

  createEffect(() => {
    const id = projectId();
    if (!id) return;
    let refreshTimer: number | undefined;
    let shouldRefreshProject = false;
    let shouldRefreshSpec = false;
    let shouldRefreshTasks = false;

    const flush = () => {
      if (shouldRefreshProject) void refetchProject();
      if (shouldRefreshSpec) void refetchSpec();
      if (shouldRefreshTasks) void refetchTasks();
      shouldRefreshProject = false;
      shouldRefreshSpec = false;
      shouldRefreshTasks = false;
      refreshTimer = undefined;
    };

    const unsubscribe = subscribeToFileChanges({
      onFileChanged: (projectId, file) => {
        if (projectId !== id) return;
        const filename = getFilename(file);
        if (filename === "SPECS.MD") {
          shouldRefreshSpec = true;
          shouldRefreshTasks = true;
        } else if (filename === "README.MD" || filename === "THREAD.MD") {
          shouldRefreshProject = true;
        } else {
          shouldRefreshProject = true;
        }
        if (refreshTimer) window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(flush, 300);
      },
    });

    onCleanup(() => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      unsubscribe();
    });
  });

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
  const repoMessage = createMemo(() => getRepoStatusMessage(project()));

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

  let restoredFromStorage = false;
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

    // Restore saved lead agent from localStorage
    if (
      !restoredFromStorage &&
      savedView?.agent?.type === "lead" &&
      savedView.agent.agentId &&
      sessionKeys &&
      savedView.agent.agentId in sessionKeys
    ) {
      restoredFromStorage = true;
      setSelectedAgent({
        type: "lead",
        projectId: current.id,
        agentId: savedView.agent.agentId,
        agentName: savedView.agent.agentId,
      });
      return;
    }
    // Defer to subagent restore effect if saved agent is a subagent
    if (!restoredFromStorage && savedView?.agent?.type === "subagent") {
      restoredFromStorage = true;
      // Set lead as fallback; subagent restore effect will override once subagents load
      if (leadAgentId) {
        setSelectedAgent({
          type: "lead",
          projectId: current.id,
          agentId: leadAgentId,
          agentName: leadAgentId,
        });
      }
      return;
    }

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

  // Restore saved subagent once subagents list is available
  let subagentRestored = false;
  createEffect(() => {
    const items = subagents();
    const current = project();
    if (subagentRestored || !current || items.length === 0) return;
    const selected = selectedAgent();
    if (selected && selected.projectId === current.id) {
      subagentRestored = true;
      return;
    }
    if (savedView?.agent?.type !== "subagent" || !savedView.agent.slug) return;
    subagentRestored = true;
    const match = items.find((entry) => entry.slug === savedView.agent!.slug);
    if (!match) return;
    const runMode =
      match.runMode === "main-run" ||
      match.runMode === "worktree" ||
      match.runMode === "clone" ||
      match.runMode === "none"
        ? match.runMode
        : undefined;
    setSelectedAgent({
      type: "subagent",
      projectId: current.id,
      slug: match.slug,
      cli: match.cli,
      runMode,
      status: match.status,
      agentName: match.name || match.slug,
    });
  });

  createEffect(() => {
    const selected = selectedAgent();
    if (!selected || selected.type !== "subagent" || !selected.slug) return;
    const item = subagents().find((entry) => entry.slug === selected.slug);
    if (!item) return;
    const runMode =
      item.runMode === "main-run" ||
      item.runMode === "worktree" ||
      item.runMode === "clone" ||
      item.runMode === "none"
        ? item.runMode
        : undefined;
    if (
      selected.cli === item.cli &&
      selected.status === item.status &&
      selected.runMode === runMode
    ) {
      return;
    }
    setSelectedAgent({
      ...selected,
      cli: item.cli,
      status: item.status,
      runMode,
    });
  });

  // Persist center view to localStorage
  createEffect(() => {
    const id = projectId();
    const selected = selectedAgent();
    const tab = centerTab();
    if (!id) return;
    const agent = selected
      ? { type: selected.type, slug: selected.slug, agentId: selected.agentId }
      : undefined;
    saveCenterView(id, { tab, agent });
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
                    setSpawnFormDraft({
                      includeDefaultPrompt:
                        input.prefill.includeDefaultPrompt ?? true,
                      includeRoleInstructions:
                        input.prefill.includeRoleInstructions ?? true,
                      includePostRun: input.prefill.includePostRun ?? true,
                      includeCustomInstructions: false,
                      customInstructions: input.prefill.customInstructions ?? "",
                    });
                    setMergedTab("chat");
                    setCenterTab("chat");
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
                    setMergedTab("chat");
                    setCenterTab("chat");
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
                      runMode:
                        info.runMode === "main-run" ||
                        info.runMode === "worktree" ||
                        info.runMode === "clone" ||
                        info.runMode === "none"
                          ? info.runMode
                          : undefined,
                      status: info.status,
                    });
                  }}
                />
              </div>
              <Show when={!compactLayout()}>
                <div class="project-detail__center">
                  <CenterPanel
                    project={detail()}
                    tab={centerTab()}
                    onTabChange={setCenterTab}
                    onAddComment={handleAddComment}
                    selectedAgent={selectedAgent()}
                    spawnMode={spawnMode()}
                    chatInputDraft={chatInputDraft()}
                    onChatInputDraftChange={setChatInputDraft}
                    spawnFormDraft={spawnFormDraft()}
                    onSpawnFormDraftChange={setSpawnFormDraft}
                    subagents={subagents()}
                    onCancelSpawn={() => setSpawnMode(null)}
                    hasArea={Boolean(area())}
                    repoValid={detail().repoValid}
                    repoMessage={repoMessage()}
                    onSpawned={(slug) => {
                      setSpawnMode(null);
                      setSelectedAgent({
                        type: "subagent",
                        projectId: projectId(),
                        slug,
                        cli: undefined,
                        runMode: undefined,
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
                      onClick={() => { setMergedTab("chat"); setCenterTab("chat"); }}
                    >
                      Chat
                    </button>
                    <button
                      type="button"
                      classList={{ active: mergedTab() === "activity" }}
                      onClick={() => { setMergedTab("activity"); setCenterTab("activity"); }}
                    >
                      Activity
                    </button>
                    <button
                      type="button"
                      classList={{ active: mergedTab() === "changes" }}
                      onClick={() => { setMergedTab("changes"); setCenterTab("changes"); }}
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
                        chatInputDraft={chatInputDraft()}
                        onChatInputDraftChange={setChatInputDraft}
                        spawnFormDraft={spawnFormDraft()}
                        onSpawnFormDraftChange={setSpawnFormDraft}
                        subagents={subagents()}
                        onCancelSpawn={() => setSpawnMode(null)}
                        hasArea={Boolean(area())}
                        repoValid={detail().repoValid}
                        repoMessage={repoMessage()}
                        onSpawned={(slug) => {
                          setSpawnMode(null);
                          setSelectedAgent({
                            type: "subagent",
                            projectId: projectId(),
                            slug,
                            cli: undefined,
                            runMode: undefined,
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
          background: var(--bg-base);
          color: var(--text-primary);
        }

        .project-detail-breadcrumb {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          font-size: 13px;
        }

        .project-detail-back {
          border: 0;
          background: transparent;
          color: var(--text-primary);
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
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          background: var(--bg-overlay);
          color: var(--text-primary);
          padding: 4px 8px;
          font-size: 13px;
        }

        .project-detail-title-save,
        .project-detail-title-cancel {
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          background: var(--bg-overlay);
          color: var(--text-primary);
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
          border-right: 1px solid var(--border-subtle);
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
          border-left: 1px solid var(--border-subtle);
          overflow-y: auto;
        }

        .project-detail__merged {
          flex: 1;
          min-width: 0;
          display: grid;
          grid-template-rows: auto 1fr;
          background: var(--bg-base);
        }

        .project-detail-merged-tabs {
          display: flex;
          gap: 8px;
          padding: 16px 18px;
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-base);
        }

        .project-detail-merged-tabs button {
          border: 1px solid var(--border-subtle);
          background: var(--bg-overlay);
          color: var(--text-secondary);
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          cursor: pointer;
        }

        .project-detail-merged-tabs button.active {
          color: #fff;
          border-color: #2563eb;
          background: #2563eb;
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
          background: var(--bg-base);
          color: var(--text-secondary);
        }
      `}</style>
    </>
  );
}
