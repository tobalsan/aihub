export type LinearIssue = {
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

export type TrackerConfig = {
  kind: "linear";
  endpoint: string;
  apiKey: string;
  projectSlug: string;
  activeStates: string[];
  terminalStates: string[];
  needsHuman: string;
  inProgressTarget?: string;
};

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
    project_slug?: string;
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
    kind?: "subagent" | "fake" | "cli" | "codex" | "pi";
    runner?: "subagent" | "fake" | "cli" | "codex" | "pi";
    command?: string | string[];
    model?: string;
    settings?: Record<string, unknown>;
    max_turns?: number;
    turn_timeout_ms?: number;
    stall_timeout_ms?: number;
    max_concurrent?: number;
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
