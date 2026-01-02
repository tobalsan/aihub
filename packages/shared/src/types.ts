import { z } from "zod";

// Think levels
export const ThinkLevelSchema = z.enum(["off", "minimal", "low", "medium", "high"]);
export type ThinkLevel = z.infer<typeof ThinkLevelSchema>;

// Agent model config
export const AgentModelConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
});
export type AgentModelConfig = z.infer<typeof AgentModelConfigSchema>;

// Discord config
export const DiscordConfigSchema = z.object({
  token: z.string(),
  applicationId: z.string().optional(),
  guildId: z.string().optional(),
  channelId: z.string().optional(),
});
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;

// Amsg config
export const AmsgConfigSchema = z.object({
  id: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});
export type AmsgConfig = z.infer<typeof AmsgConfigSchema>;

// Agent config
export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspace: z.string(),
  model: AgentModelConfigSchema,
  discord: DiscordConfigSchema.optional(),
  thinkLevel: ThinkLevelSchema.optional(),
  queueMode: z.enum(["queue", "interrupt"]).optional().default("queue"),
  amsg: AmsgConfigSchema.optional(),
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
  | { type: "tool_start"; toolName: string }
  | { type: "tool_end"; toolName: string; isError?: boolean }
  | { type: "done"; meta?: { durationMs: number } }
  | { type: "error"; message: string };

// WebSocket protocol types
export type WsSendMessage = {
  type: "send";
  agentId: string;
  sessionId?: string; // explicit session ID (bypasses sessionKey resolution)
  sessionKey?: string; // logical key (resolved to sessionId with idle timeout)
  message: string;
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

export type WsServerMessage = StreamEvent | WsHistoryUpdatedEvent;

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
