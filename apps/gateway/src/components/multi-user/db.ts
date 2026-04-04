import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { CONFIG_DIR } from "../../config/index.js";

export const AUTH_DB_FILENAME = "auth.db";

export function getAuthDbPath(baseDir = CONFIG_DIR): string {
  return path.join(baseDir, AUTH_DB_FILENAME);
}

export function ensureAgentAssignmentsTable(
  db: Database.Database
): void {
  const createTableSql = `
    CREATE TABLE agent_assignments (
      userId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      assignedBy TEXT NOT NULL,
      assignedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (userId, agentId),
      FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE,
      FOREIGN KEY (assignedBy) REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_assignments_agent_id
      ON agent_assignments (agentId);
  `;
  const tableExists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_assignments'"
    )
    .get();

  if (!tableExists) {
    db.exec(createTableSql);
    return;
  }

  const foreignKeys = db
    .prepare("PRAGMA foreign_key_list(agent_assignments)")
    .all() as Array<{ table: string; from: string }>;
  const hasExpectedForeignKeys =
    foreignKeys.some((row) => row.table === "user" && row.from === "userId") &&
    foreignKeys.some(
      (row) => row.table === "user" && row.from === "assignedBy"
    );

  if (!hasExpectedForeignKeys) {
    const hasUserTable = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user'"
      )
      .get();

    db.exec("DROP TABLE IF EXISTS agent_assignments_next");
    db.exec(createTableSql.replace("agent_assignments", "agent_assignments_next"));

    if (hasUserTable) {
      db.exec(`
        INSERT INTO agent_assignments_next (userId, agentId, assignedBy, assignedAt)
        SELECT assignments.userId, assignments.agentId, assignments.assignedBy, assignments.assignedAt
        FROM agent_assignments AS assignments
        INNER JOIN user AS assigned_user ON assigned_user.id = assignments.userId
        INNER JOIN user AS assigning_user ON assigning_user.id = assignments.assignedBy;
      `);
    }

    db.exec(`
      DROP TABLE agent_assignments;
      ALTER TABLE agent_assignments_next RENAME TO agent_assignments;
      CREATE INDEX IF NOT EXISTS idx_agent_assignments_agent_id
        ON agent_assignments (agentId);
    `);
  } else {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agent_assignments_agent_id
        ON agent_assignments (agentId);
    `);
  }
}

export function initializeMultiUserDatabase(
  dbPath = getAuthDbPath()
): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureAgentAssignmentsTable(db);
  return db;
}
