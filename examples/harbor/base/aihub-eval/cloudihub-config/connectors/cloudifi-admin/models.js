import { z } from "zod";
export const SPECIAL_FLAGS_MASK = 18624;
export const AuthResponseSchema = z.object({
    token: z.string(),
});
export const CoreRefreshResponseSchema = z.object({
    tokenid: z.string(),
    ttl: z.number().optional().default(3600),
    msg: z.string().optional(),
    msgCode: z.string().optional(),
    msg_code: z.string().optional(),
});
const CountrySchema = z
    .object({
    id: z.number().optional(),
    name: z.string().optional(),
    code: z.string().optional(),
    continent: z.string().optional(),
})
    .passthrough();
const TemplateSchema = z
    .object({
    id: z.number().optional(),
    name: z.string().optional(),
    hash: z.string().optional(),
    companyId: z.number().optional(),
})
    .passthrough();
const CountryFieldSchema = z.union([CountrySchema, z.string()]).optional().nullable();
export const CompanySchema = z
    .object({
    id: z.number(),
    name: z.string(),
    hash: z.string().optional().nullable(),
    domainsPattern: z.string().optional().nullable(),
    sponsorsDomainsPattern: z.string().optional().nullable(),
    serviceStartDate: z.string().optional().nullable(),
    serviceEndDate: z.string().optional().nullable(),
    billingDate: z.string().optional().nullable(),
    createdAt: z.string().optional().nullable(),
    updatedAt: z.string().optional().nullable(),
    deletedAt: z.string().optional().nullable(),
    contact: z.string().optional().nullable(),
    contacts: z.array(z.string()).optional().nullable(),
    logo: z.string().optional().nullable(),
    redirectionUrl: z.string().optional().nullable(),
    guestText: z.string().optional().nullable(),
    cookieDuration: z.number().optional().nullable(),
    maxUsers: z.number().optional().nullable(),
    maxDevices: z.number().optional().nullable(),
    maxValidity: z.number().optional().nullable(),
    maxSeen: z.number().optional().nullable(),
    maxLocations: z.number().optional().nullable(),
    maxAppointedUsers: z.number().optional().nullable(),
    options: z.number().optional().nullable(),
    exceedPercent: z.number().optional().nullable(),
    passphrase: z.string().optional().nullable(),
    logtime: z.union([z.number(), z.string()]).optional().nullable(),
    country: CountryFieldSchema,
    template: TemplateSchema.optional().nullable(),
    domains: z.array(z.string()).optional().nullable(),
    sponsorsDomains: z.array(z.string()).optional().nullable(),
    companyId: z.union([z.string(), z.number()]).optional().nullable(),
    address: z.string().optional().nullable(),
})
    .passthrough();
export const CompaniesResponseSchema = z.object({
    "hydra:member": z.array(CompanySchema),
    "hydra:totalItems": z.number(),
});
export const CompanyQuotaSchema = z.object({
    maxGuest: z.number().nullable().optional().default(null),
    maxLocations: z.number().nullable().optional().default(null),
});
export const QuotaReportResponseSchema = z.object({
    report: z.record(z.string(), CompanyQuotaSchema),
});
