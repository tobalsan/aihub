/**
 * SliceKanbanWidget — per-project slice kanban.
 * Columns: todo | in_progress | review | ready_to_merge | done | cancelled
 * Drag card → status change via PATCH /projects/:projectId/slices/:sliceId
 */
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  fetchSlices,
  fetchSubagents,
  updateSlice,
  subscribeToFileChanges,
  subscribeToSubagentChanges,
} from "../api/client";
import type { SliceRecord, SliceStatus, SubagentListItem } from "../api/types";

type ColumnDef = { id: SliceStatus; title: string; color: string };

const COLUMNS: ColumnDef[] = [
  { id: "todo", title: "Todo", color: "#3b6ecc" },
  { id: "in_progress", title: "In Progress", color: "#8a6fd1" },
  { id: "review", title: "Review", color: "#f08b57" },
  { id: "ready_to_merge", title: "Ready to Merge", color: "#2fb6a3" },
  { id: "done", title: "Done", color: "#53b97c" },
  { id: "cancelled", title: "Cancelled", color: "#6b6b6b" },
];

const TERMINAL_BLOCKER_STATUSES = new Set<SliceStatus>([
  "done",
  "ready_to_merge",
  "cancelled",
]);

type Props = {
  projectId: string;
  /** Navigate to slice detail on card click. Default: /projects/:projectId/slices/:sliceId */
  onSliceClick?: (sliceId: string) => void;
};

function blockedBy(slice: SliceRecord): string[] {
  return Array.isArray(slice.frontmatter.blocked_by)
    ? slice.frontmatter.blocked_by.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
}

function projectIdFromSliceId(sliceId: string): string {
  return sliceId.match(/^(PRO-\d+)-S\d+$/)?.[1] ?? "";
}

function blockerStatusLabel(status: SliceStatus | undefined): string {
  return status ?? "unknown";
}

