import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { GatewayConfig } from "@aihub/shared";
import { getProjectsContext } from "../context.js";
import { getProjectsRoot } from "../util/paths.js";

const DEBOUNCE_MS = 300;

export function inferProjectIdFromDirName(dirName: string): string {
  const match = /^(PRO-\d+)/.exec(dirName);
  if (match) return match[1];
  const base = dirName.split("_")[0];
  return base || dirName;
}

function parseProjectPath(
  projectsRoot: string,
  targetPath: string
): { projectId: string; relativePath: string; parts: string[] } | null {
  const relativePath = path.relative(projectsRoot, targetPath);
  if (!relativePath || relativePath.startsWith("..")) return null;
  const parts = relativePath.split(path.sep).filter(Boolean);
  const projectId = inferProjectIdFromDirName(parts[0] ?? "");
  if (!projectId || projectId.startsWith(".")) return null;
  return {
    projectId,
    relativePath: parts.join("/"),
    parts,
  };
}

function isAgentSessionEvent(event: string, parts: string[]): boolean {
  if (parts[1] !== "sessions") return false;
  if ((event === "addDir" || event === "unlinkDir") && parts.length === 3) {
    return true;
  }
  if (
    (event === "add" || event === "change" || event === "unlink") &&
    parts.length >= 4 &&
    parts[parts.length - 1] === "state.json"
  ) {
    return true;
  }
  return false;
}

export type ProjectWatcher = {
  close: () => Promise<void>;
};

export function startProjectWatcher(config: GatewayConfig): ProjectWatcher {
  const projectsRoot = getProjectsRoot(config);
  const fileTimers = new Map<string, NodeJS.Timeout>();
  const filePayloads = new Map<string, Set<string>>();
  const agentTimers = new Map<string, NodeJS.Timeout>();

  const queueFileChanged = (projectId: string, file: string) => {
    const existingFiles = filePayloads.get(projectId) ?? new Set<string>();
    existingFiles.add(file);
    filePayloads.set(projectId, existingFiles);
    const existing = fileTimers.get(projectId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      fileTimers.delete(projectId);
      const nextFiles = filePayloads.get(projectId);
      if (!nextFiles || nextFiles.size === 0) return;
      filePayloads.delete(projectId);
      for (const nextFile of nextFiles) {
        getProjectsContext().emit("file.changed", {
          type: "file_changed",
          projectId,
          file: nextFile,
        });
      }
    }, DEBOUNCE_MS);
    fileTimers.set(projectId, timer);
  };

  const queueAgentChanged = (projectId: string) => {
    const existing = agentTimers.get(projectId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      agentTimers.delete(projectId);
      getProjectsContext().emit("agent.changed", {
        type: "agent_changed",
        projectId,
      });
    }, DEBOUNCE_MS);
    agentTimers.set(projectId, timer);
  };

  const markdownWatcher: FSWatcher = chokidar.watch(
    path.join(projectsRoot, "**/*.md"),
    { ignoreInitial: true }
  );

  markdownWatcher.on("all", (event, changedPath) => {
    if (event !== "add" && event !== "change" && event !== "unlink") return;
    const parsed = parseProjectPath(projectsRoot, changedPath);
    if (!parsed) return;
    queueFileChanged(parsed.projectId, parsed.relativePath);
  });

  const sessionsWatcher: FSWatcher = chokidar.watch(projectsRoot, {
    ignoreInitial: true,
    depth: 4,
  });

  sessionsWatcher.on("all", (event, changedPath) => {
    const parsed = parseProjectPath(projectsRoot, changedPath);
    if (!parsed) return;
    if (!isAgentSessionEvent(event, parsed.parts)) return;
    queueAgentChanged(parsed.projectId);
  });

  return {
    close: async () => {
      for (const timer of fileTimers.values()) clearTimeout(timer);
      for (const timer of agentTimers.values()) clearTimeout(timer);
      fileTimers.clear();
      filePayloads.clear();
      agentTimers.clear();
      await Promise.allSettled([
        markdownWatcher.close(),
        sessionsWatcher.close(),
      ]);
    },
  };
}
