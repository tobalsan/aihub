/**
 * Board-hosted project detail page — §15.3
 * Route: /board/projects/:projectId
 * Tabs: Pitch | Slices | Thread | Activity
 */
import { useParams, useNavigate, useSearchParams } from "@solidjs/router";
import {
  For,
  Match,
  Show,
  Suspense,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  addProjectComment,
  createSlice,
  fetchAreas,
  fetchProject,
  subscribeToFileChanges,
  updateProject,
} from "../../api/client";
import type { ProjectLifecycleStatus } from "../../api/types";
import { DocEditor } from "./DocEditor";
import { SliceKanbanWidget } from "../SliceKanbanWidget";
import { SliceDetailPage } from "../SliceDetailPage";
import { ActivityFeed } from "../ActivityFeed";
import { renderMarkdown } from "../../lib/markdown";

// ── Types ────────────────────────────────────────────────────────────

type BpdTab = "pitch" | "slices" | "thread" | "activity";
type PitchDocKey = "README" | "SPECS";

type LifecycleAction = {
  label: string;
  nextStatus: string;
  dangerous?: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────

function getLifecycleStatus(
  frontmatter: Record<string, unknown>
): ProjectLifecycleStatus {
  const s = frontmatter.status;
  if (
    s === "shaping" ||
    s === "active" ||
    s === "done" ||
    s === "cancelled" ||
    s === "archived"
  ) {
    return s;
  }
  return "shaping";
}

function getValidActions(status: ProjectLifecycleStatus): LifecycleAction[] {
  switch (status) {
    case "shaping":
      return [{ label: "Move to active", nextStatus: "active" }];
    case "active":
      return [
        { label: "Archive", nextStatus: "archived" },
        { label: "Cancel", nextStatus: "cancelled", dangerous: true },
      ];
    case "done":
      return [{ label: "Archive", nextStatus: "archived" }];
    case "archived":
      return [{ label: "Unarchive", nextStatus: "shaping" }];
    case "cancelled":
      return [];
  }
}

function statusPillStyle(status: ProjectLifecycleStatus): string {
  switch (status) {
    case "active":
      return "background:#22c55e22;color:#16a34a;border-color:#22c55e44";
    case "done":
      return "background:#6366f122;color:#6366f1;border-color:#6366f144";
    case "cancelled":
      return "background:#f8717122;color:#dc2626;border-color:#f8717144";
    case "archived":
      return "background:#71717a22;color:#71717a;border-color:#71717a44";
    case "shaping":
    default:
      return "background:#f59e0b22;color:#d97706;border-color:#f59e0b44";
  }
}

function fmtDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function isBpdTab(value: unknown): value is BpdTab {
  return (
    value === "pitch" ||
    value === "slices" ||
    value === "thread" ||
    value === "activity"
  );
}

// ── Props ────────────────────────────────────────────────────────────

export type BoardProjectDetailPageProps = {
  /**
   * Project ID to display. When omitted (standalone route), read from URL params.
   * When provided (embedded in BoardView), use this value directly.
   */
  projectId?: string;
  sliceId?: string | null;
  tab?: string;
  /** Called when back button clicked. Defaults to navigate('/board'). */
  onBack?: () => void;
  /**
   * Called when navigating to another project (e.g. via ActivityFeed).
   * Defaults to navigate('/board/projects/:id').
   */
  onOpenProject?: (id: string) => void;
  onNavigate?: (to: string, options?: { replace?: boolean }) => void;
};

// ── Component ────────────────────────────────────────────────────────

export function BoardProjectDetailPage(
  props: BoardProjectDetailPageProps = {}
) {
  const params = useParams<{ projectId: string; sliceId?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = createMemo(() => props.projectId ?? params.projectId ?? "");
  const navigateTo = (to: string, options?: { replace?: boolean }) => {
    if (props.onNavigate) props.onNavigate(to, options);
    else if (options) navigate(to, options);
    else navigate(to);
  };

  const selectedSliceId = createMemo(
    () => props.sliceId ?? params.sliceId ?? null
  );
  const activeTab = createMemo<BpdTab>(() => {
    if (selectedSliceId()) return "slices";
    const tab = props.tab ?? searchParams.tab;
    return isBpdTab(tab) ? tab : "pitch";
  });
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [actionPending, setActionPending] = createSignal(false);
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [pitchDocKey, setPitchDocKey] = createSignal<PitchDocKey>("README");

  // Slice creation form state
  const [addingSlice, setAddingSlice] = createSignal(false);
  const [newSliceTitle, setNewSliceTitle] = createSignal("");
  const [sliceCreating, setSliceCreating] = createSignal(false);

  // Thread comment form state
  const [commentDraft, setCommentDraft] = createSignal("");
  const [commentPosting, setCommentPosting] = createSignal(false);

  const [project, { mutate: mutateProject, refetch: refetchProject }] =
    createResource(projectId, fetchProject);
  const [areas] = createResource(fetchAreas);

  // Realtime file-change subscription
  createEffect(() => {
    const id = projectId();
    if (!id) return;
    let refreshTimer: number | undefined;

    const unsubscribe = subscribeToFileChanges({
      onFileChanged: (changedId, file) => {
        if (changedId !== id) return;
        const upper = file.toUpperCase();
        if (
          upper.includes("README") ||
          upper.includes("SPECS") ||
          upper.includes("THREAD")
        ) {
          if (refreshTimer) window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(() => {
            void refetchProject();
          }, 300);
        }
      },
    });

    onCleanup(() => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      unsubscribe();
    });
  });

  createEffect(() => {
    projectId();
    setPitchDocKey("README");
  });

  // Close menu on outside click
  createEffect(() => {
    if (!menuOpen()) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest(".bpd-action-menu-root")) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    onCleanup(() => window.removeEventListener("mousedown", handler));
  });

  const area = createMemo(() => {
    const p = project.latest;
    const areaId = p?.frontmatter?.area;
    if (!areaId || typeof areaId !== "string") return undefined;
    return (areas.latest ?? []).find((a) => a.id === areaId);
  });

  const lifecycleStatus = createMemo((): ProjectLifecycleStatus => {
    const p = project.latest;
    if (!p) return "shaping";
    return getLifecycleStatus(p.frontmatter);
  });

  const validActions = createMemo(() => getValidActions(lifecycleStatus()));

  const projectUrl = (tab: BpdTab = "pitch") => {
    const id = projectId();
    const base = `/board/projects/${encodeURIComponent(id)}`;
    return tab === "pitch" ? base : `${base}?tab=${tab}`;
  };

  const sliceUrl = (sliceId: string, tab?: string) => {
    const id = projectId();
    const base = `/board/projects/${encodeURIComponent(id)}/slices/${encodeURIComponent(sliceId)}`;
    return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base;
  };

  const openProjectTab = (tab: BpdTab) => {
    navigateTo(projectUrl(tab));
  };

  const handleBack = () => {
    if (selectedSliceId()) {
      closeSliceDetail();
      return;
    }
    if (props.onBack) {
      props.onBack();
    } else {
      navigate("/board");
    }
  };

  const openSliceDetail = (sliceId: string) => {
    if (!projectId()) return;
    navigateTo(sliceUrl(sliceId));
  };

  const closeSliceDetail = () => {
    navigateTo(projectUrl("slices"), { replace: true });
  };

  const handleLifecycleAction = async (nextStatus: string) => {
    setMenuOpen(false);
    const id = projectId();
    if (!id || actionPending()) return;
    setActionPending(true);
    setActionError(null);
    try {
      const updated = await updateProject(id, { status: nextStatus });
      mutateProject(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionPending(false);
    }
  };

  const handleSaveDoc = async (docKey: string, content: string) => {
    const id = projectId();
    if (!id) return;
    const updated = await updateProject(id, { docs: { [docKey]: content } });
    mutateProject(updated);
  };

  const renderPitchDocSelector = () => (
    <div class="bpd-pitch-doc-selector" aria-label="Pitch document">
      <For each={["README", "SPECS"] as PitchDocKey[]}>
        {(key) => (
          <button
            type="button"
            class="bpd-pitch-doc-option"
            classList={{ active: pitchDocKey() === key }}
            aria-pressed={pitchDocKey() === key}
            onClick={() => setPitchDocKey(key)}
          >
            {key}
          </button>
        )}
      </For>
    </div>
  );

  const handleAddSlice = async (e: Event) => {
    e.preventDefault();
    const title = newSliceTitle().trim();
    if (!title || sliceCreating()) return;
    const id = projectId();
    if (!id) return;
    setSliceCreating(true);
    try {
      await createSlice(id, { title, status: "todo" });
      setNewSliceTitle("");
      setAddingSlice(false);
    } catch {
      // silently ignore; kanban will show current state
    } finally {
      setSliceCreating(false);
    }
  };

  const handlePostComment = async (e: Event) => {
    e.preventDefault();
    const body = commentDraft().trim();
    if (!body || commentPosting()) return;
    const id = projectId();
    if (!id) return;
    setCommentPosting(true);
    try {
      await addProjectComment(id, body);
      setCommentDraft("");
      await refetchProject();
    } catch {
      // ignore
    } finally {
      setCommentPosting(false);
    }
  };

  return (
    <div class="bpd">
      {/* ── Header ── */}
      <header class="bpd-header">
        <button
          type="button"
          class="bpd-back"
          onClick={handleBack}
          aria-label="Back"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>

        <Show
          when={project.latest}
          fallback={<span class="bpd-loading-inline">Loading…</span>}
        >
          {(p) => (
            <div class="bpd-header-info">
              <span class="bpd-id">{p().id}</span>
              <span class="bpd-title">{p().title}</span>
              <span
                class="bpd-status-pill"
                style={statusPillStyle(lifecycleStatus())}
              >
                {lifecycleStatus()}
              </span>
              <Show when={area()}>
                {(a) => <span class="bpd-area">{a().title}</span>}
              </Show>
            </div>
          )}
        </Show>

        {/* Lifecycle action menu */}
        <Show when={validActions().length > 0}>
          <div class="bpd-action-menu-root">
            <button
              type="button"
              class="bpd-action-menu-trigger"
              disabled={actionPending()}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen()}
            >
              {actionPending() ? "…" : "Actions ▾"}
            </button>
            <Show when={menuOpen()}>
              <div class="bpd-action-menu" role="menu">
                <For each={validActions()}>
                  {(action) => (
                    <button
                      type="button"
                      role="menuitem"
                      class="bpd-action-item"
                      classList={{
                        "bpd-action-item--danger": Boolean(action.dangerous),
                      }}
                      onClick={() =>
                        void handleLifecycleAction(action.nextStatus)
                      }
                    >
                      {action.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={actionError()}>
          <span class="bpd-action-error">{actionError()}</span>
        </Show>
      </header>

      {/* ── Tabs ── */}
      <div class="bpd-tabs" role="tablist">
        {(["pitch", "slices", "thread", "activity"] as BpdTab[]).map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab() === tab}
            classList={{ "bpd-tab": true, active: activeTab() === tab }}
            onClick={() => openProjectTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      <div class="bpd-body">
        <Show when={project.loading && !project.latest}>
          <div class="bpd-loading">Loading project…</div>
        </Show>
        <Show when={project.error && !project.latest}>
          <div class="bpd-error">Failed to load project.</div>
        </Show>

        <Show when={project.latest}>
          {(p) => (
            <Switch>
              {/* Pitch tab — README.md editor + read-only SPECS.md */}
              <Match when={activeTab() === "pitch"}>
                <div class="bpd-tab-panel">
                  <Switch>
                    <Match when={pitchDocKey() === "README"}>
                      <DocEditor
                        projectId={projectId()}
                        docKey="README"
                        content={p().docs?.["README"] ?? ""}
                        onSave={(content) =>
                          void handleSaveDoc("README", content)
                        }
                        headerContent={renderPitchDocSelector()}
                      />
                    </Match>
                    <Match when={pitchDocKey() === "SPECS"}>
                      <section class="bpd-pitch-readonly">
                        <header class="bpd-pitch-readonly-header">
                          {renderPitchDocSelector()}
                          <span class="bpd-pitch-readonly-status">
                            read-only
                          </span>
                        </header>
                        <Show
                          when={(p().docs?.["SPECS"] ?? "").trim().length > 0}
                          fallback={
                            <div class="bpd-pitch-empty">No SPECS yet.</div>
                          }
                        >
                          <div
                            class="bpd-pitch-markdown"
                            innerHTML={renderMarkdown(
                              p().docs?.["SPECS"] ?? "",
                              { stripFrontmatter: true }
                            )}
                          />
                        </Show>
                      </section>
                    </Match>
                  </Switch>
                </div>
              </Match>

              {/* Slices tab */}
              <Match when={activeTab() === "slices"}>
                <div class="bpd-tab-panel bpd-tab-panel--slices">
                  <div class="bpd-slices-toolbar">
                    <Show
                      when={addingSlice()}
                      fallback={
                        <button
                          type="button"
                          class="bpd-add-slice-btn"
                          onClick={() => setAddingSlice(true)}
                        >
                          + Add slice
                        </button>
                      }
                    >
                      <form
                        class="bpd-add-slice-form"
                        onSubmit={handleAddSlice}
                      >
                        <input
                          autofocus
                          class="bpd-add-slice-input"
                          placeholder="Slice title…"
                          value={newSliceTitle()}
                          onInput={(e) =>
                            setNewSliceTitle(e.currentTarget.value)
                          }
                        />
                        <button
                          type="submit"
                          class="bpd-add-slice-submit"
                          disabled={sliceCreating() || !newSliceTitle().trim()}
                        >
                          {sliceCreating() ? "Adding…" : "Add"}
                        </button>
                        <button
                          type="button"
                          class="bpd-add-slice-cancel"
                          onClick={() => {
                            setAddingSlice(false);
                            setNewSliceTitle("");
                          }}
                        >
                          Cancel
                        </button>
                      </form>
                    </Show>
                  </div>
                  <Show
                    when={selectedSliceId()}
                    fallback={
                      <div class="bpd-slices-kanban">
                        <Suspense fallback={<SlicesLoading />}>
                          <SliceKanbanWidget
                            projectId={projectId()}
                            onSliceClick={openSliceDetail}
                          />
                        </Suspense>
                      </div>
                    }
                  >
                    {(sliceId) => (
                      <div class="bpd-slices-detail">
                        <SliceDetailPage
                          projectId={projectId()}
                          sliceId={sliceId()}
                          routeBase="board"
                          onBack={closeSliceDetail}
                          onOpenSlice={(nextProjectId, nextSliceId) => {
                            if (nextProjectId === projectId()) {
                              openSliceDetail(nextSliceId);
                            } else if (props.onOpenProject) {
                              props.onOpenProject(nextProjectId);
                              navigateTo(
                                `/board/projects/${encodeURIComponent(nextProjectId)}/slices/${encodeURIComponent(nextSliceId)}`
                              );
                            } else {
                              navigateTo(
                                `/board/projects/${encodeURIComponent(nextProjectId)}/slices/${encodeURIComponent(nextSliceId)}`
                              );
                            }
                          }}
                        />
                      </div>
                    )}
                  </Show>
                </div>
              </Match>

              {/* Thread tab — comment log + comment form */}
              <Match when={activeTab() === "thread"}>
                <div class="bpd-tab-panel bpd-tab-panel--thread">
                  <div class="bpd-thread-comments">
                    <Show
                      when={p().thread.length > 0}
                      fallback={
                        <div class="bpd-comment-empty">No comments yet.</div>
                      }
                    >
                      <div class="bpd-comment-list">
                        <For each={p().thread}>
                          {(entry) => (
                            <div class="bpd-comment">
                              <div class="bpd-comment-meta">
                                <span class="bpd-comment-author">
                                  {entry.author}
                                </span>
                                <span class="bpd-comment-date">
                                  {fmtDate(entry.date)}
                                </span>
                              </div>
                              <div
                                class="bpd-comment-body bpd-comment-markdown"
                                innerHTML={renderMarkdown(entry.body, {
                                  rewriteHref: (href) => href,
                                })}
                              />
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                    <form class="bpd-comment-form" onSubmit={handlePostComment}>
                      <textarea
                        class="bpd-comment-input"
                        placeholder="Add a comment…"
                        value={commentDraft()}
                        onInput={(e) => setCommentDraft(e.currentTarget.value)}
                        rows={3}
                      />
                      <button
                        type="submit"
                        class="bpd-comment-submit"
                        disabled={commentPosting() || !commentDraft().trim()}
                      >
                        {commentPosting() ? "Posting…" : "Post comment"}
                      </button>
                    </form>
                  </div>
                </div>
              </Match>

              <Match when={activeTab() === "activity"}>
                <div class="bpd-tab-panel bpd-activity-feed">
                  <ActivityFeed
                    projectId={projectId()}
                    onOpenProject={(id) =>
                      props.onOpenProject
                        ? props.onOpenProject(id)
                        : navigateTo(`/board/projects/${id}`)
                    }
                  />
                </div>
              </Match>
            </Switch>
          )}
        </Show>
      </div>

      <style>{`
        .bpd {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          background: var(--bg-base);
          color: var(--text-primary);
        }

        /* Header */
        .bpd-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-default);
          flex-shrink: 0;
          flex-wrap: wrap;
          min-height: 52px;
        }

        .bpd-back {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          flex-shrink: 0;
          border-radius: 6px;
          border: 1px solid var(--border-default);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }

        .bpd-back:hover {
          background: var(--bg-surface);
          color: var(--text-primary);
        }

        .bpd-header-info {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 0;
          flex-wrap: wrap;
        }

        .bpd-id {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 12px;
          color: var(--text-accent, #6366f1);
          padding: 2px 8px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--text-accent, #6366f1) 12%, transparent);
          flex-shrink: 0;
        }

        .bpd-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .bpd-status-pill {
          font-size: 11px;
          font-weight: 500;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid transparent;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          flex-shrink: 0;
        }

        .bpd-area {
          font-size: 12px;
          color: var(--text-secondary);
          flex-shrink: 0;
        }

        .bpd-loading-inline {
          font-size: 13px;
          color: var(--text-secondary);
        }

        /* Lifecycle action menu */
        .bpd-action-menu-root {
          position: relative;
          flex-shrink: 0;
        }

        .bpd-action-menu-trigger {
          font-size: 12px;
          font-weight: 500;
          padding: 5px 10px;
          border-radius: 6px;
          border: 1px solid var(--border-default);
          background: var(--bg-surface);
          color: var(--text-primary);
          cursor: pointer;
          transition: background 0.12s;
        }

        .bpd-action-menu-trigger:hover:not(:disabled) {
          background: var(--bg-hover, color-mix(in srgb, var(--bg-surface) 80%, #fff));
        }

        .bpd-action-menu-trigger:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .bpd-action-menu {
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.15);
          min-width: 160px;
          z-index: 100;
          overflow: hidden;
        }

        .bpd-action-item {
          display: block;
          width: 100%;
          padding: 8px 12px;
          font-size: 13px;
          text-align: left;
          background: transparent;
          border: none;
          color: var(--text-primary);
          cursor: pointer;
          transition: background 0.1s;
        }

        .bpd-action-item:hover {
          background: var(--bg-hover, color-mix(in srgb, var(--bg-surface) 80%, #fff));
        }

        .bpd-action-item--danger {
          color: #dc2626;
        }

        .bpd-action-error {
          font-size: 12px;
          color: #dc2626;
        }

        /* Tabs */
        .bpd-tabs {
          display: flex;
          gap: 0;
          border-bottom: 1px solid var(--border-default);
          flex-shrink: 0;
        }

        .bpd-tab {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-family: inherit;
          font-size: 13px;
          font-weight: 500;
          padding: 10px 16px;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          transition: color 0.12s, border-color 0.12s;
        }

        .bpd-tab:hover {
          color: var(--text-primary);
        }

        .bpd-tab.active {
          color: var(--text-primary);
          border-bottom-color: var(--text-accent, #6366f1);
        }

        /* Body */
        .bpd-body {
          flex: 1;
          min-height: 0;
          overflow: auto;
          display: flex;
          flex-direction: column;
        }

        .bpd-loading,
        .bpd-error {
          padding: 32px;
          font-size: 13px;
          color: var(--text-secondary);
          text-align: center;
        }

        .bpd-error {
          color: #dc2626;
        }

        .bpd-tab-panel {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          height: 100%;
          padding: 16px;
        }

        .bpd-pitch-doc-selector {
          display: inline-flex;
          align-items: center;
          gap: 12px;
        }

        .bpd-pitch-doc-option {
          border: 0;
          background: transparent;
          color: var(--text-secondary);
          font: inherit;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11px;
          letter-spacing: 0.02em;
          padding: 2px 0;
          cursor: pointer;
        }

        .bpd-pitch-doc-option:hover,
        .bpd-pitch-doc-option:focus-visible {
          color: var(--text-primary);
        }

        .bpd-pitch-doc-option:focus-visible {
          outline: 2px solid var(--text-accent, #6366f1);
          outline-offset: 3px;
          border-radius: 3px;
        }

        .bpd-pitch-doc-option.active {
          color: #dc2626;
          font-weight: 700;
        }

        .bpd-pitch-readonly {
          min-height: 200px;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-surface);
          color: var(--text-primary);
          border: 1px solid var(--border-default);
          border-radius: 10px;
          overflow: hidden;
        }

        .bpd-pitch-readonly-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-default);
          background: var(--bg-surface);
          font-size: 11px;
          color: var(--text-secondary);
        }

        .bpd-pitch-readonly-status {
          min-width: 56px;
          text-align: right;
          opacity: 0.75;
        }

        .bpd-pitch-markdown {
          flex: 1 1 auto;
          min-height: 200px;
          overflow: auto;
          padding: 14px;
          line-height: 1.55;
        }

        .bpd-pitch-empty {
          padding: 14px;
          color: var(--text-secondary);
          font-size: 13px;
        }

        .bpd-pitch-markdown > :first-child {
          margin-top: 0;
        }

        .bpd-pitch-markdown > :last-child {
          margin-bottom: 0;
        }

        .bpd-pitch-markdown p,
        .bpd-pitch-markdown ul,
        .bpd-pitch-markdown ol,
        .bpd-pitch-markdown blockquote,
        .bpd-pitch-markdown pre {
          margin: 0 0 12px;
        }

        .bpd-pitch-markdown h1,
        .bpd-pitch-markdown h2,
        .bpd-pitch-markdown h3 {
          margin: 18px 0 8px;
          line-height: 1.2;
        }

        .bpd-pitch-markdown h1 { font-size: 28px; }
        .bpd-pitch-markdown h2 { font-size: 23px; }
        .bpd-pitch-markdown h3 { font-size: 19px; }

        .bpd-pitch-markdown ul,
        .bpd-pitch-markdown ol {
          padding-left: 24px;
        }

        .bpd-pitch-markdown blockquote {
          padding-left: 12px;
          border-left: 3px solid var(--text-accent, #6366f1);
          color: var(--text-secondary);
        }

        .bpd-pitch-markdown code,
        .bpd-pitch-markdown pre {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        }

        .bpd-pitch-markdown code {
          background: var(--bg-base);
          border-radius: 4px;
          padding: 1px 4px;
        }

        .bpd-pitch-markdown pre {
          overflow: auto;
          padding: 10px;
          border-radius: 6px;
          background: var(--bg-base);
        }

        .bpd-pitch-markdown pre code {
          background: transparent;
          padding: 0;
        }

        /* Slices tab */
        .bpd-tab-panel--slices {
          padding: 12px 16px;
          gap: 10px;
        }

        .bpd-slices-toolbar {
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }

        .bpd-add-slice-btn {
          font-size: 13px;
          font-weight: 500;
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid var(--border-default);
          background: var(--bg-surface);
          color: var(--text-primary);
          cursor: pointer;
          transition: background 0.12s;
        }

        .bpd-add-slice-btn:hover {
          background: var(--bg-hover, color-mix(in srgb, var(--bg-surface) 80%, #fff));
        }

        .bpd-add-slice-form {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
        }

        .bpd-add-slice-input {
          flex: 1;
          font-family: inherit;
          font-size: 13px;
          padding: 5px 9px;
          border-radius: 6px;
          border: 1px solid var(--border-default);
          background: var(--bg-base);
          color: var(--text-primary);
          outline: none;
        }

        .bpd-add-slice-input:focus {
          border-color: var(--text-accent, #6366f1);
        }

        .bpd-add-slice-submit {
          font-size: 13px;
          padding: 5px 12px;
          border-radius: 6px;
          border: none;
          background: var(--text-accent, #6366f1);
          color: #fff;
          cursor: pointer;
          font-weight: 500;
        }

        .bpd-add-slice-submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .bpd-add-slice-cancel {
          font-size: 13px;
          padding: 5px 10px;
          border-radius: 6px;
          border: 1px solid var(--border-default);
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
        }

        .bpd-slices-kanban {
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }

        .bpd-slices-detail {
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }

        /* Thread tab */
        .bpd-tab-panel--thread {
          gap: 16px;
          overflow: auto;
        }

        .bpd-thread-comments {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .bpd-comment-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .bpd-comment-empty {
          padding: 12px;
          border: 1px dashed var(--border-default);
          border-radius: 8px;
          color: var(--text-secondary);
          font-size: 13px;
        }

        .bpd-comment {
          padding: 10px 12px;
          border: 1px solid var(--border-default);
          border-radius: 8px;
          background: var(--bg-surface);
        }

        .bpd-comment-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
          font-size: 12px;
        }

        .bpd-comment-author {
          font-weight: 600;
          color: var(--text-primary);
        }

        .bpd-comment-date {
          color: var(--text-secondary);
        }

        .bpd-comment-body {
          font-size: 13px;
          color: var(--text-primary);
          line-height: 1.5;
        }

        .bpd-comment-markdown > :first-child {
          margin-top: 0;
        }

        .bpd-comment-markdown > :last-child {
          margin-bottom: 0;
        }

        .bpd-comment-markdown p,
        .bpd-comment-markdown pre,
        .bpd-comment-markdown blockquote,
        .bpd-comment-markdown ul,
        .bpd-comment-markdown ol {
          margin: 0 0 8px;
        }

        .bpd-comment-markdown ul,
        .bpd-comment-markdown ol {
          padding-left: 18px;
        }

        .bpd-comment-markdown code {
          font-family: var(--font-mono, monospace);
          font-size: 12px;
          background: var(--bg-elevated);
          border-radius: 4px;
          padding: 1px 4px;
        }

        .bpd-comment-markdown pre {
          overflow-x: auto;
          background: var(--bg-elevated);
          border-radius: 6px;
          padding: 10px;
        }

        .bpd-comment-markdown pre code {
          background: transparent;
          padding: 0;
        }

        .bpd-comment-markdown a {
          color: var(--accent);
        }

        .bpd-comment-form {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: auto;
        }

        .bpd-comment-input {
          width: 100%;
          font-family: inherit;
          font-size: 13px;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--border-default);
          background: var(--bg-base);
          color: var(--text-primary);
          resize: vertical;
          outline: none;
          box-sizing: border-box;
        }

        .bpd-comment-input:focus {
          border-color: var(--text-accent, #6366f1);
        }

        .bpd-comment-submit {
          align-self: flex-end;
          font-size: 13px;
          font-weight: 500;
          padding: 6px 14px;
          border-radius: 6px;
          border: none;
          background: var(--text-accent, #6366f1);
          color: #fff;
          cursor: pointer;
        }

        .bpd-comment-submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Activity stub */
        .bpd-activity-stub {
          align-items: center;
          justify-content: center;
        }

        .bpd-activity-stub-inner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          text-align: center;
          color: var(--text-secondary);
          max-width: 320px;
        }

        .bpd-activity-stub-icon {
          font-size: 32px;
          margin-bottom: 4px;
        }

        .bpd-activity-stub-text {
          margin: 0;
          font-size: 14px;
          color: var(--text-primary);
          font-weight: 500;
        }

        .bpd-activity-stub-sub {
          margin: 0;
          font-size: 12px;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}

function SlicesLoading() {
  return <div class="bpd-loading">Loading slices…</div>;
}
