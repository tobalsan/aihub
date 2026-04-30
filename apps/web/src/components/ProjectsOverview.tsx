import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  createProject,
  fetchBoardProjects,
  fetchProject,
  fetchRuntimeSubagentLogs,
  interruptRuntimeSubagent,
  resumeRuntimeSubagent,
  subscribeToFileChanges,
  updateProject,
} from "../api/client";
import type {
  BoardProject,
  BoardWorktree,
  ProjectDetail,
  SubagentLogEvent,
} from "../api/types";
import { renderMarkdown } from "../lib/markdown";

type FilterMode = "active" | "done" | "archived";
type WorktreeTone = "green" | "red" | "yellow" | "muted" | "idle";

type WorktreeStatus = {
  label: string;
  tone: WorktreeTone;
  working: boolean;
};

type LogState = {
  worktree: BoardWorktree;
  loading: boolean;
  error: string | null;
  events: SubagentLogEvent[];
};

const TERMINAL_STATUSES = new Set(["archived", "trashed", "cancelled"]);

function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return parts.slice(-2).join("/");
}

function relativeTime(value?: string): string {
  if (!value) return "No activity";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "No activity";
  const diff = Date.now() - time;
  if (diff < 30_000) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function getWorktreeStatus(worktree: BoardWorktree): WorktreeStatus {
  const runStatus = worktree.agentRun?.status;
  if (runStatus === "running") {
    return { label: "working", tone: "green", working: true };
  }
  if (runStatus === "failed") {
    return { label: "failed", tone: "red", working: false };
  }
  if (worktree.queueStatus === "conflict") {
    return { label: "conflict", tone: "red", working: false };
  }
  if (worktree.queueStatus === "stale_worker") {
    return { label: "stale", tone: "yellow", working: false };
  }
  if (worktree.queueStatus === "pending") {
    return { label: "pending", tone: "yellow", working: false };
  }
  if (worktree.queueStatus === "skipped") {
    return { label: "skipped", tone: "muted", working: false };
  }
  if (worktree.queueStatus === "integrated") {
    return { label: "integrated", tone: "muted", working: false };
  }
  return { label: "idle", tone: "idle", working: false };
}

function projectMatchesFilter(project: BoardProject, mode: FilterMode): boolean {
  if (mode === "done") return project.status === "done" || project.group === "done";
  if (mode === "archived") return TERMINAL_STATUSES.has(project.status);
  return (
    !TERMINAL_STATUSES.has(project.status) &&
    project.status !== "done" &&
    project.group !== "done"
  );
}

function firstParagraph(markdown: string): string {
  return markdown
    .replace(/^---[\s\S]*?---\s*/m, "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith("#")) ?? "";
}

function logText(event: SubagentLogEvent): string {
  return (
    event.text ??
    event.diff?.summary ??
    event.tool?.name ??
    String(event.type)
  ).trim();
}

export function ProjectsOverview() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = createSignal<FilterMode>("active");
  const [query, setQuery] = createSignal("");
  const [createOpen, setCreateOpen] = createSignal(false);
  const [createTitle, setCreateTitle] = createSignal("");
  const [createError, setCreateError] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [editingTitle, setEditingTitle] = createSignal(false);
  const [draftTitle, setDraftTitle] = createSignal("");
  const [actionError, setActionError] = createSignal("");
  const [logState, setLogState] = createSignal<LogState | null>(null);
  const [projects, { mutate, refetch }] = createResource(() =>
    fetchBoardProjects(true)
  );
  const selectedProjectId = createMemo(() =>
    typeof params.id === "string" && params.id.trim() ? params.id : null
  );
  const selectedProject = createMemo(() => {
    const id = selectedProjectId();
    return (projects() ?? []).find((project) => project.id === id) ?? null;
  });
  const [detail] = createResource(selectedProjectId, async (id) =>
    id ? fetchProject(id) : null
  );
  const preview = createMemo(() => {
    const readme = detail()?.docs?.README ?? detail()?.docs?.["README.md"] ?? "";
    return firstParagraph(readme);
  });
  const filteredProjects = createMemo(() => {
    const needle = query().trim().toLowerCase();
    return (projects() ?? []).filter((project) => {
      if (!projectMatchesFilter(project, filter())) return false;
      return !needle || project.title.toLowerCase().includes(needle);
    });
  });

  createEffect(() => {
    const project = selectedProject();
    if (project && !editingTitle()) setDraftTitle(project.title);
  });

  createEffect(() => {
    if (selectedProjectId() || projects.loading) return;
    const first = filteredProjects()[0];
    if (first) navigate(`/projects/${first.id}`, { replace: true });
  });

  createEffect(() => {
    let refreshTimer: number | undefined;
    const unsubscribe = subscribeToFileChanges({
      onFileChanged: () => {
        if (refreshTimer) window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => {
          void refetch();
          refreshTimer = undefined;
        }, 250);
      },
      onAgentChanged: () => {
        if (refreshTimer) window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => {
          void refetch();
          refreshTimer = undefined;
        }, 250);
      },
    });
    onCleanup(() => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      unsubscribe();
    });
  });

  function selectProject(id: string) {
    navigate(`/projects/${id}`);
  }

  function replaceProject(project: BoardProject) {
    mutate((current) =>
      current?.map((item) => (item.id === project.id ? project : item)) ?? []
    );
  }

  async function saveTitle() {
    const project = selectedProject();
    const title = draftTitle().trim();
    if (!project || title.length === 0 || title === project.title) {
      setEditingTitle(false);
      setDraftTitle(project?.title ?? "");
      return;
    }
    setActionError("");
    try {
      await updateProject(project.id, { title });
      replaceProject({ ...project, title });
      setEditingTitle(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to save title");
    }
  }

  async function markDone() {
    const project = selectedProject();
    if (!project) return;
    setActionError("");
    try {
      await updateProject(project.id, { status: "done" });
      replaceProject({ ...project, status: "done", group: "done" });
      setFilter("done");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to mark done");
    }
  }

  async function submitCreate(event: SubmitEvent) {
    event.preventDefault();
    const title = createTitle().trim();
    if (!title) return;
    setCreating(true);
    setCreateError("");
    try {
      const result = await createProject({ title });
      if (!result.ok) {
        setCreateError(result.error);
        return;
      }
      const created = result.data;
      mutate((current) => [
        {
          id: created.id,
          title: created.title,
          area:
            typeof created.frontmatter.area === "string"
              ? created.frontmatter.area
              : "",
          status:
            typeof created.frontmatter.status === "string"
              ? created.frontmatter.status
              : "maybe",
          group: "active",
          created:
            typeof created.frontmatter.created === "string"
              ? created.frontmatter.created
              : new Date().toISOString(),
          worktrees: [],
        },
        ...(current ?? []),
      ]);
      setCreateOpen(false);
      setCreateTitle("");
      setFilter("active");
      navigate(`/projects/${created.id}`);
      void refetch();
    } finally {
      setCreating(false);
    }
  }

  async function openLogs(worktree: BoardWorktree) {
    const runId = worktree.agentRun?.runId;
    if (!runId) return;
    setLogState({ worktree, loading: true, error: null, events: [] });
    try {
      const data = await fetchRuntimeSubagentLogs(runId, 0);
      setLogState({ worktree, loading: false, error: null, events: data.events });
    } catch (error) {
      setLogState({
        worktree,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load logs",
        events: [],
      });
    }
  }

  async function stopRun(worktree: BoardWorktree) {
    const runId = worktree.agentRun?.runId;
    if (!runId) return;
    setActionError("");
    const result = await interruptRuntimeSubagent(runId);
    if (!result.ok) setActionError(result.error);
    void refetch();
  }

  async function resumeRun(worktree: BoardWorktree) {
    const runId = worktree.agentRun?.runId;
    if (!runId) return;
    setActionError("");
    const result = await resumeRuntimeSubagent(runId, "Continue from the latest state.");
    if (!result.ok) setActionError(result.error);
    void refetch();
  }

  function openDetail(tab: "chat" | "activity" | "changes" = "chat") {
    const project = selectedProject();
    if (!project) return;
    try {
      localStorage.setItem(
        `aihub:project:${project.id}:center-view`,
        JSON.stringify({ tab })
      );
    } catch {
      // ignore
    }
    setSearchParams({ ...searchParams, detail: "1" });
  }

  return (
    <div class="projects-overview">
      <aside class="po-list-pane">
        <header class="po-list-header">
          <div>
            <h1>Projects</h1>
            <p>{filteredProjects().length} visible</p>
          </div>
          <button class="po-primary" type="button" onClick={() => setCreateOpen(true)}>
            + New
          </button>
        </header>
        <div class="po-filters" role="tablist" aria-label="Project filters">
          <For each={["active", "done", "archived"] as FilterMode[]}>
            {(mode) => (
              <button
                classList={{ "po-filter": true, active: filter() === mode }}
                onClick={() => setFilter(mode)}
                type="button"
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            )}
          </For>
        </div>
        <input
          class="po-search"
          placeholder="Search projects"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <Show
          when={filteredProjects().length > 0}
          fallback={<div class="po-empty">No projects match this view.</div>}
        >
          <div class="po-project-list">
            <For each={filteredProjects()}>
              {(project) => (
                <button
                  classList={{
                    "po-project-row": true,
                    selected: selectedProjectId() === project.id,
                  }}
                  type="button"
                  onClick={() => selectProject(project.id)}
                >
                  <span class={`po-status status-${project.status}`}>
                    {statusLabel(project.status)}
                  </span>
                  <span class="po-project-title">{project.title}</span>
                  <span class="po-count">{project.worktrees.length} wt</span>
                  <span class="po-area">{project.area || "No area"}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </aside>

      <main class="po-detail-pane">
        <Show
          when={selectedProject()}
          fallback={<section class="po-detail-empty">Select a project.</section>}
        >
          {(project) => (
            <section class="po-detail">
              <header class="po-detail-header">
                <div class="po-title-wrap">
                  <Show
                    when={editingTitle()}
                    fallback={
                      <button
                        class="po-title-button"
                        type="button"
                        onClick={() => setEditingTitle(true)}
                      >
                        {project().title}
                      </button>
                    }
                  >
                    <input
                      class="po-title-input"
                      value={draftTitle()}
                      autofocus
                      onInput={(event) => setDraftTitle(event.currentTarget.value)}
                      onBlur={() => void saveTitle()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveTitle();
                        if (event.key === "Escape") {
                          setDraftTitle(project().title);
                          setEditingTitle(false);
                        }
                      }}
                    />
                  </Show>
                  <div class="po-detail-meta">
                    <span class={`po-status status-${project().status}`}>
                      {statusLabel(project().status)}
                    </span>
                    <span>{project().area || "No area"}</span>
                  </div>
                </div>
                <button class="po-secondary" type="button" onClick={markDone}>
                  Mark done
                </button>
              </header>
              <Show when={actionError()}>
                {(message) => <p class="po-error">{message()}</p>}
              </Show>

              <details class="po-readme">
                <summary>
                  <span>Description / README</span>
                  <button
                    class="po-link-button"
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      openDetail("chat");
                    }}
                  >
                    Edit
                  </button>
                </summary>
                <Show
                  when={preview()}
                  fallback={<p class="po-muted">No README description yet.</p>}
                >
                  {(body) => (
                    <div
                      class="po-readme-preview"
                      innerHTML={renderMarkdown(body())}
                    />
                  )}
                </Show>
              </details>

              <section class="po-worktrees">
                <div class="po-section-title">
                  <h2>Worktrees</h2>
                  <span>{project().worktrees.length}</span>
                </div>
                <Show
                  when={project().worktrees.length > 0}
                  fallback={<div class="po-empty compact">No worktrees.</div>}
                >
                  <div class="po-worktree-list">
                    <For each={project().worktrees}>
                      {(worktree) => {
                        const wtStatus = createMemo(() =>
                          getWorktreeStatus(worktree)
                        );
                        return (
                          <article class="po-worktree-row">
                            <div class="po-worktree-main">
                              <div class="po-worktree-title">
                                <strong>{worktree.workerSlug || worktree.name}</strong>
                                <span>{shortPath(worktree.worktreePath || worktree.path)}</span>
                              </div>
                              <div class="po-worktree-meta">
                                <span>{worktree.branch ?? "no branch"}</span>
                                <span>{relativeTime(worktree.agentRun?.updatedAt ?? worktree.integratedAt ?? worktree.startedAt)}</span>
                              </div>
                            </div>
                            <span
                              class={`po-worktree-status tone-${wtStatus().tone}`}
                              classList={{ working: wtStatus().working }}
                            >
                              <span class="po-status-dot" />
                              {wtStatus().label}
                            </span>
                            <div class="po-worktree-actions">
                              <Show when={worktree.agentRun}>
                                <button type="button" onClick={() => void openLogs(worktree)}>
                                  Logs
                                </button>
                              </Show>
                              <Show when={worktree.agentRun?.status === "running"}>
                                <button type="button" onClick={() => void stopRun(worktree)}>
                                  Stop
                                </button>
                              </Show>
                              <Show
                                when={
                                  worktree.agentRun &&
                                  worktree.agentRun.status !== "running"
                                }
                              >
                                <button type="button" onClick={() => void resumeRun(worktree)}>
                                  Resume
                                </button>
                              </Show>
                              <button type="button" onClick={() => openDetail("changes")}>
                                Open diff
                              </button>
                            </div>
                          </article>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </section>
            </section>
          )}
        </Show>
      </main>

      <Show when={createOpen()}>
        <div class="po-modal-backdrop" onClick={() => setCreateOpen(false)}>
          <form
            class="po-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitCreate}
          >
            <h2>New project</h2>
            <input
              class="po-create-title"
              placeholder="Project title"
              value={createTitle()}
              autofocus
              onInput={(event) => setCreateTitle(event.currentTarget.value)}
            />
            <Show when={createError()}>
              {(message) => <p class="po-error">{message()}</p>}
            </Show>
            <div class="po-modal-actions">
              <button type="button" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button class="po-primary" type="submit" disabled={creating()}>
                Create
              </button>
            </div>
          </form>
        </div>
      </Show>

      <Show when={logState()}>
        {(state) => (
          <div class="po-modal-backdrop" onClick={() => setLogState(null)}>
            <section
              class="po-modal po-log-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <header class="po-log-header">
                <h2>{state().worktree.workerSlug} logs</h2>
                <button type="button" onClick={() => setLogState(null)}>
                  Close
                </button>
              </header>
              <Show when={state().error}>
                {(message) => <p class="po-error">{message()}</p>}
              </Show>
              <Show
                when={!state().loading}
                fallback={<p class="po-muted">Loading logs...</p>}
              >
                <Show
                  when={state().events.length > 0}
                  fallback={<p class="po-muted">No logs yet.</p>}
                >
                  <div class="po-log-list">
                    <For each={state().events}>
                      {(event) => <pre>{logText(event)}</pre>}
                    </For>
                  </div>
                </Show>
              </Show>
            </section>
          </div>
        )}
      </Show>

      <style>{`
        .projects-overview {
          height: 100%;
          display: grid;
          grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
          background: var(--surface-primary);
          color: var(--text-primary);
        }
        .po-list-pane,
        .po-detail-pane {
          min-height: 0;
          overflow: auto;
        }
        .po-list-pane {
          border-right: 1px solid var(--border-default);
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          background: var(--surface-secondary);
        }
        .po-list-header,
        .po-detail-header,
        .po-section-title,
        .po-worktree-row,
        .po-log-header,
        .po-modal-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .po-list-header h1,
        .po-detail h1,
        .po-section-title h2,
        .po-modal h2 {
          margin: 0;
          color: var(--text-primary);
        }
        .po-list-header h1 { font-size: 22px; }
        .po-list-header p,
        .po-muted,
        .po-empty,
        .po-detail-meta,
        .po-worktree-meta {
          margin: 0;
          color: var(--text-secondary);
          font-size: 13px;
        }
        .po-primary,
        .po-secondary,
        .po-filter,
        .po-worktree-actions button,
        .po-modal-actions button,
        .po-link-button {
          border: 1px solid var(--border-default);
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        }
        .po-primary {
          background: var(--accent);
          border-color: var(--accent);
          color: var(--accent-contrast);
          padding: 8px 11px;
        }
        .po-secondary,
        .po-modal-actions button {
          background: var(--surface-secondary);
          color: var(--text-primary);
          padding: 8px 11px;
        }
        .po-filters {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }
        .po-filter {
          background: transparent;
          color: var(--text-secondary);
          padding: 7px 8px;
        }
        .po-filter.active {
          background: var(--surface-primary);
          color: var(--text-primary);
        }
        .po-search,
        .po-title-input,
        .po-create-title {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border-default);
          border-radius: 6px;
          background: var(--surface-primary);
          color: var(--text-primary);
          padding: 9px 10px;
          font: inherit;
        }
        .po-project-list {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .po-project-row {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          grid-template-areas:
            "status title count"
            "area area area";
          gap: 6px 8px;
          width: 100%;
          text-align: left;
          border: 1px solid transparent;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          padding: 10px;
          cursor: pointer;
        }
        .po-project-row:hover,
        .po-project-row.selected {
          border-color: var(--border-default);
          background: var(--surface-primary);
        }
        .po-project-title {
          grid-area: title;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 600;
        }
        .po-count {
          grid-area: count;
          color: var(--text-secondary);
          font-size: 12px;
        }
        .po-area {
          grid-area: area;
          color: var(--text-secondary);
          font-size: 12px;
        }
        .po-status {
          grid-area: status;
          width: fit-content;
          border: 1px solid var(--border-default);
          border-radius: 999px;
          padding: 2px 7px;
          color: var(--text-secondary);
          font-size: 11px;
          text-transform: capitalize;
          white-space: nowrap;
        }
        .status-done { color: #86efac; border-color: rgba(34, 197, 94, 0.35); }
        .status-archived,
        .status-trashed,
        .status-cancelled { color: #cbd5e1; }
        .po-detail-pane {
          padding: 24px;
        }
        .po-detail {
          max-width: 1180px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .po-title-wrap {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .po-title-button {
          border: 0;
          padding: 0;
          background: transparent;
          color: var(--text-primary);
          font-size: 28px;
          font-weight: 700;
          text-align: left;
          cursor: text;
        }
        .po-detail-meta,
        .po-worktree-meta,
        .po-worktree-title {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .po-readme {
          border: 1px solid var(--border-default);
          border-radius: 8px;
          padding: 12px 14px;
          background: var(--surface-secondary);
        }
        .po-readme summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          color: var(--text-primary);
          font-weight: 600;
        }
        .po-link-button {
          background: transparent;
          color: var(--text-secondary);
          padding: 5px 8px;
        }
        .po-readme-preview {
          margin-top: 12px;
          color: var(--text-primary);
          font-size: 14px;
          line-height: 1.55;
        }
        .po-worktrees {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .po-section-title h2 { font-size: 16px; }
        .po-worktree-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .po-worktree-row {
          border: 1px solid var(--border-default);
          border-radius: 8px;
          padding: 12px;
          background: var(--surface-secondary);
        }
        .po-worktree-main {
          min-width: 0;
          flex: 1;
        }
        .po-worktree-title strong,
        .po-worktree-title span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .po-worktree-title span {
          color: var(--text-secondary);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 12px;
        }
        .po-worktree-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-width: 92px;
          color: var(--text-secondary);
          font-size: 12px;
          text-transform: capitalize;
        }
        .po-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
        }
        .tone-green { color: #22c55e; }
        .tone-red { color: #ef4444; }
        .tone-yellow { color: #f59e0b; }
        .tone-muted { color: #cbd5e1; }
        .tone-idle { color: var(--text-secondary); }
        .po-worktree-status.working .po-status-dot {
          animation: po-pulse 1.2s ease-in-out infinite;
        }
        @keyframes po-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(0.82); }
        }
        .po-worktree-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .po-worktree-actions button {
          background: var(--surface-primary);
          color: var(--text-primary);
          padding: 6px 8px;
        }
        .po-empty,
        .po-detail-empty {
          border: 1px dashed var(--border-default);
          border-radius: 8px;
          padding: 18px;
          color: var(--text-secondary);
        }
        .po-empty.compact {
          padding: 12px;
        }
        .po-error {
          margin: 0;
          color: #fca5a5;
          font-size: 13px;
        }
        .po-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(0, 0, 0, 0.42);
        }
        .po-modal {
          width: min(460px, 100%);
          border: 1px solid var(--border-default);
          border-radius: 8px;
          padding: 16px;
          background: var(--surface-primary);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.24);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .po-log-modal {
          width: min(780px, 100%);
          max-height: min(720px, 90vh);
        }
        .po-log-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          overflow: auto;
        }
        .po-log-list pre {
          margin: 0;
          border: 1px solid var(--border-default);
          border-radius: 6px;
          padding: 8px;
          background: var(--surface-secondary);
          color: var(--text-primary);
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          font-size: 12px;
        }
        @media (max-width: 900px) {
          .projects-overview {
            grid-template-columns: 1fr;
          }
          .po-list-pane {
            border-right: 0;
            border-bottom: 1px solid var(--border-default);
            max-height: 45vh;
          }
          .po-detail-pane {
            padding: 16px;
          }
          .po-worktree-row,
          .po-detail-header {
            align-items: flex-start;
            flex-direction: column;
          }
          .po-worktree-status {
            min-width: 0;
          }
          .po-worktree-actions {
            justify-content: flex-start;
          }
        }
      `}</style>
    </div>
  );
}
