import { ProjectsComponentConfigSchema, type Component } from "@aihub/shared";
import {
  startProjectWatcher,
  type ProjectWatcher,
} from "../../projects/watcher.js";

let watcher: ProjectWatcher | null = null;

const projectsComponent: Component = {
  id: "projects",
  displayName: "Projects",
  dependencies: [],
  requiredSecrets: [],
  validateConfig(raw) {
    const result = ProjectsComponentConfigSchema.safeParse(raw);
    return {
      valid: result.success,
      errors: result.success ? [] : result.error.issues.map((issue) => issue.message),
    };
  },
  registerRoutes() {},
  async start(ctx) {
    watcher = startProjectWatcher(ctx.getConfig());
  },
  async stop() {
    await watcher?.close();
    watcher = null;
  },
  capabilities() {
    return ["projects"];
  },
};

export { projectsComponent };
