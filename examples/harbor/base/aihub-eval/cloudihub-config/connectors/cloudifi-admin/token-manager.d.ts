import { StoredTokens, TokenStore } from "./token-store.js";
export interface TokenManagerOptions {
    username: string;
    password: string;
    adminApiBase?: string;
    coreApiBase?: string;
    tokenSkewSeconds?: number;
    coreMinTtlSeconds?: number;
    adminMaxAgeSeconds?: number;
    tokenStore?: TokenStore;
    store?: TokenStore;
}
export declare class TokenManager {
    readonly store: TokenStore;
    readonly username: string;
    readonly password: string;
    readonly adminApiBase: string;
    readonly coreApiBase: string;
    readonly tokenSkewMs: number;
    readonly coreMinTtlMs: number;
    readonly adminMaxAgeMs: number;
    constructor(options: TokenManagerOptions);
    getCoreToken(): Promise<string>;
    forceReauth(): Promise<void>;
    isAdminTokenValid(tokens: StoredTokens, now?: number): boolean;
    isCoreTokenValid(tokens: StoredTokens, now?: number): boolean;
    private _authAdmin;
    private _refreshCore;
    private decodeJwtExpiry;
    private getStatus;
    _isAdminTokenValid(tokens: StoredTokens, now?: number): boolean;
    _isCoreTokenValid(tokens: StoredTokens, now?: number): boolean;
}
