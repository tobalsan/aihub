import {
  LangfuseComponentConfigSchema,
  type Component,
  type ComponentContext,
} from "@aihub/shared";
import { agentEventBus } from "../../agents/events.js";
import { LangfuseTracer } from "./tracer.js";

let tracer: LangfuseTracer | undefined;

const langfuseComponent: Component = {
  id: "langfuse",
  displayName: "Langfuse",
  dependencies: [],
  requiredSecrets: [],
  routePrefixes: [],
  validateConfig(raw) {
    const result = LangfuseComponentConfigSchema.safeParse(raw);
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
  async start(ctx: ComponentContext) {
    const config = LangfuseComponentConfigSchema.parse(
      ctx.getConfig().components?.langfuse
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
    tracer.start(agentEventBus);
  },
  async stop() {
    await tracer?.stop();
    tracer = undefined;
  },
  capabilities() {
    return ["langfuse-tracing"];
  },
};

export { langfuseComponent };
