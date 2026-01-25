import type {
  Agent,
  SendMessageResponse,
  StreamEvent,
  SimpleHistoryMessage,
  FullHistoryMessage,
  HistoryViewMode,
  ActiveToolCall,
  ThinkLevel,
  TaskboardResponse,
  TaskboardItemResponse,
  ProjectListItem,
  ProjectDetail,
  ProjectUpdatePayload,
} from "./types";

const API_BASE = "/api";
const SESSION_KEY_PREFIX = "aihub:sessionKey:";
const DEFAULT_SESSION_KEY = "main";

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

export type HistoryResponse<T> = {
  messages: T[];
  thinkingLevel?: ThinkLevel;
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
  return { messages: data.messages ?? [], thinkingLevel: data.thinkingLevel };
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
  return { messages: data.messages ?? [], thinkingLevel: data.thinkingLevel };
}

/** @deprecated Use fetchSimpleHistory or fetchFullHistory */
export async function fetchHistory(
  agentId: string,
  sessionKey: string
): Promise<SimpleHistoryMessage[]> {
  const res = await fetchSimpleHistory(agentId, sessionKey);
  return res.messages;
}

export async function sendMessage(
  agentId: string,
  message: string,
  sessionId?: string
): Promise<SendMessageResponse> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

function getWsUrl(): string {
  // Use Vite's proxy in dev mode, direct connection in prod
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function getSessionKey(agentId: string): string {
  return localStorage.getItem(`${SESSION_KEY_PREFIX}${agentId}`) ?? DEFAULT_SESSION_KEY;
}

export function setSessionKey(agentId: string, key: string): void {
  localStorage.setItem(`${SESSION_KEY_PREFIX}${agentId}`, key);
}

export type DoneMeta = {
  durationMs?: number;
  aborted?: boolean;
  queued?: boolean;
};

export type StreamCallbacks = {
  onText: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolCall?: (id: string, name: string, args: unknown) => void;
  onToolStart?: (toolName: string) => void;
  onToolEnd?: (toolName: string, isError: boolean) => void;
  onSessionReset?: (sessionId: string) => void;
  onDone: (meta?: DoneMeta) => void;
  onError: (error: string) => void;
};

export function streamMessage(
  agentId: string,
  message: string,
  sessionKey: string,
  onText: (text: string) => void,
  onDone: (meta?: DoneMeta) => void,
  onError: (error: string) => void,
  callbacks?: Partial<StreamCallbacks>,
  thinkLevel?: ThinkLevel
): () => void {
  const ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "send", agentId, sessionKey, message, ...(thinkLevel && { thinkLevel }) }));
  };

  ws.onmessage = (e) => {
    const event = JSON.parse(e.data);
    switch (event.type) {
      case "text":
        onText(event.data);
        break;
      case "thinking":
        callbacks?.onThinking?.(event.data);
        break;
      case "tool_call":
        callbacks?.onToolCall?.(event.id, event.name, event.arguments);
        break;
      case "tool_start":
        callbacks?.onToolStart?.(event.toolName);
        break;
      case "tool_end":
        callbacks?.onToolEnd?.(event.toolName, event.isError ?? false);
        break;
      case "session_reset":
        callbacks?.onSessionReset?.(event.sessionId);
        break;
      case "done":
        onDone(event.meta);
        break;
      case "error":
        onError(event.message);
        break;
    }
  };

  ws.onerror = () => {
    onError("Connection error");
  };

  return () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };
}

export type SubscriptionCallbacks = {
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolCall?: (id: string, name: string, args: unknown) => void;
  onToolStart?: (toolName: string) => void;
  onToolEnd?: (toolName: string, isError: boolean) => void;
  onDone?: () => void;
  onHistoryUpdated?: () => void;
  onError?: (error: string) => void;
};

/**
 * Subscribe to live updates for an agent session.
 * Receives events from background runs (amsg, discord, scheduler).
 */
export function subscribeToSession(
  agentId: string,
  sessionKey: string,
  callbacks: SubscriptionCallbacks
): () => void {
  const ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "subscribe", agentId, sessionKey }));
  };

  ws.onmessage = (e) => {
    const event = JSON.parse(e.data);
    switch (event.type) {
      case "text":
        callbacks.onText?.(event.data);
        break;
      case "thinking":
        callbacks.onThinking?.(event.data);
        break;
      case "tool_call":
        callbacks.onToolCall?.(event.id, event.name, event.arguments);
        break;
      case "tool_start":
        callbacks.onToolStart?.(event.toolName);
        break;
      case "tool_end":
        callbacks.onToolEnd?.(event.toolName, event.isError ?? false);
        break;
      case "done":
        callbacks.onDone?.();
        break;
      case "history_updated":
        callbacks.onHistoryUpdated?.();
        break;
      case "error":
        callbacks.onError?.(event.message);
        break;
    }
  };

  ws.onerror = () => {
    callbacks.onError?.("Subscription connection error");
  };

  return () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "unsubscribe" }));
    }
    ws.close();
  };
}

// Taskboard API functions
export type TaskboardResult =
  | { ok: true; data: TaskboardResponse }
  | { ok: false; error: string };

export async function fetchTaskboard(): Promise<TaskboardResult> {
  const res = await fetch(`${API_BASE}/taskboard`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to fetch taskboard" }));
    return { ok: false, error: data.error ?? "Failed to fetch taskboard" };
  }
  const data = await res.json();
  return { ok: true, data };
}

export type TaskboardItemResult =
  | { ok: true; data: TaskboardItemResponse }
  | { ok: false; error: string };

export async function fetchTaskboardItem(
  type: "todo" | "project",
  id: string,
  companion?: string
): Promise<TaskboardItemResult> {
  const url = companion
    ? `${API_BASE}/taskboard/${type}/${id}?companion=${encodeURIComponent(companion)}`
    : `${API_BASE}/taskboard/${type}/${id}`;
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to fetch item" }));
    return { ok: false, error: data.error ?? "Failed to fetch item" };
  }
  const data = await res.json();
  return { ok: true, data };
}

// Projects API functions
export async function fetchProjects(): Promise<ProjectListItem[]> {
  const res = await fetch(`${API_BASE}/projects`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function fetchProject(id: string): Promise<ProjectDetail> {
  const res = await fetch(`${API_BASE}/projects/${id}`);
  if (!res.ok) throw new Error("Failed to fetch project");
  return res.json();
}

export async function updateProject(
  id: string,
  payload: ProjectUpdatePayload
): Promise<ProjectDetail> {
  const res = await fetch(`${API_BASE}/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to update project" }));
    throw new Error(data.error ?? "Failed to update project");
  }
  return res.json();
}
