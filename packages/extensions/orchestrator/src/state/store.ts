import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export class StateStore {
  private db: Database.Database;
  constructor(file: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); this.db = new Database(file); }
  bootstrap(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, issue_id TEXT, identifier TEXT, workspace TEXT, repo TEXT, branch TEXT, profile_json TEXT, workflow_path TEXT, workflow_sha TEXT, pid INTEGER, started_at TEXT, finished_at TEXT, outcome TEXT, exit_code INTEGER, process_alive INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, type TEXT, payload TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS claims (issue_id TEXT, run_id TEXT, claimed_at TEXT, released_at TEXT);
CREATE TABLE IF NOT EXISTS heartbeats (daemon_id TEXT PRIMARY KEY, pid INTEGER, last_tick TEXT, version TEXT);`);
    const columns = this.db.prepare(`PRAGMA table_info(runs)`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "subagent_run_id")) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN subagent_run_id TEXT`);
    }
  }
  insertRun(run: Record<string, unknown>): void { this.db.prepare(`INSERT OR REPLACE INTO runs (run_id, issue_id, identifier, workspace, repo, branch, profile_json, workflow_path, workflow_sha, pid, started_at, process_alive) VALUES (@runId,@issueId,@identifier,@workspace,@repo,@branch,@profileJson,@workflowPath,@workflowSha,@pid,@startedAt,1)`).run(run); }
  setSubagentRunId(runId: string, subagentRunId: string | undefined): void { if (subagentRunId) this.db.prepare(`UPDATE runs SET subagent_run_id=? WHERE run_id=?`).run(subagentRunId, runId); }
  finishRun(runId: string, outcome: string, exitCode?: number): void { this.db.prepare(`UPDATE runs SET finished_at=?, outcome=?, exit_code=?, process_alive=0 WHERE run_id=?`).run(new Date().toISOString(), outcome, exitCode ?? null, runId); }
  appendEvent(runId: string, type: string, payload: unknown): void { this.db.prepare(`INSERT INTO events (run_id,type,payload,created_at) VALUES (?,?,?,?)`).run(runId, type, JSON.stringify(payload), new Date().toISOString()); }
  listRecent(limit = 50): unknown[] { return this.db.prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`).all(limit); }
  getRun(id: string): Record<string, unknown> | undefined { return this.db.prepare(`SELECT * FROM runs WHERE run_id=? OR issue_id=? OR identifier=? ORDER BY started_at DESC LIMIT 1`).get(id, id, id) as Record<string, unknown> | undefined; }
  getOpenRunByIssue(issueId: string): Record<string, unknown> | undefined { return this.db.prepare(`SELECT * FROM runs WHERE issue_id=? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1`).get(issueId) as Record<string, unknown> | undefined; }
  listOpenRuns(): Record<string, unknown>[] { return this.db.prepare(`SELECT * FROM runs WHERE finished_at IS NULL ORDER BY started_at ASC`).all() as Record<string, unknown>[]; }
  listEvents(runId: string, since = 0): unknown[] { return this.db.prepare(`SELECT * FROM events WHERE run_id=? AND id>? ORDER BY id ASC`).all(runId, since); }
  markOrphaned(): number { return this.db.prepare(`UPDATE runs SET finished_at=?, outcome='orphaned' WHERE finished_at IS NULL AND process_alive=0`).run(new Date().toISOString()).changes; }
  markActiveProcessStopped(): void { this.db.prepare(`UPDATE runs SET process_alive=0 WHERE finished_at IS NULL`).run(); }
  claim(issueId: string, runId: string): void { this.db.prepare(`INSERT INTO claims (issue_id, run_id, claimed_at) VALUES (?,?,?)`).run(issueId, runId, new Date().toISOString()); }
  release(issueId: string): void { this.db.prepare(`UPDATE claims SET released_at=? WHERE issue_id=? AND released_at IS NULL`).run(new Date().toISOString(), issueId); }
  heartbeat(id = "default"): void { this.db.prepare(`INSERT INTO heartbeats (daemon_id,pid,last_tick,version) VALUES (?,?,?,?) ON CONFLICT(daemon_id) DO UPDATE SET last_tick=excluded.last_tick,pid=excluded.pid`).run(id, process.pid, new Date().toISOString(), "0.1.0"); }
  close(): void { this.db.close(); }
}
