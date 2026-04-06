import { z } from "zod";
interface ConnectorTool {
    name: string;
    description: string;
    parameters: z.ZodObject<z.ZodRawShape>;
    execute(params: unknown): Promise<unknown>;
}
interface ResolvedConnectorConfig {
    global: Record<string, unknown>;
    agent: Record<string, unknown>;
    merged: Record<string, unknown>;
}
interface ConnectorDefinition {
    id: string;
    displayName: string;
    description: string;
    systemPrompt?: string;
    configSchema: z.ZodTypeAny;
    agentConfigSchema?: z.ZodTypeAny;
    requiredSecrets: string[];
    createTools(config: ResolvedConnectorConfig): ConnectorTool[];
}
export declare const CloudifiAdminConfigSchema: z.ZodObject<{
    username: z.ZodString;
    password: z.ZodString;
    adminApiBase: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    coreApiBase: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    tokenSkewSeconds: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    coreMinTtlSeconds: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    adminMaxAgeSeconds: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    username: string;
    password: string;
    adminApiBase: string;
    coreApiBase: string;
    tokenSkewSeconds: number;
    coreMinTtlSeconds: number;
    adminMaxAgeSeconds: number;
}, {
    username: string;
    password: string;
    adminApiBase?: string | undefined;
    coreApiBase?: string | undefined;
    tokenSkewSeconds?: number | undefined;
    coreMinTtlSeconds?: number | undefined;
    adminMaxAgeSeconds?: number | undefined;
}>;
declare const connector: ConnectorDefinition;
export default connector;
