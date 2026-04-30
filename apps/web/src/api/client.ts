import type {
  Agent,
  CapabilitiesResponse,
  SendMessageResponse,
  SimpleHistoryMessage,
  FullHistoryMessage,
  ThinkLevel,
  TaskboardResponse,
  TaskboardItemResponse,
  ProjectListItem,
  ProjectDetail,
  ProjectUpdatePayload,
  DeleteProjectResponse,
  ArchiveProjectResponse,
  UnarchiveProjectResponse,
  ActivityResponse,
  AgentStatusResponse,
  SubagentGlobalListResponse,
  RuntimeSubagentListResponse,
  SubagentListItem,
  SubagentListResponse,
  SubagentLogsResponse,
  ProjectBranchesResponse,
  ProjectSpaceState,
  SpaceCommitSummary,
  SpaceContribution,
  SpaceLeaseState,
  SpaceWriteLease,
  ProjectPullRequestTarget,
  ProjectChanges,
  CommitResult,
  FileAttachment,
  UploadResponse,
  ProjectThreadEntry,
  Area,
  Task,
  TasksResponse,
  BoardProject,
  AreaSummary,
} from "./types";
import type { SubagentRun, SubagentRunStatus } from "@aihub/shared/types";

const API_BASE = "/api";
const SESSION_KEY_PREFIX = "aihub:sessionKey:";
const DEFAULT_SESSION_KEY = "main";
const wsDebug = () =>
  globalThis.localStorage?.getItem("debug")?.includes("aihub:ws");

function fetch(input: RequestInfo | URL, init?: RequestInit) {
  return globalThis.fetch(input, { ...init, credentials: "include" });
}

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

function getWsUrl(): string {
  // Use Vite's proxy in dev mode, direct connection in prod
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
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

type WsStreamEvent =
  | {
      type: "text";
      data: string;
    }
  | {
      type: "thinking";
      data: string;
    }
  | {
      type: "tool_call";
      id: string;
      name: string;
      arguments: unknown;
    }
  | {
      type: "tool_result";
      id: string;
      name: string;
      content: string;
      isError?: boolean;
      details?: { diff?: string };
    }
  | {
      type: "tool_start";
      toolName: string;
    }
  | {
      type: "tool_end";
      toolName: string;
      isError?: boolean;
    }
  | {
      type: "file_output";
      fileId: string;
      filename: string;
      mimeType: string;
      size: number;
    }
  | {
      type: "session_reset";
      sessionId: string;
    }
  | {
      type: "done";
      meta?: DoneMeta;
    }
  | {
      type: "history_updated";
    }
  | {
      type: "active_turn";
      agentId: string;
      sessionId: string;
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
    }
  | {
      type: "error";
      message: string;
    };

function dispatchWsEvent(
  event: WsStreamEvent,
  callbacks: Partial<StreamCallbacks & SubscriptionCallbacks>
): void {
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
    case "tool_result":
      callbacks.onToolResult?.(
        event.id,
        event.name,
        event.content,
        event.isError ?? false,
        event.details
      );
      break;
    case "tool_start":
      callbacks.onToolStart?.(event.toolName);
      break;
    case "tool_end":
      callbacks.onToolEnd?.(event.toolName, event.isError ?? false);
      break;
    case "file_output":
      callbacks.onFileOutput?.({
        fileId: event.fileId,
        filename: event.filename,
        mimeType: event.mimeType,
        size: event.size,
      });
      break;
    case "session_reset":
      callbacks.onSessionReset?.(event.sessionId);
      break;
    case "done":
      callbacks.onDone?.(event.meta);
      break;
    case "history_updated":
      callbacks.onHistoryUpdated?.();
      break;
    case "active_turn":
      callbacks.onActiveTurn?.({
        userText: event.userText,
        userTimestamp: event.userTimestamp,
        startedAt: event.startedAt,
        thinking: event.thinking,
        text: event.text,
        toolCalls: event.toolCalls,
      });
      break;
    case "error":
      callbacks.onError?.(event.message);
      break;
  }
}

/**
 * Upload a file to the server
 * Returns the file path that can be used in attachments
 */
export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/media/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(error.error || "Upload failed");
  }

  return res.json();
}

/**
 * Upload multiple files and return their paths as FileAttachments
 */
