import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import type { Area, ProjectDetail } from "../../api/types";

const STATUS_OPTIONS = [
  "not_now",
  "maybe",
  "shaping",
  "todo",
  "in_progress",
  "review",
  "done",
  "cancelled",
  "archived",
];

type AgentPanelProps = {
  project: ProjectDetail;
  area?: Area;
  areas: Area[];
  onTitleChange: (title: string) => Promise<void> | void;
  onStatusChange: (status: string) => Promise<void> | void;
  onAreaChange: (area: string) => Promise<void> | void;
  onRepoChange: (repo: string) => Promise<void> | void;
};

function getFrontmatterString(
  frontmatter: Record<string, unknown>,
  key: string
): string {
  const value = frontmatter[key];
  return typeof value === "string" ? value : "";
}

function formatCreatedRelative(raw: string): string {
  if (!raw) return "Created —";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "Created —";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const created = new Date(date);
  created.setHours(0, 0, 0, 0);

  const days = Math.floor((today.getTime() - created.getTime()) / 86400000);
  if (days <= 0) return "Created today";
  if (days === 1) return "Created yesterday";
  if (days < 14) return `Created ${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `Created ${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

export function AgentPanel(props: AgentPanelProps) {
  const [statusMenuOpen, setStatusMenuOpen] = createSignal(false);
  const [areaMenuOpen, setAreaMenuOpen] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [editingTitle, setEditingTitle] = createSignal(false);
  const [titleDraft, setTitleDraft] = createSignal("");
  const [savingTitle, setSavingTitle] = createSignal(false);
  const [editingRepo, setEditingRepo] = createSignal(false);
  const [repoDraft, setRepoDraft] = createSignal("");
  const [savingRepo, setSavingRepo] = createSignal(false);

  const status = () =>
    getFrontmatterString(props.project.frontmatter, "status") || "unknown";
  const repo = () => getFrontmatterString(props.project.frontmatter, "repo");
  const created = () =>
    getFrontmatterString(props.project.frontmatter, "created");
  const areaLabel = () => props.area?.title || "No area";

  let statusMenuRef: HTMLDivElement | undefined;
  let areaMenuRef: HTMLDivElement | undefined;
  let copiedTimer: number | undefined;

  createEffect(() => {
    if (editingTitle()) return;
    setTitleDraft(props.project.title);
  });

  createEffect(() => {
    if (editingRepo()) return;
    setRepoDraft(repo());
  });

  onMount(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (statusMenuOpen() && !statusMenuRef?.contains(target ?? null)) {
        setStatusMenuOpen(false);
      }
      if (areaMenuOpen() && !areaMenuRef?.contains(target ?? null)) {
        setAreaMenuOpen(false);
      }
    };

    document.addEventListener("click", onDocumentClick);
    onCleanup(() => {
      document.removeEventListener("click", onDocumentClick);
      if (copiedTimer) window.clearTimeout(copiedTimer);
    });
  });

  const handleCopyPath = async () => {
    const text = props.project.absolutePath || props.project.path;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copiedTimer) window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore clipboard failures
    }
  };

  const saveRepo = async () => {
    if (savingRepo()) return;
    const value = repoDraft().trim();
    if (value === repo().trim()) {
      setEditingRepo(false);
      return;
    }
    setSavingRepo(true);
    try {
      await props.onRepoChange(value);
      setEditingRepo(false);
    } finally {
      setSavingRepo(false);
    }
  };

  const saveTitle = async () => {
    if (savingTitle()) return;
    const value = titleDraft().trim();
    if (!value || value === props.project.title) {
      setEditingTitle(false);
      setTitleDraft(props.project.title);
      return;
    }
    setSavingTitle(true);
    try {
      await props.onTitleChange(value);
      setEditingTitle(false);
    } finally {
      setSavingTitle(false);
    }
  };

  return (
    <>
      <aside class="agent-panel">
        <section class="agent-panel-block">
          <div class="agent-panel-headline">
            <button
              type="button"
              class="project-id-pill"
              classList={{ copied: copied() }}
              onClick={() => void handleCopyPath()}
              title="Copy project path"
            >
              {props.project.id}
            </button>
            <Show
              when={!editingTitle()}
              fallback={
                <input
                  class="agent-panel-input title-input"
                  type="text"
                  value={titleDraft()}
                  disabled={savingTitle()}
                  onInput={(event) => setTitleDraft(event.currentTarget.value)}
                  onBlur={() => void saveTitle()}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setEditingTitle(false);
                      setTitleDraft(props.project.title);
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveTitle();
                    }
                  }}
                  autofocus
                />
              }
            >
              <h2
                class="agent-panel-title"
                ondblclick={() => setEditingTitle(true)}
                title="Double-click to edit title"
              >
                {props.project.title}
              </h2>
            </Show>
          </div>

          <div class="agent-panel-meta">
            <div class="meta-field" ref={areaMenuRef}>
              <button
                type="button"
                class="agent-badge"
                style={
                  props.area
                    ? {
                        "border-color": props.area.color,
                        color: props.area.color,
                      }
                    : undefined
                }
                onClick={(event) => {
                  event.stopPropagation();
                  setAreaMenuOpen((open) => !open);
                }}
              >
                {areaLabel()}
              </button>
              <Show when={areaMenuOpen()}>
                <div class="meta-menu">
                  <button
                    type="button"
                    class="meta-item"
                    onClick={() => {
                      void props.onAreaChange("");
                      setAreaMenuOpen(false);
                    }}
                  >
                    Unset area
                  </button>
                  <For each={props.areas}>
                    {(item) => (
                      <button
                        type="button"
                        class="meta-item"
                        onClick={() => {
                          void props.onAreaChange(item.id);
                          setAreaMenuOpen(false);
                        }}
                      >
                        {item.title}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <div class="meta-field" ref={statusMenuRef}>
              <button
                type="button"
                class="agent-badge"
                onClick={(event) => {
                  event.stopPropagation();
                  setStatusMenuOpen((open) => !open);
                }}
              >
                {status()}
              </button>
              <Show when={statusMenuOpen()}>
                <div class="meta-menu">
                  <For each={STATUS_OPTIONS}>
                    {(option) => (
                      <button
                        type="button"
                        class="meta-item"
                        onClick={() => {
                          void props.onStatusChange(option);
                          setStatusMenuOpen(false);
                        }}
                      >
                        {option}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <span class="created-chip">{formatCreatedRelative(created())}</span>
          </div>
        </section>

        <section class="agent-panel-block">
          <div class="repo-row">
            <div class="agent-panel-label repo-label">Repo</div>
            <Show
              when={!editingRepo()}
              fallback={
                <input
                  class="agent-panel-input repo-input"
                  type="text"
                  value={repoDraft()}
                  placeholder={props.area?.repo || "Project repo path"}
                  disabled={savingRepo()}
                  onInput={(event) => setRepoDraft(event.currentTarget.value)}
                  onBlur={() => void saveRepo()}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setEditingRepo(false);
                      setRepoDraft(repo());
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveRepo();
                    }
                  }}
                  autofocus
                />
              }
            >
              <p
                class="agent-panel-text repo-value"
                ondblclick={() => {
                  setRepoDraft(repo());
                  setEditingRepo(true);
                }}
                title="Double-click to edit"
              >
                {repo() || props.area?.repo || "No repo set"}
              </p>
            </Show>
          </div>
        </section>

        <section class="agent-panel-block">
          <div class="agent-panel-label">Agents</div>
          <p class="agent-panel-text">Agents — coming soon</p>
        </section>
      </aside>
      <style>{`
        .agent-panel {
          min-height: 100%;
          background: #0a0a0f;
          color: #e4e4e7;
          padding: 18px 14px;
          display: grid;
          align-content: start;
          gap: 12px;
        }

        .agent-panel-block {
          border: 1px solid #1c2430;
          border-radius: 10px;
          background: #111722;
          padding: 10px;
        }

        .agent-panel-title {
          margin: 0;
          font-size: 15px;
          line-height: 1.4;
        }

        .agent-panel-headline {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          min-width: 0;
        }

        .project-id-pill {
          background: #141a23;
          border: 1px solid #2a3240;
          color: #9aa3b2;
          font-size: 11px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          padding: 5px 9px;
          border-radius: 999px;
          cursor: pointer;
          flex-shrink: 0;
        }

        .project-id-pill:hover {
          background: #1a2330;
          border-color: #3a4250;
          color: #b0b8c6;
        }

        .project-id-pill.copied {
          background: #2a4a3a;
          border-color: #4a7a5a;
          color: #a0e0b0;
        }

        .agent-panel-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .meta-field {
          position: relative;
        }

        .agent-badge {
          border: 1px solid #2a3240;
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #a1a1aa;
          background: transparent;
          cursor: pointer;
        }

        .meta-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          z-index: 3;
          background: #151c26;
          border: 1px solid #2a3240;
          border-radius: 10px;
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 140px;
        }

        .meta-item {
          background: transparent;
          border: none;
          color: #e0e6ef;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          text-align: left;
          padding: 6px 8px;
          border-radius: 8px;
          cursor: pointer;
        }

        .meta-item:hover {
          background: #232c3a;
        }

        .created-chip {
          color: #8b93a1;
          font-size: 11px;
          line-height: 1.4;
          align-self: center;
          margin-left: 8px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .agent-panel-label {
          color: #71717a;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 4px;
        }

        .agent-panel-text {
          margin: 0;
          color: #d4d4d8;
          font-size: 12px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .repo-value {
          cursor: text;
          border-radius: 6px;
          padding: 0 8px;
          margin: 0;
          height: 30px;
          line-height: 30px;
          box-sizing: border-box;
          display: block;
          flex: 1;
          min-width: 0;
          text-align: right;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .repo-value:hover {
          background: rgba(255, 255, 255, 0.04);
        }

        .repo-row {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .repo-label {
          margin-bottom: 0;
          flex-shrink: 0;
        }

        .repo-input {
          flex: 1;
          min-width: 0;
          width: auto;
          text-align: right;
        }

        .agent-panel-input {
          width: 100%;
          border: 1px solid #2a3240;
          border-radius: 8px;
          background: #0f1724;
          color: #e4e4e7;
          padding: 0 8px;
          height: 30px;
          font-size: 12px;
          box-sizing: border-box;
        }

        .title-input {
          margin-left: 8px;
        }
      `}</style>
    </>
  );
}
