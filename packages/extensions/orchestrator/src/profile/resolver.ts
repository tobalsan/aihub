import type { SubagentRuntimeProfile } from "@aihub/shared";
import type { WorkflowFrontmatter } from "../types.js";

export type ProfileResolution =
  | { profile: SubagentRuntimeProfile }
  | { park: { reason: string } };

export function resolveProfile(input: {
  labels: string[];
  workflow: WorkflowFrontmatter;
  profilesConfig: SubagentRuntimeProfile[];
}): ProfileResolution {
  const byName = new Map(input.profilesConfig.map((profile) => [profile.name, profile]));
  const mappings = input.workflow.agent?.label_profiles ?? {};
  const matches = input.labels.filter((label) => mappings[label]);
  if (matches.length > 1) return { park: { reason: `Multiple agent profile labels: ${matches.join(", ")}` } };
  const name = matches.length === 1 ? mappings[matches[0]!] : input.workflow.agent?.default_profile ?? input.workflow.agent?.profile;
  if (!name) return { park: { reason: "No default orchestrator profile configured" } };
  const profile = byName.get(name);
  if (!profile) return { park: { reason: `Configured subagent profile not found: ${name}` } };
  return { profile };
}
