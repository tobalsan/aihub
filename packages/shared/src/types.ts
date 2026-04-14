import { z } from "zod";
import type { Hono } from "hono";

// Think levels
export const ThinkLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
export type ThinkLevel = z.infer<typeof ThinkLevelSchema>;

// Agent model config
export const AgentModelConfigSchema = z.object({
  provider: z.string().optional(), // For display; inferred from sdk if omitted
  model: z.string(),
  base_url: z.string().optional(), // API proxy URL (e.g. for Claude SDK)
  auth_token: z.string().optional(), // API auth token (overrides env)
});
export type AgentModelConfig = z.infer<typeof AgentModelConfigSchema>;

// Discord config
export const DiscordConfigSchema = z.object({
  token: z.string(),
  applicationId: z.string().optional(),

  // Legacy fields (backward compat - treated as single-guild/channel mode)
  guildId: z.string().optional(),
  channelId: z.string().optional(),

  // DM settings
  dm: z
    .object({
      enabled: z.boolean().default(true),
      allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
      groupEnabled: z.boolean().default(false),
      groupChannels: z.array(z.union([z.string(), z.number()])).optional(),
    })
    .optional(),

  // Guild/channel routing & policy
  groupPolicy: z.enum(["open", "disabled", "allowlist"]).default("open"),
  guilds: z
    .record(
      z.string(),
      z.object({
        slug: z.string().optional(),
        requireMention: z.boolean().default(true),
        reactionNotifications: z
          .enum(["off", "own", "all", "allowlist"])
          .default("off"),
        reactionAllowlist: z
          .array(z.union([z.string(), z.number()]))
          .optional(),
        users: z.array(z.union([z.string(), z.number()])).optional(),
        systemPrompt: z.string().optional(),
        channels: z
          .record(
            z.string(),
            z.object({
              enabled: z.boolean().default(true),
              requireMention: z.boolean().optional(),
              users: z.array(z.union([z.string(), z.number()])).optional(),
              systemPrompt: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),

  // Behavior
  historyLimit: z.number().int().min(0).default(20),
  clearHistoryAfterReply: z.boolean().optional().default(true),
  replyToMode: z.enum(["off", "all", "first"]).default("off"),
  mentionPatterns: z.array(z.string()).optional(),

  // AIHub-only: broadcast main-session responses to a Discord channel
  broadcastToChannel: z.string().optional(),
});
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;

// Amsg config
export const AmsgConfigSchema = z.object({
  id: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});
export type AmsgConfig = z.infer<typeof AmsgConfigSchema>;

// Heartbeat config
export const HeartbeatConfigSchema = z.object({
  every: z.string().optional(), // Duration string (e.g., "30m", "1h", "0" to disable)
  prompt: z.string().optional(), // Custom prompt (replaces default)
  ackMaxChars: z.number().int().min(0).optional(), // Default: 300
});
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;

// SDK types
export const SdkIdSchema = z.enum(["pi", "claude", "openclaw"]);
export type SdkId = z.infer<typeof SdkIdSchema>;

// OpenClaw config
export const OpenClawConfigSchema = z.object({
  gatewayUrl: z.string().optional(),
  token: z.string(),
  sessionKey: z.string().optional(),
  sessionMode: z.enum(["dedicated", "fixed"]).optional(),
});
export type OpenClawConfig = z.infer<typeof OpenClawConfigSchema>;

// Agent auth config
export const AgentAuthConfigSchema = z.object({
  mode: z.enum(["oauth", "api_key", "proxy"]).optional(),
  profileId: z.string().optional(), // e.g. "anthropic:default"
});
export type AgentAuthConfig = z.infer<typeof AgentAuthConfigSchema>;

export const AgentConnectorConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .passthrough();
export type AgentConnectorConfig = z.infer<typeof AgentConnectorConfigSchema>;

export const ConnectorsGlobalConfigSchema = z
  .object({
    path: z.string().optional(),
  })
  .passthrough();
export type ConnectorsGlobalConfig = z.infer<
  typeof ConnectorsGlobalConfigSchema
>;

export const SandboxMountSchema = z.object({
  host: z.string(),
  container: z.string(),
  readonly: z.boolean().optional().default(true),
});
export type SandboxMount = z.infer<typeof SandboxMountSchema>;

export const AgentSandboxConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  image: z.string().optional().default("aihub-agent:latest"),
  network: z.string().optional(),
  memory: z.string().optional().default("2g"),
  cpus: z.number().optional().default(1),
  timeout: z.number().optional().default(300),
  workspaceWritable: z.boolean().optional().default(false),
  env: z.record(z.string(), z.string()).optional(),
  mounts: z.array(SandboxMountSchema).optional(),
});
export type AgentSandboxConfig = z.infer<typeof AgentSandboxConfigSchema>;

// Agent config
const AgentConfigBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspace: z.string(),
  sdk: SdkIdSchema.optional(), // default "pi"
  model: AgentModelConfigSchema.optional(),
  openclaw: OpenClawConfigSchema.optional(),
  auth: AgentAuthConfigSchema.optional(), // OAuth/API key auth config
  discord: DiscordConfigSchema.optional(),
  thinkLevel: ThinkLevelSchema.optional(),
  queueMode: z.enum(["queue", "interrupt"]).optional().default("queue"),
  amsg: AmsgConfigSchema.optional(),
  heartbeat: HeartbeatConfigSchema.optional(), // Periodic heartbeat config
  introMessage: z.string().optional(), // Custom intro for /new (default: "New conversation started.")
  connectors: z.record(z.string(), AgentConnectorConfigSchema).optional(),
  globalSkills: z.boolean().optional(), // Include ~/.agents/skills/ (default: false)
  onecliToken: z.string().optional(), // Per-agent OneCLI proxy token
  sandbox: AgentSandboxConfigSchema.optional(),
});
export const AgentConfigSchema = AgentConfigBaseSchema.superRefine(
  (value, ctx) => {
    if (value.sdk !== "openclaw" && !value.model) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "model is required",
        path: ["model"],
      });
    }
  }
).transform(
  (value): Omit<typeof value, "model"> & { model: AgentModelConfig } => {
    if (value.sdk === "openclaw" && !value.model) {
      return { ...value, model: { provider: "openclaw", model: "unknown" } };
    }
    return value as Omit<typeof value, "model"> & { model: AgentModelConfig };
  }
);
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// Schedule types
export const IntervalScheduleSchema = z.object({
  type: z.literal("interval"),
  everyMinutes: z.number().int().min(1),
  startAt: z.string().optional(),
});
export type IntervalSchedule = z.infer<typeof IntervalScheduleSchema>;

