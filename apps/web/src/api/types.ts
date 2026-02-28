import type { Area as SharedArea, Task as SharedTask } from "@aihub/shared";
export type SdkId = "pi" | "claude" | "openclaw";
export type ThinkLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type QueueMode = "queue" | "interrupt";

// Image attachment for multimodal messages (legacy - base64)
export type ImageAttachment = {
  /** Base64-encoded image data (without data: prefix) */
  data: string;
  /** MIME type */
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
};

// File attachment (file path from upload)
export type FileAttachment = {
  /** Absolute file path on disk */
  path: string;
  /** MIME type */
  mimeType: string;
  /** Original filename (optional) */
  filename?: string;
};

// Upload response from /api/media/upload
export type UploadResponse = {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type Agent = {
  id: string;
  name: string;
  sdk?: SdkId; // default "pi"
  model: {
    provider: string;
    model: string;
  };
  workspace?: string;
  authMode?: "oauth" | "api_key" | "proxy";
  queueMode?: QueueMode; // default "queue"
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export type SendMessageResponse = {
  payloads: Array<{ text?: string; mediaUrls?: string[] }>;
  meta: {
    durationMs: number;
    sessionId: string;
    aborted?: boolean;
    queued?: boolean;
  };
};

// Stream event types (WebSocket protocol)
export type StreamEvent =
  | { type: "text"; data: string }
  | { type: "thinking"; data: string }
  | { type: "tool_call"; id: string; name: string; arguments: unknown }
  | {
      type: "tool_result";
      id: string;
      name: string;
      content: string;
      isError: boolean;
      details?: { diff?: string };
    }
  | { type: "tool_start"; toolName: string }
  | { type: "tool_end"; toolName: string; isError?: boolean }
  | {
      type: "done";
      meta?: { durationMs: number; aborted?: boolean; queued?: boolean };
    }
  | { type: "error"; message: string };

// History view mode
export type HistoryViewMode = "simple" | "full";

// Simple history message (text only)
export type SimpleHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

// Alias for backward compatibility
export type HistoryMessage = SimpleHistoryMessage;

// Content block types for full history
export type ThinkingBlock = {
  type: "thinking";
  thinking: string;
};

export type TextBlock = {
  type: "text";
  text: string;
};

export type ToolCallBlock = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: unknown;
};

export type ContentBlock = ThinkingBlock | TextBlock | ToolCallBlock;

// Model usage info
export type ModelUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens: number;
  cost?: {
    input: number;
    output: number;
    total: number;
  };
};

// Model metadata for assistant messages
export type ModelMeta = {
  api?: string;
  provider?: string;
  model?: string;
  usage?: ModelUsage;
  stopReason?: string;
};

// Full history message types
export type FullUserMessage = {
  role: "user";
  content: ContentBlock[];
  timestamp: number;
};

export type FullAssistantMessage = {
  role: "assistant";
  content: ContentBlock[];
  timestamp: number;
  meta?: ModelMeta;
};

export type FullToolResultMessage = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ContentBlock[];
  isError: boolean;
  details?: { diff?: string };
  timestamp: number;
};

export type FullHistoryMessage =
  | FullUserMessage
  | FullAssistantMessage
  | FullToolResultMessage;

// Active tool call during streaming
export type ActiveToolCall = {
  id: string;
  toolName: string;
  status: "running" | "done" | "error";
};

// Taskboard types
export type TodoItem = {
  id: string;
  title: string;
  status: "todo";
  created?: string;
  due?: string;
  path: string;
};

export type ProjectItem = {
  id: string;
  title: string;
  status: "todo" | "doing";
  created?: string;
  due?: string;
  project?: string;
  path: string;
  companions: string[];
};

export type TaskboardResponse = {
  todos: {
    todo: TodoItem[];
    doing: TodoItem[];
  };
  projects: {
    todo: ProjectItem[];
    doing: ProjectItem[];
  };
};

