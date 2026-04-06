import { AdminAuthError, CoreRefreshError } from "./errors.js";
import { AuthResponseSchema, CoreRefreshResponseSchema } from "./models.js";
import { TokenStore } from "./token-store.js";
export class TokenManager {
    store;
    username;
    password;
    adminApiBase;
    coreApiBase;
    tokenSkewMs;
    coreMinTtlMs;
    adminMaxAgeMs;
    constructor(options) {
        this.store = options.tokenStore ?? options.store ?? new TokenStore();
        this.username = options.username;
        this.password = options.password;
        this.adminApiBase = options.adminApiBase ?? "https://admin-api-v1.cloudi-fi.net";
        this.coreApiBase = options.coreApiBase ?? "https://admin.cloudi-fi.net";
        this.tokenSkewMs = (options.tokenSkewSeconds ?? 60) * 1000;
        this.coreMinTtlMs = (options.coreMinTtlSeconds ?? 300) * 1000;
        this.adminMaxAgeMs = (options.adminMaxAgeSeconds ?? 1800) * 1000;
    }
    async getCoreToken() {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
                const tokens = await this.store.load();
                if (tokens) {
                    const adminValid = this._isAdminTokenValid(tokens);
                    const coreValid = this._isCoreTokenValid(tokens);
                    if (adminValid && coreValid && tokens.coreToken) {
                        return tokens.coreToken;
                    }
                    if (adminValid && tokens.adminToken) {
                        return await this._refreshCore(tokens.adminToken, tokens.adminExpiresAt);
                    }
                }
                const admin = await this._authAdmin();
                return await this._refreshCore(admin.token, admin.expiresAt);
            }
            catch (error) {
                const status = this.getStatus(error);
                if (attempt < 2 && (status === 401 || status === 403)) {
                    await this.forceReauth();
                    continue;
                }
                throw error;
            }
        }
        throw new AdminAuthError("Authentication failed after max attempts");
    }
    async forceReauth() {
        await this.store.clear();
    }
    isAdminTokenValid(tokens, now = Date.now()) {
        if (!tokens.adminToken) {
            return false;
        }
        const jwtExpMs = this.decodeJwtExpiry(tokens.adminToken);
        if (typeof jwtExpMs === "number") {
            return now < jwtExpMs - this.tokenSkewMs;
        }
        if (typeof tokens.adminExpiresAt === "number") {
            return now < tokens.adminExpiresAt - this.tokenSkewMs;
        }
        return now < tokens.updatedAt + this.adminMaxAgeMs;
    }
    isCoreTokenValid(tokens, now = Date.now()) {
        if (!tokens.coreToken || typeof tokens.coreExpiresAt !== "number") {
            return false;
        }
        const remainingMs = tokens.coreExpiresAt - now - this.tokenSkewMs;
        return remainingMs >= this.coreMinTtlMs;
    }
    async _authAdmin() {
        const endpoint = `${this.adminApiBase}/auth/json`;
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: this.username,
                password: this.password,
            }),
        });
        if (!response.ok) {
            throw new AdminAuthError(`Admin authentication failed: ${response.status}`, {
                endpoint,
                status: response.status,
                correlationId: response.headers.get("x-correlation-id") ?? undefined,
            });
        }
        const body = AuthResponseSchema.parse(await response.json());
        return {
            token: body.token,
            expiresAt: this.decodeJwtExpiry(body.token) ?? null,
        };
    }
    async _refreshCore(adminToken, adminExpiresAt = null) {
        const endpoint = `${this.coreApiBase}/api/2/login/refresh`;
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${adminToken}`,
                "Content-Type": "application/json",
            },
        });
        if (!response.ok) {
            throw new CoreRefreshError(`Core token refresh failed: ${response.status}`, {
                endpoint,
                status: response.status,
                correlationId: response.headers.get("x-correlation-id") ?? undefined,
            });
        }
        const body = CoreRefreshResponseSchema.parse(await response.json());
        const ttlSeconds = body.ttl ?? 3600;
        const now = Date.now();
        await this.store.save({
            adminToken,
            adminExpiresAt: adminExpiresAt ?? null,
            coreToken: body.tokenid,
            coreExpiresAt: now + ttlSeconds * 1000,
        });
        return body.tokenid;
    }
    decodeJwtExpiry(token) {
        const parts = token.split(".");
        if (parts.length < 2) {
            return undefined;
        }
        try {
            const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
            const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
            const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
            if (typeof payload.exp !== "number") {
                return undefined;
            }
            return payload.exp * 1000;
        }
        catch {
            return undefined;
        }
    }
    getStatus(error) {
        if (error instanceof AdminAuthError || error instanceof CoreRefreshError) {
            return error.status;
        }
        return undefined;
    }
    _isAdminTokenValid(tokens, now = Date.now()) {
        return this.isAdminTokenValid(tokens, now);
    }
    _isCoreTokenValid(tokens, now = Date.now()) {
        return this.isCoreTokenValid(tokens, now);
    }
}