export const DailyScheduleSchema = z.object({
  type: z.literal("daily"),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().optional(),
});
export type DailySchedule = z.infer<typeof DailyScheduleSchema>;

export const ScheduleSchema = z.discriminatedUnion("type", [
  IntervalScheduleSchema,
  DailyScheduleSchema,
]);
export type Schedule = z.infer<typeof ScheduleSchema>;

// Schedule job
export const ScheduleJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  agentId: z.string(),
  enabled: z.boolean(),
  schedule: ScheduleSchema,
  payload: z.object({
    message: z.string(),
    sessionId: z.string().optional(),
  }),
});
export type ScheduleJob = z.infer<typeof ScheduleJobSchema>;

// UI bind mode
export const UiBindModeSchema = z.enum(["loopback", "lan", "tailnet"]);
export type UiBindMode = z.infer<typeof UiBindModeSchema>;

// UI tailscale config
export const UiTailscaleConfigSchema = z.object({
  mode: z.enum(["off", "serve"]).optional(),
  resetOnExit: z.boolean().optional(),
});
export type UiTailscaleConfig = z.infer<typeof UiTailscaleConfigSchema>;

// UI config
export const UiConfigSchema = z.object({
  enabled: z.boolean().optional(),
  port: z.number().optional(),
  bind: UiBindModeSchema.optional(),
  tailscale: UiTailscaleConfigSchema.optional(),
});
export type UiConfig = z.infer<typeof UiConfigSchema>;

