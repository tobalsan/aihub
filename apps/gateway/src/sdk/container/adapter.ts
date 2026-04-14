import type { AgentConfig } from "@aihub/shared";
import { getDefaultSdkId, getSdkAdapter } from "../registry.js";
import type { SdkAdapter, SdkId } from "../types.js";

const createNotImplementedError = () =>
  new Error("Container adapter not yet implemented");

export function getContainerAdapter(): SdkAdapter {
  return {
    id: "container" as SdkId,
    displayName: "Container",
    capabilities: {
      queueWhileStreaming: true,
      interrupt: true,
      toolEvents: true,
      fullHistory: true,
    },
    resolveDisplayModel(agent: AgentConfig) {
      const sdkId = (agent.sdk ?? getDefaultSdkId()) as SdkId;
      return getSdkAdapter(sdkId).resolveDisplayModel(agent);
    },
    run() {
      return Promise.reject(createNotImplementedError());
    },
    queueMessage() {
      return Promise.reject(createNotImplementedError());
    },
    abort() {
      throw createNotImplementedError();
    },
  };
}
