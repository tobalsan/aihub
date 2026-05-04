/**
 * SliceDetailPage — full slice card view.
 * Route: /projects/:projectId/slices/:sliceId
 *
 * Renders: frontmatter + Specs + Tasks + Validation + Thread + recent runs.
 */
import { useNavigate, useParams } from "@solidjs/router";
import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  fetchSlices,
  fetchSlice,
  fetchSubagents,
  updateSlice,
  subscribeToFileChanges,
} from "../api/client";
import type { SliceStatus, SliceRecord, SubagentListItem, SubagentStatus } from "../api/types";

const RUN_STATUS_LABELS: Record<SubagentStatus, string> = {
  running: "Running",
  replied: "Done",
  error: "Error",
  idle: "Idle",
};

const STATUS_LABELS: Record<SliceStatus, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  review: "Review",
  ready_to_merge: "Ready to Merge",
  done: "Done",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<SliceStatus, string> = {
  todo: "#3b6ecc",
  in_progress: "#8a6fd1",
  review: "#f08b57",
  ready_to_merge: "#2fb6a3",
  done: "#53b97c",
  cancelled: "#6b6b6b",
};

const ALL_STATUSES: SliceStatus[] = [
  "todo",
  "in_progress",
  "review",
  "ready_to_merge",
  "done",
  "cancelled",
];

const UNKNOWN_STATUS_COLOR = "#6b6b6b";
const UNKNOWN_STATUS_LABEL = "Unknown";

type SectionTab = "specs" | "tasks" | "validation" | "thread";
type BlockerDetail = {
  id: string;
  projectId: string;
  status: SliceStatus | null;
  title: string;
};

function blockedBy(slice: SliceRecord | undefined): string[] {
  return Array.isArray(slice?.frontmatter.blocked_by)
    ? slice.frontmatter.blocked_by.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
}

function projectIdFromSliceId(sliceId: string): string {
  return sliceId.match(/^(PRO-\d+)-S\d+$/)?.[1] ?? "";
}

function parseChecklistItems(text: string): Array<{ checked: boolean; label: string }> {
  return text
    .split(/\r?\n/)
    .map((line) => line.match(/^- \[([ xX])\] (.+)$/))
    .filter(Boolean)
    .map((m) => ({
      checked: m![1] !== " ",
      label: m![2],
    }));
}

function formatRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch {
    return "";
  }
}

function SliceMarkdownSection(props: { label: string; content: string }) {
  return (
    <div class="slice-detail-section">
      <h3 class="slice-detail-section-title">{props.label}</h3>
      <Show
        when={props.content.trim()}
        fallback={<p class="slice-detail-empty">No content yet.</p>}
      >
        <pre class="slice-detail-preformatted">{props.content}</pre>
      </Show>
    </div>
  );
}

function SliceTasksSection(props: { content: string }) {
  const items = createMemo(() => parseChecklistItems(props.content));

  return (
    <div class="slice-detail-section">
      <h3 class="slice-detail-section-title">
        Tasks{" "}
        <span class="slice-detail-progress-badge">
          {items().filter((i) => i.checked).length}/{items().length}
        </span>
      </h3>
      <Show when={items().length === 0} fallback={null}>
        <p class="slice-detail-empty">No tasks yet.</p>
      </Show>
      <Show when={items().length > 0}>
        <ul class="slice-detail-checklist">
          <For each={items()}>
            {(item) => (
              <li class="slice-detail-checklist-item">
                <span
                  class="slice-detail-checkbox"
                  classList={{ checked: item.checked }}
                  aria-hidden="true"
                >
                  {item.checked ? "✓" : "○"}
                </span>
                <span
                  class="slice-detail-checklist-label"
                  classList={{ done: item.checked }}
                >
                  {item.label}
                </span>
              </li>
            )}
          </For>
        </ul>
        <Show when={props.content.trim()}>
          <details class="slice-detail-raw-toggle">
            <summary>Raw TASKS.md</summary>
            <pre class="slice-detail-preformatted">{props.content}</pre>
          </details>
        </Show>
      </Show>
    </div>
  );
}