// Gateway server bind mode (reuses UiBindMode)
export const GatewayBindModeSchema = UiBindModeSchema;
export type GatewayBindMode = UiBindMode;

// Gateway server config
export const GatewayServerConfigSchema = z.object({
  host: z.string().optional(), // Explicit host (overrides bind)
  port: z.number().optional(),
  bind: GatewayBindModeSchema.optional(), // loopback | lan | tailnet
});
export type GatewayServerConfig = z.infer<typeof GatewayServerConfigSchema>;

// Sessions config
export const SessionsConfigSchema = z.object({
  idleMinutes: z.number().int().min(1).default(360),
});
export type SessionsConfig = z.infer<typeof SessionsConfigSchema>;

// Taskboard config
export const TaskboardConfigSchema = z.object({
  todosPath: z.string().optional(),
  projectsPath: z.string().optional(),
});
export type TaskboardConfig = z.infer<typeof TaskboardConfigSchema>;

// Projects config
export const ProjectsConfigSchema = z.object({
  root: z.string().optional(),
});
export type ProjectsConfig = z.infer<typeof ProjectsConfigSchema>;

export const SecretRefSchema = z.string();
export type SecretRef = z.infer<typeof SecretRefSchema>;

export const MultiUserGoogleOAuthConfigSchema = z.object({
  clientId: SecretRefSchema.min(1),
  clientSecret: SecretRefSchema.min(1),
});
export type MultiUserGoogleOAuthConfig = z.infer<
  typeof MultiUserGoogleOAuthConfigSchema
>;

export const MultiUserOAuthConfigSchema = z.object({
  google: MultiUserGoogleOAuthConfigSchema,
});
export type MultiUserOAuthConfig = z.infer<typeof MultiUserOAuthConfigSchema>;

const MultiUserConfigBaseSchema = z.object({
  allowedDomains: z.array(z.string().min(1)).optional(),
});

export const MultiUserConfigSchema = z.discriminatedUnion("enabled", [
  MultiUserConfigBaseSchema.extend({
    enabled: z.literal(false),
    oauth: MultiUserOAuthConfigSchema.optional(),
    sessionSecret: SecretRefSchema.optional(),
  }),
  MultiUserConfigBaseSchema.extend({
    enabled: z.literal(true),
    oauth: MultiUserOAuthConfigSchema,
    sessionSecret: SecretRefSchema.min(1),
  }),
]);
export type MultiUserConfig = z.infer<typeof MultiUserConfigSchema>;

export const OnecliCaConfigSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("file"), path: z.string().min(1) }),
  z.object({ source: z.literal("system") }),
]);
export type OnecliCaConfig = z.infer<typeof OnecliCaConfigSchema>;

export const OnecliConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  mode: z.literal("proxy").default("proxy"),
  dashboardUrl: z.string().url().optional(),
  gatewayUrl: z.string().url(),
  ca: OnecliCaConfigSchema.optional(),
});
export type OnecliConfig = z.infer<typeof OnecliConfigSchema>;

export const ComponentBaseConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .passthrough();
export type ComponentBaseConfig = z.infer<typeof ComponentBaseConfigSchema>;

export const DiscordComponentChannelConfigSchema = z.object({
  agent: z.string(),
  requireMention: z.boolean().optional(),
});
export type DiscordComponentChannelConfig = z.infer<
  typeof DiscordComponentChannelConfigSchema
>;

export const DiscordComponentDmConfigSchema = z.object({
  enabled: z.boolean().optional(),
  agent: z.string(),
});
export type DiscordComponentDmConfig = z.infer<
  typeof DiscordComponentDmConfigSchema
