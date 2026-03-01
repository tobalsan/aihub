import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import {
  archiveSubagent,
  fetchSubagents,
  killSubagent,
} from "../../api/client";
import type { Area, ProjectDetail, SubagentListItem } from "../../api/types";
import type { SpawnPrefill, SpawnTemplate } from "./SpawnForm";

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

const AGENT_NAMES = [
  "Alpha",
  "Bravo",
  "Cedar",
  "Delta",
  "Echo",
  "Falcon",
  "Granite",
  "Harbor",
  "Iris",
  "Jade",
  "Kite",
  "Lark",
  "Maple",
  "Nova",
  "Onyx",
  "Pine",
  "Quartz",
  "Ridge",
  "Sage",
  "Terra",
] as const;

type AgentPanelProps = {
  project: ProjectDetail;
  area?: Area;
  areas: Area[];
  subagents: SubagentListItem[];
  onSubagentsChange?: (items: SubagentListItem[]) => void;
  onOpenSpawn: (input: {
    template: SpawnTemplate;
    prefill: SpawnPrefill;
  }) => void;
  selectedAgentSlug: string | null;
  onSelectAgent: (info: {
    type: "lead" | "subagent";
    agentId?: string;
    slug?: string;
    cli?: string;
    status?: string;
    projectId: string;
  }) => void;
  onTitleChange: (title: string) => Promise<void> | void;
  onStatusChange: (status: string) => Promise<void> | void;
  onAreaChange: (area: string) => Promise<void> | void;
  onRepoChange: (repo: string) => Promise<void> | void;
};

function pickUniqueAgentName(
  prefix: "Worker" | "Reviewer",
  subagents: SubagentListItem[]
): string {
  const used = new Set(
    subagents
      .map((item) => (item.name ?? "").trim().toLowerCase())
      .filter((name) => name.length > 0)
  );
  const available = AGENT_NAMES.filter(
    (name) => !used.has(`${prefix} ${name}`.toLowerCase())
  );
  const pool = available.length > 0 ? available : AGENT_NAMES;
  const selected =
    pool[Math.floor(Math.random() * pool.length)] ?? AGENT_NAMES[0];
  return `${prefix} ${selected}`;
}

function getFrontmatterString(
  frontmatter: Record<string, unknown>,
  key: string
): string {
  const value = frontmatter[key];
  return typeof value === "string" ? value : "";
}

