import { z } from "zod";
export declare const SPECIAL_FLAGS_MASK = 18624;
export declare const AuthResponseSchema: z.ZodObject<{
    token: z.ZodString;
}, "strip", z.ZodTypeAny, {
    token: string;
}, {
    token: string;
}>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export declare const CoreRefreshResponseSchema: z.ZodObject<{
    tokenid: z.ZodString;
    ttl: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    msg: z.ZodOptional<z.ZodString>;
    msgCode: z.ZodOptional<z.ZodString>;
    msg_code: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tokenid: string;
    ttl: number;
    msg?: string | undefined;
    msgCode?: string | undefined;
    msg_code?: string | undefined;
}, {
    tokenid: string;
    ttl?: number | undefined;
    msg?: string | undefined;
    msgCode?: string | undefined;
    msg_code?: string | undefined;
}>;
export type CoreRefreshResponse = z.infer<typeof CoreRefreshResponseSchema>;
export declare const CompanySchema: z.ZodObject<{
    id: z.ZodNumber;
    name: z.ZodString;
    hash: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    domainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    sponsorsDomainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    serviceStartDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    serviceEndDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    billingDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    createdAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    updatedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    deletedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contact: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contacts: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    logo: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    redirectionUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    guestText: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    cookieDuration: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxDevices: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxValidity: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxSeen: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxLocations: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxAppointedUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    options: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    exceedPercent: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    passphrase: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    logtime: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
    country: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        code: z.ZodOptional<z.ZodString>;
        continent: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        code: z.ZodOptional<z.ZodString>;
        continent: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        code: z.ZodOptional<z.ZodString>;
        continent: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, z.ZodString]>>>;
    template: z.ZodNullable<z.ZodOptional<z.ZodObject<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        hash: z.ZodOptional<z.ZodString>;
        companyId: z.ZodOptional<z.ZodNumber>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        hash: z.ZodOptional<z.ZodString>;
        companyId: z.ZodOptional<z.ZodNumber>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        hash: z.ZodOptional<z.ZodString>;
        companyId: z.ZodOptional<z.ZodNumber>;
    }, z.ZodTypeAny, "passthrough">>>>;
    domains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    sponsorsDomains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    companyId: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    address: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    id: z.ZodNumber;
    name: z.ZodString;
    hash: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    domainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    sponsorsDomainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    serviceStartDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    serviceEndDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    billingDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    createdAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    updatedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    deletedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contact: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contacts: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    logo: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    redirectionUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    guestText: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    cookieDuration: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxDevices: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxValidity: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxSeen: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxLocations: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxAppointedUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    options: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    exceedPercent: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    passphrase: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    logtime: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
    country: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        code: z.ZodOptional<z.ZodString>;
        continent: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        code: z.ZodOptional<z.ZodString>;
        continent: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        code: z.ZodOptional<z.ZodString>;
        continent: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, z.ZodString]>>>;
    template: z.ZodNullable<z.ZodOptional<z.ZodObject<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        hash: z.ZodOptional<z.ZodString>;
        companyId: z.ZodOptional<z.ZodNumber>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        hash: z.ZodOptional<z.ZodString>;
        companyId: z.ZodOptional<z.ZodNumber>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        hash: z.ZodOptional<z.ZodString>;
        companyId: z.ZodOptional<z.ZodNumber>;
    }, z.ZodTypeAny, "passthrough">>>>;
    domains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    sponsorsDomains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    companyId: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    address: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    id: z.ZodNumber;
    name: z.ZodString;
    hash: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    domainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    sponsorsDomainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    serviceStartDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    serviceEndDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    billingDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    createdAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    updatedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    deletedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contact: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    contacts: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    logo: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    redirectionUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    guestText: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    cookieDuration: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxDevices: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxValidity: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxSeen: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxLocations: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    maxAppointedUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    options: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    exceedPercent: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    passphrase: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    logtime: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
    country: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        code: z.ZodOptional<z.ZodString>;
        continent: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        code: z.ZodOptional<z.ZodString>;
        continent: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        code: z.ZodOptional<z.ZodString>;
        continent: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, z.ZodString]>>>;
    template: z.ZodNullable<z.ZodOptional<z.ZodObject<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        hash: z.ZodOptional<z.ZodString>;
        companyId: z.ZodOptional<z.ZodNumber>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        hash: z.ZodOptional<z.ZodString>;
        companyId: z.ZodOptional<z.ZodNumber>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodOptional<z.ZodNumber>;
        name: z.ZodOptional<z.ZodString>;
        hash: z.ZodOptional<z.ZodString>;
        companyId: z.ZodOptional<z.ZodNumber>;
    }, z.ZodTypeAny, "passthrough">>>>;
    domains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    sponsorsDomains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    companyId: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    address: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export type Company = z.infer<typeof CompanySchema>;
