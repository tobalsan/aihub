import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { fetchActivity, fetchAgents } from "../api/client";
import type { ActivityEvent, AgentListItem } from "../api/types";

function formatRelativeTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

type ActivityFeedProps = {
  onSelectAgent?: (id: string) => void;
  onOpenProject?: (id: string) => void;
  onBack?: () => void;
  fullscreen?: boolean;
};

export function ActivityFeed(props: ActivityFeedProps) {
  const [items, setItems] = createSignal<ActivityEvent[]>([]);
  const [offset, setOffset] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [hasMore, setHasMore] = createSignal(true);
  const pageSize = 20;
  const [agents] = createResource(fetchAgents);

  const resolveAgentId = (name: string) => {
    const list = (agents() ?? []) as AgentListItem[];
    return list.find((agent) => agent.name === name)?.id ?? null;
  };

  const resolveSubagentId = (event: ActivityEvent) => {
    if (event.type !== "subagent_action") return null;
    if (!event.projectId || !event.subagentSlug) return null;
    return `${event.projectId}/${event.subagentSlug}`;
  };

  const mergeById = (base: ActivityEvent[], next: ActivityEvent[]) => {
    const seen = new Set(base.map((event) => event.id));
    const merged = [...base];
    for (const event of next) {
      if (seen.has(event.id)) continue;
      merged.push(event);
      seen.add(event.id);
    }
    return merged;
  };

  const loadPage = async (nextOffset: number, append: boolean) => {
    if (loading()) return;
    setLoading(true);
    try {
      const res = await fetchActivity(nextOffset, pageSize);
      const page = res.events ?? [];
      if (append) {
        setItems((prev) => mergeById(prev, page));
      } else {
        setItems((prev) => {
          const deduped = mergeById(page, prev.filter((event) => !page.some((e) => e.id === event.id)));
          return deduped;
        });
      }
      setHasMore(page.length === pageSize);
      setOffset(nextOffset + page.length);
    } finally {
      setLoading(false);
    }
  };

  const list = () => items();
  const isClickable = (event: ActivityEvent) =>
    (event.type === "agent_message" &&
      (Boolean(resolveAgentId(event.actor)) || Boolean(resolveSubagentId(event)))) ||
    (event.type === "subagent_action" && Boolean(resolveSubagentId(event))) ||
    (event.type === "project_status" && Boolean(event.projectId));

  const handleItemClick = (event: ActivityEvent) => {
    if (event.type === "agent_message") {
      const id = resolveAgentId(event.actor);
      if (id && props.onSelectAgent) {
        props.onSelectAgent(id);
        return;
      }
      const subagentId = resolveSubagentId(event);
      if (subagentId && props.onSelectAgent) {
        props.onSelectAgent(subagentId);
      }
    }
    if (event.type === "subagent_action") {
      const subagentId = resolveSubagentId(event);
      if (subagentId && props.onSelectAgent) {
        props.onSelectAgent(subagentId);
      }
    }
    if (event.type === "project_status" && event.projectId && props.onOpenProject) {
      props.onOpenProject(event.projectId);
    }
  };

  onMount(() => {
    void loadPage(0, false);
    const interval = setInterval(() => {
      void loadPage(0, false);
    }, 10000);
    onCleanup(() => clearInterval(interval));
  });

  const handleScroll = (e: Event) => {
    if (!hasMore() || loading()) return;
    const target = e.currentTarget as HTMLDivElement;
    const threshold = 120;
    if (target.scrollHeight - target.scrollTop - target.clientHeight <= threshold) {
      void loadPage(offset(), true);
    }
  };

  return (
    <div class="activity-feed" classList={{ fullscreen: Boolean(props.fullscreen) }}>
      <div class="activity-header">
        <Show when={props.onBack}>
          <button class="back-btn" type="button" onClick={props.onBack} aria-label="Back">
            ←
          </button>
        </Show>
        <h3>Activity</h3>
        <div class="live-badge">
          <span class="live-dot" />
          LIVE
        </div>
      </div>
      <div class="activity-list" onScroll={handleScroll}>
        <Show when={list().length > 0} fallback={<div class="activity-empty">No activity yet.</div>}>
          <For each={list()}>
            {(event) =>
              isClickable(event) ? (
                <button
                  type="button"
                  class="activity-item activity-clickable"
                  onClick={() => handleItemClick(event)}
                >
                  <span class={`activity-dot ${event.color}`} />
                  <div class="activity-text">
                    <p>
                      <strong>{event.actor}</strong> {event.action}
                    </p>
                    <span class="activity-time">{formatRelativeTime(event.timestamp)}</span>
                  </div>
                </button>
              ) : (
                <div class="activity-item">
                  <span class={`activity-dot ${event.color}`} />
                  <div class="activity-text">
                    <p>
                      <strong>{event.actor}</strong> {event.action}
                    </p>
                    <span class="activity-time">{formatRelativeTime(event.timestamp)}</span>
                  </div>
                </div>
              )
            }
          </For>
        </Show>
        <Show when={hasMore()}>
          <div class="activity-loading">
            <span class="feed-spinner" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
        </Show>
      </div>

      <style>{`
        .activity-feed {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .activity-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-bottom: 1px solid #2a2a2a;
        }

        .back-btn {
          background: none;
          border: none;
          color: #888;
          font-size: 16px;
          cursor: pointer;
          margin-right: 8px;
        }

        .back-btn:hover {
          color: #fff;
        }

        .back-btn:focus-visible {
          outline: 2px solid rgba(59, 130, 246, 0.6);
          outline-offset: 2px;
        }

        .activity-header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          flex: 1;
        }

        .live-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: #22c55e;
        }

        .live-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #22c55e;
          animation: pulse 1.6s ease-in-out infinite;
        }

        .activity-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px 0;
          scroll-behavior: smooth;
        }

        .activity-empty {
          padding: 16px;
          font-size: 12px;
          color: #666;
        }

        .activity-item {
          display: flex;
          gap: 12px;
          padding: 12px 16px;
          width: 100%;
          text-align: left;
          background: none;
          border: none;
          color: inherit;
        }

        .activity-clickable {
          cursor: pointer;
        }

        .activity-clickable:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .activity-clickable:focus-visible {
          outline: 1px solid rgba(45, 212, 191, 0.6);
          outline-offset: -1px;
        }

        .activity-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          margin-top: 6px;
          background: #666;
          flex: 0 0 auto;
        }

        .activity-dot.green { background: #22c55e; }
        .activity-dot.purple { background: #a855f7; }
        .activity-dot.blue { background: #3b82f6; }
        .activity-dot.yellow { background: #eab308; }

        .activity-text p {
          margin: 0;
          font-size: 13px;
          color: #ddd;
        }

        .activity-time {
          display: block;
          font-size: 11px;
          color: #666;
          margin-top: 4px;
        }

        .activity-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px 0 20px;
        }

        .feed-spinner {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 12px;
          padding: 0 6px;
          border-radius: 999px;
          background: rgba(6, 78, 59, 0.35);
          box-shadow: inset 0 0 0 1px rgba(45, 212, 191, 0.35);
        }

        .feed-spinner span {
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: rgba(45, 212, 191, 0.95);
          box-shadow: 0 0 6px rgba(20, 184, 166, 0.85);
          animation: feed-pulse 1s ease-in-out infinite;
        }

        .feed-spinner span:nth-child(2) {
          animation-delay: 0.15s;
        }

        .feed-spinner span:nth-child(3) {
          animation-delay: 0.3s;
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }

        @keyframes feed-pulse {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-3px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