>;

export const DiscordComponentConfigSchema = z.object({
  enabled: z.boolean().optional(),
  token: SecretRefSchema,
  channels: z
    .record(z.string(), DiscordComponentChannelConfigSchema)
    .optional(),
  dm: DiscordComponentDmConfigSchema.optional(),
  historyLimit: z.number().int().min(0).optional(),
  replyToMode: z.enum(["off", "all", "first"]).optional(),
  applicationId: z.string().optional(),
  guilds: DiscordConfigSchema.shape.guilds.optional(),
  groupPolicy: DiscordConfigSchema.shape.groupPolicy.optional(),
  mentionPatterns: z.array(z.string()).optional(),
  broadcastToChannel: z.string().optional(),
  clearHistoryAfterReply: z.boolean().optional(),
});
export type DiscordComponentConfig = z.infer<
  typeof DiscordComponentConfigSchema
>;

export const SchedulerComponentConfigSchema = z.object({
  enabled: z.boolean().optional(),
  tickSeconds: z.number().optional(),
});
export type SchedulerComponentConfig = z.infer<
  typeof SchedulerComponentConfigSchema
>;

export const HeartbeatComponentConfigSchema = z.object({
  enabled: z.boolean().optional(),
});
export type HeartbeatComponentConfig = z.infer<
  typeof HeartbeatComponentConfigSchema
>;

export const AmsgComponentConfigSchema = z.object({
  enabled: z.boolean().optional(),
});
export type AmsgComponentConfig = z.infer<typeof AmsgComponentConfigSchema>;

export const ConversationsComponentConfigSchema = z.object({
  enabled: z.boolean().optional(),
});
export type ConversationsComponentConfig = z.infer<
  typeof ConversationsComponentConfigSchema
>;

export const ProjectsComponentConfigSchema = z.object({
  enabled: z.boolean().optional(),
  root: z.string().optional(),
});
export type ProjectsComponentConfig = z.infer<
  typeof ProjectsComponentConfigSchema
>;

export const LangfuseComponentConfigSchema = ComponentBaseConfigSchema.extend({
  baseUrl: z.string().optional(),
  publicKey: z.string().optional(),
  secretKey: z.string().optional(),
  flushAt: z.number().optional(),
  flushInterval: z.number().optional(),
  debug: z.boolean().optional(),
  environment: z.string().optional(),
});
export type LangfuseComponentConfig = z.infer<
  typeof LangfuseComponentConfigSchema
>;

export const ComponentsConfigSchema = z
  .object({
    discord: DiscordComponentConfigSchema.optional(),
    scheduler: SchedulerComponentConfigSchema.optional(),
    heartbeat: HeartbeatComponentConfigSchema.optional(),
    amsg: AmsgComponentConfigSchema.optional(),
    conversations: ConversationsComponentConfigSchema.optional(),
    projects: ProjectsComponentConfigSchema.optional(),
    langfuse: LangfuseComponentConfigSchema.optional(),
  })
  .optional();
export type ComponentsConfig = z.infer<typeof ComponentsConfigSchema>;

export const SubagentConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  harness: z.enum(["codex", "claude", "pi"]),
  model: z.string(),
  reasoning: z.string(),
  type: z.enum(["worker", "reviewer"]),
  runMode: z.enum(["clone", "main", "worktree", "none"]),
});
export type SubagentConfig = z.infer<typeof SubagentConfigSchema>;

export const MountAllowlistSchema = z.object({
  allowedRoots: z.array(z.string()),
  blockedPatterns: z
    .array(z.string())
    .optional()
    .default([".ssh", ".gnupg", ".aws", ".env"]),
});
export type MountAllowlist = z.infer<typeof MountAllowlistSchema>;

export const SandboxNetworkSchema = z.object({
  name: z.string().optional().default("aihub-agents"),
  internal: z.boolean().optional().default(true),
});
export type SandboxNetwork = z.infer<typeof SandboxNetworkSchema>;

