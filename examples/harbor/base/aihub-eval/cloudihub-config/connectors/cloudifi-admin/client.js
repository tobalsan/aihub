import { AdminAuthError, CloudifiAdminError } from "./errors.js";
import { CompaniesResponseSchema, QuotaReportResponseSchema, SPECIAL_FLAGS_MASK, } from "./models.js";
import { TokenManager } from "./token-manager.js";
export class CloudifiAdminClient {
    tokenManager;
    adminApiBase;
    coreApiBase;
    constructor(options) {
        const adminApiBase = options.adminApiBase ?? "https://admin-api-v1.cloudi-fi.net";
        const coreApiBase = options.coreApiBase ?? "https://admin.cloudi-fi.net";
        this.tokenManager =
            options.tokenManager ??
                new TokenManager({
                    username: options.username ?? "",
                    password: options.password ?? "",
                    adminApiBase,
                    coreApiBase,
                    tokenSkewSeconds: options.tokenSkewSeconds ?? 60,
                    coreMinTtlSeconds: options.coreMinTtlSeconds ?? 300,
                    adminMaxAgeSeconds: options.adminMaxAgeSeconds ?? 1800,
                });
        this.adminApiBase = adminApiBase;
        this.coreApiBase = coreApiBase;
    }
    async listCompanies(extraFields = false) {
        const companies = await this.fetchCompanies();
        return {
            total: companies.length,
            companies: companies.map((company) => (extraFields ? company : summarizeCompany(company))),
        };
    }
    async getCompanyDetails(companyIds, extraFields = false) {
        const ids = new Set(companyIds);
        const companies = (await this.fetchCompanies()).filter((company) => ids.has(String(company.id)));
        const foundIds = new Set(companies.map((company) => String(company.id)));
        return {
            companies: companies.map((company) => (extraFields ? company : summarizeCompany(company))),
            missingIds: companyIds.filter((companyId) => !foundIds.has(companyId)),
        };
    }
    async getQuotaUsage(startDate, endDate) {
        const query = new URLSearchParams({
            dimensions: "company",
            "start-date": startDate,
            "end-date": endDate,
        });
        const response = await this.fetchWithCoreAuth(`${this.coreApiBase}/api/2/reports/subscriptions?${query.toString()}`);
        const payload = QuotaReportResponseSchema.parse(await response.json());
        return { report: payload.report };
    }
    async validate() {
        try {
            await this.tokenManager.getCoreToken();
            return {
                ok: true,
                message: "Configuration validated successfully",
            };
        }
        catch (error) {
            return {
                ok: false,
                message: "Configuration validation failed",
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    async fetchCompanies() {
        const response = await this.fetchWithAdminAuth(`${this.adminApiBase}/companies?disable_company_filter=true`);
        const payload = CompaniesResponseSchema.parse(await response.json());
        return payload["hydra:member"].filter((company) => company.deletedAt === null || company.deletedAt === undefined
            ? company.options === null || company.options === undefined || (company.options & SPECIAL_FLAGS_MASK) === 0
            : false);
    }
    async fetchWithAdminAuth(url) {
        return await this.fetchWithRetry(async () => {
            let token = (await this.tokenManager.store.load())?.adminToken;
            if (!token) {
                await this.tokenManager.getCoreToken();
                token = (await this.tokenManager.store.load())?.adminToken;
            }
            if (!token) {
                throw new AdminAuthError("Admin token unavailable after authentication");
            }
            return await fetch(url, {
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
            });
        });
    }
    async fetchWithCoreAuth(url) {
        return await this.fetchWithRetry(async () => {
            const token = await this.tokenManager.getCoreToken();
            return await fetch(url, {
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
            });
        });
    }
    async fetchWithRetry(request) {
        let response = await request();
        if (response.status === 401 || response.status === 403) {
            await this.tokenManager.forceReauth();
            response = await request();
        }
        if (!response.ok) {
            throw new CloudifiAdminError(`Request failed with status ${response.status}`, {
                status: response.status,
            });
        }
        return response;
    }
}
function summarizeCompany(company) {
    return {
        id: company.id,
        name: company.name,
        billingDate: company.billingDate ?? null,
        maxUsers: company.maxUsers ?? null,
        maxLocations: company.maxLocations ?? null,
        country: formatCountry(company.country),
    };
}
function formatCountry(country) {
    if (!country) {
        return null;
    }
    if (typeof country === "string") {
        return country;
    }
    return country.code ?? country.name ?? null;
}
