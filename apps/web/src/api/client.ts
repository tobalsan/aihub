import type {
  Agent,
  SendMessageResponse,
  SimpleHistoryMessage,
  FullHistoryMessage,
  ThinkLevel,
  TaskboardResponse,
  TaskboardItemResponse,
  ConversationFilters,
  ConversationDetail,
  ConversationListItem,
  CreateConversationMessageInput,
  CreateConversationProjectInput,
  PostConversationMessageResponse,
  ProjectListItem,
  ProjectDetail,
  ProjectUpdatePayload,
  DeleteProjectResponse,
  ArchiveProjectResponse,
  UnarchiveProjectResponse,
  ActivityResponse,
  AgentStatusResponse,
  SubagentGlobalListResponse,
  SubagentListResponse,
  SubagentLogsResponse,
  ProjectBranchesResponse,
  FileAttachment,
  UploadResponse,
  ProjectThreadEntry,
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
  onSessionReset?: (sessionId: string) => void;
  onDone: (meta?: DoneMeta) => void;
  onError: (error: string) => void;
};

export type StreamMessageOptions = {
  attachments?: FileAttachment[];
  thinkLevel?: ThinkLevel;
};

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
  return results.map((r) => ({
    path: r.path,
    mimeType: r.mimeType,
    filename: r.filename,
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
      case "tool_result":
        callbacks?.onToolResult?.(
          event.id,
          event.name,
          event.content,
          event.isError ?? false,
          event.details
        );
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

export type StatusCallbacks = {
  onStatus?: (agentId: string, status: "streaming" | "idle") => void;
  onError?: (error: string) => void;
};

/**
 * Subscribe to global agent status updates.
 * Receives real-time status changes for all agents.
 */
export function subscribeToStatus(callbacks: StatusCallbacks): () => void {
  const ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "subscribeStatus" }));
  };

  ws.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === "status") {
      callbacks.onStatus?.(event.agentId, event.status);
    } else if (event.type === "error") {
      callbacks.onError?.(event.message);
    }
  };

  ws.onerror = () => {
    callbacks.onError?.("Status subscription connection error");
  };

  return () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "unsubscribeStatus" }));
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

export async function fetchConversations(
  filters: ConversationFilters = {}
): Promise<ConversationListItem[]> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.source) params.set("source", filters.source);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.participant) params.set("participant", filters.participant);
  const query = params.toString();
  const url = query
    ? `${API_BASE}/conversations?${query}`
    : `${API_BASE}/conversations`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch conversations");
  return res.json();
}

export async function fetchConversation(id: string): Promise<ConversationDetail> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Failed to fetch conversation");
  return res.json();
}

export function getConversationAttachmentUrl(id: string, name: string): string {
  return `${API_BASE}/conversations/${encodeURIComponent(id)}/attachments/${encodeURIComponent(name)}`;
}

export async function postConversationMessage(
  conversationId: string,
  input: CreateConversationMessageInput
): Promise<PostConversationMessageResponse> {
  const res = await fetch(
    `${API_BASE}/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to post conversation message" }));
    throw new Error(data.error ?? "Failed to post conversation message");
  }
  return res.json().catch(() => ({}));
}

export type CreateConversationProjectResult =
  | { ok: true; data: ProjectDetail }
  | { ok: false; error: string };

export async function createProjectFromConversation(
  conversationId: string,
  input: CreateConversationProjectInput
): Promise<CreateConversationProjectResult> {
  const res = await fetch(
    `${API_BASE}/conversations/${encodeURIComponent(conversationId)}/projects`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to create project from conversation" }));
    return {
      ok: false,
      error: data.error ?? "Failed to create project from conversation",
    };
  }
  const data = (await res.json()) as ProjectDetail;
  return { ok: true, data };
}

// Projects API functions
export async function fetchProjects(): Promise<ProjectListItem[]> {
  const res = await fetch(`${API_BASE}/projects`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function fetchArchivedProjects(): Promise<ProjectListItem[]> {
  const res = await fetch(`${API_BASE}/projects/archived`);
  if (!res.ok) throw new Error("Failed to fetch archived projects");
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

export type SpawnSubagentInput = {
  slug: string;
  cli: string;
  prompt: string;
  mode?: "main-run" | "worktree";
  baseBranch?: string;
  resume?: boolean;
};

export type SpawnSubagentResult =
  | { ok: true; data: { slug: string } }
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
  const data = (await res.json()) as { slug: string };
  return { ok: true, data };
}

export type SpawnRalphLoopInput = {
  cli: "codex" | "claude";
  iterations: number;
  promptFile?: string;
  mode?: "main-run" | "worktree";
  baseBranch?: string;
};

export type SpawnRalphLoopResult =
  | { ok: true; data: { slug: string } }
  | { ok: false; error: string };

export async function spawnRalphLoop(
  projectId: string,
  input: SpawnRalphLoopInput
): Promise<SpawnRalphLoopResult> {
  const res = await fetch(`${API_BASE}/projects/${projectId}/ralph-loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Failed to spawn ralph loop" }));
    return { ok: false, error: data.error ?? "Failed to spawn ralph loop" };
  }
  const data = (await res.json()) as { slug: string };
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
  runMode?: string;
  baseBranch?: string;
  slug?: string;
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