export declare const CompaniesResponseSchema: z.ZodObject<{
    "hydra:member": z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        name: z.ZodString;
        hash: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        domainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        sponsorsDomainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        serviceStartDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        serviceEndDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        billingDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        createdAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        updatedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        deletedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        contact: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        contacts: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        logo: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        redirectionUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        guestText: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        cookieDuration: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxDevices: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxValidity: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxSeen: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxLocations: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxAppointedUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        options: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        exceedPercent: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        passphrase: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        logtime: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        country: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodObject<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, z.ZodString]>>>;
        template: z.ZodNullable<z.ZodOptional<z.ZodObject<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, z.ZodTypeAny, "passthrough">>>>;
        domains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        sponsorsDomains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        companyId: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        address: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodNumber;
        name: z.ZodString;
        hash: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        domainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        sponsorsDomainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        serviceStartDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        serviceEndDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        billingDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        createdAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        updatedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        deletedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        contact: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        contacts: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        logo: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        redirectionUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        guestText: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        cookieDuration: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxDevices: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxValidity: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxSeen: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxLocations: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxAppointedUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        options: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        exceedPercent: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        passphrase: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        logtime: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        country: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodObject<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, z.ZodString]>>>;
        template: z.ZodNullable<z.ZodOptional<z.ZodObject<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, z.ZodTypeAny, "passthrough">>>>;
        domains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        sponsorsDomains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        companyId: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        address: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodNumber;
        name: z.ZodString;
        hash: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        domainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        sponsorsDomainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        serviceStartDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        serviceEndDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        billingDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        createdAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        updatedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        deletedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        contact: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        contacts: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        logo: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        redirectionUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        guestText: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        cookieDuration: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxDevices: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxValidity: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxSeen: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxLocations: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxAppointedUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        options: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        exceedPercent: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        passphrase: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        logtime: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        country: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodObject<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, z.ZodString]>>>;
        template: z.ZodNullable<z.ZodOptional<z.ZodObject<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, z.ZodTypeAny, "passthrough">>>>;
        domains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        sponsorsDomains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        companyId: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        address: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    "hydra:totalItems": z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    "hydra:member": z.objectOutputType<{
        id: z.ZodNumber;
        name: z.ZodString;
        hash: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        domainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        sponsorsDomainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        serviceStartDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        serviceEndDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        billingDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        createdAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        updatedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        deletedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        contact: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        contacts: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        logo: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        redirectionUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        guestText: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        cookieDuration: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxDevices: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxValidity: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxSeen: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxLocations: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxAppointedUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        options: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        exceedPercent: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        passphrase: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        logtime: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        country: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodObject<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, z.ZodString]>>>;
        template: z.ZodNullable<z.ZodOptional<z.ZodObject<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, z.ZodTypeAny, "passthrough">>>>;
        domains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        sponsorsDomains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        companyId: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        address: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">[];
    "hydra:totalItems": number;
}, {
    "hydra:member": z.objectInputType<{
        id: z.ZodNumber;
        name: z.ZodString;
        hash: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        domainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        sponsorsDomainsPattern: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        serviceStartDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        serviceEndDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        billingDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        createdAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        updatedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        deletedAt: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        contact: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        contacts: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        logo: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        redirectionUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        guestText: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        cookieDuration: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxDevices: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxValidity: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxSeen: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxLocations: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        maxAppointedUsers: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        options: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        exceedPercent: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        passphrase: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        logtime: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodNumber, z.ZodString]>>>;
        country: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodObject<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            code: z.ZodOptional<z.ZodString>;
            continent: z.ZodOptional<z.ZodString>;
        }, z.ZodTypeAny, "passthrough">>, z.ZodString]>>>;
        template: z.ZodNullable<z.ZodOptional<z.ZodObject<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodOptional<z.ZodNumber>;
            name: z.ZodOptional<z.ZodString>;
            hash: z.ZodOptional<z.ZodString>;
            companyId: z.ZodOptional<z.ZodNumber>;
        }, z.ZodTypeAny, "passthrough">>>>;
        domains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        sponsorsDomains: z.ZodNullable<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        companyId: z.ZodNullable<z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        address: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">[];
    "hydra:totalItems": number;
}>;
export type CompaniesResponse = z.infer<typeof CompaniesResponseSchema>;
export declare const CompanyQuotaSchema: z.ZodObject<{
    maxGuest: z.ZodDefault<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
    maxLocations: z.ZodDefault<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
}, "strip", z.ZodTypeAny, {
    maxLocations: number | null;
    maxGuest: number | null;
}, {
    maxLocations?: number | null | undefined;
    maxGuest?: number | null | undefined;
}>;
export type CompanyQuota = z.infer<typeof CompanyQuotaSchema>;
export declare const QuotaReportResponseSchema: z.ZodObject<{
    report: z.ZodRecord<z.ZodString, z.ZodObject<{
        maxGuest: z.ZodDefault<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
        maxLocations: z.ZodDefault<z.ZodOptional<z.ZodNullable<z.ZodNumber>>>;
    }, "strip", z.ZodTypeAny, {
        maxLocations: number | null;
        maxGuest: number | null;
    }, {
        maxLocations?: number | null | undefined;
        maxGuest?: number | null | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    report: Record<string, {
        maxLocations: number | null;
        maxGuest: number | null;
    }>;
}, {
    report: Record<string, {
        maxLocations?: number | null | undefined;
        maxGuest?: number | null | undefined;
    }>;
}>;
export type QuotaReportResponse = z.infer<typeof QuotaReportResponseSchema>;
