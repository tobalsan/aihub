import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { fetchProject, updateProject } from "../../api";
import type { ProjectDetail } from "../../api/types";
import { DocEditor } from "./DocEditor";
import { TasksEditor } from "./TasksEditor";

const DEFAULT_TAB_ORDER = ["README", "SPECS", "TASKS", "VALIDATION"];
const POLL_INTERVAL_MS = 5000;

interface ProjectDetailPanelProps {
  projectId: string;
  onBack: () => void;
}

export function ProjectDetailPanel(props: ProjectDetailPanelProps) {
  const [detail, setDetail] = createSignal<ProjectDetail | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [activeTab, setActiveTab] = createSignal<string>("README");

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  const tabs = createMemo<string[]>(() => {
    const d = detail();
    if (!d) return DEFAULT_TAB_ORDER;
    const keys = Object.keys(d.docs ?? {});
    const ordered: string[] = [];
    for (const k of DEFAULT_TAB_ORDER) {
      if (keys.includes(k)) ordered.push(k);
    }
    for (const k of keys) {
      if (!ordered.includes(k)) ordered.push(k);
    }
    if (ordered.length === 0) return DEFAULT_TAB_ORDER;
    return ordered;
  });

  async function load() {
    try {
      const d = await fetchProject(props.projectId);
      if (disposed) return;
      setDetail(d);
      setError(null);
      const available = Object.keys(d.docs ?? {});
      if (available.length > 0 && !available.includes(activeTab())) {
        const preferred = DEFAULT_TAB_ORDER.find((k) => available.includes(k));
        setActiveTab(preferred ?? available[0]);
      }
    } catch (err) {
      if (disposed) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveDoc(key: string, content: string): Promise<void> {
    const updated = await updateProject(props.projectId, {
      docs: { [key]: content },
    });
    if (disposed) return;
    setDetail(updated);
  }

  onMount(() => {
    void load();
    pollTimer = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
  });

  onCleanup(() => {
    disposed = true;
    if (pollTimer) clearInterval(pollTimer);
  });

  return (
    <div class="pdp">
      <header class="pdp-header">
        <button
          type="button"
          class="pdp-back"
          onClick={props.onBack}
          aria-label="Back to projects"
          title="Back to projects"
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
        <span class="pdp-id">{props.projectId}</span>
        <span class="pdp-title">{detail()?.title ?? ""}</span>
      </header>

      <Show when={error()}>
        <div class="pdp-error">{error()}</div>
      </Show>

      <div class="pdp-tabs" role="tablist">
        <For each={tabs()}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab() === tab}
              classList={{ "pdp-tab": true, active: activeTab() === tab }}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          )}
        </For>
      </div>

      <div class="pdp-body">
        <Show when={detail()} fallback={<div class="pdp-loading">Loading…</div>}>
          <Switch>
            <Match when={activeTab() === "TASKS"}>
              <TasksEditor
                projectId={props.projectId}
                content={detail()!.docs?.TASKS ?? ""}
                onSave={(content: string) => saveDoc("TASKS", content)}
              />
            </Match>
            <Match when={true}>
              <DocEditor
                projectId={props.projectId}
                docKey={activeTab()}
                content={detail()!.docs?.[activeTab()] ?? ""}
                onSave={(content: string) => saveDoc(activeTab(), content)}
              />
            </Match>
          </Switch>
        </Show>
      </div>

      <style>{`
        .pdp {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 12px;
          color: var(--text-primary);
          min-height: 0;
        }
        .pdp-header {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }
        .pdp-back {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          background: transparent;
          border: 1px solid var(--border-default);
          color: var(--text-secondary);
          cursor: pointer;
          transition: background 0.12s, color 0.12s, border-color 0.12s;
        }
        .pdp-back:hover {
          background: var(--bg-surface);
          color: var(--text-primary);
          border-color: var(--text-accent, #6366f1);
        }
        .pdp-id {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px;
          color: var(--text-accent, #6366f1);
          padding: 2px 8px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--text-accent, #6366f1) 12%, transparent);
        }
        .pdp-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pdp-error {
          font-size: 13px;
          color: #f87171;
          padding: 8px 12px;
          border: 1px solid color-mix(in srgb, #f87171 35%, var(--border-default));
          border-radius: 6px;
          background: color-mix(in srgb, #f87171 8%, var(--bg-surface));
        }
        .pdp-tabs {
          display: flex;
          gap: 2px;
          border-bottom: 1px solid var(--border-default);
          flex-shrink: 0;
          overflow-x: auto;
        }
        .pdp-tab {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-family: inherit;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 8px 14px;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          transition: color 0.12s, border-color 0.12s;
          white-space: nowrap;
        }
        .pdp-tab:hover {
          color: var(--text-primary);
        }
        .pdp-tab.active {
          color: var(--text-primary);
          border-bottom-color: var(--text-accent, #6366f1);
        }
        .pdp-body {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .pdp-loading {
          padding: 32px;
          font-size: 13px;
          color: var(--text-secondary);
          text-align: center;
        }
      `}</style>
    </div>
  );
}
