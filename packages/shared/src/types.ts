import { z } from "zod";

// Think levels
export const ThinkLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);
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
export const SdkIdSchema = z.enum(["pi", "claude"]);
export type SdkId = z.infer<typeof SdkIdSchema>;

// Agent auth config
export const AgentAuthConfigSchema = z.object({
  mode: z.enum(["oauth", "api_key", "proxy"]).optional(),
  profileId: z.string().optional(), // e.g. "anthropic:default"
});
export type AgentAuthConfig = z.infer<typeof AgentAuthConfigSchema>;

// Agent config
export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspace: z.string(),
  sdk: SdkIdSchema.optional(), // default "pi"
  model: AgentModelConfigSchema,
  auth: AgentAuthConfigSchema.optional(), // OAuth/API key auth config
  discord: DiscordConfigSchema.optional(),
  thinkLevel: ThinkLevelSchema.optional(),
  queueMode: z.enum(["queue", "interrupt"]).optional().default("queue"),
  amsg: AmsgConfigSchema.optional(),
  heartbeat: HeartbeatConfigSchema.optional(), // Periodic heartbeat config
  introMessage: z.string().optional(), // Custom intro for /new (default: "New conversation started.")
});
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

// Gateway config
export const GatewayConfigSchema = z.object({
  agents: z.array(AgentConfigSchema),
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
  env: z.record(z.string(), z.string()).optional(), // Env vars to set (only if not already set)
});
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

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
  | { type: "tool_start"; toolName: string }
  | { type: "tool_end"; toolName: string; isError?: boolean }
  | { type: "done"; meta?: { durationMs: number; aborted?: boolean; queued?: boolean } }
  | { type: "error"; message: string };

// WebSocket protocol types
export type WsSendMessage = {
  type: "send";
  agentId: string;
  sessionId?: string; // explicit session ID (bypasses sessionKey resolution)
  sessionKey?: string; // logical key (resolved to sessionId with idle timeout)
  message: string;
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

export type WsClientMessage = WsSendMessage | WsSubscribeMessage | WsUnsubscribeMessage;

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

export type WsServerMessage = StreamEvent | WsHistoryUpdatedEvent | WsSessionResetEvent;

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
  | { type: "thread_starter"; author: string; content: string; timestamp: number }
  | { type: "history"; messages: Array<{ author: string; content: string; timestamp: number }> }
  | { type: "reaction"; emoji: string; user: string; messageId: string; action: "add" | "remove" };

export type DiscordContext = {
  kind: "discord";
  blocks: DiscordContextBlock[];
};

export type AgentContext = DiscordContext; // Extensible for future context types

// Heartbeat event payload (for event emission)
export const HeartbeatStatusSchema = z.enum(["sent", "ok-empty", "ok-token", "skipped", "failed"]);
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
