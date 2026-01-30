import { For } from "solid-js";

type ActivityEvent = {
  actor: string;
  action: string;
  color: "green" | "purple" | "blue" | "yellow";
  time: string;
};

const SAMPLE_EVENTS: ActivityEvent[] = [
  { actor: "CTO", action: "moved PRO-24 to In Progress", color: "green", time: "2 min ago" },
  { actor: "PRO-24/codex", action: "committed to PRO-24", color: "purple", time: "5 min ago" },
  { actor: "Project Manager", action: "commented on PRO-15", color: "blue", time: "12 min ago" },
  { actor: "PRO-7/claude", action: "pushed 3 commits to PRO-7", color: "green", time: "18 min ago" },
  { actor: "Executive Assistant", action: "created PRO-22", color: "yellow", time: "25 min ago" },
  { actor: "CTO", action: "approved PRO-12", color: "green", time: "45 min ago" },
];

export function ActivityFeed() {
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
        <For each={SAMPLE_EVENTS}>
          {(event) => (
            <div class="activity-item">
              <span class={`activity-dot ${event.color}`} />
              <div class="activity-text">
                <p>
                  <strong>{event.actor}</strong> {event.action}
                </p>
                <span class="activity-time">{event.time}</span>
              </div>
            </div>
          )}
        </For>
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