export async function uploadFiles(files: File[]): Promise<FileAttachment[]> {
  const results = await Promise.all(files.map(uploadFile));
  return results.map((r, index) => ({
    path: r.path,
    mimeType: r.mimeType,
    filename: files[index]?.name ?? r.filename,
    size: r.size,
  }));
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

// Taskboard API functions
export type TaskboardResult =
  | { ok: true; data: TaskboardResponse }
  | { ok: false; error: string };

export async function fetchTaskboard(): Promise<TaskboardResult> {
  const res = await fetch(`${API_BASE}/taskboard`);
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch taskboard" }));
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
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch item" }));
    return { ok: false, error: data.error ?? "Failed to fetch item" };
  }
  const data = await res.json();
  return { ok: true, data };
}

export async function fetchBoardProjects(
  includeDone = false
): Promise<BoardProject[]> {
  const url = includeDone
    ? `${API_BASE}/board/projects?include=done`
    : `${API_BASE}/board/projects`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch board projects");
  const data = (await res.json()) as { items?: BoardProject[] };
  return data.items ?? [];
}

export async function fetchAreaSummaries(): Promise<AreaSummary[]> {
  const res = await fetch(`${API_BASE}/board/areas`);
  if (!res.ok) throw new Error("Failed to fetch area summaries");
  const data = (await res.json()) as { items?: AreaSummary[] };
  return data.items ?? [];
}

export async function toggleAreaHidden(
  areaId: string,
  hidden: boolean,
): Promise<void> {
  const res = await fetch(`${API_BASE}/board/areas/${encodeURIComponent(areaId)}/hidden`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hidden }),
  });
  if (!res.ok) throw new Error("Failed to update area visibility");
}

export async function updateAreaLoop(
  areaId: string,
  date: string,
  body: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/board/areas/${encodeURIComponent(areaId)}/loop`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, body }),
  });
  if (!res.ok) throw new Error("Failed to update area loop");
}

// Projects API functions
export async function fetchProjects(area?: string): Promise<ProjectListItem[]> {
  const params = new URLSearchParams();
  if (typeof area === "string" && area.trim().length > 0) {
    params.set("area", area.trim());
  }
  const query = params.toString();
  const url = query ? `${API_BASE}/projects?${query}` : `${API_BASE}/projects`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function fetchArchivedProjects(): Promise<ProjectListItem[]> {
  const res = await fetch(`${API_BASE}/projects/archived`);
  if (!res.ok) throw new Error("Failed to fetch archived projects");
  return res.json();
}

export async function fetchAreas(): Promise<Area[]> {
  const res = await fetch(`${API_BASE}/areas`);
  if (!res.ok) throw new Error("Failed to fetch areas");
  return res.json();
}

export async function createArea(payload: Area): Promise<Area> {
  const res = await fetch(`${API_BASE}/areas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to create area" }));
    throw new Error(data.error ?? "Failed to create area");
  }
  return res.json();
}

export async function updateArea(
  id: string,
  payload: Partial<Area>
): Promise<Area> {
  const res = await fetch(`${API_BASE}/areas/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to update area" }));
    throw new Error(data.error ?? "Failed to update area");
  }
  return res.json();
}

export async function fetchActivity(
  offset = 0,
  limit = 20
): Promise<ActivityResponse> {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  const res = await fetch(`${API_BASE}/activity?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch activity");
  return res.json();
}

export async function fetchAgentStatuses(): Promise<AgentStatusResponse> {
  const res = await fetch(`${API_BASE}/agents/status`);
  if (!res.ok) throw new Error("Failed to fetch agent statuses");
  return res.json();
}

export type CreateProjectInput = {
  title: string;
  description?: string;
  area?: string;
};

export type CreateProjectResult =
  | { ok: true; data: ProjectDetail }
  | { ok: false; error: string };

export async function createProject(
  input: CreateProjectInput
): Promise<CreateProjectResult> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to create project" }));
    return { ok: false, error: data.error ?? "Failed to create project" };
  }
  const data = (await res.json()) as ProjectDetail;
  return { ok: true, data };
}

export async function fetchProject(id: string): Promise<ProjectDetail> {
  const res = await fetch(`${API_BASE}/projects/${id}`);
  if (!res.ok) throw new Error("Failed to fetch project");
  return res.json();
}

