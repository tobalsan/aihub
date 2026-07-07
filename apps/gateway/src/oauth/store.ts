import fs from "node:fs";
import path from "node:path";
import {
  OAuthConnectionSchema,
  type OAuthConnection,
} from "@aihub/shared";
import { CONFIG_DIR } from "../config/index.js";

/**
 * File-backed store for OAuth connections. Connections are scoped to a single
 * (agent, provider) pair — one connection per pair, not per user. Persisted as
 * one JSON file per pair under `$AIHUB_HOME/oauth/`.
 *
 * NOTE: tokens are stored in plaintext in this slice. Encryption at rest is a
 * follow-up (ALG-359).
 */
export class OAuthConnectionStore {
  #dir: string;

  constructor(dir: string = path.join(CONFIG_DIR, "oauth")) {
    this.#dir = dir;
  }

  #fileFor(agentId: string, provider: string): string {
    const safe = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return path.join(this.#dir, `${safe(agentId)}__${safe(provider)}.json`);
  }

  get(agentId: string, provider: string): OAuthConnection | undefined {
    const file = this.#fileFor(agentId, provider);
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const parsed = OAuthConnectionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  }

  save(connection: OAuthConnection): OAuthConnection {
    const validated = OAuthConnectionSchema.parse(connection);
    fs.mkdirSync(this.#dir, { recursive: true });
    const file = this.#fileFor(validated.agentId, validated.provider);
    fs.writeFileSync(file, JSON.stringify(validated, null, 2), { mode: 0o600 });
    // `mode` is only honored on create; enforce 0600 on overwrite too so a
    // pre-existing looser file is tightened.
    fs.chmodSync(file, 0o600);
    return validated;
  }

  /**
   * Apply a partial update to a stored connection and persist it. Returns the
   * updated connection, or undefined when there is nothing stored for the pair.
   */
  update(
    agentId: string,
    provider: string,
    patch: Partial<OAuthConnection>
  ): OAuthConnection | undefined {
    const existing = this.get(agentId, provider);
    if (!existing) return undefined;
    return this.save({ ...existing, ...patch, updatedAt: Date.now() });
  }

  delete(agentId: string, provider: string): void {
    const file = this.#fileFor(agentId, provider);
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

let defaultStore: OAuthConnectionStore | undefined;

export function getOAuthConnectionStore(): OAuthConnectionStore {
  defaultStore ??= new OAuthConnectionStore();
  return defaultStore;
}
