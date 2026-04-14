import type { ContainerInput, ContainerOutput } from "@aihub/shared";

export async function runAgent(
  input: ContainerInput
): Promise<ContainerOutput> {
  console.error(
    `[agent-runner] Running agent ${input.agentId} with SDK ${input.sdkConfig.sdk}`
  );

  // TODO: Initialize Pi SDK / Claude SDK and run actual agent turn
  return {
    text: "Agent runner stub response",
  };
}
