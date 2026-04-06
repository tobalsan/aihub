import { Company, CompanyQuota } from "./models.js";
import { TokenManager } from "./token-manager.js";
export interface CloudifiAdminClientOptions {
    tokenManager?: TokenManager;
    username?: string;
    password?: string;
    adminApiBase?: string;
    coreApiBase?: string;
    tokenSkewSeconds?: number;
    coreMinTtlSeconds?: number;
    adminMaxAgeSeconds?: number;
}
type CompanySummary = Pick<Company, "id" | "name" | "billingDate" | "maxUsers" | "maxLocations"> & {
    country: string | null;
};
export declare class CloudifiAdminClient {
    readonly tokenManager: TokenManager;
    private readonly adminApiBase;
    private readonly coreApiBase;
    constructor(options: CloudifiAdminClientOptions);
    listCompanies(extraFields?: boolean): Promise<{
        total: number;
        companies: Array<Company | CompanySummary>;
    }>;
    getCompanyDetails(companyIds: string[], extraFields?: boolean): Promise<{
        companies: Array<Company | CompanySummary>;
        missingIds: string[];
    }>;
    getQuotaUsage(startDate: string, endDate: string): Promise<{
        report: Record<string, CompanyQuota>;
    }>;
    validate(): Promise<{
        ok: boolean;
        message: string;
        error?: string;
    }>;
    private fetchCompanies;
    private fetchWithAdminAuth;
    private fetchWithCoreAuth;
    private fetchWithRetry;
}
export {};
