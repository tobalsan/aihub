import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import {
  createSlice,
  getSlice,
  updateSlice,
  readSliceCounters,
} from "./slices.js";

describe("slice storage primitives", () => {
  let tmpDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-slices-"));
    projectDir = path.join(tmpDir, "PRO-238_auth-flow");
    await fs.mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates slices dir and counters on first create", async () => {
    const created = await createSlice(projectDir, {
      projectId: "PRO-238",
      title: "Auth flow",
    });

    expect(created.id).toBe("PRO-238-S01");
    await expect(
      fs.stat(path.join(projectDir, "slices", "PRO-238-S01"))
    ).resolves.toBeDefined();

    const counters = await readSliceCounters(projectDir);
    expect(counters.lastSliceId).toBe(1);

    const countersRaw = await fs.readFile(
      path.join(projectDir, ".meta", "counters.json"),
      "utf8"
    );
    expect(JSON.parse(countersRaw)).toEqual({ lastSliceId: 1 });
  });

  it("allocates IDs per-project and persists counter", async () => {
    const first = await createSlice(projectDir, {
      projectId: "PRO-238",
      title: "Auth",
    });
    const second = await createSlice(projectDir, {
      projectId: "PRO-238",
      title: "Settings",
    });

    expect(first.id).toBe("PRO-238-S01");
    expect(second.id).toBe("PRO-238-S02");
    expect((await readSliceCounters(projectDir)).lastSliceId).toBe(2);
  });

  it("round-trips frontmatter without loss on update", async () => {
    const created = await createSlice(projectDir, {
      projectId: "PRO-238",
      title: "Auth",
    });

    const updated = await updateSlice(projectDir, created.id, {
      frontmatter: {
        extra_json: { nested: [1, "two", true] },
        extra_text: "hello",
      },
      status: "in_progress",
    });

    expect(updated.frontmatter.extra_text).toBe("hello");
    expect(updated.frontmatter.extra_json).toEqual({ nested: [1, "two", true] });
    expect(updated.frontmatter.status).toBe("in_progress");

    const reread = await getSlice(projectDir, created.id);
    expect(reread.frontmatter.extra_text).toBe("hello");
    expect(reread.frontmatter.extra_json).toEqual({ nested: [1, "two", true] });
  });

  it("updates README atomically and no temp file left", async () => {
    const created = await createSlice(projectDir, {
      projectId: "PRO-238",
      title: "Auth",
    });

    await updateSlice(projectDir, created.id, { readme: "## Must\n- login\n" });

    const readmePath = path.join(projectDir, "slices", created.id, "README.md");
    const raw = await fs.readFile(readmePath, "utf8");
    expect(raw).toContain("## Must");

    const files = await fs.readdir(path.dirname(readmePath));
    expect(files.some((name) => name.includes(".tmp"))).toBe(false);
  });

  it("concurrent creates do not collide", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        createSlice(projectDir, {
          projectId: "PRO-238",
          title: `Slice ${index + 1}`,
        })
      )
    );

    const ids = results.map((item) => item.id).sort();
    expect(new Set(ids).size).toBe(12);
    expect(ids[0]).toBe("PRO-238-S01");
    expect(ids[11]).toBe("PRO-238-S12");
    expect((await readSliceCounters(projectDir)).lastSliceId).toBe(12);
  });
});
