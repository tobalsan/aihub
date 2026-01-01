import type { Agent, SendMessageResponse } from "./types";

const API_BASE = "/api";

export async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch(`${API_BASE}/agents`);
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json();
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

export function streamMessage(
  agentId: string,
  message: string,
  sessionId: string,
  onText: (text: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): () => void {
  const url = new URL(`${API_BASE}/agents/${agentId}/stream`, window.location.origin);
  url.searchParams.set("message", message);
  url.searchParams.set("sessionId", sessionId);

  const eventSource = new EventSource(url.toString());

  eventSource.addEventListener("text", (e) => {
    const data = JSON.parse(e.data);
    onText(data.data);
  });

  eventSource.addEventListener("done", () => {
    eventSource.close();
    onDone();
  });

  eventSource.addEventListener("error", (e) => {
    if (e instanceof MessageEvent) {
      const data = JSON.parse(e.data);
      onError(data.message);
    } else {
      onError("Connection error");
    }
    eventSource.close();
  });

  eventSource.onerror = () => {
    onError("Connection lost");
    eventSource.close();
  };

  return () => eventSource.close();
}
