import { For, Show, createEffect, createResource, onCleanup } from "solid-js";
import { fetchActivity } from "../api/client";
import type { ActivityEvent } from "../api/types";

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

export function ActivityFeed() {
  const [events, { refetch }] = createResource(fetchActivity);

  createEffect(() => {
    const interval = setInterval(() => refetch(), 10000);
    onCleanup(() => clearInterval(interval));
  });

  const list = () => (events()?.events ?? []) as ActivityEvent[];

  return (
    <div class="activity-feed">
      <div class="activity-header">
        <h3>Activity</h3>
        <div class="live-badge">
          <span class="live-dot" />
          LIVE
        </div>
      </div>
      <div class="activity-list">
        <Show when={list().length > 0} fallback={<div class="activity-empty">No activity yet.</div>}>
          <For each={list()}>
            {(event) => (
              <div class="activity-item">
                <span class={`activity-dot ${event.color}`} />
                <div class="activity-text">
                  <p>
                    <strong>{event.actor}</strong> {event.action}
                  </p>
                  <span class="activity-time">{formatRelativeTime(event.timestamp)}</span>
                </div>
              </div>
            )}
          </For>
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

        .activity-header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
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

        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
