export type TrackerIssue = {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number | null;
  branch_name?: string | null;
  url?: string | null;
  state: string;
  labels: string[];
  blocked_by?: Array<{ id?: string | null; identifier?: string | null; state?: string | null }>;
  created_at?: string | null;
  updated_at?: string | null;
  projectName?: string | null;
  projectSlug?: string | null;
  parentId?: string | null;
};

export type LinearIssue = TrackerIssue;

export type TrackerStatesConfig = {
  activeStates: string[];
  terminalStates: string[];
  needsHuman: string;
  inProgressTarget?: string;
};

export type LinearTrackerConfig = TrackerStatesConfig & {
  kind: "linear";
  endpoint: string;
  apiKey: string;
  projectSlug: string;
};

export type PlaneAuthKind = "api_key" | "oauth_token" | "bot_token";

export type PlaneTrackerConfig = TrackerStatesConfig & {
  kind: "plane";
  baseUrl: string;
  apiKey: string;
  authKind: PlaneAuthKind;
  workspaceSlug: string;
  projectId: string;
  moduleId?: string;
  mention?: string;
};

export type TrackerConfig = LinearTrackerConfig | PlaneTrackerConfig;

export type WorkspaceConfig = {
  root: string;
  cleanupOnTerminal: boolean;
  reuse: boolean;
};

export type WorkflowFrontmatter = {
  tracker?: {
    kind?: string;
    endpoint?: string;
    api_key?: string;
    auth_kind?: PlaneAuthKind;
    project_slug?: string;
    base_url?: string;
    workspace_slug?: string;
    project_id?: string;
    module_id?: string;
    mention?: string;
    active_states?: string[];
    terminal_states?: string[];
    needs_human?: string;
    states?: {
      active?: string[];
      terminal?: string[];
      needs_human?: string;
      in_progress_target?: string;
    };
  };
  polling?: { interval_ms?: number; jitter_ms?: number };
  workspace?: { root?: string; cleanup_on_terminal?: boolean; reuse?: boolean };
  agent?: {
    profile?: string;
    kind?: "fake" | "cli" | "codex" | "pi" | "claude";
    runner?: "fake" | "cli" | "codex" | "pi" | "claude";
    command?: string | string[];
    provider?: string;
    model?: string;
    thinking?: string;
    reasoning?: string;
    reasoningEffort?: string;
    reasoning_effort?: string;
    settings?: Record<string, unknown>;
    max_turns?: number;
    turn_timeout_ms?: number;
    idle_settle_ms?: number;
    stall_timeout_ms?: number;
    max_concurrent?: number;
    max_active_runs?: number;
  };
  hooks?: Partial<Record<"after_create" | "before_run" | "after_run" | "before_remove", string>>;
  server?: { notify_channel?: string };
  linear?: { expose_graphql_tool?: boolean; attach_issue_url?: boolean };
  digest?: { enabled?: boolean };
  [key: string]: unknown;
};

export type WorkflowConfig = {
  tracker: TrackerConfig;
  workspace: WorkspaceConfig;
  polling: { intervalMs: number; jitterMs: number };
  agent: NonNullable<WorkflowFrontmatter["agent"]>;
  hooks: WorkflowFrontmatter["hooks"];
  server: WorkflowFrontmatter["server"];
  linear: WorkflowFrontmatter["linear"];
};

export type WorkflowSnapshot = {
  path: string;
  projectPath: string;
  sha: string;
  frontmatter: WorkflowFrontmatter;
  config: WorkflowConfig;
  body: string;
};

export type ProjectDescriptor = { id: string; path: string; workflowPath: string };
