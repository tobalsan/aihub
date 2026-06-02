import fs from "node:fs/promises";
import path from "node:path";

export function sanitizeIdentifier(identifier: string): string {
  const sanitized = identifier.replace(/[^A-Za-z0-9._-]/g, "").toLowerCase();
  return sanitized || "issue";
}

function assertInsideRoot(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`workspace escapes root: ${target}`);
}

export class WorkspaceLayout {
  private readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  workspacePath(identifier: string): string {
    const workspace = path.join(this.root, sanitizeIdentifier(identifier));
    assertInsideRoot(this.root, workspace);
    return workspace;
  }

  async create(input: { identifier: string }): Promise<{ path: string; created: boolean }> {
    const workspace = this.workspacePath(input.identifier);
    try {
      const stat = await fs.stat(workspace);
      if (!stat.isDirectory()) throw new Error(`workspace path is not a directory: ${workspace}`);
      return { path: workspace, created: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.mkdir(workspace, { recursive: true });
    return { path: workspace, created: true };
  }

  async remove(input: { identifier: string }): Promise<void> {
    const workspace = this.workspacePath(input.identifier);
    await fs.rm(workspace, { recursive: true, force: true });
  }
}
