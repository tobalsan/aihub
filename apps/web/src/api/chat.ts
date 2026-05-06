import type {
  FileAttachment,
  SendMessageResponse,
  ThinkLevel,
} from "./types";
import { API_BASE, apiFetch as fetch } from "./core";
import { dispatchWsEvent, getWsUrl, type WsStreamEvent } from "./ws";

const SESSION_KEY_PREFIX = "aihub:sessionKey:";
const DEFAULT_SESSION_KEY = "main";

export type DoneMeta = {
  durationMs?: number;
  aborted?: boolean;
  queued?: boolean;
};

export type StreamCallbacks = {
  onText: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolCall?: (id: string, name: string, args: unknown) => void;
  onToolResult?: (
    id: string,
    name: string,
    content: string,
    isError: boolean,
    details?: { diff?: string }
  ) => void;
  onToolStart?: (toolName: string) => void;
  onToolEnd?: (toolName: string, isError: boolean) => void;
  onFileOutput?: (file: {
    fileId: string;
    filename: string;
    mimeType: string;
    size: number;
  }) => void;
  onSessionReset?: (sessionId: string) => void;
  onDone: (meta?: DoneMeta) => void;
  onError: (error: string) => void;
};

export type StreamMessageOptions = {
  attachments?: FileAttachment[];
  thinkLevel?: ThinkLevel;
};

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

export async function postAbort(
  agentId: string,
  sessionKey: string
): Promise<void> {
  await fetch(`${API_BASE}/agents/${agentId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "/abort", sessionKey }),
  });
}

export function getSessionKey(agentId: string): string {
  return (
    localStorage.getItem(`${SESSION_KEY_PREFIX}${agentId}`) ??
    DEFAULT_SESSION_KEY
  );
}

export function setSessionKey(agentId: string, key: string): void {
  localStorage.setItem(`${SESSION_KEY_PREFIX}${agentId}`, key);
}

export function streamMessage(
  agentId: string,
  message: string,
  sessionKey: string,
  onText: (text: string) => void,
  onDone: (meta?: DoneMeta) => void,
  onError: (error: string) => void,
  callbacks?: Partial<StreamCallbacks>,
  options?: StreamMessageOptions
): () => void {
  const ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    const payload: Record<string, unknown> = {
      type: "send",
      agentId,
      sessionKey,
      message,
    };
    if (options?.attachments && options.attachments.length > 0) {
      payload.attachments = options.attachments;
    }
    if (options?.thinkLevel) {
      payload.thinkLevel = options.thinkLevel;
    }
    ws.send(JSON.stringify(payload));
  };

  ws.onmessage = (e) => {
    dispatchWsEvent(JSON.parse(e.data) as WsStreamEvent, {
      ...callbacks,
      onText,
      onDone,
      onError,
    });
  };

  ws.onerror = () => {
    onError("Connection error");
  };

  return () => {
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      ws.close();
    }
  };
}
