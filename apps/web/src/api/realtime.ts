import type { SubagentRunStatus } from "@aihub/shared/types";
import type { ActiveTurn } from "./agents";
import { dispatchWsEvent, getWsUrl, wsDebug, type WsStreamEvent } from "./ws";

export type SubscriptionCallbacks = {
  onText?: (text: string) => void;
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
  onActiveTurn?: (snapshot: ActiveTurn) => void;
  onDone?: () => void;
  onHistoryUpdated?: () => void;
  onError?: (error: string) => void;
};

/**
 * Subscribe to live updates for an agent session.
 * Receives events from background runs (discord, scheduler).
 */
export function subscribeToSession(
  agentId: string,
  sessionKey: string,
  callbacks: SubscriptionCallbacks
): () => void {
  const ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "subscribe", agentId, sessionKey }));
    callbacks.onHistoryUpdated?.();
  };

  ws.onmessage = (e) => {
    dispatchWsEvent(JSON.parse(e.data) as WsStreamEvent, callbacks);
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

export type StatusCallbacks = {
  onStatus?: (agentId: string, status: "streaming" | "idle") => void;
  onError?: (error: string) => void;
  onReconnect?: () => void;
};

export type FileChangeCallbacks = {
  onFileChanged?: (projectId: string, file: string) => void;
  onAgentChanged?: (projectId: string) => void;
  onError?: (error: string) => void;
};

export type SubagentChangeCallbacks = {
  onSubagentChanged?: (event: {
    runId: string;
    parent?: { type: string; id: string };
    status: SubagentRunStatus;
  }) => void;
  onError?: (error: string) => void;
};

const statusSubscribers = new Set<StatusCallbacks>();
let statusSocket: WebSocket | null = null;
let statusReconnectTimer: number | undefined;
let statusHasConnectedOnce = false;

function clearStatusReconnectTimer(): void {
  if (statusReconnectTimer !== undefined) {
    window.clearTimeout(statusReconnectTimer);
    statusReconnectTimer = undefined;
  }
}

function scheduleStatusReconnect(): void {
  if (statusSubscribers.size === 0) return;
  if (statusReconnectTimer !== undefined) return;
  statusReconnectTimer = window.setTimeout(() => {
    statusReconnectTimer = undefined;
    if (statusSubscribers.size > 0) {
      connectStatusSocket();
    }
  }, 1000);
}

function disconnectStatusSocket(): void {
  clearStatusReconnectTimer();
  const socket = statusSocket;
  statusSocket = null;
  statusHasConnectedOnce = false;
  if (!socket) return;
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "unsubscribeStatus" }));
  }
  socket.close();
}

function connectStatusSocket(): void {
  if (statusSubscribers.size === 0) return;
  if (
    statusSocket &&
    (statusSocket.readyState === WebSocket.OPEN ||
      statusSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  const ws = new WebSocket(getWsUrl());
  statusSocket = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "subscribeStatus" }));
    if (statusHasConnectedOnce) {
      for (const subscriber of statusSubscribers) {
        subscriber.onReconnect?.();
      }
    }
    statusHasConnectedOnce = true;
  };

  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "status") {
      if (wsDebug()) {
        console.log("[ws] status received:", payload.agentId, payload.status);
      }
      for (const subscriber of statusSubscribers) {
        subscriber.onStatus?.(payload.agentId, payload.status);
      }
      return;
    }
    if (payload.type === "error") {
      for (const subscriber of statusSubscribers) {
        subscriber.onError?.(payload.message);
      }
    }
  };

  ws.onerror = () => {
    for (const subscriber of statusSubscribers) {
      subscriber.onError?.("Status subscription connection error");
    }
  };

  ws.onclose = () => {
    if (statusSocket === ws) {
      statusSocket = null;
    }
    if (wsDebug()) {
      console.log("[ws] status socket closed, scheduling reconnect");
    }
    scheduleStatusReconnect();
  };
}

const fileChangeSubscribers = new Set<FileChangeCallbacks>();
const subagentChangeSubscribers = new Set<SubagentChangeCallbacks>();
let fileChangeSocket: WebSocket | null = null;
let fileChangeReconnectTimer: number | undefined;

