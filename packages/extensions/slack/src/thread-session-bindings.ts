import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type SlackThreadSessionBinding = {
  channelId: string;
  threadTs: string;
  sessionId: string;
  agentId: string;
  createdAt: number;
};

export type SetSlackThreadSessionBindingInput = Omit<
  SlackThreadSessionBinding,
  "createdAt"
>;

type SlackThreadSessionBindingRow = {
  channel_id: string;
  thread_ts: string;
  session_id: string;
  agent_id: string;
  created_at: number;
};

export class SlackThreadSessionBindingStore {
  private readonly db: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, "thread-sessions.db"));
    this.db.exec(`CREATE TABLE IF NOT EXISTS thread_sessions (
  channel_id  TEXT NOT NULL,
  thread_ts   TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (channel_id, thread_ts, agent_id)
);`);
  }

  getBinding(
    channelId: string,
    threadTs: string,
    agentId?: string
  ): SlackThreadSessionBinding | undefined {
    const row = agentId
      ? this.db
          .prepare(
            "SELECT * FROM thread_sessions WHERE channel_id = ? AND thread_ts = ? AND agent_id = ?"
          )
          .get(channelId, threadTs, agentId)
      : this.db
          .prepare(
            "SELECT * FROM thread_sessions WHERE channel_id = ? AND thread_ts = ? ORDER BY created_at ASC LIMIT 1"
          )
          .get(channelId, threadTs);
    return row
      ? this.rowToBinding(row as SlackThreadSessionBindingRow)
      : undefined;
  }

  setBinding(input: SetSlackThreadSessionBindingInput): SlackThreadSessionBinding {
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO thread_sessions (channel_id, thread_ts, session_id, agent_id, created_at)
VALUES (@channelId, @threadTs, @sessionId, @agentId, @createdAt)`
      )
      .run({ ...input, createdAt });
    return { ...input, createdAt };
  }

  deleteBinding(channelId: string, threadTs: string, agentId: string): boolean {
    return (
      this.db
        .prepare(
          "DELETE FROM thread_sessions WHERE channel_id = ? AND thread_ts = ? AND agent_id = ?"
        )
        .run(channelId, threadTs, agentId).changes > 0
    );
  }

  close(): void {
    this.db.close();
  }

  private rowToBinding(row: SlackThreadSessionBindingRow): SlackThreadSessionBinding {
    return {
      channelId: row.channel_id,
      threadTs: row.thread_ts,
      sessionId: row.session_id,
      agentId: row.agent_id,
      createdAt: row.created_at,
    };
  }
}

export function createSlackThreadSessionBindingStore(
  dataDir: string
): SlackThreadSessionBindingStore {
  return new SlackThreadSessionBindingStore(dataDir);
}