export async function fetchTasks(projectId: string): Promise<TasksResponse> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/tasks`);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json();
}

export async function updateTask(
  projectId: string,
  order: number,
  patch: { checked?: boolean; status?: Task["status"]; agentId?: string | null }
): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/tasks/${order}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to update task");
}

export async function createTask(
  projectId: string,
  input: { title: string; description?: string; status?: Task["status"] }
): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create task");
}

export async function fetchSpec(
  projectId: string
): Promise<{ content: string }> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/spec`);
  if (!res.ok) throw new Error("Failed to fetch spec");
  return res.json();
}

export async function saveSpec(
  projectId: string,
  content: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/spec`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("Failed to save spec");
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
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to update project" }));
    throw new Error(data.error ?? "Failed to update project");
  }
  return res.json();
}

export type DeleteProjectResult =
  | { ok: true; data: DeleteProjectResponse }
  | { ok: false; error: string };

export async function deleteProject(id: string): Promise<DeleteProjectResult> {
  const res = await fetch(`${API_BASE}/projects/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to delete project" }));
    return { ok: false, error: data.error ?? "Failed to delete project" };
  }
  const data = (await res.json()) as DeleteProjectResponse;
  return { ok: true, data };
}

export type ArchiveProjectResult =
  | { ok: true; data: ArchiveProjectResponse }
  | { ok: false; error: string };

export async function archiveProject(
  id: string
): Promise<ArchiveProjectResult> {
  const res = await fetch(`${API_BASE}/projects/${id}/archive`, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to archive project" }));
    return { ok: false, error: data.error ?? "Failed to archive project" };
  }
  const data = (await res.json()) as ArchiveProjectResponse;
  return { ok: true, data };
}

export type UnarchiveProjectResult =
  | { ok: true; data: UnarchiveProjectResponse }
  | { ok: false; error: string };

export async function unarchiveProject(
  id: string
): Promise<UnarchiveProjectResult> {
  const res = await fetch(`${API_BASE}/projects/${id}/unarchive`, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to unarchive project" }));
    return { ok: false, error: data.error ?? "Failed to unarchive project" };
  }
  const data = (await res.json()) as UnarchiveProjectResponse;
  return { ok: true, data };
}

export async function fetchAllSubagents(): Promise<SubagentGlobalListResponse> {
  const res = await fetch(`${API_BASE}/subagents`);
  if (!res.ok) throw new Error("Failed to fetch subagents");
  return res.json();
}

export async function fetchRuntimeSubagents(filters?: {
  parent?: string;
  status?: SubagentRunStatus;
  includeArchived?: boolean;
}): Promise<RuntimeSubagentListResponse> {
  const params = new URLSearchParams();
  if (filters?.parent) params.set("parent", filters.parent);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.includeArchived) params.set("includeArchived", "true");
  const query = params.toString();
  const res = await fetch(`${API_BASE}/subagents${query ? `?${query}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch subagents");
  return res.json();
}

export async function fetchRuntimeSubagentLogs(
  runId: string,
  since: number
): Promise<SubagentLogsResponse> {
  const res = await fetch(
    `${API_BASE}/subagents/${encodeURIComponent(runId)}/logs?since=${since}`
  );
  if (!res.ok) throw new Error("Failed to fetch subagent logs");
  return res.json();
}

export type InterruptRuntimeSubagentResult =
  | { ok: true; data: SubagentRun }
  | { ok: false; error: string };

export async function interruptRuntimeSubagent(
  runId: string
): Promise<InterruptRuntimeSubagentResult> {
  const res = await fetch(
    `${API_BASE}/subagents/${encodeURIComponent(runId)}/interrupt`,
    { method: "POST" }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to interrupt subagent" }));
    return { ok: false, error: data.error ?? "Failed to interrupt subagent" };
  }
  return { ok: true, data: (await res.json()) as SubagentRun };
}

export type ArchiveRuntimeSubagentResult =
  | { ok: true; data: SubagentRun }
  | { ok: false; error: string };

export async function archiveRuntimeSubagent(
  runId: string
): Promise<ArchiveRuntimeSubagentResult> {
  const res = await fetch(
    `${API_BASE}/subagents/${encodeURIComponent(runId)}/archive`,
    { method: "POST" }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to archive subagent" }));
    return { ok: false, error: data.error ?? "Failed to archive subagent" };
  }
  return { ok: true, data: (await res.json()) as SubagentRun };
}

export type DeleteRuntimeSubagentResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteRuntimeSubagent(
  runId: string
): Promise<DeleteRuntimeSubagentResult> {
  const res = await fetch(
    `${API_BASE}/subagents/${encodeURIComponent(runId)}`,
    {
      method: "DELETE",
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to delete subagent" }));
    return { ok: false, error: data.error ?? "Failed to delete subagent" };
  }
  return { ok: true };
}

export type SubagentListResult =
  | { ok: true; data: SubagentListResponse }
  | { ok: false; error: string };

export async function fetchSubagents(
  projectId: string,
  includeArchived = false
): Promise<SubagentListResult> {
  const query = includeArchived ? "?includeArchived=true" : "";
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/subagents${query}`
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch subagents" }));
    return { ok: false, error: data.error ?? "Failed to fetch subagents" };
  }
  const data = (await res.json()) as SubagentListResponse;
  return { ok: true, data };
}

export type RenameSubagentResult =
  | { ok: true; data: SubagentListItem }
  | { ok: false; error: string };

export async function renameSubagent(
  projectId: string,
  slug: string,
  name: string
): Promise<RenameSubagentResult> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/subagents/${encodeURIComponent(slug)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to rename subagent" }));
    return { ok: false, error: data.error ?? "Failed to rename subagent" };
  }
  const data = (await res.json()) as SubagentListItem;
  return { ok: true, data };
}

export type SubagentLogsResult =
  | { ok: true; data: SubagentLogsResponse }
  | { ok: false; error: string };

export async function fetchSubagentLogs(
  projectId: string,
  slug: string,
  since: number
): Promise<SubagentLogsResult> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/subagents/${slug}/logs?since=${since}`
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch logs" }));
    return { ok: false, error: data.error ?? "Failed to fetch logs" };
  }
  const data = (await res.json()) as SubagentLogsResponse;
  return { ok: true, data };
}

export type ProjectBranchesResult =
  | { ok: true; data: ProjectBranchesResponse }
  | { ok: false; error: string };

export async function fetchProjectBranches(
  projectId: string
): Promise<ProjectBranchesResult> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/branches`);
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch branches" }));
    return { ok: false, error: data.error ?? "Failed to fetch branches" };
  }
  const data = (await res.json()) as ProjectBranchesResponse;
  return { ok: true, data };
}

export async function fetchProjectChanges(
  projectId: string
): Promise<ProjectChanges> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/changes`);
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch changes" }));
    throw new Error(data.error ?? "Failed to fetch changes");
  }
  return (await res.json()) as ProjectChanges;
}

export async function fetchProjectSpace(
  projectId: string
): Promise<ProjectSpaceState> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/space`);
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch project space" }));
    throw new Error(data.error ?? "Failed to fetch project space");
  }
  return (await res.json()) as ProjectSpaceState;
}

export async function integrateProjectSpace(
  projectId: string
): Promise<ProjectSpaceState> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/space/integrate`, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to integrate project space" }));
    throw new Error(data.error ?? "Failed to integrate project space");
  }
  return (await res.json()) as ProjectSpaceState;
}

export async function skipSpaceEntries(
  projectId: string,
  entryIds: string[]
): Promise<ProjectSpaceState> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/space/entries/skip`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryIds }),
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to skip space entries" }));
    throw new Error(data.error ?? "Failed to skip space entries");
  }
  return (await res.json()) as ProjectSpaceState;
}

export async function integrateSpaceEntries(
  projectId: string,
  entryIds: string[]
): Promise<ProjectSpaceState> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/space/entries/integrate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryIds }),
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to integrate space entries" }));
    throw new Error(data.error ?? "Failed to integrate space entries");
  }
  return (await res.json()) as ProjectSpaceState;
}

export async function rebaseSpaceOntoMain(
  projectId: string
): Promise<ProjectSpaceState> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/space/rebase`, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to rebase project space" }));
    throw new Error(data.error ?? "Failed to rebase project space");
  }
  return (await res.json()) as ProjectSpaceState;
}

