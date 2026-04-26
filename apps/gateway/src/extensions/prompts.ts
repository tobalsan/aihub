import type { AgentConfig, GatewayConfig } from "@aihub/shared";
import { loadConfig } from "../config/index.js";
import { getLoadedExtensions } from "./registry.js";

export async function getExtensionSystemPromptContributions(
  agent: AgentConfig,
  config: GatewayConfig = loadConfig()
): Promise<string[]> {
  const contributions = await Promise.all(
    getLoadedExtensions().map(async (extension) => {
      const contribution = await extension.getSystemPromptContributions?.(
        agent,
        { config }
      );
      if (!contribution) return [];
      return Array.isArray(contribution) ? contribution : [contribution];
    })
  );

  return contributions.flat().filter((prompt) => prompt.trim().length > 0);
}
