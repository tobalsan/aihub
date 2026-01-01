import type { Agent, SendMessageResponse, StreamEvent, HistoryMessage } from "./types";

const API_BASE = "/api";
const SESSION_KEY_PREFIX = "aihub:sessionKey:";
const DEFAULT_SESSION_KEY = "main";

export async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch(`${API_BASE}/agents`);
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json();
}

export async function fetchHistory(
  agentId: string,
  sessionKey: string
): Promise<HistoryMessage[]> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/history?sessionKey=${encodeURIComponent(sessionKey)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.messages ?? [];
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

export function streamMessage(
  agentId: string,
  message: string,
  sessionKey: string,
  onText: (text: string) => void,
  onDone: () => void,
  onError: (error: string) => void
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