export type MergeSpaceIntoMainResult = {
  sha?: string;
  commitSha?: string;
  mergedCommitSha?: string;
  cleanupSummary?: string;
  message?: string;
  cleanup?: {
    summary?: string;
    errors?: string[];
    removedWorktrees?: string[];
    removedBranches?: string[];
  };
};

type MergeSpaceApiResponse = {
  merge?: {
    afterSha?: string;
    cleanup?: MergeSpaceCleanupPayload;
  };
} & MergeSpaceIntoMainResult;

type MergeSpaceCleanupPayload = {
  workerWorktreesRemoved?: number;
  workerBranchesDeleted?: number;
  spaceWorktreeRemoved?: boolean;
  spaceBranchDeleted?: boolean;
  errors?: string[];
};

function buildCleanupSummary(
  cleanup?: MergeSpaceCleanupPayload
): string | undefined {
  if (!cleanup) return undefined;
  const parts: string[] = [];
  if (typeof cleanup.workerWorktreesRemoved === "number") {
    parts.push(`worktrees removed: ${cleanup.workerWorktreesRemoved}`);
  }
  if (typeof cleanup.workerBranchesDeleted === "number") {
    parts.push(`branches deleted: ${cleanup.workerBranchesDeleted}`);
  }
  if (cleanup.spaceWorktreeRemoved) parts.push("space worktree removed");
  if (cleanup.spaceBranchDeleted) parts.push("space branch deleted");
  return parts.length > 0 ? parts.join(", ") : undefined;
}

export async function mergeSpaceIntoMain(
  projectId: string,
  input: { cleanup?: boolean } = {}
): Promise<MergeSpaceIntoMainResult> {
  const cleanup = input.cleanup ?? true;
  const res = await fetch(`${API_BASE}/projects/${projectId}/space/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cleanup }),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to merge space into main" }));
    throw new Error(data.error ?? "Failed to merge space into main");
  }
  const data = (await res.json()) as MergeSpaceApiResponse;
  const mergedCommitSha =
    data.mergedCommitSha ?? data.commitSha ?? data.sha ?? data.merge?.afterSha;
  return {
    ...data,
    mergedCommitSha,
    cleanupSummary:
      data.cleanupSummary ?? buildCleanupSummary(data.merge?.cleanup),
    cleanup:
      data.cleanup ??
      (data.merge?.cleanup
        ? {
            errors: data.merge.cleanup.errors,
          }
        : undefined),
  };
}

export async function fetchProjectSpaceCommits(
  projectId: string,
  limit = 20
): Promise<SpaceCommitSummary[]> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/space/commits?limit=${limit}`
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch space commits" }));
    throw new Error(data.error ?? "Failed to fetch space commits");
  }
  const data = (await res.json()) as { commits?: SpaceCommitSummary[] };
  return data.commits ?? [];
}

export async function fetchProjectSpaceContribution(
  projectId: string,
  entryId: string
): Promise<SpaceContribution> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/space/contributions/${encodeURIComponent(entryId)}`
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch space contribution" }));
    throw new Error(data.error ?? "Failed to fetch space contribution");
  }
  return (await res.json()) as SpaceContribution;
}

export async function fixSpaceConflict(
  projectId: string,
  entryId: string
): Promise<{ entryId: string; slug: string }> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/space/conflicts/${encodeURIComponent(entryId)}/fix`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fix space conflict" }));
    throw new Error(data.error ?? "Failed to fix space conflict");
  }
  return (await res.json()) as { entryId: string; slug: string };
}

export async function fixSpaceRebaseConflict(
  projectId: string
): Promise<{ slug: string }> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/space/rebase/fix`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fix space rebase conflict" }));
    throw new Error(data.error ?? "Failed to fix space rebase conflict");
  }
  return (await res.json()) as { slug: string };
}

export async function fetchProjectSpaceLease(
  projectId: string
): Promise<SpaceLeaseState> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/space/lease`);
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch space lease" }));
    throw new Error(data.error ?? "Failed to fetch space lease");
  }
  return (await res.json()) as SpaceLeaseState;
}