function getFrontmatterRecord(
  frontmatter: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = frontmatter[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
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
  const [showRepoBlock, setShowRepoBlock] = createSignal(false);
  const [editingRepo, setEditingRepo] = createSignal(false);
  const [repoDraft, setRepoDraft] = createSignal("");
  const [savingRepo, setSavingRepo] = createSignal(false);
  const [templateMenuOpen, setTemplateMenuOpen] = createSignal(false);
  const [busyActionSlug, setBusyActionSlug] = createSignal<string | null>(null);
  const [agentError, setAgentError] = createSignal<string | null>(null);

  const status = () =>
    getFrontmatterString(props.project.frontmatter, "status") || "unknown";
  const repo = () => getFrontmatterString(props.project.frontmatter, "repo");
  const created = () =>
    getFrontmatterString(props.project.frontmatter, "created");
  const areaLabel = () => props.area?.title || "No area";
  const leadAgentId = createMemo(() => {
    const sessionKeys = getFrontmatterRecord(
      props.project.frontmatter,
      "sessionKeys"
    );
    if (!sessionKeys) return null;
    const keys = Object.keys(sessionKeys).filter(
      (key) => typeof sessionKeys[key] === "string"
    );
    return keys[0] ?? null;
  });
  const selectedLeadId = createMemo(() => {
    const selected = props.selectedAgentSlug;
    if (!selected || !selected.startsWith("lead:")) return null;
    return selected.slice("lead:".length);
  });

  let statusMenuRef: HTMLDivElement | undefined;
  let areaMenuRef: HTMLDivElement | undefined;
  let templateMenuRef: HTMLDivElement | undefined;
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
      if (templateMenuOpen() && !templateMenuRef?.contains(target ?? null)) {
        setTemplateMenuOpen(false);
      }
    };

    document.addEventListener("click", onDocumentClick);
    let active = true;
    const loadSubagents = async () => {
      const result = await fetchSubagents(props.project.id, true);
      if (!active) return;
      if (result.ok) {
        props.onSubagentsChange?.(result.data.items);
        setAgentError(null);
      } else {
        setAgentError(result.error);
      }
    };
    void loadSubagents();
    const timer = window.setInterval(() => {
      void loadSubagents();
    }, 10000);

    onCleanup(() => {
      active = false;
      window.clearInterval(timer);
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

  const statusIndicator = (statusValue: SubagentListItem["status"]) => {
    if (statusValue === "running") return { symbol: "●", tone: "running" };
    if (statusValue === "replied") return { symbol: "✓", tone: "done" };
    if (statusValue === "error") return { symbol: "✗", tone: "error" };
    return { symbol: "○", tone: "idle" };
  };

  const taskLabel = (item: SubagentListItem) => {
    const metadata = item as Record<string, unknown>;
    const task =
      metadata.task ??
      metadata.taskLabel ??
      metadata.assignedTask ??
      metadata.assignment;
    return typeof task === "string" ? task : "";
  };

  const refreshSubagents = async () => {
    const refresh = await fetchSubagents(props.project.id, true);
    if (refresh.ok) {
      props.onSubagentsChange?.(refresh.data.items);
      return true;
    }
    setAgentError(refresh.error);
    return false;
  };

  const selectLeadIfNeeded = (slug: string) => {
    if (props.selectedAgentSlug !== slug) return;
    const leadId = leadAgentId();
    if (!leadId) return;
    props.onSelectAgent({
      type: "lead",
      agentId: leadId,
      projectId: props.project.id,
    });
  };

  const openTemplate = (template: SpawnTemplate, prefill: SpawnPrefill) => {
    props.onOpenSpawn({ template, prefill });
    setTemplateMenuOpen(false);
  };

  const handleArchiveSubagent = async (item: SubagentListItem) => {
    if (busyActionSlug()) return;
    if (!window.confirm(`Archive run ${item.slug}?`)) return;
    setBusyActionSlug(item.slug);
    setAgentError(null);
    const result = await archiveSubagent(props.project.id, item.slug);
    setBusyActionSlug(null);
    if (!result.ok) {
      setAgentError(result.error);
      return;
    }
    await refreshSubagents();
    selectLeadIfNeeded(item.slug);
  };

  const handleKillSubagent = async (item: SubagentListItem) => {
    if (busyActionSlug()) return;
    if (
      !window.confirm(
        `Kill subagent ${item.slug}? This removes all workspace data.`
      )
    )
      return;
    setBusyActionSlug(item.slug);
    setAgentError(null);
    const result = await killSubagent(props.project.id, item.slug);
    setBusyActionSlug(null);
    if (!result.ok) {
      setAgentError(result.error);
      return;
    }
    await refreshSubagents();
    selectLeadIfNeeded(item.slug);
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
            <button
              type="button"
              class="repo-toggle-btn"
              classList={{ active: showRepoBlock() }}
              onClick={() => setShowRepoBlock((value) => !value)}
              title={showRepoBlock() ? "Hide repo path" : "Show repo path"}
              aria-label={showRepoBlock() ? "Hide repo path" : "Show repo path"}
              aria-expanded={showRepoBlock()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 7h6l2 2h10v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
            </button>
          </div>
        </section>

        <Show when={showRepoBlock()}>
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
        </Show>

        <section class="agent-panel-block">
          <div class="agent-panel-label">Agents</div>
          <div class="agent-list">
            <Show when={leadAgentId()}>
              {(leadId) => (
                <button
                  type="button"
                  class="agent-list-item lead"
                  classList={{ selected: selectedLeadId() === leadId() }}
                  onClick={() =>
                    props.onSelectAgent({
                      type: "lead",
                      agentId: leadId(),
                      projectId: props.project.id,
                    })
                  }
                >
                  <span class="agent-status running">●</span>
                  <span class="agent-list-main">
                    <span class="agent-name">{leadId()}</span>
                    <span class="agent-task">Lead agent</span>
                  </span>
                </button>
              )}
            </Show>
            <For each={props.subagents}>
              {(item) => {
                const indicator = statusIndicator(item.status);
                return (
                  <div
                    class="agent-list-item subagent"
                    classList={{
                      selected: props.selectedAgentSlug === item.slug,
                    }}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      props.onSelectAgent({
                        type: "subagent",
                        slug: item.slug,
                        cli: item.cli,
                        status: item.status,
                        projectId: props.project.id,
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      props.onSelectAgent({
                        type: "subagent",
                        slug: item.slug,
                        cli: item.cli,
                        status: item.status,
                        projectId: props.project.id,
                      });
                    }}
                  >
                    <span class={`agent-status ${indicator.tone}`}>
                      {indicator.symbol}
                    </span>
                    <span class="agent-list-main">
                      <span class="agent-name">
                        {item.name ?? item.cli ?? item.slug}
                      </span>
                      <Show when={taskLabel(item)}>
                        {(label) => <span class="agent-task">{label()}</span>}
                      </Show>
                    </span>
                    <div class="agent-row-actions">
                      <button
                        type="button"
                        class="agent-row-action archive"
                        title={`Archive ${item.name ?? item.cli ?? item.slug}`}
                        aria-label={`Archive ${item.name ?? item.cli ?? item.slug}`}
                        disabled={Boolean(busyActionSlug())}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleArchiveSubagent(item);
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path d="M3 7h18v13H3z" />
                          <path d="M7 7V4h10v3" />
                          <path d="M7 12h10" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="agent-row-action kill"
                        title={`Kill ${item.name ?? item.cli ?? item.slug}`}
                        aria-label={`Kill ${item.name ?? item.cli ?? item.slug}`}
                        disabled={Boolean(busyActionSlug())}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleKillSubagent(item);
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
          <div class="add-agent-wrap" ref={templateMenuRef}>
            <button
              type="button"
              class="add-agent-btn"
              onClick={(event) => {
                event.stopPropagation();
                setTemplateMenuOpen((open) => !open);
              }}
            >
              + Add Agent
            </button>
            <Show when={templateMenuOpen()}>
              <div class="template-menu">
                <button
                  type="button"
                  class="template-option"
                  onClick={() =>
                    openTemplate("coordinator", {
                      name: "Coordinator",
                      cli: "claude",
                      model: "opus",
                      reasoning: "medium",
                      runMode: "none",
                      includeDefaultPrompt: true,
                      includePostRun: false,
                    })
                  }
                >
                  <span class="template-title">Coordinator</span>
                  <span class="template-description">
                    Orchestrates tasks, doesn&apos;t write code
                  </span>
                </button>
                <button
                  type="button"
                  class="template-option"
                  onClick={() =>
                    openTemplate("worker", {
                      name: pickUniqueAgentName("Worker", props.subagents),
                      cli: "codex",
                      model: "gpt-5.3-codex",
                      reasoning: "medium",
                      runMode: "clone",
                      includeDefaultPrompt: true,
                      includePostRun: true,
                    })
                  }
                >
                  <span class="template-title">Worker</span>
                  <span class="template-description">
                    Implements code in isolated workspace
                  </span>
                </button>
                <button
                  type="button"
                  class="template-option"
                  onClick={() =>
                    openTemplate("reviewer", {
                      name: pickUniqueAgentName("Reviewer", props.subagents),
                      cli: "codex",
                      model: "gpt-5.3-codex",
                      reasoning: "medium",
                      runMode: "none",
                      includeDefaultPrompt: true,
                      includePostRun: false,
                    })
                  }
                >
                  <span class="template-title">Reviewer</span>
                  <span class="template-description">
                    Reviews worker output, runs tests
                  </span>
                </button>
                <button
                  type="button"
                  class="template-option"
                  onClick={() => openTemplate("custom", {})}
                >
                  <span class="template-title">Custom</span>
                  <span class="template-description">Blank form</span>
                </button>
              </div>
            </Show>
          </div>
          <Show when={agentError()}>
            {(message) => <p class="agent-error">{message()}</p>}
          </Show>
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

        .repo-toggle-btn {
          margin-left: auto;
          width: 26px;
          height: 26px;
          border-radius: 8px;
          border: 1px solid #2a3240;
          background: transparent;
          color: #7f8a9a;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
          flex-shrink: 0;
        }

        .repo-toggle-btn svg {
          width: 14px;
          height: 14px;
        }

        .repo-toggle-btn:hover {
          color: #b0b8c6;
          border-color: #3a4250;
          background: #1a2330;
        }

        .repo-toggle-btn.active {
          color: #93c5fd;
          border-color: #3b82f6;
          background: #1e2e4f;
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

        .agent-list {
          display: grid;
          gap: 6px;
        }

        .agent-list-item {
          width: 100%;
          border: 1px solid #1f2937;
          border-radius: 8px;
          padding: 7px 8px;
          background: #0f1724;
          color: #e4e4e7;
          display: flex;
          gap: 8px;
          align-items: flex-start;
          text-align: left;
          cursor: pointer;
        }

        .agent-list-item:hover {
          border-color: #334155;
        }

        .agent-list-item.selected {
          border-color: #3b82f6;
          box-shadow: inset 2px 0 0 #3b82f6;
        }

        .agent-list-item.lead {
          background: #101a2b;
        }

        .agent-list-item.subagent {
          position: relative;
          align-items: center;
          padding-right: 64px;
        }

        .agent-list-item.subagent:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 1px;
        }

        .agent-row-actions {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          gap: 4px;
          align-items: center;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transition: opacity 0.12s ease;
        }

        .agent-list-item.subagent:hover .agent-row-actions,
        .agent-list-item.subagent:focus-within .agent-row-actions {
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
        }

        .agent-row-action {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          border: 1px solid #2a3240;
          background: #0f1724;
          color: #7f8a9a;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
        }

        .agent-row-action svg {
          width: 14px;
          height: 14px;
        }

        .agent-row-action.archive:hover:not(:disabled) {
          color: #f6c454;
          border-color: #5a4a22;
        }

        .agent-row-action.kill:hover:not(:disabled) {
          color: #f87171;
          border-color: #5a2525;
        }

        .agent-row-action:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .agent-status {
          font-size: 13px;
          line-height: 1;
          padding-top: 2px;
          width: 12px;
        }

        .agent-status.running,
        .agent-status.done {
          color: #34d399;
        }

        .agent-status.idle {
          color: #71717a;
        }

        .agent-status.error {
          color: #f87171;
        }

        .agent-list-main {
          min-width: 0;
          display: grid;
          gap: 2px;
        }

        .agent-name {
          font-size: 12px;
          color: #e4e4e7;
          line-height: 1.3;
        }

        .agent-task {
          font-size: 11px;
          color: #94a3b8;
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .add-agent-btn {
          margin-top: 8px;
          width: 100%;
          border: 1px dashed #3b82f6;
          border-radius: 8px;
          background: transparent;
          color: #93c5fd;
          padding: 8px 10px;
          font-size: 12px;
          cursor: pointer;
        }

        .add-agent-wrap {
          margin-top: 8px;
          position: relative;
        }

        .template-menu {
          position: absolute;
          z-index: 4;
          top: calc(100% + 6px);
          right: 0;
          left: 0;
          display: grid;
          gap: 4px;
          border: 1px solid #2a3240;
          border-radius: 8px;
          padding: 8px;
          background: #111722;
        }

        .template-option {
          width: 100%;
          border: 1px solid #1f2937;
          border-radius: 8px;
          background: #0f1724;
          color: #e4e4e7;
          padding: 8px;
          text-align: left;
          display: grid;
          gap: 4px;
          cursor: pointer;
        }

        .template-option:hover {
          border-color: #334155;
        }

        .template-title {
          font-size: 12px;
          color: #dbeafe;
        }

        .template-description {
          font-size: 11px;
          color: #94a3b8;
        }

        .agent-error {
          margin: 8px 0 0;
          font-size: 11px;
          color: #fca5a5;
        }
      `}</style>
    </>
  );
}
