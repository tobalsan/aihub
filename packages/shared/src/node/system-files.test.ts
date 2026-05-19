import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSystemFiles } from "./system-files.js";

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "aihub-system-files-"));
}

describe("resolveSystemFiles", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
    vi.unstubAllEnvs();
  });

  it("prepends AGENTS and default system files", async () => {
    dir = await tempDir();
    await fs.writeFile(path.join(dir, "AGENTS.md"), "agents");
    await fs.writeFile(path.join(dir, "SOUL.md"), "soul");
    await fs.writeFile(path.join(dir, "USER.md"), "user");
    const files = await resolveSystemFiles({ workspaceDir: dir });
    expect(files.map((f) => f.path)).toEqual(["AGENTS.md", "SOUL.md", "USER.md"]);
  });

  it("requires default SOUL and skips missing USER with warning", async () => {
    dir = await tempDir();
    const warnings: string[] = [];
    await expect(resolveSystemFiles({ workspaceDir: dir, warn: (m) => warnings.push(m) })).rejects.toThrow("Required system file not found: SOUL.md");
    await fs.writeFile(path.join(dir, "SOUL.md"), "soul");
    const files = await resolveSystemFiles({ workspaceDir: dir, warn: (m) => warnings.push(m) });
    expect(files.map((f) => f.path)).toEqual(["SOUL.md"]);
    expect(warnings.some((m) => m.includes("USER.md"))).toBe(true);
  });

  it("dedupes AGENTS when listed", async () => {
    dir = await tempDir();
    await fs.writeFile(path.join(dir, "AGENTS.md"), "agents");
    await fs.writeFile(path.join(dir, "SOUL.md"), "soul");
    const warnings: string[] = [];
    const files = await resolveSystemFiles({ workspaceDir: dir, systemFiles: ["AGENTS.md", "SOUL.md"], warn: (m) => warnings.push(m) });
    expect(files.map((f) => f.path)).toEqual(["AGENTS.md", "SOUL.md"]);
    expect(warnings.some((m) => m.includes("auto-included"))).toBe(true);
  });

  it("loads cross-workspace relative paths", async () => {
    dir = await tempDir();
    const shared = path.join(dir, "shared.md");
    const agent = path.join(dir, "agent");
    await fs.mkdir(agent);
    await fs.writeFile(shared, "shared");
    const files = await resolveSystemFiles({ workspaceDir: agent, systemFiles: ["../shared.md"] });
    expect(files).toHaveLength(1);
    expect(files[0].content).toBe("shared");
  });

  it("resolves $AIHUB_HOME to default ~/.aihub when env is absent", async () => {
    vi.stubEnv("AIHUB_HOME", "");
    dir = await tempDir();
    const homeFile = path.join(os.homedir(), ".aihub", "system-file-test.md");
    await fs.mkdir(path.dirname(homeFile), { recursive: true });
    await fs.writeFile(homeFile, "home");
    try {
      const files = await resolveSystemFiles({
        workspaceDir: dir,
        systemFiles: ["$AIHUB_HOME/system-file-test.md"],
      });
      expect(files).toHaveLength(1);
      expect(files[0].absolutePath).toBe(homeFile);
      expect(files[0].content).toBe("home");
    } finally {
      await fs.rm(homeFile, { force: true });
    }
  });
});