export const SandboxOnecliSchema = z.object({
  enabled: z.boolean().optional().default(true),
  url: z.string(),
  caPath: z.string().optional(),
});
export type SandboxOnecli = z.infer<typeof SandboxOnecliSchema>;

export const GlobalSandboxConfigSchema = z.object({
  sharedDir: z.string().optional(),
  network: SandboxNetworkSchema.optional(),
  onecli: SandboxOnecliSchema.optional(),
  mountAllowlist: MountAllowlistSchema.optional(),
});
export type GlobalSandboxConfig = z.infer<typeof GlobalSandboxConfigSchema>;

// Gateway config
export const GatewayConfigSchema = z.object({
  version: z.number().optional(),
  agents: z.array(AgentConfigSchema),
  sandbox: GlobalSandboxConfigSchema.optional(),
  onecli: OnecliConfigSchema.optional(),
  connectors: ConnectorsGlobalConfigSchema.optional(),
  components: ComponentsConfigSchema,
  multiUser: MultiUserConfigSchema.optional(),
  server: z
    .object({
      host: z.string().optional(),
      port: z.number().optional(),
      baseUrl: z.string().optional(),
    })
    .optional(),
  gateway: GatewayServerConfigSchema.optional(),
  sessions: SessionsConfigSchema.optional().default({}),
  scheduler: z
    .object({
      enabled: z.boolean().optional().default(true),
      tickSeconds: z.number().optional().default(60),
    })
    .optional(),
  web: z
    .object({
      baseUrl: z.string().optional(),
    })
    .optional(),
  ui: UiConfigSchema.optional(),
  taskboard: TaskboardConfigSchema.optional(),
  projects: ProjectsConfigSchema.optional(),
  subagents: z.array(SubagentConfigSchema).optional(),
  env: z.record(z.string(), z.string()).optional(), // Env vars to set (only if not already set)
});
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export type RunAgentParams = {
  agentId: string;
  message: string;
  attachments?: FileAttachment[];
  sessionId?: string;
  sessionKey?: string;
  thinkLevel?: ThinkLevel;
  context?: AgentContext;
  source?: string;
  onEvent?: (event: StreamEvent) => void;
};

