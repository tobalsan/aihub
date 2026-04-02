import { ConversationsComponentConfigSchema, type Component } from "@aihub/shared";

const conversationsComponent: Component = {
  id: "conversations",
  displayName: "Conversations",
  dependencies: [],
  requiredSecrets: [],
  validateConfig(raw) {
    const result = ConversationsComponentConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success ? [] : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes() {},
  async start() {},
  async stop() {},
  capabilities() {
    return ["conversations"];
  },
};

export { conversationsComponent };