export type TaskboardItemResponse = {
  id: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
  companions: string[];
};

// Conversations API types
export type ConversationFilters = {
  q?: string;
  source?: string;
  tag?: string;
  participant?: string;
};

export type ConversationListItem = {
  id: string;
  title: string;
  date?: string;
  source?: string;
  participants: string[];
  tags: string[];
  preview: string;
  attachments: string[];
};

export type ConversationMessage = {
  speaker: string;
  timestamp?: string;
  body: string;
};

export type ConversationDetail = ConversationListItem & {
  frontmatter: Record<string, unknown>;
  content: string;
  messages: ConversationMessage[];
};

export type CreateConversationProjectInput = {
  title?: string;
};

export type CreateConversationMessageInput = {
  message: string;
};

export type PostConversationMessageResponse = {
  mentions?: string[];
};

// Projects API types
export type ProjectListItem = {
  id: string;
  title: string;
  path: string;
  absolutePath: string;
  frontmatter: Record<string, unknown>;
};

export type ProjectDetail = {
  id: string;
  title: string;
  path: string;
  absolutePath: string;
  frontmatter: Record<string, unknown>;
  docs: Record<string, string>;
  thread: ProjectThreadEntry[];
};

export type DeleteProjectResponse = {
  id: string;
  path: string;
  trashedPath: string;
};

export type ArchiveProjectResponse = {
  id: string;
  path: string;
  archivedPath: string;
};

export type UnarchiveProjectResponse = {
  id: string;
  path: string;
};

export type ProjectUpdatePayload = {
  title?: string;
  domain?: string;
  owner?: string;
  executionMode?: string;
  appetite?: string;
  status?: string;
  area?: string;
  readme?: string;
  specs?: string;
  docs?: Record<string, string>;
  repo?: string;
  sessionKeys?: Record<string, string> | null;
};

export type ProjectThreadEntry = {
  author: string;
  date: string;
  body: string;
};

export type Area = SharedArea;
export type Task = SharedTask;

export type TasksResponse = {
  tasks: Task[];
  progress: { done: number; total: number };
};

export type SubagentStatus = "running" | "replied" | "error" | "idle";

export type SubagentGlobalListItem = {
  projectId: string;
  slug: string;
  type?: "subagent" | "ralph_loop";
  cli?: string;
  runMode?: string;
  role?: "supervisor" | "worker";
  parentSlug?: string;
  groupKey?: string;
  baseBranch?: string;
  worktreePath?: string;
  iterations?: number;
  status: SubagentStatus;
  lastActive?: string;
};

export type SubagentGlobalListResponse = {
  items: SubagentGlobalListItem[];
};

export type SubagentListItem = {
  slug: string;
  type?: "subagent" | "ralph_loop";
  cli?: string;
  runMode?: string;
  role?: "supervisor" | "worker";
  parentSlug?: string;
  groupKey?: string;
  status: SubagentStatus;
  lastActive?: string;
  baseBranch?: string;
  worktreePath?: string;
  lastError?: string;
  archived?: boolean;
  iterations?: number;
};

export type SubagentLogEvent = {
  ts?: string;
  type: string;
  text?: string;
  tool?: { name?: string; id?: string };
  diff?: { path?: string; summary?: string };
};

export type ActivityEvent = {
  id: string;
  type:
    | "project_status"
    | "agent_message"
    | "subagent_action"
    | "project_comment";
  actor: string;
  action: string;
  projectId?: string;
  subagentSlug?: string;
  timestamp: string;
  color: "green" | "purple" | "blue" | "yellow";
};

export type ActivityResponse = {
  events: ActivityEvent[];
};

export type AgentStatusResponse = {
  statuses: Record<string, "streaming" | "idle">;
};

export type SubagentListResponse = {
  items: SubagentListItem[];
};

export type SubagentLogsResponse = {
  cursor: number;
  events: SubagentLogEvent[];
};

export type ProjectBranchesResponse = {
  branches: string[];
};