function clearFileChangeReconnectTimer(): void {
  if (fileChangeReconnectTimer !== undefined) {
    window.clearTimeout(fileChangeReconnectTimer);
    fileChangeReconnectTimer = undefined;
  }
}

function scheduleFileChangeReconnect(): void {
  if (
    fileChangeSubscribers.size === 0 &&
    subagentChangeSubscribers.size === 0
  ) {
    return;
  }
  if (fileChangeReconnectTimer !== undefined) return;
  fileChangeReconnectTimer = window.setTimeout(() => {
    fileChangeReconnectTimer = undefined;
    if (fileChangeSubscribers.size > 0 || subagentChangeSubscribers.size > 0) {
      connectFileChangeSocket();
    }
  }, 1000);
}

function disconnectFileChangeSocket(): void {
  clearFileChangeReconnectTimer();
  const socket = fileChangeSocket;
  fileChangeSocket = null;
  if (!socket) return;
  // No unsubscribe message needed — server broadcasts to all clients.
  socket.close();
}

function connectFileChangeSocket(): void {
  if (
    fileChangeSubscribers.size === 0 &&
    subagentChangeSubscribers.size === 0
  ) {
    return;
  }
  if (
    fileChangeSocket &&
    (fileChangeSocket.readyState === WebSocket.OPEN ||
      fileChangeSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  const ws = new WebSocket(getWsUrl());
  fileChangeSocket = ws;

  ws.onopen = () => {
    // Server broadcasts file_changed/agent_changed to all connected clients,
    // no subscribe message needed — just keep the connection open.
  };

  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (wsDebug()) {
      console.log("[ws] file event received:", payload.type, payload.projectId);
    }
    if (payload.type === "file_changed") {
      for (const subscriber of fileChangeSubscribers) {
        subscriber.onFileChanged?.(payload.projectId, payload.file);
      }
      return;
    }
    if (payload.type === "agent_changed") {
      for (const subscriber of fileChangeSubscribers) {
        subscriber.onAgentChanged?.(payload.projectId);
      }
      return;
    }
    if (payload.type === "subagent_changed") {
      for (const subscriber of subagentChangeSubscribers) {
        subscriber.onSubagentChanged?.({
          runId: payload.runId,
          parent: payload.parent,
          status: payload.status,
        });
      }
      return;
    }
    if (payload.type === "error") {
      for (const subscriber of fileChangeSubscribers) {
        subscriber.onError?.(payload.message);
      }
      for (const subscriber of subagentChangeSubscribers) {
        subscriber.onError?.(payload.message);
      }
    }
  };

  ws.onerror = () => {
    for (const subscriber of fileChangeSubscribers) {
      subscriber.onError?.("File change subscription connection error");
    }
    for (const subscriber of subagentChangeSubscribers) {
      subscriber.onError?.("Subagent subscription connection error");
    }
  };

  ws.onclose = () => {
    if (fileChangeSocket === ws) {
      fileChangeSocket = null;
    }
    scheduleFileChangeReconnect();
  };
}

/**
 * Subscribe to global agent status updates.
 * Receives real-time status changes for all agents.
 */
export function subscribeToStatus(callbacks: StatusCallbacks): () => void {
  statusSubscribers.add(callbacks);
  connectStatusSocket();

  return () => {
    statusSubscribers.delete(callbacks);
    if (statusSubscribers.size === 0) {
      disconnectStatusSocket();
    }
  };
}

export function subscribeToFileChanges(
  callbacks: FileChangeCallbacks
): () => void {
  fileChangeSubscribers.add(callbacks);
  connectFileChangeSocket();

  return () => {
    fileChangeSubscribers.delete(callbacks);
    if (
      fileChangeSubscribers.size === 0 &&
      subagentChangeSubscribers.size === 0
    ) {
      disconnectFileChangeSocket();
    }
  };
}

export function subscribeToSubagentChanges(
  callbacks: SubagentChangeCallbacks
): () => void {
  subagentChangeSubscribers.add(callbacks);
  connectFileChangeSocket();

  return () => {
    subagentChangeSubscribers.delete(callbacks);
    if (
      fileChangeSubscribers.size === 0 &&
      subagentChangeSubscribers.size === 0
    ) {
      disconnectFileChangeSocket();
    }
  };
}