export async function acquireProjectSpaceLease(
  projectId: string,
  input: { holder: string; ttlSeconds?: number; force?: boolean }
): Promise<SpaceWriteLease | null> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/space/lease`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to acquire space lease" }));
    throw new Error(data.error ?? "Failed to acquire space lease");
  }
  const data = (await res.json()) as SpaceLeaseState;
  return data.lease;
}

export async function releaseProjectSpaceLease(
  projectId: string,
  input: { holder?: string; force?: boolean }
): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/space/lease`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to release space lease" }));
    throw new Error(data.error ?? "Failed to release space lease");
  }
}

export async function fetchProjectPullRequestTarget(
  projectId: string
): Promise<ProjectPullRequestTarget> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/pr-target`);
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to fetch PR target" }));
    throw new Error(data.error ?? "Failed to fetch PR target");
  }
  return (await res.json()) as ProjectPullRequestTarget;
}

export async function commitProjectChanges(
  projectId: string,
  message: string
): Promise<CommitResult> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to commit changes" }));
    return { ok: false, error: data.error ?? "Failed to commit changes" };
  }
  return (await res.json()) as CommitResult;
}

export type AgentInfo = { id: string; name: string };
export type SubagentTemplateInfo = {
  name: string;
  description?: string;
  cli: string;
  model: string;
  reasoning: string;
  type: string;
  runMode: string;
};

export async function fetchSpawnOptions(): Promise<{
  agents: AgentInfo[];
  subagentTemplates: SubagentTemplateInfo[];
}> {
  const res = await fetch(`${API_BASE}/config/spawn-options`);
  if (!res.ok) return { agents: [], subagentTemplates: [] };
  return res.json();
}

export type SpawnSubagentInput = {
  slug: string;
  cli: string;
  name?: string;
  prompt: string;
  template?: "lead" | "custom";
  promptRole?: "coordinator" | "worker" | "reviewer" | "legacy";
  includeDefaultPrompt?: boolean;
  includeRoleInstructions?: boolean;
  includePostRun?: boolean;
  model?: string;
  reasoningEffort?: string;
  thinking?: string;
  mode?: "main-run" | "worktree" | "clone" | "none";
  baseBranch?: string;
  resume?: boolean;
  attachments?: FileAttachment[];
  agentId?: string;
};

export type SpawnSubagentResult =
  | {
      ok: true;
      data: { slug: string; agentId?: string; sessionKey?: string };
    }
  | { ok: false; error: string };

export async function spawnSubagent(
  projectId: string,
  input: SpawnSubagentInput
): Promise<SpawnSubagentResult> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/subagents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to spawn subagent" }));
    return { ok: false, error: data.error ?? "Failed to spawn subagent" };
  }
  const data = (await res.json()) as {
    slug: string;
    agentId?: string;
    sessionKey?: string;
  };
  return { ok: true, data };
}

export type UpdateSubagentInput = {
  name?: string;
  model?: string;
  reasoningEffort?: string;
  thinking?: string;
};

export type UpdateSubagentResult =
  | {
      ok: true;
      data: {
        slug: string;
        name?: string;
        model?: string;
        reasoningEffort?: string;
        thinking?: string;
      };
    }
  | { ok: false; error: string };

export async function updateSubagent(
  projectId: string,
  slug: string,
  input: UpdateSubagentInput
): Promise<UpdateSubagentResult> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/subagents/${slug}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to update subagent" }));
    return { ok: false, error: data.error ?? "Failed to update subagent" };
  }
  const data = (await res.json()) as {
    slug: string;
    name?: string;
    model?: string;
    reasoningEffort?: string;
    thinking?: string;
  };
  return { ok: true, data };
}

export type InterruptSubagentResult =
  | { ok: true; data: { slug: string } }
  | { ok: false; error: string };

export async function interruptSubagent(
  projectId: string,
  slug: string
): Promise<InterruptSubagentResult> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/subagents/${slug}/interrupt`,
    {
      method: "POST",
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to interrupt subagent" }));
    return { ok: false, error: data.error ?? "Failed to interrupt subagent" };
  }
  const data = (await res.json()) as { slug: string };
  return { ok: true, data };
}

export type KillSubagentResult =
  | { ok: true; data: { slug: string } }
  | { ok: false; error: string };