export function SliceDetailPage() {
  const params = useParams<{ projectId: string; sliceId: string }>();
  const navigate = useNavigate();

  const projectId = createMemo(() => params.projectId ?? "");
  const sliceId = createMemo(() => params.sliceId ?? "");

  const [activeTab, setActiveTab] = createSignal<SectionTab>("specs");
  const [statusChanging, setStatusChanging] = createSignal(false);

  const [slice, { mutate, refetch }] = createResource(
    () => ({ projectId: projectId(), sliceId: sliceId() }),
    ({ projectId, sliceId }) => fetchSlice(projectId, sliceId)
  );

  // Recent runs: fetch project subagents, filter by sliceId
  const [recentRuns] = createResource(
    () => ({ projectId: projectId(), sliceId: sliceId() }),
    async ({ projectId, sliceId }) => {
      const result = await fetchSubagents(projectId, true);
      if (!result.ok) return [] as SubagentListItem[];
      return result.data.items.filter((s) => s.sliceId === sliceId);
    }
  );

  // Live refresh
  createResource(() => projectId(), (pid) => {
    const unsub = subscribeToFileChanges({
      onFileChanged: (changedId) => {
        if (changedId === pid) void refetch();
      },
    });
    onCleanup(unsub);
  });

  const handleStatusChange = async (status: SliceStatus) => {
    if (statusChanging()) return;
    setStatusChanging(true);
    const prev = slice();
    if (prev) {
      mutate({ ...prev, frontmatter: { ...prev.frontmatter, status } });
    }
    try {
      const updated = await updateSlice(projectId(), sliceId(), { status });
      mutate(updated);
    } catch {
      if (prev) mutate(prev);
    } finally {
      setStatusChanging(false);
    }
  };

  const handleBack = () => {
    navigate(`/projects/${encodeURIComponent(projectId())}`);
  };

  const frontmatter = createMemo(() => slice()?.frontmatter);
  const docs = createMemo(() => slice()?.docs);
  const blockerIds = createMemo(() => blockedBy(slice()));
  const blockerProjectIds = createMemo(() => [
    ...new Set(blockerIds().map(projectIdFromSliceId).filter(Boolean)),
  ]);
  const [blockerSlices] = createResource(
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
  const blockerDetails = createMemo<BlockerDetail[]>(() => {
    const byId = new Map(
      (blockerSlices() ?? []).map((item) => [item.id, item])
    );
    return blockerIds().map((id) => {
      const resolved = byId.get(id);
      return {
        id,
        projectId: projectIdFromSliceId(id) || projectId(),
        status: resolved?.frontmatter.status ?? null,
        title: resolved?.frontmatter.title ?? "Missing slice",
      };
    });
  });

  return (
    <div class="slice-detail-page">
      <Show when={slice.loading && !slice()}>
        <div class="slice-detail-state">Loading slice…</div>
      </Show>
      <Show when={slice.error}>
        <div class="slice-detail-state">Failed to load slice.</div>
      </Show>
      <Show when={slice()}>
        {(detail: () => SliceRecord) => (
          <>
            <header class="slice-detail-breadcrumb">
              <button
                type="button"
                class="slice-detail-back"
                onClick={handleBack}
              >
                ← Back to project
              </button>
              <span class="slice-detail-sep">/</span>
              <span class="slice-detail-id">{detail().id}</span>
              <span class="slice-detail-sep">/</span>
              <span class="slice-detail-title-crumb">{detail().frontmatter.title}</span>
            </header>

            <div class="slice-detail-body">
              {/* Left: metadata */}
              <aside class="slice-detail-sidebar">
                <div class="slice-detail-meta-group">
                  <div class="slice-detail-meta-label">Status</div>
                  <div class="slice-detail-status-row">
                    <span
                      class="slice-detail-status-pill"
                      style={{ background: STATUS_COLORS[frontmatter()!.status] }}
                    >
                      {STATUS_LABELS[frontmatter()!.status]}
                    </span>
                  </div>
                  <div class="slice-detail-status-buttons">
                    <For each={ALL_STATUSES}>
                      {(s) => (
                        <button
                          type="button"
                          class="slice-detail-status-btn"
                          classList={{
                            active: frontmatter()!.status === s,
                          }}
                          disabled={statusChanging() || frontmatter()!.status === s}
                          onClick={() => void handleStatusChange(s)}
                          style={{ "--dot-color": STATUS_COLORS[s] } as Record<string, string>}
                        >
                          <span class="slice-status-btn-dot" />
                          {STATUS_LABELS[s]}
                        </button>
                      )}
                    </For>
                  </div>
                </div>

                <div class="slice-detail-meta-group">
                  <div class="slice-detail-meta-label">Hill position</div>
                  <div class="slice-detail-meta-value">
                    {frontmatter()?.hill_position ?? "—"}
                  </div>
                </div>

                <Show when={blockerDetails().length > 0}>
                  <div class="slice-detail-meta-group slice-detail-blockers">
                    <div class="slice-detail-meta-label">
                      Blockers ({blockerDetails().length})
                    </div>
                    <For each={blockerDetails()}>
                      {(blocker) => (
                        <a
                          class="slice-detail-blocker-row"
                          href={`/projects/${encodeURIComponent(blocker.projectId)}/slices/${encodeURIComponent(blocker.id)}`}
                          onClick={(event) => {
                            event.preventDefault();
                            navigate(
                              `/projects/${encodeURIComponent(blocker.projectId)}/slices/${encodeURIComponent(blocker.id)}`
                            );
                          }}
                        >
                          <span class="slice-detail-blocker-id">
                            {blocker.id}
                          </span>
                          <span
                            class="slice-detail-status-pill slice-detail-blocker-status"
                            style={{
                              background: blocker.status
                                ? STATUS_COLORS[blocker.status]
                                : UNKNOWN_STATUS_COLOR,
                            }}
                          >
                            {blocker.status
                              ? STATUS_LABELS[blocker.status]
                              : UNKNOWN_STATUS_LABEL}
                          </span>
                          <span class="slice-detail-blocker-title">
                            {blocker.title}
                          </span>
                        </a>
                      )}
                    </For>
                  </div>
                </Show>

                <div class="slice-detail-meta-group">
                  <div class="slice-detail-meta-label">Created</div>
                  <div class="slice-detail-meta-value">
                    {formatRelative(frontmatter()?.created_at as string ?? "")}
                  </div>
                </div>

                <div class="slice-detail-meta-group">
                  <div class="slice-detail-meta-label">Updated</div>
                  <div class="slice-detail-meta-value">
                    {formatRelative(frontmatter()?.updated_at as string ?? "")}
                  </div>
                </div>

                <div class="slice-detail-meta-group">
                  <div class="slice-detail-meta-label">Recent Runs</div>
                  <Show when={recentRuns.loading}>
                    <div class="slice-detail-runs-empty">Loading…</div>
                  </Show>
                  <Show when={!recentRuns.loading && (recentRuns() ?? []).length === 0}>
                    <div class="slice-detail-runs-empty">No runs yet.</div>
                  </Show>
                  <For each={recentRuns() ?? []}>
                    {(run) => (
                      <div class="slice-detail-run-row">
                        <span class="slice-detail-run-name">{run.name ?? run.slug}</span>
                        <span
                          class="slice-detail-run-status"
                          classList={{
                            "run-running": run.status === "running",
                            "run-done": run.status === "replied",
                            "run-error": run.status === "error",
                          }}
                        >
                          {RUN_STATUS_LABELS[run.status] ?? run.status}
                        </span>
                      </div>
                    )}
                  </For>
                </div>

                {/* Frontmatter extras (any keys beyond known ones) */}
                <For each={Object.entries(frontmatter() ?? {}).filter(
                  ([k]) => !["id","project_id","title","status","blocked_by","hill_position","created_at","updated_at"].includes(k)
                )}>
                  {([key, value]) => (
                    <div class="slice-detail-meta-group">
                      <div class="slice-detail-meta-label">{key}</div>
                      <div class="slice-detail-meta-value slice-detail-meta-mono">
                        {typeof value === "string" ? value : JSON.stringify(value)}
                      </div>
                    </div>
                  )}
                </For>
              </aside>

              {/* Center: docs */}
              <main class="slice-detail-main">
                {/* README must/nice */}
                <section class="slice-detail-readme">
                  <Show
                    when={docs()?.readme?.trim()}
                    fallback={<p class="slice-detail-empty">No description yet.</p>}
                  >
                    <pre class="slice-detail-preformatted">{docs()?.readme}</pre>
                  </Show>
                </section>

                {/* Tabs: Specs | Tasks | Validation | Thread */}
                <nav class="slice-detail-tabs">
                  <For each={[
                    { id: "specs" as SectionTab, label: "Specs" },
                    { id: "tasks" as SectionTab, label: "Tasks" },
                    { id: "validation" as SectionTab, label: "Validation" },
                    { id: "thread" as SectionTab, label: "Thread" },
                  ]}>
                    {(tab) => (
                      <button
                        type="button"
                        class="slice-detail-tab-btn"
                        classList={{ active: activeTab() === tab.id }}
                        onClick={() => setActiveTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    )}
                  </For>
                </nav>

                <div class="slice-detail-tab-content">
                  <Show when={activeTab() === "specs"}>
                    <SliceMarkdownSection label="SPECS.md" content={docs()?.specs ?? ""} />
                  </Show>
                  <Show when={activeTab() === "tasks"}>
                    <SliceTasksSection content={docs()?.tasks ?? ""} />
                  </Show>
                  <Show when={activeTab() === "validation"}>
                    <SliceMarkdownSection label="VALIDATION.md" content={docs()?.validation ?? ""} />
                  </Show>
                  <Show when={activeTab() === "thread"}>
                    <SliceMarkdownSection label="THREAD.md" content={docs()?.thread ?? ""} />
                  </Show>
                </div>
              </main>
            </div>
          </>
        )}
      </Show>
      <style>{`
        .slice-detail-page {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-base);
          color: var(--text-primary);
          overflow: hidden;
        }

        .slice-detail-state {
          padding: 24px;
          color: var(--text-secondary);
          font-size: 13px;
        }

        .slice-detail-breadcrumb {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border-bottom: 1px solid var(--border-subtle);
          font-size: 13px;
          color: var(--text-secondary);
          flex-shrink: 0;
          overflow: hidden;
          white-space: nowrap;
        }

        .slice-detail-back {
          background: none;
          border: none;
          color: var(--text-primary);
          cursor: pointer;
          font-size: 13px;
          padding: 0;
        }

        .slice-detail-sep { color: var(--text-tertiary); }

        .slice-detail-id {
          font-family: var(--font-mono, monospace);
          font-size: 12px;
          color: var(--text-tertiary);
        }

        .slice-detail-title-crumb {
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 500;
          color: var(--text-primary);
        }

        .slice-detail-body {
          flex: 1;
          display: flex;
          gap: 0;
          overflow: hidden;
        }

        .slice-detail-sidebar {
          width: 200px;
          flex-shrink: 0;
          border-right: 1px solid var(--border-subtle);
          overflow-y: auto;
          padding: 16px 12px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .slice-detail-meta-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .slice-detail-meta-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-tertiary);
        }

        .slice-detail-meta-value {
          font-size: 13px;
          color: var(--text-secondary);
        }

        .slice-detail-meta-mono {
          font-family: var(--font-mono, monospace);
          font-size: 11px;
          word-break: break-all;
        }

        .slice-detail-status-row {
          margin-bottom: 6px;
        }

        .slice-detail-status-pill {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 600;
          color: #fff;
        }

        .slice-detail-blockers {
          gap: 6px;
        }

        .slice-detail-blocker-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 4px;
          padding: 7px 8px;
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          color: inherit;
          text-decoration: none;
          background: var(--bg-surface);
        }

        .slice-detail-blocker-row:hover {
          border-color: var(--border-default);
          background: var(--bg-elevated);
        }

        .slice-detail-blocker-row:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }

        .slice-detail-blocker-id {
          font-family: var(--font-mono, monospace);
          font-size: 11px;
          color: var(--text-tertiary);
        }

        .slice-detail-blocker-status {
          width: fit-content;
          font-size: 10px;
          padding: 1px 6px;
        }

        .slice-detail-blocker-title {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .slice-detail-status-buttons {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .slice-detail-status-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background: none;
          border: 1px solid transparent;
          border-radius: 4px;
          padding: 3px 6px;
          font-size: 12px;
          color: var(--text-secondary);
          cursor: pointer;
          text-align: left;
          transition: background 0.1s;
        }

        .slice-detail-status-btn:hover:not(:disabled) {
          background: var(--bg-elevated);
        }

        .slice-detail-status-btn.active {
          background: var(--bg-elevated);
          border-color: var(--border-default);
          color: var(--text-primary);
          font-weight: 600;
        }

        .slice-detail-status-btn:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .slice-status-btn-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--dot-color, var(--text-tertiary));
          flex-shrink: 0;
        }

        .slice-detail-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-width: 0;
        }

        .slice-detail-readme {
          padding: 16px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          max-height: 160px;
          overflow-y: auto;
        }

        .slice-detail-tabs {
          display: flex;
          gap: 0;
          border-bottom: 1px solid var(--border-subtle);
          padding: 0 12px;
          flex-shrink: 0;
        }

        .slice-detail-tab-btn {
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          padding: 8px 12px;
          font-size: 13px;
          color: var(--text-secondary);
          cursor: pointer;
          transition: color 0.1s, border-color 0.1s;
        }

        .slice-detail-tab-btn.active {
          color: var(--text-primary);
          border-bottom-color: var(--accent, #7c6aff);
        }

        .slice-detail-tab-content {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }

        .slice-detail-section {}

        .slice-detail-section-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          margin: 0 0 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .slice-detail-progress-badge {
          font-size: 11px;
          font-weight: 400;
          background: var(--bg-elevated);
          border-radius: 8px;
          padding: 1px 6px;
          color: var(--text-tertiary);
        }

        .slice-detail-preformatted {
          white-space: pre-wrap;
          word-break: break-word;
          font-family: var(--font-mono, monospace);
          font-size: 12px;
          color: var(--text-secondary);
          background: var(--bg-surface);
          border-radius: 6px;
          padding: 12px;
          margin: 0;
          line-height: 1.6;
        }

        .slice-detail-empty {
          color: var(--text-tertiary);
          font-size: 13px;
          margin: 0;
        }

        .slice-detail-checklist {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .slice-detail-checklist-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 13px;
        }

        .slice-detail-checkbox {
          color: var(--text-tertiary);
          font-size: 12px;
          flex-shrink: 0;
          margin-top: 1px;
        }

        .slice-detail-checkbox.checked {
          color: var(--success, #53b97c);
        }

        .slice-detail-checklist-label.done {
          color: var(--text-tertiary);
          text-decoration: line-through;
        }

        .slice-detail-raw-toggle {
          margin-top: 12px;
        }

        .slice-detail-raw-toggle summary {
          font-size: 12px;
          color: var(--text-tertiary);
          cursor: pointer;
          user-select: none;
        }

        @media (max-width: 768px) {
          .slice-detail-body {
            flex-direction: column;
          }
          .slice-detail-sidebar {
            width: 100%;
            border-right: none;
            border-bottom: 1px solid var(--border-subtle);
            max-height: 200px;
            flex-direction: row;
            flex-wrap: wrap;
            gap: 12px;
          }
        }

        .slice-detail-runs-empty {
          font-size: 12px;
          color: var(--text-tertiary);
          padding: 2px 0;
        }

        .slice-detail-run-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          padding: 3px 0;
          border-bottom: 1px solid var(--border-subtle);
        }

        .slice-detail-run-row:last-child {
          border-bottom: none;
        }

        .slice-detail-run-name {
          font-size: 12px;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          min-width: 0;
        }

        .slice-detail-run-status {
          font-size: 11px;
          border-radius: 4px;
          padding: 1px 5px;
          background: var(--bg-elevated);
          color: var(--text-tertiary);
          flex-shrink: 0;
        }

        .slice-detail-run-status.run-running {
          background: color-mix(in srgb, #8a6fd1 15%, var(--bg-elevated));
          color: #8a6fd1;
        }

        .slice-detail-run-status.run-done {
          background: color-mix(in srgb, #53b97c 15%, var(--bg-elevated));
          color: #53b97c;
        }

        .slice-detail-run-status.run-error {
          background: color-mix(in srgb, #e05c5c 15%, var(--bg-elevated));
          color: #e05c5c;
        }
      `}</style>
    </div>
  );
}