export function SliceKanbanWidget(props: Props) {
  const navigate = useNavigate();

  const [slices, { mutate, refetch }] = createResource(
    () => props.projectId,
    fetchSlices
  );
  const [agentRuns, { refetch: refetchAgentRuns }] = createResource(
    () => props.projectId,
    async (projectId) => {
      const result = await fetchSubagents(projectId, true);
      return result.ok ? result.data.items : ([] as SubagentListItem[]);
    }
  );

  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  const [draggingFromStatus, setDraggingFromStatus] =
    createSignal<SliceStatus | null>(null);
  const [dragOverColumn, setDragOverColumn] = createSignal<SliceStatus | null>(
    null
  );
  const [addingToColumn, setAddingToColumn] = createSignal<SliceStatus | null>(
    null
  );
  const [newSliceTitle, setNewSliceTitle] = createSignal("");
  const [creating, setCreating] = createSignal(false);

  const slicesByStatus = (status: SliceStatus): SliceRecord[] => {
    return (slices() ?? []).filter((s) => s.frontmatter.status === status);
  };

  const blockerProjectIds = createMemo(() => [
    ...new Set(
      (slices() ?? [])
        .flatMap(blockedBy)
        .map(projectIdFromSliceId)
        .filter((pid) => pid && pid !== props.projectId)
    ),
  ]);

  const [externalBlockerSlices, { refetch: refetchExternalBlockers }] =
    createResource(
      () => blockerProjectIds().join(","),
      async (key) => {
        if (!key) return [] as SliceRecord[];
        const nested = await Promise.all(
          key.split(",").map(async (pid) => {
            try {
              return await fetchSlices(pid);
            } catch {
              return [] as SliceRecord[];
            }
          })
        );
        return nested.flat();
      }
    );

  // Live refresh on slice/project file changes. Debounced to collapse CLI and
  // orchestrator bursts that rewrite README + SCOPE_MAP together.
  createEffect(() => {
    const projectId = props.projectId;
    const externalProjectIds = blockerProjectIds();
    let refreshTimer: number | undefined;
    let agentRefreshTimer: number | undefined;
    let shouldRefreshSlices = false;
    let shouldRefreshExternalBlockers = false;

    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        if (shouldRefreshSlices) void refetch();
        if (shouldRefreshExternalBlockers) void refetchExternalBlockers();
        shouldRefreshSlices = false;
        shouldRefreshExternalBlockers = false;
        refreshTimer = undefined;
      }, 250);
    };

    const scheduleAgentRefresh = () => {
      if (agentRefreshTimer) window.clearTimeout(agentRefreshTimer);
      agentRefreshTimer = window.setTimeout(() => {
        void refetchAgentRuns();
        agentRefreshTimer = undefined;
      }, 250);
    };

    const unsubscribe = subscribeToFileChanges({
      onFileChanged: (changedProjectId) => {
        if (changedProjectId === projectId) {
          shouldRefreshSlices = true;
          scheduleRefresh();
          return;
        }
        if (externalProjectIds.includes(changedProjectId)) {
          shouldRefreshExternalBlockers = true;
          scheduleRefresh();
        }
      },
      onAgentChanged: (changedProjectId) => {
        if (changedProjectId === projectId) scheduleAgentRefresh();
      },
    });
    const unsubscribeSubagents = subscribeToSubagentChanges({
      onSubagentChanged: () => scheduleAgentRefresh(),
    });

    onCleanup(() => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      if (agentRefreshTimer) window.clearTimeout(agentRefreshTimer);
      unsubscribe();
      unsubscribeSubagents();
    });
  });

  const blockerStatusIndex = createMemo(() => {
    const index = new Map<string, SliceStatus>();
    for (const item of [
      ...(slices() ?? []),
      ...(externalBlockerSlices() ?? []),
    ]) {
      index.set(item.id, item.frontmatter.status);
    }
    return index;
  });

  const activeAgentSliceIds = createMemo(() => {
    const ids = new Set<string>();
    for (const run of agentRuns() ?? []) {
      if (run.status === "running" && run.sliceId) ids.add(run.sliceId);
    }
    return ids;
  });

  const pendingBlockers = (slice: SliceRecord): string[] => {
    const statusIndex = blockerStatusIndex();
    return blockedBy(slice).filter((blockerId) => {
      const status = statusIndex.get(blockerId);
      return !status || !TERMINAL_BLOCKER_STATUSES.has(status);
    });
  };

  const blockerTooltip = (slice: SliceRecord): string =>
    blockedBy(slice)
      .map(
        (blockerId) =>
          `${blockerId}: ${blockerStatusLabel(blockerStatusIndex().get(blockerId))}`
      )
      .join("\n");

  const handleCardDragStart = (slice: SliceRecord) => (e: DragEvent) => {
    setDraggingId(slice.id);
    setDraggingFromStatus(slice.frontmatter.status);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", slice.id);
    }
  };

  const handleCardDragEnd = () => {
    setDraggingId(null);
    setDraggingFromStatus(null);
    setDragOverColumn(null);
  };

  const handleColumnDragOver = (status: SliceStatus) => (e: DragEvent) => {
    if (!draggingId()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    setDragOverColumn(status);
  };

  const handleColumnDragLeave = (status: SliceStatus) => (e: DragEvent) => {
    if (e.currentTarget === e.target && dragOverColumn() === status) {
      setDragOverColumn(null);
    }
  };

  const handleColumnDrop = (status: SliceStatus) => async (e: DragEvent) => {
    if (!draggingId()) return;
    e.preventDefault();
    const id = e.dataTransfer?.getData("text/plain") || draggingId();
    if (!id) return;
    if (draggingFromStatus() === status) {
      setDragOverColumn(null);
      return;
    }
    // Optimistic update
    const prev = slices() ?? [];
    mutate(
      prev.map((s) =>
        s.id === id ? { ...s, frontmatter: { ...s.frontmatter, status } } : s
      )
    );
    setDragOverColumn(null);
    setDraggingId(null);
    setDraggingFromStatus(null);
    try {
      await updateSlice(props.projectId, id, { status });
      await refetch();
    } catch {
      mutate(prev);
    }
  };

  const handleCardClick = (slice: SliceRecord) => {
    if (props.onSliceClick) {
      props.onSliceClick(slice.id);
    } else {
      navigate(
        `/projects/${encodeURIComponent(props.projectId)}/slices/${encodeURIComponent(slice.id)}`
      );
    }
  };

  const handleAddSlice = async (status: SliceStatus) => {
    const title = newSliceTitle().trim();
    if (!title || creating()) return;
    setCreating(true);
    try {
      const { createSlice } = await import("../api/client");
      const created = await createSlice(props.projectId, { title, status });
      mutate([...(slices() ?? []), created]);
      setAddingToColumn(null);
      setNewSliceTitle("");
    } catch {
      // ignore; user can retry
    } finally {
      setCreating(false);
    }
  };

  return (
    <div class="slice-kanban">
      <Show when={slices.loading && !slices()}>
        <div class="slice-kanban-loading">Loading slices…</div>
      </Show>
      <Show when={slices.error}>
        <div class="slice-kanban-error">Failed to load slices.</div>
      </Show>
      <div class="slice-kanban-columns">
        <For each={COLUMNS}>
          {(col) => (
            <div
              class="slice-kanban-column"
              classList={{ "drop-target": dragOverColumn() === col.id }}
              onDragOver={handleColumnDragOver(col.id)}
              onDragLeave={handleColumnDragLeave(col.id)}
              onDrop={handleColumnDrop(col.id)}
            >
              <div class="slice-kanban-column-header">
                <span
                  class="slice-kanban-column-dot"
                  style={{ background: col.color }}
                />
                <span class="slice-kanban-column-title">{col.title}</span>
                <span class="slice-kanban-column-count">
                  {slicesByStatus(col.id).length}
                </span>
                <button
                  type="button"
                  class="slice-kanban-add-btn"
                  title={`Add slice to ${col.title}`}
                  onClick={() => {
                    setAddingToColumn(col.id);
                    setNewSliceTitle("");
                  }}
                >
                  +
                </button>
              </div>

              <Show when={addingToColumn() === col.id}>
                <form
                  class="slice-kanban-add-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleAddSlice(col.id);
                  }}
                >
                  <input
                    autofocus
                    class="slice-kanban-add-input"
                    placeholder="Slice title…"
                    value={newSliceTitle()}
                    onInput={(e) => setNewSliceTitle(e.currentTarget.value)}
                  />
                  <div class="slice-kanban-add-actions">
                    <button type="submit" disabled={creating()}>
                      {creating() ? "Adding…" : "Add"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddingToColumn(null);
                        setNewSliceTitle("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </Show>

              <div class="slice-kanban-cards">
                <For each={slicesByStatus(col.id)}>
                  {(slice) => {
                    const activeBlockers = createMemo(() =>
                      pendingBlockers(slice)
                    );
                    const isBlocked = createMemo(
                      () => activeBlockers().length > 0
                    );
                    return (
                      <div
                        class="slice-kanban-card"
                        classList={{
                          dragging: draggingId() === slice.id,
                          blocked: isBlocked(),
                        }}
                        draggable={true}
                        onDragStart={handleCardDragStart(slice)}
                        onDragEnd={handleCardDragEnd}
                        onClick={() => handleCardClick(slice)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            handleCardClick(slice);
                        }}
                        aria-label={`Slice: ${slice.frontmatter.title}`}
                      >
                        <div class="slice-card-id">{slice.id}</div>
                        <div class="slice-card-title-row">
                          <div class="slice-card-title">
                            {slice.frontmatter.title}
                          </div>
                          <Show when={isBlocked()}>
                            <span
                              class="slice-card-blocked-badge"
                              title={blockerTooltip(slice)}
                              aria-label={`Blocked by ${activeBlockers().join(", ")}`}
                            >
                              ⛔ blocked
                            </span>
                          </Show>
                          <Show when={activeAgentSliceIds().has(slice.id)}>
                            <span
                              class="slice-card-agent-active"
                              aria-label={`Agent active on slice ${slice.id}`}
                            >
                              ● agent active
                            </span>
                          </Show>
                        </div>
                        <div class="slice-card-meta">
                          <span class="slice-card-hill">
                            {slice.frontmatter.hill_position}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
      <style>{`
        .slice-kanban {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .slice-kanban-loading,
        .slice-kanban-error {
          padding: 24px;
          color: var(--text-secondary);
          font-size: 13px;
        }

        .slice-kanban-columns {
          display: flex;
          gap: 12px;
          overflow-x: auto;
          padding: 12px;
          height: 100%;
          align-items: flex-start;
        }

        .slice-kanban-column {
          min-width: 200px;
          max-width: 240px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-radius: 8px;
          padding: 8px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          transition: border-color 0.15s;
        }

        .slice-kanban-column.drop-target {
          border-color: var(--accent);
          background: color-mix(in srgb, var(--accent) 8%, var(--bg-surface));
        }

        .slice-kanban-column-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 2px;
        }

        .slice-kanban-column-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .slice-kanban-column-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .slice-kanban-column-count {
          font-size: 11px;
          color: var(--text-tertiary);
          background: var(--bg-elevated);
          border-radius: 8px;
          padding: 1px 6px;
        }

        .slice-kanban-add-btn {
          border: none;
          background: none;
          color: var(--text-tertiary);
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          padding: 0 2px;
          border-radius: 4px;
          transition: color 0.1s;
        }

        .slice-kanban-add-btn:hover {
          color: var(--text-primary);
          background: var(--bg-elevated);
        }

        .slice-kanban-add-form {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 6px;
          background: var(--bg-elevated);
          border-radius: 6px;
        }

        .slice-kanban-add-input {
          font-size: 13px;
          padding: 4px 8px;
          border: 1px solid var(--border-default);
          border-radius: 4px;
          background: var(--bg-base);
          color: var(--text-primary);
          width: 100%;
          box-sizing: border-box;
        }

        .slice-kanban-add-actions {
          display: flex;
          gap: 6px;
        }

        .slice-kanban-add-actions button {
          flex: 1;
          font-size: 12px;
          padding: 3px 8px;
          border-radius: 4px;
          border: 1px solid var(--border-default);
          background: var(--bg-surface);
          color: var(--text-primary);
          cursor: pointer;
        }

        .slice-kanban-add-actions button[type="submit"] {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
        }

        .slice-kanban-cards {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .slice-kanban-card {
          padding: 10px 12px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          cursor: pointer;
          transition: border-color 0.15s, box-shadow 0.15s, opacity 0.15s;
          user-select: none;
        }

        .slice-kanban-card.blocked {
          opacity: 0.7;
        }

        .slice-kanban-card:hover {
          border-color: var(--border-default);
          box-shadow: 0 1px 4px rgba(0,0,0,0.08);
        }

        .slice-kanban-card:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }

        .slice-kanban-card.dragging {
          opacity: 0.4;
        }

        .slice-card-id {
          font-size: 10px;
          font-family: var(--font-mono, monospace);
          color: var(--text-tertiary);
          margin-bottom: 4px;
        }

        .slice-card-title {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary);
          line-height: 1.4;
          word-break: break-word;
        }

        .slice-card-title-row {
          display: flex;
          align-items: flex-start;
          gap: 6px;
        }

        .slice-card-title-row .slice-card-title {
          min-width: 0;
          flex: 1;
        }

        .slice-card-blocked-badge {
          flex-shrink: 0;
          font-size: 10px;
          line-height: 1.2;
          color: #9a3412;
          background: #fff7ed;
          border: 1px solid #fed7aa;
          border-radius: 4px;
          padding: 1px 5px;
        }

        .slice-card-agent-active {
          flex-shrink: 0;
          font-size: 10px;
          line-height: 1.2;
          color: #166534;
          background: #dcfce7;
          border: 1px solid #86efac;
          border-radius: 4px;
          padding: 1px 5px;
        }

        .slice-card-meta {
          margin-top: 6px;
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .slice-card-hill {
          font-size: 10px;
          color: var(--text-tertiary);
          background: var(--bg-elevated);
          border-radius: 4px;
          padding: 1px 5px;
        }
      `}</style>
    </div>
  );
}
