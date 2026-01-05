import type { SdkAdapter, SdkId } from "./types.js";
import { piAdapter } from "./pi/adapter.js";
import { claudeAdapter } from "./claude/adapter.js";

const adapters: Record<SdkId, SdkAdapter> = {
  pi: piAdapter,
  claude: claudeAdapter,
};

export function getSdkAdapter(id: SdkId): SdkAdapter {
  const adapter = adapters[id];
  if (!adapter) {
    throw new Error(`Unknown SDK: ${id}`);
  }
  return adapter;
}

export function getDefaultSdkId(): SdkId {
  return "pi";
}
