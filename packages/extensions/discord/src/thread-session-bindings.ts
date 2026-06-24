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
  thread_id    TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  channel_id   TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);`);
  }

  getBinding(threadId: string): ThreadSessionBinding | undefined {
    const row = this.db
      .prepare("SELECT * FROM thread_sessions WHERE thread_id = ?")
      .get(threadId) as ThreadSessionBindingRow | undefined;
    if (!row) return undefined;
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
