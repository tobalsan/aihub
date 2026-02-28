import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { fetchSubagentLogs, fetchSubagents } from "../../api/client";
import { AgentChat } from "../AgentChat";
import type {
  ProjectDetail,
  SubagentListItem,
  SubagentLogEvent,
} from "../../api/types";
import { ChangesView } from "./ChangesView";

export type CenterTab = "chat" | "activity" | "changes";
export type SelectedProjectAgent = {
  type: "lead" | "subagent";
  agentId?: string;
  agentName?: string;
  slug?: string;
  cli?: string;
  status?: string;
  projectId: string;
};

type CenterPanelProps = {
  project: ProjectDetail;
  tab?: CenterTab;
  showTabs?: boolean;
  onAddComment?: (body: string) => Promise<void>;
  selectedAgent: SelectedProjectAgent | null;
};

type TimelineItem = {
  key: string;
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

function firstPromptSnippet(events: SubagentLogEvent[]): string {
  const prompt = events.find((event) => event.type === "user" && event.text);
  if (!prompt?.text) return "";
  return prompt.text.slice(0, 140);
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
  const [internalTab, setInternalTab] = createSignal<CenterTab>("chat");
  const [newComment, setNewComment] = createSignal("");
  const [addingComment, setAddingComment] = createSignal(false);
  const [subagents, setSubagents] = createSignal<SubagentListItem[]>([]);
  const [logBySlug, setLogBySlug] = createSignal<
    Record<string, SubagentLogEvent[]>
  >({});
  const tab = () => props.tab ?? internalTab();
  const canSubmitComment = () =>
    Boolean(props.onAddComment) && newComment().trim().length > 0;
  const timelineItems = createMemo<TimelineItem[]>(() => {
    const threadItems: TimelineItem[] = props.project.thread.map(
      (entry, index) => ({
        key: `thread:${index}`,
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
      const startSnippet = firstPromptSnippet(events);
      if (startedAt) {
        subagentItems.push({
          key: `subagent:start:${item.slug}`,
          ts: parseTimestamp(startedAt),
          dateLabel: formatDateLabel(startedAt),
          author: cli,
          body: startSnippet
            ? `Agent started. Prompt: ${startSnippet}`
            : "Agent started.",
        });
      }
      if (item.status === "replied" || item.status === "error") {
        const outcome =
          item.status === "error" ? "Agent errored." : "Agent completed.";
        const details = outcomeSnippet(events);
        const stamp =
          (events.length > 0 ? events[events.length - 1].ts : undefined) ??
          item.lastActive;
        subagentItems.push({
          key: `subagent:end:${item.slug}`,
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
    const timer = window.setInterval(() => {
      void poll();
    }, 10000);
    onCleanup(() => {
      active = false;
      window.clearInterval(timer);
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
                  onClick={() => setInternalTab(item.id)}
                >
                  {item.label}
                </button>
              )}
            </For>
          </header>
        </Show>
        <div class="center-panel-body">
          <Show when={tab() === "chat"}>
            <Show
              when={props.selectedAgent}
              fallback={
                <p class="center-placeholder">Select an agent to chat</p>
              }
            >
              {(selected) => (
                <AgentChat
                  agentType={selected().type}
                  agentId={
                    selected().type === "lead"
                      ? (selected().agentId ?? null)
                      : null
                  }
                  agentName={
                    selected().type === "lead"
                      ? (selected().agentName ?? selected().agentId ?? null)
                      : `${selected().projectId}/${selected().cli ?? selected().slug ?? "agent"}`
                  }
                  subagentInfo={
                    selected().type === "subagent" && selected().slug
                      ? {
                          projectId: selected().projectId,
                          slug: selected().slug!,
                          cli: selected().cli,
                          status: selected().status as
                            | "running"
                            | "replied"
                            | "error"
                            | "idle"
                            | undefined,
                        }
                      : undefined
                  }
                  onBack={() => {}}
                />
              )}
            </Show>
          </Show>
          <Show when={tab() === "activity"}>
            <Show
              when={timelineItems().length > 0}
              fallback={<p class="center-placeholder">No activity yet</p>}
            >
              <ul class="activity-list">
                <For each={timelineItems()}>
                  {(entry) => (
                    <li class="activity-item">
                      <div class="activity-meta">
                        <span class="activity-author">{entry.author}</span>
                        <span class="activity-date">{entry.dateLabel}</span>
                      </div>
                      <p>{entry.body}</p>
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
          </Show>
          <Show when={tab() === "changes"}>
            <ChangesView projectId={props.project.id} />
          </Show>
        </div>
      </section>
      <style>{`
        .center-panel {
          min-height: 100%;
          display: grid;
          grid-template-rows: auto 1fr;
          background: #0a0a0f;
        }

        .center-panel-tabs {
          display: flex;
          gap: 8px;
          position: sticky;
          top: 0;
          z-index: 2;
          background: #0a0a0f;
          padding: 16px 18px;
          border-bottom: 1px solid #1c2430;
        }

        .center-tab {
          border: 1px solid #2a3240;
          background: #111722;
          color: #a1a1aa;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          cursor: pointer;
        }

        .center-tab.active {
          color: #e4e4e7;
          border-color: #3b82f6;
          background: #172554;
        }

        .center-panel-body {
          padding: 20px;
          color: #e4e4e7;
        }

        .center-placeholder {
          color: #71717a;
        }

        .activity-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 10px;
        }

        .activity-item {
          border: 1px solid #1f2937;
          border-radius: 10px;
          padding: 12px;
          background: #111722;
        }

        .activity-item p {
          margin: 8px 0 0;
          color: #d4d4d8;
          white-space: pre-wrap;
        }

        .activity-meta {
          display: grid;
          gap: 2px;
        }

        .activity-author {
          color: #9ca3af;
          font-weight: 600;
          line-height: 1.2;
        }

        .activity-date {
          color: #71717a;
          line-height: 1.2;
          font-size: 12px;
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
          border: 1px solid #1f2937;
          background: #0f172a;
          color: #e4e4e7;
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
          color: #ffffff;
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
