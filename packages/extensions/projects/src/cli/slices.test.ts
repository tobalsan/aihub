import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerSlicesCommands } from "./slices.js";

async function setupProject(root: string, id: string, title: string): Promise<string> {
  const dir = path.join(root, `${id}_test`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "README.md"),
    `---\nid: ${JSON.stringify(id)}\ntitle: ${JSON.stringify(title)}\nstatus: "active"\n---\n`,
    "utf8"
  );
  return dir;
}

function createProgram() {
  const program = new Command();
  program.name("slices").exitOverride();
  registerSlicesCommands(program);
  return program;
}

describe("slices CLI", () => {
  let prevHome: string | undefined;
  let homeDir: string;
  let projectsRoot: string;

  beforeEach(async () => {
    prevHome = process.env.AIHUB_HOME;
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-home-"));
    projectsRoot = path.join(homeDir, "projects");
    await fs.mkdir(projectsRoot, { recursive: true });
    process.env.AIHUB_HOME = homeDir;
    await fs.writeFile(
      path.join(homeDir, "aihub.json"),
      JSON.stringify({ agents: [], projects: { root: projectsRoot } }),
      "utf8"
    );
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.AIHUB_HOME;
    else process.env.AIHUB_HOME = prevHome;
    await fs.rm(homeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("add creates slice and prints id", async () => {
    await setupProject(projectsRoot, "PRO-101", "Proj");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      logs.push(String(msg ?? ""));
    });

    await createProgram().parseAsync([
      "node",
      "slices",
      "add",
      "--project",
      "PRO-101",
      "Auth flow",
    ]);

    expect(logs[0]).toBe("PRO-101-S01");
    const readme = await fs.readFile(
      path.join(projectsRoot, "PRO-101_test", "slices", "PRO-101-S01", "README.md"),
      "utf8"
    );
    expect(readme).toContain('title: "Auth flow"');
  });

  it("list supports no flags and filters", async () => {
    await setupProject(projectsRoot, "PRO-101", "One");
    await setupProject(projectsRoot, "PRO-102", "Two");
    await createProgram().parseAsync([
      "node",
      "slices",
      "add",
      "--project",
      "PRO-101",
      "A",
    ]);
    await createProgram().parseAsync([
      "node",
      "slices",
      "add",
      "--project",
      "PRO-102",
      "B",
    ]);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      logs.push(String(msg ?? ""));
    });

    await createProgram().parseAsync(["node", "slices", "list"]);
    expect(logs[0]).toContain("PRO-101-S01");
    expect(logs[0]).toContain("PRO-102-S01");

    logs.length = 0;
    await createProgram().parseAsync([
      "node",
      "slices",
      "list",
      "--project",
      "PRO-101",
      "--status",
      "todo",
    ]);
    expect(logs[0]).toContain("PRO-101-S01");
    expect(logs[0]).not.toContain("PRO-102-S01");
  });

  it("get resolves slice across projects", async () => {
    await setupProject(projectsRoot, "PRO-101", "One");
    await setupProject(projectsRoot, "PRO-102", "Two");
    await createProgram().parseAsync([
      "node",
      "slices",
      "add",
      "--project",
      "PRO-102",
      "Slice B",
    ]);

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      logs.push(String(msg ?? ""));
    });

    await createProgram().parseAsync(["node", "slices", "get", "PRO-102-S01"]);
    expect(logs[0]).toContain("id: PRO-102-S01");
    expect(logs[0]).toContain("title: Slice B");
  });

  it("prints clear errors for missing project and missing slice", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
      errors.push(String(msg ?? ""));
    });
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`EXIT:${code}`);
    }) as never);

    await expect(
      createProgram().parseAsync([
        "node",
        "slices",
        "add",
        "--project",
        "PRO-999",
        "Missing",
      ])
    ).rejects.toThrow("EXIT:1");
    expect(errors[0]).toBe("Project not found: PRO-999");

    errors.length = 0;
    await setupProject(projectsRoot, "PRO-101", "One");
    await expect(
      createProgram().parseAsync(["node", "slices", "get", "PRO-101-S99"])
    ).rejects.toThrow("EXIT:1");
    expect(errors[0]).toBe("Slice not found: PRO-101-S99");
  });
});
