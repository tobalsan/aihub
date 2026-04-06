export declare class CloudifiAdminError extends Error {
    endpoint?: string;
    status?: number;
    correlationId?: string;
    constructor(message: string, options?: {
        endpoint?: string;
        status?: number;
        correlationId?: string;
    });
}
export declare class AdminAuthError extends CloudifiAdminError {
}
export declare class CoreRefreshError extends CloudifiAdminError {
}
export declare class TokenStoreError extends CloudifiAdminError {
}
