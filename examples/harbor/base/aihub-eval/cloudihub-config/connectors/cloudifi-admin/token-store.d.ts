export interface StoredTokens {
    adminToken: string | null;
    adminExpiresAt: number | null;
    coreToken: string | null;
    coreExpiresAt: number | null;
    updatedAt: number;
}
declare const DEFAULT_TOKENS_PATH: string;
export declare class TokenStore {
    readonly path: string;
    readonly lockPath: string;
    constructor(pathname?: string);
    load(): Promise<StoredTokens | null>;
    save(tokens: Omit<StoredTokens, "updatedAt"> | StoredTokens): Promise<void>;
    clear(): Promise<void>;
    private shouldGarbageCollect;
    private clearLocked;
    private writeFileAtomically;
    private withLock;
    private acquireLock;
    private isAlreadyExists;
    private isMissingFile;
}
export { DEFAULT_TOKENS_PATH };
