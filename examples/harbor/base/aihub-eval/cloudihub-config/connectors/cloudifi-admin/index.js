import { z } from "zod";
import { CloudifiAdminClient } from "./client.js";
import { TokenManager } from "./token-manager.js";
export const CloudifiAdminConfigSchema = z.object({
    username: z.string(),
    password: z.string(),
    adminApiBase: z.string().optional().default("https://admin-api-v1.cloudi-fi.net"),
    coreApiBase: z.string().optional().default("https://admin.cloudi-fi.net"),
    tokenSkewSeconds: z.number().optional().default(60),
    coreMinTtlSeconds: z.number().optional().default(300),
    adminMaxAgeSeconds: z.number().optional().default(1800),
});
const ListCompaniesParamsSchema = z.object({
    extraFields: z.boolean().optional().default(false),
});
const GetCompanyDetailsParamsSchema = z.object({
    companyIds: z.array(z.string()),
    extraFields: z.boolean().optional().default(false),
});
const GetQuotaUsageParamsSchema = z.object({
    startDate: z.string(),
    endDate: z.string(),
});
const EmptyParamsSchema = z.object({});
const connector = {
    id: "cloudifi_admin",
    displayName: "Cloudi-Fi Admin",
    description: "Cloudi-Fi admin connector for company listings, company details, and quota usage.",
    systemPrompt: `# Cloudi-Fi Admin Connector

Use this connector for Cloudi-Fi admin operations that manage customer WiFi companies.
Authentication is handled automatically — do not ask the user to perform auth steps.

## Tools

- **list_companies** — list active customer companies with billing data. Use extraFields=true for the complete record.
- **get_company_details** — fetch details for specific companies by ID. Pass a companyIds array.
- **get_quota_usage** — fetch quota usage for all companies in a date range (YYYY-MM-DD).
- **validate** — test connectivity and credentials.

## Key Concepts

- Companies = customer accounts in Cloudi-Fi admin
- Quotas = usage limits and consumption
- Billing dates = billing cycle reference for a company

## Common Workflow

To check a customer's usage: list_companies to find the company ID, then get_quota_usage with a date range.`,
    configSchema: CloudifiAdminConfigSchema,
    requiredSecrets: ["username", "password"],
    createTools(config) {
        const parsedConfig = CloudifiAdminConfigSchema.parse(config.merged);
        const tokenManager = new TokenManager(parsedConfig);
        const client = new CloudifiAdminClient({
            tokenManager,
            adminApiBase: parsedConfig.adminApiBase,
            coreApiBase: parsedConfig.coreApiBase,
        });
        return [
            {
                name: "list_companies",
                description: "List active customer companies with billing data.",
                parameters: ListCompaniesParamsSchema,
                async execute(params) {
                    const parsed = ListCompaniesParamsSchema.parse(params);
                    return await client.listCompanies(parsed.extraFields);
                },
            },
            {
                name: "get_company_details",
                description: "Get details for specific companies by company ID.",
                parameters: GetCompanyDetailsParamsSchema,
                async execute(params) {
                    const parsed = GetCompanyDetailsParamsSchema.parse(params);
                    return await client.getCompanyDetails(parsed.companyIds, parsed.extraFields);
                },
            },
            {
                name: "get_quota_usage",
                description: "Fetch quota usage for all companies within a date range.",
                parameters: GetQuotaUsageParamsSchema,
                async execute(params) {
                    const parsed = GetQuotaUsageParamsSchema.parse(params);
                    return await client.getQuotaUsage(parsed.startDate, parsed.endDate);
                },
            },
            {
                name: "validate",
                description: "Validate configuration and connectivity.",
                parameters: EmptyParamsSchema,
                async execute(params) {
                    EmptyParamsSchema.parse(params);
                    return await client.validate();
                },
            },
        ];
    },
};
export default connector;
