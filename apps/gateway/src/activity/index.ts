import type { GatewayConfig } from "@aihub/shared";
import { normalizeProjectStatus } from "@aihub/shared";
import { listProjects } from "../projects/index.js";
import { getActiveAgents } from "../config/index.js";
import { getSessionEntry, DEFAULT_MAIN_KEY } from "../sessions/index.js";
import { getSessionHistory } from "../agents/index.js";
import { listAllSubagents } from "../subagents/index.js";

type ActivityColor = "green" | "purple" | "blue" | "yellow";

export type ActivityEvent = {
  id: string;
  type: "project_status" | "agent_message" | "subagent_action";
  actor: string;
  action: string;
  projectId?: string;
  timestamp: string;
  color: ActivityColor;
};

const lastProjectStatuses = new Map<string, string>();
const lastAgentMessageTs = new Map<string, number>();
const lastSubagentActivity = new Map<string, string>();

function formatStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusColor(status: string): ActivityColor {
  if (status === "done" || status === "in_progress") return "green";
  if (status === "review") return "purple";
  if (status === "maybe" || status === "shaping") return "yellow";
  return "blue";
}

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function subagentColor(status: string): ActivityColor {
  if (status === "running") return "green";
  if (status === "error") return "yellow";
  if (status === "replied") return "purple";
  return "blue";
}

export async function getRecentActivity(
  config: GatewayConfig
): Promise<ActivityEvent[]> {
  const events: ActivityEvent[] = [];
  const nowIso = new Date().toISOString();

  const projects = await listProjects(config);
  if (projects.ok) {
    for (const project of projects.data) {
      const status = normalizeProjectStatus(String(project.frontmatter?.status ?? ""));
      const prev = lastProjectStatuses.get(project.id);
      lastProjectStatuses.set(project.id, status);
      if (prev && prev !== status) {
        events.push({
          id: `project-${project.id}-${Date.now()}`,
          type: "project_status",
          actor: "AIHub",
          action: `moved ${project.id} to ${formatStatus(status)}`,
          projectId: project.id,
          timestamp: nowIso,
          color: statusColor(status),
        });
      }
    }
  }

  const agents = getActiveAgents();
  for (const agent of agents) {
    const entry = getSessionEntry(agent.id, DEFAULT_MAIN_KEY);
    if (!entry) continue;
    const history = await getSessionHistory(agent.id, entry.sessionId);
    const last = [...history].reverse().find((msg) => msg.role === "assistant");
    if (!last || typeof last.timestamp !== "number") continue;
    const prevTs = lastAgentMessageTs.get(agent.id);
    if (prevTs === last.timestamp) continue;
    lastAgentMessageTs.set(agent.id, last.timestamp);
    const text = truncate(last.content.trim());
    if (!text) continue;
    events.push({
      id: `agent-${agent.id}-${last.timestamp}`,
      type: "agent_message",
      actor: agent.name,
      action: `said: ${text}`,
      timestamp: new Date(last.timestamp).toISOString(),
      color: "blue",
    });
  }

  const subagents = await listAllSubagents(config);
  for (const subagent of subagents) {
    if (!subagent.lastActive) continue;
    const key = `${subagent.projectId}:${subagent.slug}`;
    const prev = lastSubagentActivity.get(key);
    if (prev === subagent.lastActive) continue;
    lastSubagentActivity.set(key, subagent.lastActive);
    const actor = `${subagent.projectId}/${subagent.cli ?? subagent.slug}`;
    const action =
      subagent.status === "running"
        ? "is running"
        : subagent.status === "error"
          ? "errored"
          : subagent.status === "replied"
            ? "replied"
            : "is idle";
    events.push({
      id: `subagent-${key}-${subagent.lastActive}`,
      type: "subagent_action",
      actor,
      action,
      projectId: subagent.projectId,
      timestamp: subagent.lastActive ?? nowIso,
      color: subagentColor(subagent.status),
    });
  }

  return events
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 20);
}
