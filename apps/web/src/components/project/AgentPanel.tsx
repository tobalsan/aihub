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
  onStatusChange: (status: string) => Promise<void> | void;
};

function getFrontmatterString(
  frontmatter: Record<string, unknown>,
  key: string
): string {
  const value = frontmatter[key];
  return typeof value === "string" ? value : "";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function AgentPanel(props: AgentPanelProps) {
  const status = () =>
    getFrontmatterString(props.project.frontmatter, "status");
  const repo = () => getFrontmatterString(props.project.frontmatter, "repo");
  const created = () =>
    getFrontmatterString(props.project.frontmatter, "created");
  const updated = () =>
    getFrontmatterString(props.project.frontmatter, "updated");

  return (
    <>
      <aside class="agent-panel">
        <section class="agent-panel-block">
          <h2 class="agent-panel-title">{props.project.title}</h2>
          <div class="agent-panel-meta">
            <span class="agent-badge">{status() || "unknown"}</span>
            {props.area && (
              <span
                class="agent-badge area"
                style={{
                  "border-color": props.area.color,
                  color: props.area.color,
                }}
              >
                {props.area.title}
              </span>
            )}
          </div>
        </section>

        <section class="agent-panel-block">
          <label class="agent-panel-label" for="project-status-select">
            Status
          </label>
          <select
            id="project-status-select"
            class="agent-panel-select"
            value={status() || "maybe"}
            onChange={(e) => void props.onStatusChange(e.currentTarget.value)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option value={option}>{option}</option>
            ))}
          </select>
        </section>

        <section class="agent-panel-block">
          <div class="agent-panel-label">Repo</div>
          <p class="agent-panel-text">{repo() || "No repo set"}</p>
        </section>

        <section class="agent-panel-block">
          <div class="agent-panel-label">Path</div>
          <p class="agent-panel-text">{props.project.absolutePath}</p>
        </section>

        <section class="agent-panel-block">
          <div class="agent-panel-label">Created</div>
          <p class="agent-panel-text">
            {created() ? formatDate(created()) : "—"}
          </p>
          <div class="agent-panel-label">Last modified</div>
          <p class="agent-panel-text">
            {updated() ? formatDate(updated()) : "—"}
          </p>
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
          margin: 0 0 8px;
          font-size: 15px;
          line-height: 1.4;
        }

        .agent-panel-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .agent-badge {
          border: 1px solid #2a3240;
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #a1a1aa;
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

        .agent-panel-select {
          width: 100%;
          border: 1px solid #2a3240;
          background: #0f1724;
          color: #e4e4e7;
          border-radius: 8px;
          padding: 6px 8px;
          font-size: 12px;
        }
      `}</style>
    </>
  );
}
