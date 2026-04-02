import {
  SchedulerComponentConfigSchema,
  type Component,
  type ComponentContext,
} from "@aihub/shared";
import { startScheduler, stopScheduler } from "../../scheduler/index.js";

const schedulerComponent: Component = {
  id: "scheduler",
  displayName: "Scheduler",
  dependencies: [],
  requiredSecrets: [],
  validateConfig(raw) {
    const result = SchedulerComponentConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success ? [] : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes() {},
  async start(_ctx: ComponentContext) {
    await startScheduler();
  },
  async stop() {
    await stopScheduler();
  },
  capabilities() {
    return ["schedules"];
  },
};

export { schedulerComponent };
