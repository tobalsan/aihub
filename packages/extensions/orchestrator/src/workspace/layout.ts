import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { RepoConfig } from "../types.js";

export function sanitizeIdentifier(identifier: string): string {
  const sanitized = identifier.replace(/[^A-Za-z0-9_-]/g, "").toLowerCase();
  return sanitized || "issue";
}

function run(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
  });
}

export class WorkspaceLayout {
  constructor(private readonly root: string) {}

  workspacePath(identifier: string): string {
    return path.join(this.root, sanitizeIdentifier(identifier));
  }

  async create(input: { identifier: string; repo?: RepoConfig | null }): Promise<{ path: string; branch?: string; created: boolean }> {
    const workspace = this.workspacePath(input.identifier);
    try {
      await fs.access(workspace);
      return { path: workspace, branch: input.repo ? `aihub/${sanitizeIdentifier(input.identifier)}` : undefined, created: false };
    } catch {}
    await fs.mkdir(path.dirname(workspace), { recursive: true });
    if (!input.repo) {
      await fs.mkdir(workspace, { recursive: true });
      return { path: workspace, created: true };
    }
    const branch = `aihub/${sanitizeIdentifier(input.identifier)}`;
    await run("git", ["worktree", "add", "-b", branch, workspace, input.repo.baseBranch ?? "main"], input.repo.path);
    return { path: workspace, branch, created: true };
  }

  async remove(input: { identifier: string; repo?: RepoConfig | null }): Promise<void> {
    const workspace = this.workspacePath(input.identifier);
    if (input.repo) {
      await run("git", ["worktree", "remove", "--force", workspace], input.repo.path).catch(() => undefined);
      await run("git", ["branch", "-D", `aihub/${sanitizeIdentifier(input.identifier)}`], input.repo.path).catch(() => undefined);
    }
    await fs.rm(workspace, { recursive: true, force: true });
  }
}
