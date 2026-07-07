import fs from "node:fs";
import path from "node:path";
import {
  OAuthConnectionSchema,
  type OAuthConnection,
} from "@aihub/shared";
import { CONFIG_DIR } from "../config/index.js";
import { TokenCipher } from "./crypto.js";
import { resolveTokenCipher } from "./encryption.js";

/**
 * File-backed store for OAuth connections. Connections are scoped to a single
 * (agent, provider) pair — one connection per pair, not per user. Persisted as
 * one JSON file per pair under `$AIHUB_HOME/oauth/`.
 *
 * Token fields (access + refresh) are encrypted at rest with AES-256-GCM when an
 * encryption secret is configured (`oauth.encryptionKey`); a leaked token file
 * then yields ciphertext, not a live Google grant. Tokens are only decrypted in
 * memory on read. When no secret is configured the store falls back to plaintext
 * (a warning is logged once at startup) so local/dev setups keep working.
 */
export class OAuthConnectionStore {
  #dir: string;
  #cipher: TokenCipher | undefined;

  /**
   * @param cipher token cipher, or `null` to force plaintext (local/dev, tests).
   *   When omitted entirely, the cipher is resolved from instance config
   *   (`oauth.encryptionKey`) via {@link resolveTokenCipher}.
   */
  constructor(
    dir: string = path.join(CONFIG_DIR, "oauth"),
    cipher: TokenCipher | null | undefined = undefined
  ) {
    this.#dir = dir;
    // `undefined` => resolve from config; `null` => explicitly no cipher
    // (plaintext) without touching config, keeping tests isolated.
    this.#cipher = cipher === undefined ? resolveTokenCipher() : cipher ?? undefined;
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
    if (!parsed.success) return undefined;
    return this.#decryptTokens(parsed.data);
  }

  save(connection: OAuthConnection): OAuthConnection {
    const validated = OAuthConnectionSchema.parse(connection);
    fs.mkdirSync(this.#dir, { recursive: true });
    const file = this.#fileFor(validated.agentId, validated.provider);
    const onDisk = this.#encryptTokens(validated);
    fs.writeFileSync(file, JSON.stringify(onDisk, null, 2), { mode: 0o600 });
    // `mode` is only honored on create; enforce 0600 on overwrite too so a
    // pre-existing looser file is tightened.
    fs.chmodSync(file, 0o600);
    return validated;
  }

  /** Encrypt token fields for persistence; no-op when no cipher is configured. */
  #encryptTokens(connection: OAuthConnection): OAuthConnection {
    if (!this.#cipher) return connection;
    return {
      ...connection,
      accessToken: this.#cipher.encrypt(connection.accessToken),
      refreshToken:
        connection.refreshToken !== undefined
          ? this.#cipher.encrypt(connection.refreshToken)
          : undefined,
    };
  }

  /** Decrypt token fields read from disk; passes plaintext through untouched. */
  #decryptTokens(connection: OAuthConnection): OAuthConnection {
    if (!this.#cipher) return connection;
    return {
      ...connection,
      accessToken: this.#cipher.decrypt(connection.accessToken),
      refreshToken:
        connection.refreshToken !== undefined
          ? this.#cipher.decrypt(connection.refreshToken)
          : undefined,
    };
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
