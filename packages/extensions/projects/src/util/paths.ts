import type { GatewayConfig } from "@aihub/shared";
import { expandPath } from "@aihub/shared";

export function getProjectsRoot(config: GatewayConfig): string {
  return expandPath(config.projects?.root ?? "~/projects");
}
