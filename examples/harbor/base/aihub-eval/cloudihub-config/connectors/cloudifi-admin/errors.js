export class CloudifiAdminError extends Error {
    endpoint;
    status;
    correlationId;
    constructor(message, options = {}) {
        super(message);
        this.name = new.target.name;
        this.endpoint = options.endpoint;
        this.status = options.status;
        this.correlationId = options.correlationId;
    }
}
export class AdminAuthError extends CloudifiAdminError {
}
export class CoreRefreshError extends CloudifiAdminError {
}
export class TokenStoreError extends CloudifiAdminError {
}
