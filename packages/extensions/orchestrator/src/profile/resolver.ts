import type { SubagentRuntimeProfile } from "@aihub/shared";
import type { WorkflowFrontmatter } from "../types.js";

export type ProfileResolution =
  | { profile: SubagentRuntimeProfile }
  | { park: { reason: string } };

export function resolveProfile(input: {
  workflow: WorkflowFrontmatter;
  profilesConfig: SubagentRuntimeProfile[];
}): ProfileResolution {
  const name = input.workflow.agent?.profile;
  if (!name) return { park: { reason: "No orchestrator profile configured" } };
  const profile = new Map(input.profilesConfig.map((item) => [item.name, item])).get(name);
  if (!profile) return { park: { reason: `Configured subagent profile not found: ${name}` } };
  return { profile };
}
