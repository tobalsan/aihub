export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url?: string | null;
  state: string;
  labels: string[];
  projectName?: string | null;
  parentId?: string | null;
};

export type WorkflowFrontmatter = {
  tracker?: {
    states?: {
      active?: string[];
      terminal?: string[];
      needs_human?: string;
      in_progress_target?: string;
    };
  };
  polling?: { interval_ms?: number; jitter_ms?: number };
  workspace?: { cleanup_on_terminal?: boolean; reuse?: boolean };
  agent?: {
    default_profile?: string;
    profile?: string;
    label_profiles?: Record<string, string>;
    max_turns?: number;
    stall_timeout_ms?: number;
    max_concurrent?: number;
  };
  hooks?: Partial<Record<"after_create" | "before_run" | "after_run" | "before_remove", string>>;
  server?: { notify_channel?: string };
  linear?: { expose_graphql_tool?: boolean; attach_issue_url?: boolean };
  digest?: { enabled?: boolean };
  [key: string]: unknown;
};

export type WorkflowSnapshot = {
  path: string;
  sha: string;
  frontmatter: WorkflowFrontmatter;
  body: string;
};

export type RepoConfig = { name: string; path: string; baseBranch?: string };