export type RunAgentResult = {
  payloads: Array<{ text?: string; mediaUrls?: string[] }>;
  meta: {
    durationMs: number;
    sessionId: string;
    aborted?: boolean;
    queued?: boolean;
  };
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ComponentContext {
  resolveSecret(name: string): Promise<string>;
  getAgent(id: string): AgentConfig | undefined;
  getAgents(): AgentConfig[];
  runAgent(params: RunAgentParams): Promise<RunAgentResult>;
  getConfig(): GatewayConfig;
}

export interface Component {
  id: string;
  displayName: string;
  dependencies: string[];
  requiredSecrets: string[];
  routePrefixes: string[];
  validateConfig(raw: unknown): ValidationResult;
  registerRoutes(app: Hono): void;
  start(ctx: ComponentContext): Promise<void>;
  stop(): Promise<void>;
  capabilities(): string[];
}

// API payloads
export const SendMessageRequestSchema = z.object({
  message: z.string(),
  sessionId: z.string().optional(), // explicit session ID (bypasses sessionKey resolution)
  sessionKey: z.string().optional(), // logical key (resolved to sessionId with idle timeout)
  thinkLevel: ThinkLevelSchema.optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const AgentStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  isStreaming: z.boolean(),
  lastActivity: z.number().optional(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

const CapabilitiesUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  role: z
    .union([z.string(), z.array(z.string())])
    .nullable()
    .optional(),
});

export const CapabilitiesResponseSchema = z.object({
  version: z.number(),
  components: z.record(z.string(), z.boolean()),
  agents: z.array(z.string()),
  multiUser: z.boolean(),
  user: CapabilitiesUserSchema.optional(),
});
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;

// Projects API types
export const ProjectStatusSchema = z.enum([
  "not_now",
  "maybe",
  "shaping",
  "todo",
  "in_progress",
  "review",
  "done",
  "cancelled",
  "archived",
  "trashed",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectDomainSchema = z.enum(["life", "admin", "coding"]);
export type ProjectDomain = z.infer<typeof ProjectDomainSchema>;

export const ProjectExecutionModeSchema = z.enum(["subagent", "ralph_loop"]);
export type ProjectExecutionMode = z.infer<typeof ProjectExecutionModeSchema>;

export const ProjectAppetiteSchema = z.enum(["small", "big"]);
export type ProjectAppetite = z.infer<typeof ProjectAppetiteSchema>;

export const AreaSchema = z.object({
  id: z.string(),
  title: z.string(),
  color: z.string(),
  icon: z.string().optional(),
  description: z.string().optional(),
  repo: z.string().optional(),
  order: z.number().optional(),
});
export type Area = z.infer<typeof AreaSchema>;

export const TaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "done"]).default("todo"),
  checked: z.boolean(),
  agentId: z.string().optional(),
  order: z.number(),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateProjectRequestSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  specs: z.string().optional(),
  domain: ProjectDomainSchema.optional(),
  owner: z.string().optional(),
  executionMode: ProjectExecutionModeSchema.optional(),
  appetite: ProjectAppetiteSchema.optional(),
  status: ProjectStatusSchema.optional(),
  area: z.string().optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const CreateConversationProjectRequestSchema = z.object({
  title: z.string().optional(),
});
export type CreateConversationProjectRequest = z.infer<
  typeof CreateConversationProjectRequestSchema
>;

export const PostConversationMessageRequestSchema = z.object({
  message: z.string(),
});
export type PostConversationMessageRequest = z.infer<
  typeof PostConversationMessageRequestSchema
>;

export const UpdateProjectRequestSchema = z.object({
  title: z.string().optional(),
  domain: z.union([ProjectDomainSchema, z.literal("")]).optional(),
  owner: z.union([z.string(), z.literal("")]).optional(),
  executionMode: z
    .union([ProjectExecutionModeSchema, z.literal("")])
    .optional(),
  appetite: z.union([ProjectAppetiteSchema, z.literal("")]).optional(),
  status: ProjectStatusSchema.optional(),
  agent: z.string().optional(),
  readme: z.string().optional(),
  specs: z.string().optional(),
  docs: z.record(z.string()).optional(),
  repo: z.union([z.string(), z.literal("")]).optional(),
  area: z.union([z.string(), z.literal("")]).optional(),
  sessionKeys: z.record(z.string()).nullable().optional(),
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>;

export const ProjectCommentRequestSchema = z.object({
  author: z.string(),
  message: z.string(),
});
export type ProjectCommentRequest = z.infer<typeof ProjectCommentRequestSchema>;

export const UpdateProjectCommentRequestSchema = z.object({
  body: z.string(),
});
export type UpdateProjectCommentRequest = z.infer<
  typeof UpdateProjectCommentRequestSchema
>;

export const StartPromptRoleSchema = z.enum([
  "coordinator",
  "worker",
  "reviewer",
  "legacy",
]);
export type StartPromptRole = z.infer<typeof StartPromptRoleSchema>;

export const CliRunModeSchema = z.enum([
  "main-run",
  "worktree",
  "clone",
  "none",
]);
export type CliRunMode = z.infer<typeof CliRunModeSchema>;

export const StartProjectRunRequestSchema = z.object({
  customPrompt: z.string().optional(),
  runAgent: z.string().optional(),
  promptRole: StartPromptRoleSchema.optional(),
  includeDefaultPrompt: z.boolean().optional(),
  includeRoleInstructions: z.boolean().optional(),
  includePostRun: z.boolean().optional(),
  subagentTemplate: z.string().optional(),
  runMode: z.string().optional(),
  baseBranch: z.string().optional(),
  slug: z.string().optional(),
  name: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: z.string().optional(),
  thinking: z.string().optional(),
});
export type StartProjectRunRequest = z.infer<
  typeof StartProjectRunRequestSchema
>;

export type SubagentGlobalListItem = {
  projectId: string;
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
  baseBranch?: string;
  worktreePath?: string;
  iterations?: number;
  status: "running" | "replied" | "error" | "idle";
  lastActive?: string;
  runStartedAt?: string;
};

export const CreateScheduleRequestSchema = z.object({
  name: z.string(),
  agentId: z.string(),
  schedule: ScheduleSchema,
  payload: z.object({
    message: z.string(),
    sessionId: z.string().optional(),
  }),
});
export type CreateScheduleRequest = z.infer<typeof CreateScheduleRequestSchema>;

export const UpdateScheduleRequestSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  schedule: ScheduleSchema.optional(),
  payload: z
    .object({
      message: z.string(),
      sessionId: z.string().optional(),
    })
    .optional(),
});
export type UpdateScheduleRequest = z.infer<typeof UpdateScheduleRequestSchema>;

// Stream event types (used by WebSocket)
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

// Image attachment for multimodal messages (base64 - legacy)
export type ImageAttachment = {
  /** Base64-encoded image data (without data: prefix) */
  data: string;
  /** MIME type (image/jpeg, image/png, image/gif, image/webp) */
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
};

export const FileAttachmentSchema = z.object({
  path: z.string(),
  mimeType: z.string(),
  filename: z.string().optional(),
});

// File attachment (file path - preferred)
export type FileAttachment = z.infer<typeof FileAttachmentSchema>;

// WebSocket protocol types
export type WsSendMessage = {
  type: "send";
  agentId: string;
  sessionId?: string; // explicit session ID (bypasses sessionKey resolution)
  sessionKey?: string; // logical key (resolved to sessionId with idle timeout)
  message: string;
  attachments?: FileAttachment[]; // file attachments (paths from /api/media/upload)
  thinkLevel?: ThinkLevel; // per-request think level override
};

export type WsSubscribeMessage = {
  type: "subscribe";
  agentId: string;
  sessionKey: string;
};

export type WsUnsubscribeMessage = {
  type: "unsubscribe";
};

export type WsSubscribeStatusMessage = {
  type: "subscribeStatus";
};

export type WsUnsubscribeStatusMessage = {
  type: "unsubscribeStatus";
};

export type WsClientMessage =
  | WsSendMessage
  | WsSubscribeMessage
  | WsUnsubscribeMessage
  | WsSubscribeStatusMessage
  | WsUnsubscribeStatusMessage;

// Server messages include stream events plus subscription-specific events
export type WsHistoryUpdatedEvent = {
  type: "history_updated";
  agentId: string;
  sessionId: string;
};

export type WsSessionResetEvent = {
  type: "session_reset";
  sessionId: string;
};

export type WsStatusEvent = {
  type: "status";
  agentId: string;
  status: "streaming" | "idle";
};

export type WsFileChangedEvent = {
  type: "file_changed";
  projectId: string;
  file: string;
};

export type WsAgentChangedEvent = {
  type: "agent_changed";
  projectId: string;
};

export type WsServerMessage =
  | StreamEvent
  | WsHistoryUpdatedEvent
  | WsSessionResetEvent
  | WsStatusEvent
  | WsFileChangedEvent
  | WsAgentChangedEvent;

// History types

/** Simple history message (text only) */
export type SimpleHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

/** Content block types for full history */
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

/** Model usage info */
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

export type ContextEstimate = {
  usedTokens: number;
  maxTokens: number;
  pct: number;
  basis: string;
  available: boolean;
  reason?: string;
};

/** Model metadata for assistant messages */
export type ModelMeta = {
  api?: string;
  provider?: string;
  model?: string;
  usage?: ModelUsage;
  stopReason?: string;
};

/** Full history message with all content blocks */
export type FullHistoryMessage =
  | {
      role: "user";
      content: ContentBlock[];
      timestamp: number;
    }
  | {
      role: "assistant";
      content: ContentBlock[];
      timestamp: number;
      meta?: ModelMeta;
    }
  | {
      role: "toolResult";
      toolCallId: string;
      toolName: string;
      content: ContentBlock[];
      isError: boolean;
      details?: { diff?: string };
      timestamp: number;
    };

export type HistoryViewMode = "simple" | "full";

// Discord context types for runAgent()
export type DiscordContextBlock =
  | { type: "channel_topic"; topic: string }
  | { type: "channel_name"; name: string }
  | {
      type: "thread_starter";
      author: string;
      content: string;
      timestamp: number;
    }
  | {
      type: "history";
      messages: Array<{ author: string; content: string; timestamp: number }>;
    }
  | {
      type: "reaction";
      emoji: string;
      user: string;
      messageId: string;
      action: "add" | "remove";
    };

export type DiscordContext = {
  kind: "discord";
  blocks: DiscordContextBlock[];
};

export type AgentContext = DiscordContext; // Extensible for future context types

export const AgentContextSchema = z
  .object({
    kind: z.string(),
  })
  .passthrough();

export const ContainerConnectorToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()),
});
export type ContainerConnectorTool = z.infer<typeof ContainerConnectorToolSchema>;

