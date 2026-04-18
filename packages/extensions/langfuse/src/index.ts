import {
  LangfuseExtensionConfigSchema,
  type AgentHistoryEvent,
  type AgentStreamEvent,
  type Extension,
  type ExtensionContext,
} from "@aihub/shared";
import { LangfuseTracer } from "./tracer.js";

let tracer: LangfuseTracer | undefined;
let unsubscribeStream: (() => void) | undefined;
let unsubscribeHistory: (() => void) | undefined;

const langfuseExtension: Extension = {
  id: "langfuse",
  displayName: "Langfuse",
  description: "Langfuse tracing for agent runs",
  dependencies: [],
  configSchema: LangfuseExtensionConfigSchema,
  routePrefixes: [],
  validateConfig(raw) {
    const result = LangfuseExtensionConfigSchema.safeParse(raw);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((issue) => issue.message),
      };
    }

    const errors: string[] = [];
    if (!result.data.publicKey && !process.env.LANGFUSE_PUBLIC_KEY) {
      errors.push("Langfuse publicKey or LANGFUSE_PUBLIC_KEY is required");
    }
    if (!result.data.secretKey && !process.env.LANGFUSE_SECRET_KEY) {
      errors.push("Langfuse secretKey or LANGFUSE_SECRET_KEY is required");
    }

    return { valid: errors.length === 0, errors };
  },
  registerRoutes() {},
  async start(ctx: ExtensionContext) {
    const config = LangfuseExtensionConfigSchema.parse(
      ctx.getConfig().extensions?.langfuse
    );
    tracer = new LangfuseTracer({
      publicKey: config.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY!,
      secretKey: config.secretKey ?? process.env.LANGFUSE_SECRET_KEY!,
      baseUrl: config.baseUrl ?? process.env.LANGFUSE_BASE_URL,
      flushAt: config.flushAt,
      flushInterval: config.flushInterval,
      debug: config.debug,
      environment: config.environment ?? "dev",
    });
    tracer.start();
    unsubscribeStream = ctx.subscribe("agent.stream", (event) => {
      void tracer?.handleStreamEvent(event as AgentStreamEvent);
    });
    unsubscribeHistory = ctx.subscribe("agent.history", (event) => {
      tracer?.handleHistoryEvent(event as AgentHistoryEvent);
    });
  },
  async stop() {
    unsubscribeStream?.();
    unsubscribeStream = undefined;
    unsubscribeHistory?.();
    unsubscribeHistory = undefined;
    await tracer?.stop();
    tracer = undefined;
  },
  capabilities() {
    return ["langfuse-tracing"];
  },
};

export { langfuseExtension };
