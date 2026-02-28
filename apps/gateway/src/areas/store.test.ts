import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";

describe("areas store", () => {
  let tmpDir: string;
  let projectsRoot: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-areas-store-"));
    projectsRoot = path.join(tmpDir, "projects");
    await fs.mkdir(projectsRoot, { recursive: true });

    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
    vi.resetModules();
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("supports area CRUD", async () => {
    const { createArea, listAreas, getArea, updateArea, deleteArea } =
      await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const created = await createArea(config, {
      id: "aihub",
      title: "AIHub",
      color: "#3b8ecc",
      order: 2,
    });
    expect(created.id).toBe("aihub");

    const fetched = await getArea(config, "aihub");
    expect(fetched?.title).toBe("AIHub");

    await createArea(config, {
      id: "cloudifai",
      title: "Cloudifai",
      color: "#8a3bcc",
      order: 1,
    });
    const listed = await listAreas(config);
    expect(listed.map((area) => area.id)).toEqual(["cloudifai", "aihub"]);

    const updated = await updateArea(config, "aihub", {
      title: "AIHub v3",
      order: 0,
    });
    expect(updated.title).toBe("AIHub v3");
    expect(updated.order).toBe(0);

    const deleted = await deleteArea(config, "aihub");
    expect(deleted).toBe(true);
    expect(await getArea(config, "aihub")).toBeNull();
  });

  it("migrates inferred areas and seeds defaults", async () => {
    const { migrateAreas } = await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const aihubDir = path.join(projectsRoot, "PRO-1_aihub_area_store");
    const ranksourceDir = path.join(projectsRoot, "PRO-2_ranksource_search");
    const existingAreaDir = path.join(projectsRoot, "PRO-3_cloudifai_core");
    await fs.mkdir(aihubDir, { recursive: true });
    await fs.mkdir(ranksourceDir, { recursive: true });
    await fs.mkdir(existingAreaDir, { recursive: true });

    await fs.writeFile(
      path.join(aihubDir, "README.md"),
      '---\nid: "PRO-1"\ntitle: "Area Store"\n---\n# Area Store\n',
      "utf8"
    );
    await fs.writeFile(
      path.join(ranksourceDir, "README.md"),
      '---\nid: "PRO-2"\ntitle: "Ranksource"\n---\n# Ranksource\n',
      "utf8"
    );
    await fs.writeFile(
      path.join(existingAreaDir, "README.md"),
      '---\nid: "PRO-3"\ntitle: "Cloudifai"\narea: "cloudifai"\n---\n# Cloudifai\n',
      "utf8"
    );

    const result = await migrateAreas(config);
    expect(result.seededAreas).toEqual(["aihub", "ranksource", "cloudifai"]);
    expect(result.updatedProjects).toContain("PRO-1_aihub_area_store");
    expect(result.updatedProjects).toContain("PRO-2_ranksource_search");
    expect(result.skippedProjects).toContain("PRO-3_cloudifai_core");

    const aihubReadme = await fs.readFile(
      path.join(aihubDir, "README.md"),
      "utf8"
    );
    const ranksourceReadme = await fs.readFile(
      path.join(ranksourceDir, "README.md"),
      "utf8"
    );
    expect(aihubReadme).toContain('area: "aihub"');
    expect(ranksourceReadme).toContain('area: "ranksource"');

    await expect(
      fs.stat(path.join(projectsRoot, ".areas", "aihub.yaml"))
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(projectsRoot, ".areas", "ranksource.yaml"))
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(projectsRoot, ".areas", "cloudifai.yaml"))
    ).resolves.toBeDefined();
  });
});