export const ContainerConnectorConfigSchema = z.object({
  id: z.string(),
  systemPrompt: z.string().optional(),
  tools: z.array(ContainerConnectorToolSchema),
});
export type ContainerConnectorConfig = z.infer<
  typeof ContainerConnectorConfigSchema
>;

export const ContainerInputSchema = z.object({
  agentId: z.string(),
  sessionId: z.string(),
  userId: z.string().optional(),
  message: z.string(),
  attachments: z.array(FileAttachmentSchema).optional(),
  workspaceDir: z.string(),
  sessionDir: z.string(),
  ipcDir: z.string(),
  gatewayUrl: z.string(),
  agentToken: z.string(),
  thinkLevel: ThinkLevelSchema.optional(),
  context: AgentContextSchema.optional(),
  onecli: z
    .object({
      enabled: z.boolean(),
      url: z.string(),
      caPath: z.string().optional(),
    })
    .optional(),
  connectorConfigs: z.array(ContainerConnectorConfigSchema).optional(),
  sdkConfig: z.object({
    sdk: SdkIdSchema,
    model: AgentModelConfigSchema,
  }),
});
export type ContainerInput = z.infer<typeof ContainerInputSchema>;

export const ContainerOutputSchema = z.object({
  text: z.string(),
  aborted: z.boolean().optional(),
  history: z.array(z.unknown()).optional(),
  error: z.string().optional(),
});
export type ContainerOutput = z.infer<typeof ContainerOutputSchema>;

// Heartbeat event payload (for event emission)
export const HeartbeatStatusSchema = z.enum([
  "sent",
  "ok-empty",
  "ok-token",
  "skipped",
  "failed",
]);
export type HeartbeatStatus = z.infer<typeof HeartbeatStatusSchema>;

export type HeartbeatEventPayload = {
  ts: number;
  agentId: string;
  status: HeartbeatStatus;
  to?: string; // Discord channel ID
  preview?: string; // First 200 chars of alert
  alertText?: string; // Full alert text (for delivery)
  durationMs?: number;
  reason?: string; // Why it skipped/failed
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

// Attachment upload types
export type UploadedAttachment = {
  originalName: string;
  savedName: string;
  path: string;
  isImage: boolean;
};

export const UploadAttachmentResponseSchema = z.array(
  z.object({
    originalName: z.string(),
    savedName: z.string(),
    path: z.string(),
    isImage: z.boolean(),
  })
);
export type UploadAttachmentResponse = z.infer<
  typeof UploadAttachmentResponseSchema
>;
