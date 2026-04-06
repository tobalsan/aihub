import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TokenStoreError } from "./errors.js";
const DEFAULT_TOKENS_PATH = path.join(os.homedir(), ".local", "state", "aihub", "connectors", "cloudifi_admin", "tokens.json");
export class TokenStore {
    path;
    lockPath;
    constructor(pathname = DEFAULT_TOKENS_PATH) {
        this.path = pathname;
        this.lockPath = `${pathname}.lock`;
    }
    async load() {
        return this.withLock(async () => {
            try {
                const raw = await readFile(this.path, "utf8");
                if (!raw.trim()) {
                    return null;
                }
                const parsed = JSON.parse(raw);
                if (this.shouldGarbageCollect(parsed)) {
                    await this.writeFileAtomically("");
                    return null;
                }
                return parsed;
            }
            catch (error) {
                if (this.isMissingFile(error)) {
                    return null;
                }
                if (error instanceof SyntaxError) {
                    await this.clearLocked();
                    return null;
                }
                throw new TokenStoreError(`Failed to load tokens: ${String(error)}`);
            }
        });
    }
    async save(tokens) {
        await this.withLock(async () => {
            const record = {
                ...tokens,
                updatedAt: Date.now(),
            };
            await this.writeFileAtomically(JSON.stringify(record, null, 2));
        });
    }
    async clear() {
        await this.withLock(async () => {
            await this.clearLocked();
        });
    }
    shouldGarbageCollect(tokens) {
        const cutoff = Date.now() - 60 * 60 * 1000;
        return (typeof tokens.adminExpiresAt === "number" &&
            typeof tokens.coreExpiresAt === "number" &&
            tokens.adminExpiresAt < cutoff &&
            tokens.coreExpiresAt < cutoff);
    }
    async clearLocked() {
        try {
            await this.writeFileAtomically("");
        }
        catch (error) {
            throw new TokenStoreError(`Failed to clear tokens: ${String(error)}`);
        }
    }
    async writeFileAtomically(content) {
        await mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
        const tmpPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        try {
            await writeFile(tmpPath, content, { mode: 0o600 });
            await rename(tmpPath, this.path);
        }
        catch (error) {
            await rm(tmpPath, { force: true });
            throw new TokenStoreError(`Failed to save tokens: ${String(error)}`);
        }
    }
    async withLock(work) {
        await mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
        const release = await this.acquireLock();
        try {
            return await work();
        }
        finally {
            await release();
        }
    }
    async acquireLock() {
        const startedAt = Date.now();
        while (true) {
            try {
                const handle = await open(this.lockPath, "wx", 0o600);
                return async () => {
                    await handle.close();
                    await rm(this.lockPath, { force: true });
                };
            }
            catch (error) {
                if (!this.isAlreadyExists(error)) {
                    throw new TokenStoreError(`Failed to acquire token lock: ${String(error)}`);
                }
                if (Date.now() - startedAt > 5_000) {
                    try {
                        const info = await stat(this.lockPath);
                        if (Date.now() - info.mtimeMs > 5_000) {
                            await rm(this.lockPath, { force: true });
                            continue;
                        }
                    }
                    catch (statError) {
                        if (!this.isMissingFile(statError)) {
                            throw new TokenStoreError(`Failed to inspect token lock: ${String(statError)}`);
                        }
                    }
                }
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        }
    }
    isAlreadyExists(error) {
        return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
    }
    isMissingFile(error) {
        return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
    }
}
export { DEFAULT_TOKENS_PATH };
