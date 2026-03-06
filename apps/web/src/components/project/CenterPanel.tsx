import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  fetchSubagentLogs,
  fetchSubagents,
  subscribeToFileChanges,
} from "../../api/client";
import { AgentChat } from "../AgentChat";
import type {
  ProjectDetail,
  SubagentListItem,
  SubagentLogEvent,
} from "../../api/types";
import { ChangesView } from "./ChangesView";
import {
  SpawnForm,
  type SpawnFormDraft,
  type SpawnPrefill,
  type SpawnTemplate,
} from "./SpawnForm";

export type CenterTab = "chat" | "activity" | "changes";
export type SelectedProjectAgent = {
  type: "lead" | "subagent";
  agentId?: string;
  agentName?: string;
  slug?: string;
  cli?: string;
  runMode?: "main-run" | "worktree" | "clone" | "none";
  status?: string;
  projectId: string;
};

type CenterPanelProps = {
  project: ProjectDetail;
  tab?: CenterTab;
  defaultTab?: CenterTab;
  showTabs?: boolean;
  onAddComment?: (body: string) => Promise<void>;
  selectedAgent: SelectedProjectAgent | null;
  spawnMode?: { template: SpawnTemplate; prefill: SpawnPrefill } | null;
  chatInputDraft?: string;
  onChatInputDraftChange?: (value: string) => void;
  spawnFormDraft?: SpawnFormDraft;
  onSpawnFormDraftChange?: (draft: SpawnFormDraft) => void;
  subagents?: SubagentListItem[];
  onSpawned?: (slug: string) => void;
  onCancelSpawn?: () => void;
  onTabChange?: (tab: CenterTab) => void;
  hasArea?: boolean;
  hasRepo?: boolean;
};

type TimelineItem = {
  key: string;
  kind: "comment" | "activity";
  ts: number;
  dateLabel: string;
  author: string;
  body: string;
};

function parseTimestamp(raw: string | undefined): number {
  if (!raw) return 0;
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? 0 : ts;
}

function formatDateLabel(raw: string | undefined): string {
  return raw && raw.trim() ? raw : "Unknown time";
}

function formatRelativeActivityTime(ts: number): string {
  if (!ts) return "";
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return "now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function outcomeSnippet(events: SubagentLogEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event?.text) continue;
    if (
      event.type === "assistant" ||
      event.type === "error" ||
      event.type === "stderr"
    ) {
      return event.text.slice(0, 140);
    }
  }
  return "";
}

