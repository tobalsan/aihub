import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { scanAreaSummaries, toggleAreaHidden } from "./areas.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "areas-test-"));
  await fs.mkdir(path.join(tmpDir, ".areas"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeArea(id: string, yaml: string, loop?: string) {
  const areasDir = path.join(tmpDir, ".areas");
  await fs.writeFile(path.join(areasDir, `${id}.yaml`), yaml, "utf-8");
  if (loop !== undefined) {
    await fs.writeFile(path.join(areasDir, `${id}.loop.md`), loop, "utf-8");
  }
}

describe("scanAreaSummaries", () => {
  it("returns empty array when .areas dir missing", async () => {
    const result = await scanAreaSummaries("/nonexistent/path");
    expect(result).toEqual([]);
  });

  it("returns empty array when .areas has no yaml files", async () => {
    const result = await scanAreaSummaries(tmpDir);
    expect(result).toEqual([]);
  });

  it("reads area config without loop file", async () => {
    await writeArea(
      "aihub",
      "id: aihub\ntitle: AIHub\ncolor: '#3b8ecc'\norder: 1\n",
    );

    const result = await scanAreaSummaries(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "aihub",
      title: "AIHub",
      color: "#3b8ecc",
      order: 1,
      recentlyDone: "",
      whatsNext: "",
    });
  });

  it("reads area config with loop file", async () => {
    await writeArea(
      "aihub",
      "id: aihub\ntitle: AIHub\ncolor: '#3b8ecc'\norder: 1\n",
      `# AIHub

## Recently Done
- Shipped board projects tab
- Fixed CLI build error

## What's Next
- Area summaries feature
`,
    );

    const result = await scanAreaSummaries(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.recentlyDone).toContain("Shipped board projects tab");
    expect(result[0]!.recentlyDone).toContain("Fixed CLI build error");
    expect(result[0]!.whatsNext).toContain("Area summaries feature");
  });

  it("sorts by order then title", async () => {
    await writeArea("ranksource", "id: ranksource\ntitle: Ranksource\ncolor: '#cc6b3b'\norder: 2\n");
    await writeArea("aihub", "id: aihub\ntitle: AIHub\ncolor: '#3b8ecc'\norder: 1\n");
    await writeArea("cloudifai", "id: cloudifai\ntitle: Cloudifai\ncolor: '#FFE100'\norder: 3\n");

    const result = await scanAreaSummaries(tmpDir);
    expect(result.map((a) => a.id)).toEqual(["aihub", "ranksource", "cloudifai"]);
  });

  it("uses defaults for missing config fields", async () => {
    await writeArea("mystery", "id: mystery\n");

    const result = await scanAreaSummaries(tmpDir);
    expect(result[0]).toMatchObject({
      id: "mystery",
      title: "mystery",
      color: "#6b7280",
      order: 999,
    });
  });

  it("handles loop file with only one section", async () => {
    await writeArea(
      "test",
      "id: test\ntitle: Test\ncolor: '#fff'\n",
      `# Test

## What's Next
- Do something cool
`,
    );

    const result = await scanAreaSummaries(tmpDir);
    expect(result[0]!.recentlyDone).toBe("");
    expect(result[0]!.whatsNext).toContain("Do something cool");
  });

  it("skips areas with unreadable yaml", async () => {
    const areasDir = path.join(tmpDir, ".areas");
    // Create a directory instead of a file — will fail to read
    await fs.mkdir(path.join(areasDir, "bad.yaml"), { recursive: true });
    await writeArea("good", "id: good\ntitle: Good\ncolor: '#000'\n");

    const result = await scanAreaSummaries(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("good");
  });

  it("reads hidden flag from yaml", async () => {
    await writeArea(
      "stale",
      "id: stale\ntitle: Stale Project\ncolor: '#999'\nhidden: true\n",
    );
    await writeArea(
      "active",
      "id: active\ntitle: Active\ncolor: '#0f0'\n",
    );

    const result = await scanAreaSummaries(tmpDir);
    const stale = result.find((a) => a.id === "stale");
    const active = result.find((a) => a.id === "active");
    expect(stale!.hidden).toBe(true);
    expect(active!.hidden).toBe(false);
  });
});

describe("toggleAreaHidden", () => {
  it("sets hidden: true on an area", async () => {
    await writeArea("test", "id: test\ntitle: Test\ncolor: '#fff'\n");
    await toggleAreaHidden(tmpDir, "test", true);

    const result = await scanAreaSummaries(tmpDir);
    expect(result[0]!.hidden).toBe(true);
  });

  it("removes hidden when set to false", async () => {
    await writeArea("test", "id: test\ntitle: Test\ncolor: '#fff'\nhidden: true\n");
    await toggleAreaHidden(tmpDir, "test", false);

    const result = await scanAreaSummaries(tmpDir);
    expect(result[0]!.hidden).toBe(false);

    // Verify the hidden line is actually gone from the file
    const raw = await fs.readFile(path.join(tmpDir, ".areas", "test.yaml"), "utf-8");
    expect(raw).not.toContain("hidden");
  });

  it("throws for missing area", async () => {
    await expect(toggleAreaHidden(tmpDir, "nope", true)).rejects.toThrow(
      "Area config not found",
    );
  });
});
