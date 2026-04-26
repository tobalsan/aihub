import type { AgentConfig, ExtensionAgentTool } from "@aihub/shared";
import { getLoadedExtensions } from "./registry.js";

export type LoadedExtensionAgentTool = ExtensionAgentTool & {
  extensionId: string;
};

export async function getExtensionAgentTools(
  agent: AgentConfig
): Promise<LoadedExtensionAgentTool[]> {
  const groups = await Promise.all(
    getLoadedExtensions().map(async (extension) => {
      const tools = (await extension.getAgentTools?.(agent)) ?? [];
      return tools.map((tool) => ({ ...tool, extensionId: extension.id }));
    })
  );
  const tools = groups.flat();
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate extension agent tool: ${tool.name}`);
    }
    seen.add(tool.name);
  }
  return tools;
}

export async function executeExtensionAgentTool(
  agent: AgentConfig,
  toolName: string,
  args: unknown
): Promise<{ found: boolean; result?: unknown }> {
  const tool = (await getExtensionAgentTools(agent)).find(
    (candidate) => candidate.name === toolName
  );
  if (!tool) return { found: false };
  return {
    found: true,
    result: await tool.execute(args, { agent }),
  };
}
