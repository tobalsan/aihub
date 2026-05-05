import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runGit(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args]);
  return stdout.trim();
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  try {
    await runGit(repo, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

export function projectIntegrationBranchName(projectId: string): string {
  return `${projectId}/integration`;
}

export async function ensureProjectIntegrationBranch(
  repo: string,
  projectId: string
): Promise<string> {
  const branch = projectIntegrationBranchName(projectId);
  if (await branchExists(repo, branch)) return branch;

  await runGit(repo, ["branch", branch, "refs/heads/main"]);
  return branch;
}
