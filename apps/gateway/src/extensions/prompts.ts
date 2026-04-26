import type { AgentConfig } from "@aihub/shared";
import { getLoadedExtensions } from "./registry.js";

export async function getExtensionSystemPromptContributions(
  agent: AgentConfig
): Promise<string[]> {
  const contributions = await Promise.all(
    getLoadedExtensions().map(async (extension) => {
      const contribution = await extension.getSystemPromptContributions?.(agent);
      if (!contribution) return [];
      return Array.isArray(contribution) ? contribution : [contribution];
    })
  );

  return contributions.flat().filter((prompt) => prompt.trim().length > 0);
}
