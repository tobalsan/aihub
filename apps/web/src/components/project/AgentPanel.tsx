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
  unarchiveSubagent,
  fetchSimpleHistory,
  fetchSubagentLogs,
  fetchSubagents,
  killSubagent,
  renameSubagent,
  subscribeToFileChanges,
  updateSubagent,
} from "../../api/client";
import type {
  Area,
  ProjectDetail,
  SubagentListItem,
  SubagentLogEvent,
} from "../../api/types";
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

const MODEL_OPTIONS: Record<string, readonly string[]> = {
  claude: ["opus", "sonnet", "haiku"],
  codex: ["gpt-5.4", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"],
  pi: [
    "qwen3.5-plus",
    "qwen3-max-2026-01-23",
    "MiniMax-M2.5",
    "glm-5",
    "kimi-k2.5",
  ],
};

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
    runMode?: string;
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

function formatElapsed(raw?: string): string {
  if (!raw) return "—";
  const timestamp = new Date(raw).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60000) return "now";
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

function normalizeExcerpt(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > 96 ? `${compact.slice(0, 95)}…` : compact;
}

function trimOptional(value?: string): string {
  const next = value?.trim();
  return next && next.length > 0 ? next : "";
}

function formatAgentMeta(cli?: string, model?: string): string {
  const cliValue = trimOptional(cli);
  const modelValue = trimOptional(model);
  if (cliValue && modelValue) return `${cliValue} · ${modelValue}`;
  return cliValue || modelValue || "";
}

function agentDisplayName(item: SubagentListItem): string {
  return trimOptional(item.name) || trimOptional(item.cli) || item.slug;
}

function pickPreviewFromEvents(events: SubagentLogEvent[]): {
  text: string;
  at?: string;
} | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (
      event.type !== "assistant" &&
      event.type !== "user" &&
      event.type !== "tool_output" &&
      event.type !== "stdout" &&
      event.type !== "stderr" &&
      event.type !== "error"
    ) {
      continue;
    }
    const text = normalizeExcerpt(event.text ?? "");
    if (!text) continue;
    return { text, at: event.ts };
  }
  return null;
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
  const [busyModelSlug, setBusyModelSlug] = createSignal<string | null>(null);
  const [modelMenuSlug, setModelMenuSlug] = createSignal<string | null>(null);
  const [modelMenuPosition, setModelMenuPosition] = createSignal<{
    left: number;
    top: number;
  } | null>(null);
  const [agentError, setAgentError] = createSignal<string | null>(null);
  const [editingNameSlug, setEditingNameSlug] = createSignal<string | null>(
    null
  );
  const [nameDraft, setNameDraft] = createSignal("");
  const [savingNameSlug, setSavingNameSlug] = createSignal<string | null>(null);
  const [showArchived, setShowArchived] = createSignal(false);
  const [nowTick, setNowTick] = createSignal(Date.now());
  const [leadPreview, setLeadPreview] = createSignal<{
    text: string;
    at?: string;
  }>({
    text: "No messages yet",
  });
  const [subagentPreview, setSubagentPreview] = createSignal<
    Record<string, { text: string; at?: string; cursor: number }>
  >({});

  const status = () =>
    getFrontmatterString(props.project.frontmatter, "status") || "unknown";
  const repo = () => getFrontmatterString(props.project.frontmatter, "repo");
  const hasRepo = () => Boolean(repo() || props.area?.repo);
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
  const leadSessionKey = createMemo(() => {
    const leadId = leadAgentId();
    if (!leadId) return "main";
    const sessionKeys = getFrontmatterRecord(
      props.project.frontmatter,
      "sessionKeys"
    );
    const value = sessionKeys?.[leadId];
    return typeof value === "string" && value.trim() ? value : "main";
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
      const targetElement = target instanceof Element ? target : null;
      if (statusMenuOpen() && !statusMenuRef?.contains(target ?? null)) {
        setStatusMenuOpen(false);
      }
      if (areaMenuOpen() && !areaMenuRef?.contains(target ?? null)) {
        setAreaMenuOpen(false);
      }
      if (templateMenuOpen() && !templateMenuRef?.contains(target ?? null)) {
        setTemplateMenuOpen(false);
      }
      if (modelMenuSlug() && !targetElement?.closest(".agent-meta-wrap")) {
        setModelMenuSlug(null);
        setModelMenuPosition(null);
      }
    };

    document.addEventListener("click", onDocumentClick);
    let active = true;
    let loadingSubagents = false;
    const loadSubagents = async () => {
      if (loadingSubagents) return;
      if (editingNameSlug()) return;
      loadingSubagents = true;
      const result = await fetchSubagents(props.project.id, true);
      if (!active) return;
      if (result.ok) {
        props.onSubagentsChange?.(result.data.items);
        setAgentError(null);
      } else {
        setAgentError(result.error);
      }
      loadingSubagents = false;
    };
    void loadSubagents();
    const unsubscribeFileChanges = subscribeToFileChanges({
      onAgentChanged: (projectId) => {
        if (projectId !== props.project.id) return;
        void loadSubagents();
      },
    });
    const subagentPollTimer = window.setInterval(() => {
      void loadSubagents();
    }, 2000);
    const tickTimer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 60000);

    onCleanup(() => {
      active = false;
      window.clearInterval(subagentPollTimer);
      window.clearInterval(tickTimer);
      unsubscribeFileChanges();
      document.removeEventListener("click", onDocumentClick);
      if (copiedTimer) window.clearTimeout(copiedTimer);
    });
  });

  createEffect(() => {
    const leadId = leadAgentId();
    const sessionKey = leadSessionKey();
    if (!leadId) {
      setLeadPreview({ text: "No messages yet" });
      return;
    }
    let cancelled = false;
    void (async () => {
      const history = await fetchSimpleHistory(leadId, sessionKey);
      if (cancelled) return;
      const last = history.messages.at(-1);
      const text = normalizeExcerpt(last?.content ?? "");
      setLeadPreview({
        text: text || "No messages yet",
        at:
          typeof last?.timestamp === "number"
            ? new Date(last.timestamp).toISOString()
            : undefined,
      });
    })();
    onCleanup(() => {
      cancelled = true;
    });
  });

  createEffect(() => {
    const projectId = props.project.id;
    const items = props.subagents;
    const activeSlugs = new Set(items.map((item) => item.slug));
    let previousPreview: Record<
      string,
      { text: string; at?: string; cursor: number }
    > = {};
    setSubagentPreview((prev) => {
      previousPreview = prev;
      const next: Record<
        string,
        { text: string; at?: string; cursor: number }
      > = {};
      for (const [slug, value] of Object.entries(prev)) {
        if (activeSlugs.has(slug)) next[slug] = value;
      }
      return next;
    });
    if (items.length === 0) return;
    let cancelled = false;
    void Promise.all(
      items.map(async (item) => {
        const current = previousPreview[item.slug];
        const logs = await fetchSubagentLogs(
          projectId,
          item.slug,
          current?.cursor ?? 0
        );
        if (!logs.ok || cancelled) return;
        const picked = pickPreviewFromEvents(logs.data.events);
        setSubagentPreview((prev) => ({
          ...prev,
          [item.slug]: {
            text:
              picked?.text ??
              prev[item.slug]?.text ??
              normalizeExcerpt(taskLabel(item)) ??
              "",
            at: picked?.at ?? item.lastActive ?? prev[item.slug]?.at,
            cursor: logs.data.cursor,
          },
        }));
      })
    );
    onCleanup(() => {
      cancelled = true;
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

  const previewText = (item: SubagentListItem) =>
    subagentPreview()[item.slug]?.text ||
    normalizeExcerpt(taskLabel(item)) ||
    "No messages yet";

  const previewAt = (item: SubagentListItem) =>
    subagentPreview()[item.slug]?.at ?? item.lastActive;

  const elapsedLabel = (raw?: string) => {
    nowTick();
    return formatElapsed(raw);
  };
  const groupedSubagents = createMemo(() => {
    const activeAgents: SubagentListItem[] = [];
    const idleAgents: SubagentListItem[] = [];
    const archivedAgents: SubagentListItem[] = [];
    for (const item of props.subagents) {
      if (item.archived) {
        archivedAgents.push(item);
      } else if (item.status === "running") {
        activeAgents.push(item);
      } else {
        idleAgents.push(item);
      }
    }
    const byMostRecent = (a: SubagentListItem, b: SubagentListItem) => {
      const aAt = previewAt(a) ?? "";
      const bAt = previewAt(b) ?? "";
      return bAt.localeCompare(aAt);
    };
    activeAgents.sort(byMostRecent);
    idleAgents.sort(byMostRecent);
    archivedAgents.sort(byMostRecent);
    return { activeAgents, idleAgents, archivedAgents };
  });
  const renderSubagentCard = (item: SubagentListItem) => {
    const indicator = statusIndicator(item.status);
    const agentMeta = formatAgentMeta(item.cli, item.model);
    const options = MODEL_OPTIONS[item.cli ?? ""] ?? [];
    const currentModel = trimOptional(item.model);
    const modelOptions =
      currentModel && !options.includes(currentModel)
        ? [currentModel, ...options]
        : [...options];
    const selectedModel = currentModel || modelOptions[0] || "";
    const canEditModel = item.status !== "running" && modelOptions.length > 0;
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
            runMode: item.runMode,
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
            runMode: item.runMode,
            status: item.status,
            projectId: props.project.id,
          });
        }}
      >
        <span class={`agent-status ${indicator.tone}`}>{indicator.symbol}</span>
        <span class="agent-list-main">
          <span class="agent-list-head">
            <span class="agent-title">
              <Show
                when={editingNameSlug() !== item.slug}
                fallback={
                  <input
                    class="agent-name-input"
                    type="text"
                    value={nameDraft()}
                    disabled={savingNameSlug() === item.slug}
                    onClick={(event) => event.stopPropagation()}
                    onInput={(event) => setNameDraft(event.currentTarget.value)}
                    onBlur={() => void saveRenamedSubagent(item)}
                    onKeyDown={(event) => {
                      if (event.key === " " || event.key === "Spacebar") {
                        event.stopPropagation();
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setEditingNameSlug(null);
                        setNameDraft("");
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        void saveRenamedSubagent(item);
                      }
                    }}
                    autofocus
                  />
                }
              >
                <button
                  type="button"
                  class="agent-name-btn"
                  disabled={savingNameSlug() === item.slug}
                  onClick={(event) => {
                    event.stopPropagation();
                    beginRenameSubagent(item);
                  }}
                  title="Rename agent"
                  aria-label={`Rename ${agentDisplayName(item)}`}
                >
                  <span class="agent-name">{agentDisplayName(item)}</span>
                </button>
              </Show>
              <Show when={agentMeta}>
                <span class="agent-meta-wrap">
                  <span
                    class="agent-meta"
                    classList={{ editable: canEditModel }}
                    role={canEditModel ? "button" : undefined}
                    tabIndex={canEditModel ? 0 : undefined}
                    title={canEditModel ? "Change model" : undefined}
                    onClick={(event) => {
                      if (!canEditModel) return;
                      event.stopPropagation();
                      const target = event.currentTarget;
                      const rect = target.getBoundingClientRect();
                      setModelMenuSlug((current) => {
                        const isClosing = current === item.slug;
                        setModelMenuPosition(
                          isClosing
                            ? null
                            : { left: rect.left, top: rect.bottom + 4 }
                        );
                        return isClosing ? null : item.slug;
                      });
                    }}
                    onKeyDown={(event) => {
                      if (!canEditModel) return;
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      const target = event.currentTarget;
                      const rect = target.getBoundingClientRect();
                      setModelMenuSlug((current) => {
                        const isClosing = current === item.slug;
                        setModelMenuPosition(
                          isClosing
                            ? null
                            : { left: rect.left, top: rect.bottom + 4 }
                        );
                        return isClosing ? null : item.slug;
                      });
                    }}
                  >
                    {agentMeta}
                  </span>
                  <Show when={canEditModel && modelMenuSlug() === item.slug}>
                    <div
                      class="agent-model-popup"
                      style={
                        modelMenuPosition()
                          ? {
                              left: `${modelMenuPosition()!.left}px`,
                              top: `${modelMenuPosition()!.top}px`,
                            }
                          : undefined
                      }
                      onClick={(event) => event.stopPropagation()}
                    >
                      <For each={modelOptions}>
                        {(value) => (
                          <button
                            type="button"
                            class="agent-model-option"
                            classList={{ selected: value === selectedModel }}
                            disabled={busyModelSlug() === item.slug}
                            onClick={(event) => {
                              event.stopPropagation();
                              setModelMenuSlug(null);
                              setModelMenuPosition(null);
                              void handleModelUpdate(item, value);
                            }}
                          >
                            {value}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </span>
              </Show>
            </span>
            <span class="agent-elapsed">{elapsedLabel(previewAt(item))}</span>
          </span>
          <span class="agent-task">{previewText(item)}</span>
        </span>
        <div class="agent-row-actions">
          <button
            type="button"
            class="agent-row-action archive"
            title={`${item.archived ? "Unarchive" : "Archive"} ${item.name ?? item.cli ?? item.slug}`}
            aria-label={`${item.archived ? "Unarchive" : "Archive"} ${item.name ?? item.cli ?? item.slug}`}
            disabled={Boolean(busyActionSlug() || savingNameSlug())}
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
            disabled={Boolean(busyActionSlug() || savingNameSlug())}
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
  };

  createEffect(() => {
    const openSlug = modelMenuSlug();
    if (!openSlug) return;
    const item = props.subagents.find((entry) => entry.slug === openSlug);
    if (!item) {
      setModelMenuSlug(null);
      setModelMenuPosition(null);
      return;
    }
    const options = MODEL_OPTIONS[item.cli ?? ""] ?? [];
    const currentModel = trimOptional(item.model);
    const modelOptions =
      currentModel && !options.includes(currentModel)
        ? [currentModel, ...options]
        : options;
    if (item.status === "running" || modelOptions.length === 0) {
      setModelMenuSlug(null);
      setModelMenuPosition(null);
    }
  });

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
    const isArchived = item.archived;
    const action = isArchived ? "Unarchive" : "Archive";
    if (!window.confirm(`${action} run ${item.slug}?`)) return;
    setBusyActionSlug(item.slug);
    setAgentError(null);
    const result = isArchived
      ? await unarchiveSubagent(props.project.id, item.slug)
      : await archiveSubagent(props.project.id, item.slug);
    setBusyActionSlug(null);
    if (!result.ok) {
      setAgentError(result.error);
      return;
    }
    await refreshSubagents();
    if (!isArchived) selectLeadIfNeeded(item.slug);
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

  const beginRenameSubagent = (item: SubagentListItem) => {
    if (savingNameSlug()) return;
    setAgentError(null);
    setEditingNameSlug(item.slug);
    setNameDraft(agentDisplayName(item));
  };

  const saveRenamedSubagent = async (item: SubagentListItem) => {
    if (savingNameSlug()) return;
    const nextName = nameDraft().trim();
    const currentName = agentDisplayName(item);
    setEditingNameSlug(null);
    setNameDraft("");
    if (!nextName || nextName === currentName) return;

    props.onSubagentsChange?.(
      props.subagents.map((entry) =>
        entry.slug === item.slug ? { ...entry, name: nextName } : entry
      )
    );

    setSavingNameSlug(item.slug);
    setAgentError(null);
    const result = await renameSubagent(props.project.id, item.slug, nextName);
    setSavingNameSlug(null);
    if (!result.ok) {
      setAgentError(result.error);
      await refreshSubagents();
      return;
    }
    props.onSubagentsChange?.(
      props.subagents.map((entry) =>
        entry.slug === item.slug ? { ...entry, ...result.data } : entry
      )
    );
  };

  const setLocalSubagentPatch = (
    slug: string,
    patch: Partial<SubagentListItem>
  ) => {
    props.onSubagentsChange?.(
      props.subagents.map((entry) =>
        entry.slug === slug ? { ...entry, ...patch } : entry
      )
    );
  };

  const handleModelUpdate = async (
    item: SubagentListItem,
    nextModel: string
  ) => {
    const model = nextModel.trim();
    const previousModel = trimOptional(item.model);
    if (!model || model === previousModel || busyModelSlug()) return;
    setBusyModelSlug(item.slug);
    setAgentError(null);
    setLocalSubagentPatch(item.slug, { model });
    const result = await updateSubagent(props.project.id, item.slug, { model });
    setBusyModelSlug(null);
    if (!result.ok) {
      setLocalSubagentPatch(item.slug, { model: previousModel || undefined });
      setAgentError(result.error);
      return;
    }
    setLocalSubagentPatch(item.slug, {
      name: result.data.name,
      model: result.data.model,
      reasoningEffort: result.data.reasoningEffort,
      thinking: result.data.thinking,
    });
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
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
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
          <div class="add-agent-wrap" ref={templateMenuRef}>
            <button
              type="button"
              class="add-agent-btn"
              disabled={!hasRepo()}
              title={!hasRepo() ? (props.area ? "No repo set" : "No area set") : undefined}
              onClick={(event) => {
                if (!hasRepo()) return;
                event.stopPropagation();
                setTemplateMenuOpen((open) => !open);
              }}
            >
              + Create new agent
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
                      includeRoleInstructions: true,
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
                      model: "gpt-5.4",
                      reasoning: "medium",
                      runMode: "clone",
                      includeDefaultPrompt: true,
                      includeRoleInstructions: true,
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
                      model: "gpt-5.4",
                      reasoning: "high",
                      runMode: "none",
                      includeDefaultPrompt: true,
                      includeRoleInstructions: true,
                      includePostRun: true,
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
                    <span class="agent-list-head">
                      <span class="agent-title">
                        <span class="agent-name">{leadId()}</span>
                      </span>
                      <span class="agent-elapsed">
                        {elapsedLabel(leadPreview().at)}
                      </span>
                    </span>
                    <span class="agent-task">{leadPreview().text}</span>
                  </span>
                </button>
              )}
            </Show>
            <For each={groupedSubagents().activeAgents}>
              {(item) => renderSubagentCard(item)}
            </For>
            <Show
              when={
                groupedSubagents().activeAgents.length > 0 &&
                groupedSubagents().idleAgents.length > 0
              }
            >
              <div class="agent-group-gap" />
            </Show>
            <For each={groupedSubagents().idleAgents}>
              {(item) => renderSubagentCard(item)}
            </For>
            <Show when={groupedSubagents().archivedAgents.length > 0}>
              <button
                type="button"
                class="show-archived-toggle"
                onClick={() => setShowArchived((v) => !v)}
              >
                {showArchived() ? "Hide archived" : `Show archived (${groupedSubagents().archivedAgents.length})`}
              </button>
            </Show>
            <Show when={showArchived() && groupedSubagents().archivedAgents.length > 0}>
              <div class="agent-group-gap" />
              <For each={groupedSubagents().archivedAgents}>
                {(item) => renderSubagentCard(item)}
              </For>
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
          background: var(--bg-base);
          color: var(--text-primary);
          padding: 18px 14px;
          display: grid;
          align-content: start;
          gap: 12px;
        }

        .agent-panel-block {
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          background: var(--bg-overlay);
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
          background: var(--bg-input);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          font-size: 11px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          padding: 5px 9px;
          border-radius: 999px;
          cursor: pointer;
          flex-shrink: 0;
        }

        .project-id-pill:hover {
          background: var(--mix-hover-bg);
          border-color: var(--mix-hover-border);
          color: var(--text-primary);
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
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-secondary);
          background: transparent;
          cursor: pointer;
        }

        .meta-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          z-index: 3;
          background: var(--mix-modal-bg);
          border: 1px solid var(--border-subtle);
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
          color: var(--text-primary);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          text-align: left;
          padding: 6px 8px;
          border-radius: 8px;
          cursor: pointer;
        }

        .meta-item:hover {
          background: var(--bg-raised);
        }

        .created-chip {
          color: var(--text-secondary);
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
          border: 1px solid var(--border-subtle);
          background: transparent;
          color: var(--text-tertiary);
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
          color: var(--text-primary);
          border-color: var(--mix-hover-border);
          background: var(--mix-hover-bg);
        }

        .repo-toggle-btn.active {
          color: #93c5fd;
          border-color: #3b82f6;
          background: #1e2e4f;
        }

        .agent-panel-label {
          color: var(--text-muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 4px;
        }

        .agent-panel-text {
          margin: 0;
          color: var(--text-primary);
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
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          background: var(--bg-input);
          color: var(--text-primary);
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
          gap: 8px;
        }

        .agent-group-gap {
          height: 12px;
        }

        .show-archived-toggle {
          background: none;
          border: none;
          color: var(--text-tertiary);
          font-size: 11px;
          cursor: pointer;
          padding: 4px 6px;
          width: 100%;
          text-align: left;
        }
        .show-archived-toggle:hover {
          color: var(--text-secondary);
        }

        .agent-list-item {
          width: 100%;
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          padding: 10px;
          background: var(--bg-inset);
          color: var(--text-primary);
          display: flex;
          gap: 10px;
          align-items: flex-start;
          text-align: left;
          cursor: pointer;
          min-width: 0;
        }

        .agent-list-item:hover {
          border-color: var(--border-subtle);
        }

        .agent-list-item.selected {
          border-color: #3b82f6;
          box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
        }

        .agent-list-item.lead {
          background: var(--bg-inset);
        }

        .agent-list-item.subagent {
          position: relative;
        }

        .agent-list-item.subagent:focus-visible {
          outline: 2px solid #3b82f6;
          outline-offset: 1px;
        }

        .agent-row-actions {
          position: absolute;
          right: 8px;
          bottom: 8px;
          z-index: 2;
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
          border: 1px solid var(--border-subtle);
          background: var(--bg-input);
          color: var(--text-tertiary);
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
          padding-top: 4px;
          width: 12px;
        }

        .agent-status.running,
        .agent-status.done {
          color: #34d399;
        }

        .agent-status.idle {
          color: var(--text-muted);
        }

        .agent-status.error {
          color: #f87171;
        }

        .agent-list-main {
          min-width: 0;
          display: grid;
          gap: 4px;
          width: 100%;
        }

        .agent-list-head {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .agent-title {
          display: flex;
          align-items: baseline;
          gap: 6px;
          min-width: 0;
          flex: 1;
          overflow: visible;
          position: relative;
        }

        .agent-name-btn {
          border: none;
          background: transparent;
          color: inherit;
          padding: 0;
          margin: 0;
          min-width: 0;
          max-width: 100%;
          cursor: text;
          text-align: left;
        }

        .agent-name-btn:disabled {
          cursor: wait;
        }

        .agent-elapsed {
          margin-left: auto;
          font-size: 11px;
          color: var(--text-tertiary);
          line-height: 1;
          text-transform: lowercase;
          letter-spacing: 0.02em;
        }

        .agent-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.3;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 0 1 auto;
        }

        .agent-name-input {
          width: 150px;
          max-width: 100%;
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          background: var(--bg-input);
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 600;
          line-height: 1.3;
          padding: 2px 6px;
          min-width: 0;
        }

        .agent-meta {
          font-size: 11px;
          color: var(--text-tertiary);
          line-height: 1.2;
          white-space: nowrap;
        }

        .agent-meta-wrap {
          position: relative;
          flex: 0 0 auto;
        }

        .agent-meta.editable {
          cursor: pointer;
          padding: 0 2px;
          margin: 0 -2px;
          border-radius: 4px;
          transition:
            background-color 0.12s ease,
            color 0.12s ease;
        }

        .agent-meta.editable:hover,
        .agent-meta.editable:focus-visible {
          color: var(--text-secondary);
          background: color-mix(in srgb, var(--bg-input) 70%, transparent);
          outline: none;
        }

        .agent-model-popup {
          position: fixed;
          min-width: 160px;
          z-index: 4;
          display: grid;
          gap: 2px;
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          background: var(--bg-overlay);
          padding: 4px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
        }

        .agent-model-option {
          border: 1px solid transparent;
          border-radius: 6px;
          background: transparent;
          color: var(--text-secondary);
          font-size: 11px;
          line-height: 1.3;
          text-align: left;
          padding: 5px 7px;
          cursor: pointer;
        }

        .agent-model-option:hover:not(:disabled) {
          color: var(--text-primary);
          background: color-mix(in srgb, var(--bg-input) 70%, transparent);
        }

        .agent-model-option.selected {
          color: var(--text-primary);
          border-color: var(--border-subtle);
          background: color-mix(in srgb, var(--bg-input) 75%, transparent);
        }

        .agent-model-option:disabled {
          opacity: 0.55;
          cursor: wait;
        }

        .agent-task {
          font-size: 11px;
          color: var(--text-secondary);
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .add-agent-btn {
          width: 100%;
          border: none;
          background: transparent;
          color: var(--text-secondary);
          padding: 0;
          font-size: 13px;
          line-height: 1.4;
          cursor: pointer;
          text-align: left;
          transition: color 0.12s ease;
        }

        .add-agent-btn:hover:not(:disabled) {
          color: var(--text-primary);
        }

        .add-agent-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .add-agent-wrap {
          margin: 2px 0 8px;
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
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 8px;
          background: var(--bg-overlay);
        }

        .template-option {
          width: 100%;
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          background: var(--bg-input);
          color: var(--text-primary);
          padding: 8px;
          text-align: left;
          display: grid;
          gap: 4px;
          cursor: pointer;
        }

        .template-option:hover {
          border-color: var(--border-subtle);
        }

        .template-title {
          font-size: 12px;
          color: #3b82f6;
        }

        .template-description {
          font-size: 11px;
          color: var(--text-secondary);
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
