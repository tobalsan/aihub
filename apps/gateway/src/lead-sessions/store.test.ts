import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  legacyLeadSessionId,
  readLeadSessionsForProject,
} from "../../../../packages/extensions/projects/src/lead-sessions/store.js";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("lead session store", () => {
  it("returns an empty list when the index is missing", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lead-sessions-"));

    const sessions = await readLeadSessionsForProject({
      id: "PRO-1",
      absolutePath: tmpDir,
      frontmatter: {},
    });

    expect(sessions).toEqual([]);
  });

  it("lazily materializes legacy sessionKeys once", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lead-sessions-"));
    const transcriptDir = path.join(tmpDir, "sessions", "legacy-pom");
    await fs.mkdir(transcriptDir, { recursive: true });
    const historyFile = path.join(transcriptDir, "history.jsonl");
    await fs.writeFile(historyFile, "{}\n", "utf8");
    const mtime = new Date("2026-05-14T12:00:00.000Z");
    await fs.utimes(historyFile, mtime, mtime);

    const project = {
      id: "PRO-1",
      absolutePath: tmpDir,
      frontmatter: {
        created: "2026-05-14T00:00:00.000Z",
        sessionKeys: { pom: "legacy-pom" },
      },
    };

    const first = await readLeadSessionsForProject(project);
    const second = await readLeadSessionsForProject(project);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).toMatchObject({
      id: legacyLeadSessionId("PRO-1", "pom"),
      agentId: "pom",
      title: "Main",
      titleLocked: true,
      transcriptRef: "legacy-pom",
      updatedAt: mtime.toISOString(),
    });
  });

  it("does not overwrite an existing migrated record", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lead-sessions-"));
    const existing = {
      id: legacyLeadSessionId("PRO-1", "pom"),
      projectId: "PRO-1",
      agentId: "pom",
      kind: "lead",
      title: "Renamed",
      titleLocked: true,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T01:00:00.000Z",
      transcriptRef: "legacy-pom",
    };
    await fs.writeFile(
      path.join(tmpDir, "lead-sessions.json"),
      JSON.stringify([existing], null, 2),
      "utf8"
    );

    const sessions = await readLeadSessionsForProject({
      id: "PRO-1",
      absolutePath: tmpDir,
      frontmatter: { sessionKeys: { pom: "legacy-pom" } },
    });

    expect(sessions).toEqual([existing]);
  });
});