export function CenterPanel(props: CenterPanelProps) {
  const [internalTab, setInternalTab] = createSignal<CenterTab>(
    props.defaultTab ?? "chat"
  );
  const [newComment, setNewComment] = createSignal("");
  const [addingComment, setAddingComment] = createSignal(false);
  const [subagents, setSubagents] = createSignal<SubagentListItem[]>([]);
  const [logBySlug, setLogBySlug] = createSignal<
    Record<string, SubagentLogEvent[]>
  >({});
  const tab = () => props.tab ?? internalTab();
  const chatSelectedAgent = createMemo(() =>
    props.spawnMode ? null : props.selectedAgent
  );
  const canSubmitComment = () =>
    Boolean(props.onAddComment) && newComment().trim().length > 0;
  const timelineItems = createMemo<TimelineItem[]>(() => {
    const threadItems: TimelineItem[] = props.project.thread.map(
      (entry, index) => ({
        key: `thread:${index}`,
        kind: "comment",
        ts: parseTimestamp(entry.date),
        dateLabel: formatDateLabel(entry.date),
        author: entry.author,
        body: entry.body,
      })
    );
    const subagentItems: TimelineItem[] = [];
    for (const item of subagents()) {
      const cli = item.cli ?? item.slug;
      const events = logBySlug()[item.slug] ?? [];
      const startedAt = events.find((event) => event.ts)?.ts ?? item.lastActive;
      if (startedAt) {
        subagentItems.push({
          key: `subagent:start:${item.slug}`,
          kind: "activity",
          ts: parseTimestamp(startedAt),
          dateLabel: formatDateLabel(startedAt),
          author: cli,
          body: `${cli} started.`,
        });
      }
      if (item.status === "replied" || item.status === "error") {
        const outcome =
          item.status === "error"
            ? `${cli} errored.`
            : `${cli} completed.`;
        const details = outcomeSnippet(events);
        const stamp =
          (events.length > 0 ? events[events.length - 1].ts : undefined) ??
          item.lastActive;
        subagentItems.push({
          key: `subagent:end:${item.slug}`,
          kind: "activity",
          ts: parseTimestamp(stamp),
          dateLabel: formatDateLabel(stamp),
          author: cli,
          body: details ? `${outcome} ${details}` : outcome,
        });
      }
    }
    return [...threadItems, ...subagentItems].sort((a, b) => b.ts - a.ts);
  });

  const handleAddComment = async () => {
    if (!props.onAddComment || addingComment()) return;
    const body = newComment().trim();
    if (!body) return;
    setAddingComment(true);
    setNewComment("");
    try {
      await props.onAddComment(body);
    } finally {
      setAddingComment(false);
    }
  };

  const tabs: Array<{ id: CenterTab; label: string }> = [
    { id: "chat", label: "Chat" },
    { id: "activity", label: "Activity" },
    { id: "changes", label: "Changes" },
  ];

  createEffect(() => {
    const projectId = props.project.id;
    if (!projectId) return;
    setLogBySlug({});
    let active = true;
    const cursorBySlug: Record<string, number> = {};

    const poll = async () => {
      const list = await fetchSubagents(projectId, true);
      if (!active || !list.ok) return;
      setSubagents(list.data.items);
      for (const item of list.data.items) {
        const cursor = cursorBySlug[item.slug] ?? 0;
        const logs = await fetchSubagentLogs(projectId, item.slug, cursor);
        if (!active || !logs.ok) continue;
        cursorBySlug[item.slug] = logs.data.cursor;
        if (logs.data.events.length === 0) continue;
        setLogBySlug((prev) => ({
          ...prev,
          [item.slug]: [...(prev[item.slug] ?? []), ...logs.data.events],
        }));
      }
    };

    void poll();
    const unsubscribeFileChanges = subscribeToFileChanges({
      onAgentChanged: (changedProjectId) => {
        if (changedProjectId !== projectId) return;
        void poll();
      },
    });
    onCleanup(() => {
      active = false;
      unsubscribeFileChanges();
    });
  });

  return (
    <>
      <section class="center-panel">
        <Show when={props.showTabs !== false}>
          <header class="center-panel-tabs">
            <For each={tabs}>
              {(item) => (
                <button
                  type="button"
                  class="center-tab"
                  classList={{ active: tab() === item.id }}
                  onClick={() => {
                    setInternalTab(item.id);
                    props.onTabChange?.(item.id);
                  }}
                >
                  {item.label}
                </button>
              )}
            </For>
          </header>
        </Show>
        <div class="center-panel-body">
          <Show when={tab() === "chat"}>
            <div class="center-chat-shell">
              <Show when={props.spawnMode}>
                <SpawnForm
                  projectId={props.project.id}
                  project={props.project}
                  prefill={props.spawnMode!.prefill}
                  template={props.spawnMode!.template}
                  subagents={props.subagents ?? []}
                  draft={props.spawnFormDraft}
                  onDraftChange={props.onSpawnFormDraftChange}
                  onSpawned={(slug) => props.onSpawned?.(slug)}
                  onCancel={() => props.onCancelSpawn?.()}
                />
              </Show>
              <Show when={chatSelectedAgent()}>
                <AgentChat
                  agentType={chatSelectedAgent()!.type}
                  agentId={
                    chatSelectedAgent()!.type === "lead"
                      ? (chatSelectedAgent()!.agentId ?? null)
                      : null
                  }
                  agentName={
                    chatSelectedAgent()!.type === "lead"
                      ? (chatSelectedAgent()!.agentName ??
                        chatSelectedAgent()!.agentId ??
                        null)
                      : `${chatSelectedAgent()!.projectId}/${chatSelectedAgent()!.cli ?? chatSelectedAgent()!.slug ?? "agent"}`
                  }
                  subagentInfo={
                    chatSelectedAgent()!.type === "subagent" &&
                    chatSelectedAgent()!.slug
                      ? {
                          projectId: chatSelectedAgent()!.projectId,
                          slug: chatSelectedAgent()!.slug!,
                          cli: chatSelectedAgent()!.cli,
                          runMode: chatSelectedAgent()!.runMode,
                          status: chatSelectedAgent()!.status as
                            | "running"
                            | "replied"
                            | "error"
                            | "idle"
                            | undefined,
                        }
                      : undefined
                  }
                  onBack={() => {}}
                  inputDraft={props.chatInputDraft ?? ""}
                  onInputDraftChange={props.onChatInputDraftChange}
                  showHeader={false}
                />
              </Show>
              <Show when={!props.spawnMode && !props.selectedAgent}>
                <Show
                  when={props.hasRepo !== false}
                  fallback={
                    <div class="center-placeholder-centered">
                      <p class="center-error-msg">
                        ⚠ {props.hasArea === false ? "No area set" : "No repo set"}
                      </p>
                    </div>
                  }
                >
                  <p class="center-placeholder">Select an agent to chat</p>
                </Show>
              </Show>
            </div>
          </Show>
          <Show when={tab() === "activity"}>
            <div class="center-scroll-view">
              <Show
                when={timelineItems().length > 0}
                fallback={<p class="center-placeholder">No activity yet</p>}
              >
                <ul class="activity-list">
                  <For each={timelineItems()}>
                    {(entry) => (
                      <li
                        class="activity-entry"
                        classList={{
                          "activity-entry--comment": entry.kind === "comment",
                          "activity-entry--event": entry.kind === "activity",
                        }}
                      >
                        <Show
                          when={entry.kind === "comment"}
                          fallback={
                            <p class="activity-event-line">
                              <span>{entry.body}</span>
                              <span class="activity-event-time">
                                {formatRelativeActivityTime(entry.ts)}
                              </span>
                            </p>
                          }
                        >
                          <div class="activity-item">
                            <div class="activity-meta">
                              <span class="activity-author">{entry.author}</span>
                              <span class="activity-date">{entry.dateLabel}</span>
                            </div>
                            <p>{entry.body}</p>
                          </div>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={props.onAddComment}>
                <div class="thread-add">
                  <textarea
                    class="thread-add-textarea"
                    placeholder="Add a comment..."
                    value={newComment()}
                    onInput={(e) => setNewComment(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        (e.metaKey || e.ctrlKey) &&
                        canSubmitComment()
                      ) {
                        e.preventDefault();
                        void handleAddComment();
                      }
                    }}
                    disabled={addingComment()}
                  />
                  <button
                    type="button"
                    class="thread-add-btn"
                    disabled={!canSubmitComment() || addingComment()}
                    onClick={() => void handleAddComment()}
                  >
                    Add
                  </button>
                </div>
              </Show>
            </div>
          </Show>
          <Show when={tab() === "changes"}>
            <div class="center-scroll-view">
              <ChangesView projectId={props.project.id} />
            </div>
          </Show>
        </div>
      </section>
      <style>{`
        .center-panel {
          height: 100%;
          min-height: 0;
          display: grid;
          grid-template-rows: auto 1fr;
          background: var(--bg-base);
        }

        .center-panel-tabs {
          display: flex;
          gap: 8px;
          position: sticky;
          top: 0;
          z-index: 2;
          background: var(--bg-base);
          padding: 16px 18px;
          border-bottom: 1px solid var(--border-subtle);
        }

        .center-tab {
          border: 1px solid var(--border-subtle);
          background: var(--bg-overlay);
          color: var(--text-secondary);
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          cursor: pointer;
        }

        .center-tab.active {
          color: #fff;
          border-color: #3b82f6;
          background: #3b82f6;
        }

        .center-panel-body {
          padding: 20px;
          color: var(--text-primary);
          min-height: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .center-chat-shell {
          min-height: 0;
          flex: 1;
          display: flex;
          min-width: 0;
        }

        .center-chat-shell .agent-chat {
          flex: 1;
          min-width: 0;
          min-height: 0;
        }

        .center-chat-shell .spawn-form-panel {
          flex: 1;
          min-width: 0;
          min-height: 0;
        }

        .center-scroll-view {
          min-height: 0;
          flex: 1;
          overflow-y: auto;
        }

        .center-placeholder {
          color: var(--text-muted);
        }

        .center-placeholder-centered {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .center-error-msg {
          color: #ef4444;
          font-weight: 700;
          font-size: 18px;
          margin: 0;
        }

        .activity-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 10px;
        }

        .activity-entry--event {
          padding: 4px 2px;
        }

        .activity-item {
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          padding: 12px;
          background: var(--bg-overlay);
        }

        .activity-item p {
          margin: 8px 0 0;
          color: var(--text-primary);
          white-space: pre-wrap;
        }

        .activity-meta {
          display: grid;
          gap: 2px;
        }

        .activity-author {
          color: var(--text-secondary);
          font-weight: 600;
          line-height: 1.2;
        }

        .activity-date {
          color: var(--text-muted);
          line-height: 1.2;
          font-size: 12px;
        }

        .activity-event-line {
          margin: 0;
          display: inline-flex;
          align-items: baseline;
          gap: 8px;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.4;
        }

        .activity-event-time {
          color: var(--text-muted);
          font-size: 12px;
          white-space: nowrap;
        }

        .thread-add {
          margin-top: 12px;
          display: grid;
          gap: 8px;
        }

        .thread-add-textarea {
          width: 100%;
          min-height: 82px;
          border-radius: 10px;
          border: 1px solid var(--border-subtle);
          background: var(--bg-inset);
          color: var(--text-primary);
          padding: 10px 12px;
          resize: vertical;
          font: inherit;
        }

        .thread-add-textarea:focus {
          outline: none;
          border-color: #3b82f6;
        }

        .thread-add-btn {
          justify-self: end;
          border: 1px solid #3b82f6;
          background: #1d4ed8;
          color: var(--text-primary);
          border-radius: 8px;
          padding: 6px 12px;
          cursor: pointer;
          font-size: 12px;
        }

        .thread-add-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </>
  );
}
