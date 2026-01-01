import type {
  Agent,
  SendMessageResponse,
  StreamEvent,
  SimpleHistoryMessage,
  FullHistoryMessage,
  HistoryViewMode,
  ActiveToolCall,
} from "./types";

const API_BASE = "/api";
const SESSION_KEY_PREFIX = "aihub:sessionKey:";
const DEFAULT_SESSION_KEY = "main";

export async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch(`${API_BASE}/agents`);
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json();
}

export async function fetchSimpleHistory(
  agentId: string,
  sessionKey: string
): Promise<SimpleHistoryMessage[]> {
  const res = await fetch(
    `${API_BASE}/agents/${agentId}/history?sessionKey=${encodeURIComponent(sessionKey)}&view=simple`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.messages ?? [];
}

export async function fetchFullHistory(
  agentId: string,
  sessionKey: string
): Promise<FullHistoryMessage[]> {
  const res = await fetch(
    `${API_BASE}/agents/${agentId}/history?sessionKey=${encodeURIComponent(sessionKey)}&view=full`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.messages ?? [];
}

/** @deprecated Use fetchSimpleHistory or fetchFullHistory */
export async function fetchHistory(
  agentId: string,
  sessionKey: string
): Promise<SimpleHistoryMessage[]> {
  return fetchSimpleHistory(agentId, sessionKey);
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
  // In dev mode (port 3000), connect directly to gateway (port 4000)
  // In prod, use same host
  const isDev = window.location.port === "3000";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = isDev ? `${window.location.hostname}:4000` : window.location.host;
  return `${proto}//${host}/ws`;
}

export function getSessionKey(agentId: string): string {
  return localStorage.getItem(`${SESSION_KEY_PREFIX}${agentId}`) ?? DEFAULT_SESSION_KEY;
}

export function setSessionKey(agentId: string, key: string): void {
  localStorage.setItem(`${SESSION_KEY_PREFIX}${agentId}`, key);
}

export type StreamCallbacks = {
  onText: (text: string) => void;
  onToolStart?: (toolName: string) => void;
  onToolEnd?: (toolName: string, isError: boolean) => void;
  onDone: () => void;
  onError: (error: string) => void;
};

export function streamMessage(
  agentId: string,
  message: string,
  sessionKey: string,
  onText: (text: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  callbacks?: Partial<StreamCallbacks>
): () => void {
  const ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "send", agentId, sessionKey, message }));
  };

  ws.onmessage = (e) => {
    const event: StreamEvent = JSON.parse(e.data);
    switch (event.type) {
      case "text":
        onText(event.data);
        break;
      case "tool_start":
        callbacks?.onToolStart?.(event.toolName);
        break;
      case "tool_end":
        callbacks?.onToolEnd?.(event.toolName, event.isError ?? false);
        break;
      case "done":
        onDone();
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