export async function killSubagent(
  projectId: string,
  slug: string
): Promise<KillSubagentResult> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/subagents/${slug}/kill`,
    {
      method: "POST",
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to kill subagent" }));
    return { ok: false, error: data.error ?? "Failed to kill subagent" };
  }
  const data = (await res.json()) as { slug: string };
  return { ok: true, data };
}

export type LeadSessionResult =
  | { ok: true; data: { ok: true; agentId: string; sessionKey?: string } }
  | { ok: false; error: string };

export async function removeLeadSession(
  projectId: string,
  agentId: string
): Promise<LeadSessionResult> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/lead-sessions/${encodeURIComponent(agentId)}`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to remove lead session" }));
    return { ok: false, error: data.error ?? "Failed to remove lead session" };
  }
  return { ok: true, data: await res.json() };
}

export async function resetLeadSession(
  projectId: string,
  agentId: string
): Promise<LeadSessionResult> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/lead-sessions/${encodeURIComponent(agentId)}/reset`,
    { method: "POST" }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to reset lead session" }));
    return { ok: false, error: data.error ?? "Failed to reset lead session" };
  }
  return { ok: true, data: await res.json() };
}

export type ArchiveSubagentResult =
  | { ok: true; data: { slug: string; archived: boolean } }
  | { ok: false; error: string };

export async function archiveSubagent(
  projectId: string,
  slug: string
): Promise<ArchiveSubagentResult> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/subagents/${slug}/archive`,
    {
      method: "POST",
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to archive subagent" }));
    return { ok: false, error: data.error ?? "Failed to archive subagent" };
  }
  const data = (await res.json()) as { slug: string; archived: boolean };
  return { ok: true, data };
}

export type UnarchiveSubagentResult =
  | { ok: true; data: { slug: string; archived: boolean } }
  | { ok: false; error: string };

export async function unarchiveSubagent(
  projectId: string,
  slug: string
): Promise<UnarchiveSubagentResult> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/subagents/${slug}/unarchive`,
    {
      method: "POST",
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to unarchive subagent" }));
    return { ok: false, error: data.error ?? "Failed to unarchive subagent" };
  }
  const data = (await res.json()) as { slug: string; archived: boolean };
  return { ok: true, data };
}

export type UploadedAttachment = {
  originalName: string;
  savedName: string;
  path: string;
  isImage: boolean;
};

export type UploadAttachmentsResult =
  | { ok: true; data: UploadedAttachment[] }
  | { ok: false; error: string };

export async function uploadAttachments(
  projectId: string,
  files: File[]
): Promise<UploadAttachmentsResult> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  const res = await fetch(`${API_BASE}/projects/${projectId}/attachments`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to upload attachments" }));
    return { ok: false, error: data.error ?? "Failed to upload attachments" };
  }

  const data = (await res.json()) as UploadedAttachment[];
  return { ok: true, data };
}

export async function addProjectComment(
  projectId: string,
  message: string,
  author = "AIHub"
): Promise<ProjectThreadEntry> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ author, message }),
  });
  if (!res.ok) throw new Error("Failed to add comment");
  return res.json();
}

export async function updateProjectComment(
  projectId: string,
  index: number,
  body: string
): Promise<ProjectThreadEntry> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/comments/${index}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }
  );
  if (!res.ok) throw new Error("Failed to update comment");
  return res.json();
}

export async function deleteProjectComment(
  projectId: string,
  index: number
): Promise<{ index: number }> {
  const res = await fetch(
    `${API_BASE}/projects/${projectId}/comments/${index}`,
    {
      method: "DELETE",
    }
  );
  if (!res.ok) throw new Error("Failed to delete comment");
  return res.json();
}

export type StartProjectRunResult =
  | { ok: true; type: "aihub" | "cli"; slug?: string; runMode?: string }
  | { ok: false; error: string };

export type StartProjectRunInput = {
  customPrompt?: string;
  runAgent?: string;
  template?: "lead" | "custom";
  promptRole?: "coordinator" | "worker" | "reviewer" | "legacy";
  includeDefaultPrompt?: boolean;
  includeRoleInstructions?: boolean;
  includePostRun?: boolean;
  runMode?: string;
  baseBranch?: string;
  slug?: string;
  name?: string;
  model?: string;
  reasoningEffort?: string;
  thinking?: string;
};

export async function startProjectRun(
  projectId: string,
  input?: StartProjectRunInput
): Promise<StartProjectRunResult> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to start run" }));
    return { ok: false, error: data.error ?? "Failed to start run" };
  }
  return res.json();
}
