import type {
  Agent,
  AgentStatusResponse,
  CapabilitiesResponse,
  FullHistoryMessage,
  SimpleHistoryMessage,
  ThinkLevel,
} from "./types";
import { API_BASE, apiFetch as fetch } from "./core";

export async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch(`${API_BASE}/agents`);
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json();
}

export async function fetchAgent(agentId: string): Promise<Agent> {
  const res = await fetch(`${API_BASE}/agents/${agentId}`);
  if (!res.ok) throw new Error("Failed to fetch agent");
  return res.json();
}

export async function fetchCapabilities(): Promise<CapabilitiesResponse> {
  const res = await fetch(`${API_BASE}/capabilities`);
  if (!res.ok) {
    const error = new Error("Failed to fetch capabilities") as Error & {
      status?: number;
    };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export type ActiveTurn = {
  userText: string | null;
  userTimestamp: number;
  startedAt: number;
  thinking: string;
  text: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: unknown;
    status: "running" | "done" | "error";
  }>;
};

export type HistoryResponse<T> = {
  messages: T[];
  thinkingLevel?: ThinkLevel;
  isStreaming?: boolean;
  activeTurn?: ActiveTurn | null;
};

export async function fetchSimpleHistory(
  agentId: string,
  sessionKey: string
): Promise<HistoryResponse<SimpleHistoryMessage>> {
  const res = await fetch(
    `${API_BASE}/agents/${agentId}/history?sessionKey=${encodeURIComponent(sessionKey)}&view=simple`
  );
  if (!res.ok) return { messages: [] };
  const data = await res.json();
  return {
    messages: data.messages ?? [],
    thinkingLevel: data.thinkingLevel,
    isStreaming: data.isStreaming,
    activeTurn: data.activeTurn ?? null,
  };
}

export async function fetchFullHistory(
  agentId: string,
  sessionKey: string
): Promise<HistoryResponse<FullHistoryMessage>> {
  const res = await fetch(
    `${API_BASE}/agents/${agentId}/history?sessionKey=${encodeURIComponent(sessionKey)}&view=full`
  );
  if (!res.ok) return { messages: [] };
  const data = await res.json();
  return {
    messages: data.messages ?? [],
    thinkingLevel: data.thinkingLevel,
    isStreaming: data.isStreaming,
    activeTurn: data.activeTurn ?? null,
  };
}

export async function fetchAgentStatuses(): Promise<AgentStatusResponse> {
  const res = await fetch(`${API_BASE}/agents/status`);
  if (!res.ok) throw new Error("Failed to fetch agent statuses");
  return res.json();
}
