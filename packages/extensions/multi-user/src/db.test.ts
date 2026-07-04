import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeMultiUserDatabase } from "./db.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("multi-user db", () => {
  it("initializes sqlite db and agent assignments table", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihub-auth-db-"));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, "auth.db");

    const db = initializeMultiUserDatabase(dbPath);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    const foreignKeys = db
      .prepare("PRAGMA foreign_key_list(agent_assignments)")
      .all() as Array<{ table: string; from: string }>;
    const foreignKeysEnabled = db.pragma("foreign_keys", {
      simple: true,
    }) as number;

    db.close();

    expect(fs.existsSync(dbPath)).toBe(true);
    expect(tables.map((table) => table.name)).toContain("agent_assignments");
    expect(tables.map((table) => table.name)).toContain("teams");
    expect(foreignKeysEnabled).toBe(1);
    expect(foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "user", from: "userId" }),
        expect.objectContaining({ table: "user", from: "assignedBy" }),
      ])
    );
  });

  it("creates a teams table with a unique name index", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihub-teams-db-"));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, "auth.db");

    const db = initializeMultiUserDatabase(dbPath);
    const columns = db
      .prepare("PRAGMA table_info(teams)")
      .all() as Array<{ name: string; notnull: number }>;
    const indexes = db
      .prepare("PRAGMA index_list(teams)")
      .all() as Array<{ name: string; unique: number }>;

    db.close();

    const columnNames = columns.map((column) => column.name);
    expect(columnNames).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "description",
        "color",
        "icon",
        "createdBy",
        "createdAt",
      ])
    );
    expect(indexes.some((index) => index.unique === 1)).toBe(true);
  });
});
