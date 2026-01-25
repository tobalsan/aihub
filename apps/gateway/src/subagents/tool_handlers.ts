import type { GatewayConfig } from "@aihub/shared";
import { getConfig } from "../config/index.js";
import { listSubagents, getSubagentLogs } from "./index.js";
import { spawnSubagent, interruptSubagent, type SpawnSubagentInput } from "./runner.js";

export type SubagentToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type SubagentToolHandlers = {
  spawn: (input: SpawnSubagentInput) => Promise<SubagentToolResult<{ slug: string }>>;
  status: (input: { projectId: string; slug: string }) => Promise<SubagentToolResult<unknown>>;
  logs: (input: { projectId: string; slug: string; since?: number }) => Promise<SubagentToolResult<unknown>>;
  interrupt: (input: { projectId: string; slug: string }) => Promise<SubagentToolResult<{ slug: string }>>;
};

export function createSubagentToolHandlers(overrides?: {
  getConfig?: () => GatewayConfig;
  spawn?: typeof spawnSubagent;
  list?: typeof listSubagents;
  logs?: typeof getSubagentLogs;
  interrupt?: typeof interruptSubagent;
}): SubagentToolHandlers {
  const resolveConfig = overrides?.getConfig ?? getConfig;
  const spawn = overrides?.spawn ?? spawnSubagent;
  const list = overrides?.list ?? listSubagents;
  const logs = overrides?.logs ?? getSubagentLogs;
  const interrupt = overrides?.interrupt ?? interruptSubagent;

  return {
    async spawn(input) {
      const config = resolveConfig();
      return spawn(config, input);
    },
    async status(input) {
      const config = resolveConfig();
      const result = await list(config, input.projectId);
      if (!result.ok) return result;
      const item = result.data.items.find((entry) => entry.slug === input.slug);
      if (!item) return { ok: false, error: `Subagent not found: ${input.slug}` };
      return { ok: true, data: item };
    },
    async logs(input) {
      const config = resolveConfig();
      const since = input.since ?? 0;
      return logs(config, input.projectId, input.slug, since);
    },
    async interrupt(input) {
      const config = resolveConfig();
      return interrupt(config, input.projectId, input.slug);
    },
  };
}
