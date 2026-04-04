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
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_assignments (
      userId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      assignedBy TEXT NOT NULL,
      assignedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (userId, agentId)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_assignments_agent_id
      ON agent_assignments (agentId);
  `);
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
