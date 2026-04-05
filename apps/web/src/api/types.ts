import type {
  Area as SharedArea,
  CapabilitiesResponse as SharedCapabilitiesResponse,
  ContextEstimate,
  ContentBlock,
  FileAttachment,
  FullHistoryMessage,
  ImageAttachment,
  ModelMeta,
  ModelUsage,
  ProjectItem,
  SdkId,
  SimpleHistoryMessage,
  StreamEvent,
  SubagentGlobalListItem as SharedSubagentGlobalListItem,
  Task as SharedTask,
  TaskboardItemResponse,
  TaskboardResponse,
  TextBlock,
  ThinkLevel,
  ThinkingBlock,
  TodoItem,
  ToolCallBlock,
} from "@aihub/shared/types";
export type {
  ContextEstimate,
  ContentBlock,
  FileAttachment,
  FullHistoryMessage,
  ImageAttachment,
  ModelMeta,
  ModelUsage,
  ProjectItem,
  SdkId,
  SimpleHistoryMessage,
  StreamEvent,
  TaskboardItemResponse,
  TaskboardResponse,
  TextBlock,
  ThinkLevel,
  ThinkingBlock,
  TodoItem,
  ToolCallBlock,
};

export type QueueMode = "queue" | "interrupt";

// Upload response from /api/media/upload
export type UploadResponse = {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type CapabilitiesResponse = SharedCapabilitiesResponse;

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

// History view mode
export type HistoryViewMode = "simple" | "full";

export type FullUserMessage = Extract<FullHistoryMessage, { role: "user" }>;
export type FullAssistantMessage = Extract<
  FullHistoryMessage,
  { role: "assistant" }
>;
export type FullToolResultMessage = Extract<
  FullHistoryMessage,
  { role: "toolResult" }
>;

// Active tool call during streaming
export type ActiveToolCall = {
  id: string;
  toolName: string;
  status: "running" | "done" | "error";
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
  repoValid: boolean;
  frontmatter: Record<string, unknown>;
};

export type ProjectDetail = {
  id: string;
  title: string;
  path: string;
  absolutePath: string;
  repoValid: boolean;
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

export type SubagentGlobalListItem = SharedSubagentGlobalListItem;

export type SubagentGlobalListResponse = {
  items: SubagentGlobalListItem[];
};

export type SubagentListItem = {
  slug: string;
  type?: "subagent" | "ralph_loop";
  cli?: string;
  name?: string;
  model?: string;
  reasoningEffort?: string;
  thinking?: string;
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
  parentToolUseId?: string;
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
  latestUsage?: ModelUsage;
  latestContextEstimate?: ContextEstimate;
};

export type ProjectBranchesResponse = {
  branches: string[];
};

export type FileChange = {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed";
  staged: boolean;
};

export type MainBranchCommit = {
  sha: string;
  subject: string;
};

export type DirtyState = {
  files: FileChange[];
  diff: string;
  stats: { filesChanged: number; insertions: number; deletions: number };
};

export type ProjectChanges = {
  branch: string;
  baseBranch: string;
  source?: { type: "space" | "repo"; path: string };
  files: FileChange[];
  diff: string;
  stats: { filesChanged: number; insertions: number; deletions: number };
  branchDiffStats?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  branchDiffFiles?: { path: string; insertions: number; deletions: number }[];
  mainAheadCommits?: MainBranchCommit[];
  mainRepoDirty?: DirtyState;
};

export type SpaceIntegrationEntry = {
  id: string;
  workerSlug: string;
  runMode: "worktree" | "clone";
  worktreePath: string;
  startSha?: string;
  endSha?: string;
  shas: string[];
  status: "pending" | "integrated" | "conflict" | "skipped" | "stale_worker";
  createdAt: string;
  integratedAt?: string;
  error?: string;
  staleAgainstSha?: string;
};

export type SpaceCommitSummary = {
  sha: string;
  subject: string;
  author: string;
  date: string;
};

export type SpaceContribution = {
  entry: SpaceIntegrationEntry;
  commits: SpaceCommitSummary[];
  diff: string;
  conflictFiles: string[];
};

export type ProjectSpaceState = {
  version: 1;
  projectId: string;
  branch: string;
  worktreePath: string;
  baseBranch: string;
  integrationBlocked: boolean;
  rebaseConflict?: { baseSha: string; error: string };
  queue: SpaceIntegrationEntry[];
  updatedAt: string;
};

export type SpaceWriteLease = {
  holder: string;
  acquiredAt: string;
  expiresAt: string;
};

export type SpaceLeaseState = {
  enabled: boolean;
  lease: SpaceWriteLease | null;
};

export type ProjectPullRequestTarget = {
  branch: string;
  baseBranch: string;
  compareUrl?: string;
};

export type CommitResult = {
  ok: boolean;
  sha?: string;
  message?: string;
  error?: string;
};
