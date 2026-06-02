import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column);
}

export class StateStore {
  private db: Database.Database;
  constructor(file: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); this.db = new Database(file); }
  bootstrap(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, project_id TEXT, issue_id TEXT, identifier TEXT, workspace TEXT, profile_json TEXT, workflow_path TEXT, workflow_sha TEXT, pid INTEGER, started_at TEXT, finished_at TEXT, outcome TEXT, exit_code INTEGER, process_alive INTEGER DEFAULT 1, subagent_run_id TEXT);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, run_id TEXT, type TEXT, payload TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS claims (project_id TEXT, issue_id TEXT, run_id TEXT, claimed_at TEXT, released_at TEXT);
CREATE TABLE IF NOT EXISTS heartbeats (daemon_id TEXT PRIMARY KEY, pid INTEGER, last_tick TEXT, version TEXT);`);
    for (const [table, column] of [["runs", "project_id"], ["runs", "subagent_run_id"], ["events", "project_id"], ["claims", "project_id"]] as const) {
      if (!hasColumn(this.db, table, column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    }
  }
  insertRun(run: Record<string, unknown>): void { this.db.prepare(`INSERT OR REPLACE INTO runs (run_id, project_id, issue_id, identifier, workspace, profile_json, workflow_path, workflow_sha, pid, started_at, process_alive) VALUES (@runId,@projectId,@issueId,@identifier,@workspace,@profileJson,@workflowPath,@workflowSha,@pid,@startedAt,1)`).run({ projectId: "default", ...run }); }
  setSubagentRunId(runId: string, subagentRunId: string | undefined): void { if (subagentRunId) this.db.prepare(`UPDATE runs SET subagent_run_id=? WHERE run_id=?`).run(subagentRunId, runId); }
  finishRun(runId: string, outcome: string, exitCode?: number): void { this.db.prepare(`UPDATE runs SET finished_at=?, outcome=?, exit_code=?, process_alive=0 WHERE run_id=?`).run(new Date().toISOString(), outcome, exitCode ?? null, runId); }
  appendEvent(runId: string, type: string, payload: unknown, projectId?: string): void { this.db.prepare(`INSERT INTO events (project_id,run_id,type,payload,created_at) VALUES (?,?,?,?,?)`).run(projectId ?? null, runId, type, JSON.stringify(payload), new Date().toISOString()); }
  listRecent(limit = 50, projectId?: string): unknown[] { return projectId ? this.db.prepare(`SELECT * FROM runs WHERE project_id=? ORDER BY started_at DESC LIMIT ?`).all(projectId, limit) : this.db.prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`).all(limit); }
  getRun(id: string, projectId?: string): Record<string, unknown> | undefined { return projectId ? this.db.prepare(`SELECT * FROM runs WHERE project_id=? AND (run_id=? OR issue_id=? OR identifier=?) ORDER BY started_at DESC LIMIT 1`).get(projectId, id, id, id) as Record<string, unknown> | undefined : this.db.prepare(`SELECT * FROM runs WHERE run_id=? OR issue_id=? OR identifier=? ORDER BY started_at DESC LIMIT 1`).get(id, id, id) as Record<string, unknown> | undefined; }
  getOpenRunByIssue(issueId: string, projectId?: string): Record<string, unknown> | undefined { return projectId ? this.db.prepare(`SELECT * FROM runs WHERE project_id=? AND issue_id=? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1`).get(projectId, issueId) as Record<string, unknown> | undefined : this.db.prepare(`SELECT * FROM runs WHERE issue_id=? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1`).get(issueId) as Record<string, unknown> | undefined; }
  listOpenRuns(projectId?: string): Record<string, unknown>[] { return (projectId ? this.db.prepare(`SELECT * FROM runs WHERE project_id=? AND finished_at IS NULL ORDER BY started_at ASC`).all(projectId) : this.db.prepare(`SELECT * FROM runs WHERE finished_at IS NULL ORDER BY started_at ASC`).all()) as Record<string, unknown>[]; }
  listOpenRunsByProject(projectId: string): Record<string, unknown>[] { return this.listOpenRuns(projectId); }
  listEvents(runId: string, since = 0): unknown[] { return this.db.prepare(`SELECT * FROM events WHERE run_id=? AND id>? ORDER BY id ASC`).all(runId, since); }
  markOrphaned(): number { return this.db.prepare(`UPDATE runs SET finished_at=?, outcome='orphaned' WHERE finished_at IS NULL AND process_alive=0`).run(new Date().toISOString()).changes; }
  markOpenRunsInterrupted(outcome = "interrupted_gateway_restart"): number { return this.db.prepare(`UPDATE runs SET finished_at=?, outcome=?, process_alive=0 WHERE finished_at IS NULL`).run(new Date().toISOString(), outcome).changes; }
  markActiveProcessStopped(): void { this.db.prepare(`UPDATE runs SET process_alive=0 WHERE finished_at IS NULL`).run(); }
  claim(issueId: string, runId: string, projectId = "default"): void { this.db.prepare(`INSERT INTO claims (project_id, issue_id, run_id, claimed_at) VALUES (?,?,?,?)`).run(projectId, issueId, runId, new Date().toISOString()); }
  release(issueId: string, projectId?: string): void { projectId ? this.db.prepare(`UPDATE claims SET released_at=? WHERE project_id=? AND issue_id=? AND released_at IS NULL`).run(new Date().toISOString(), projectId, issueId) : this.db.prepare(`UPDATE claims SET released_at=? WHERE issue_id=? AND released_at IS NULL`).run(new Date().toISOString(), issueId); }
  heartbeat(id = "default"): void { this.db.prepare(`INSERT INTO heartbeats (daemon_id,pid,last_tick,version) VALUES (?,?,?,?) ON CONFLICT(daemon_id) DO UPDATE SET last_tick=excluded.last_tick,pid=excluded.pid`).run(id, process.pid, new Date().toISOString(), "0.1.0"); }
  close(): void { this.db.close(); }
}
