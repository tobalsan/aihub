import * as path from "node:path";
import type { GatewayConfig } from "@aihub/shared";
import { expandPath } from "@aihub/shared";

export function getProjectsRoot(config: GatewayConfig): string {
  const root =
    (config.extensions?.projects as { root?: string } | undefined)?.root ??
    config.projects?.root ??
    "~/projects";
  return expandPath(root);
}

/**
 * Resolve the directory under which subagent worktrees/clones are created.
 *
 * Resolution order:
 *   1. `extensions.projects.worktreeDir` if set:
 *      - absolute path (starts with `/` or `~`) → used as-is (after expandPath)
 *      - relative path → resolved against `getProjectsRoot(config)`
 *   2. otherwise, defaults to `~/.worktrees`
 *
 * Each subagent's actual workspace lands at `<worktreeRoot>/<projectId>/<slug>`.
 *
 * Note: this replaces the legacy `<projectsRoot>/.workspaces/<projectId>/<slug>`
 * layout. Existing on-disk workspaces created under that path are not migrated;
 * they remain readable by the resume path which trusts `state.worktree_path`.
 */
export function getProjectsWorktreeRoot(config: GatewayConfig): string {
  const setting = config.extensions?.projects?.worktreeDir?.trim();
  if (setting) {
    if (setting.startsWith("/") || setting.startsWith("~")) {
      return expandPath(setting);
    }
    return path.join(getProjectsRoot(config), setting);
  }
  return expandPath("~/.worktrees");
}
