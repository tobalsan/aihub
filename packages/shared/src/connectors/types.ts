import { z } from "zod";

export interface ResolvedConnectorConfig {
  global: Record<string, unknown>;
  agent: Record<string, unknown>;
  merged: Record<string, unknown>;
}

export interface ConnectorTool {
  name: string;
  description: string;
  parameters: z.AnyZodObject;
  execute(params: unknown): Promise<unknown>;
}

export interface ConnectorDefinition {
  id: string;
  displayName: string;
  description: string;
  systemPrompt?: string;
  configSchema: z.ZodTypeAny;
  agentConfigSchema?: z.ZodTypeAny;
  requiredSecrets: string[];
  createTools(config: ResolvedConnectorConfig): ConnectorTool[];
}

const isZodSchema = (value: unknown): value is z.ZodTypeAny =>
  typeof value === "object" &&
  value !== null &&
  "safeParse" in value &&
  typeof value.safeParse === "function";

const isZodObjectSchema = (value: unknown): value is z.AnyZodObject =>
  isZodSchema(value) &&
  typeof (value as { _def?: { typeName?: string } })._def?.typeName ===
    "string" &&
  (value as { _def: { typeName: string } })._def.typeName === "ZodObject";

export const ZodSchemaSchema = z.custom<z.ZodTypeAny>(isZodSchema, {
  message: "Expected Zod schema",
});

export const ZodObjectSchemaSchema = z.custom<z.AnyZodObject>(
  isZodObjectSchema,
  {
    message: "Expected Zod object schema",
  }
);

export const ResolvedConnectorConfigSchema = z.object({
  global: z.record(z.string(), z.unknown()),
  agent: z.record(z.string(), z.unknown()),
  merged: z.record(z.string(), z.unknown()),
});

export const ConnectorToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: ZodObjectSchemaSchema,
  execute: z.function().args(z.unknown()).returns(z.promise(z.unknown())),
});

export const ConnectorDefinitionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  systemPrompt: z.string().optional(),
  configSchema: ZodSchemaSchema,
  agentConfigSchema: ZodSchemaSchema.optional(),
  requiredSecrets: z.array(z.string()),
  createTools: z
    .function()
    .args(ResolvedConnectorConfigSchema)
    .returns(z.array(ConnectorToolSchema)),
});
