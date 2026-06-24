import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type ThreadSessionBinding = {
  threadId: string;
  sessionId: string;
  agentId: string;
  channelId: string;
  createdAt: number;
};

export type SetThreadSessionBindingInput = {
  threadId: string;
  sessionId: string;
  agentId: string;
  channelId: string;
};

type ThreadSessionBindingRow = {
  thread_id: string;
  session_id: string;
  agent_id: string;
  channel_id: string;
  created_at: number;
};

export class ThreadSessionBindingStore {
  private readonly db: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, "thread-sessions.db"));
    this.db.exec(`CREATE TABLE IF NOT EXISTS thread_sessions (
  thread_id    TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  channel_id   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (thread_id, agent_id)
);`);
    this.migrateSingleThreadPrimaryKey();
  }

  private migrateSingleThreadPrimaryKey(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(thread_sessions)")
      .all() as Array<{ name: string; pk: number }>;
    const threadPk = columns.find((column) => column.name === "thread_id")?.pk ?? 0;
    const agentPk = columns.find((column) => column.name === "agent_id")?.pk ?? 0;
    if (threadPk !== 1 || agentPk !== 2) {
      this.db.exec(`ALTER TABLE thread_sessions RENAME TO thread_sessions_old;
CREATE TABLE thread_sessions (
  thread_id    TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  channel_id   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (thread_id, agent_id)
);
INSERT OR IGNORE INTO thread_sessions (thread_id, session_id, agent_id, channel_id, created_at)
SELECT thread_id, session_id, agent_id, channel_id, created_at FROM thread_sessions_old;
DROP TABLE thread_sessions_old;`);
    }
  }

  getBinding(
    threadId: string,
    agentId?: string
  ): ThreadSessionBinding | undefined {
    if (!agentId) return this.getBindings(threadId)[0];
    const row = this.db
      .prepare("SELECT * FROM thread_sessions WHERE thread_id = ? AND agent_id = ?")
      .get(threadId, agentId) as ThreadSessionBindingRow | undefined;
    if (!row) return undefined;
    return this.rowToBinding(row);
  }

  getBindings(threadId: string): ThreadSessionBinding[] {
    const rows = this.db
      .prepare("SELECT * FROM thread_sessions WHERE thread_id = ? ORDER BY created_at ASC")
      .all(threadId) as ThreadSessionBindingRow[];
    return rows.map((row) => this.rowToBinding(row));
  }

  private rowToBinding(row: ThreadSessionBindingRow): ThreadSessionBinding {
    return {
      threadId: row.thread_id,
      sessionId: row.session_id,
      agentId: row.agent_id,
      channelId: row.channel_id,
      createdAt: row.created_at,
    };
  }

  setBinding(input: SetThreadSessionBindingInput): ThreadSessionBinding {
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO thread_sessions (thread_id, session_id, agent_id, channel_id, created_at)
VALUES (@threadId, @sessionId, @agentId, @channelId, @createdAt)`
      )
      .run({ ...input, createdAt });
    return { ...input, createdAt };
  }

  close(): void {
    this.db.close();
  }
}

export function createThreadSessionBindingStore(
  dataDir: string
): ThreadSessionBindingStore {
  return new ThreadSessionBindingStore(dataDir);
}
