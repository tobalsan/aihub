import type {
  Extension,
  GatewayConfig,
  ValidationResult,
} from "@aihub/shared";
import { initializeConnectors } from "../connectors/index.js";
import { resolveConfigSecrets } from "./secrets.js";

function uniqueAgentIdValidation(config: GatewayConfig): ValidationResult {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const agent of config.agents) {
    if (seen.has(agent.id)) duplicates.add(agent.id);
    seen.add(agent.id);
  }

  return {
    valid: duplicates.size === 0,
    errors: Array.from(duplicates).map((id) => `Duplicate agent id "${id}"`),
  };
}

function validateComponentAgentReferences(
  config: GatewayConfig
): ValidationResult {
  const agentIds = new Set(config.agents.map((agent) => agent.id));
  const errors: string[] = [];
  const discord = config.extensions?.discord;

  for (const [channelId, route] of Object.entries(discord?.channels ?? {})) {
    if (!agentIds.has(route.agent)) {
      errors.push(
        `Component "discord" channel "${channelId}" references unknown agent "${route.agent}"`
      );
    }
  }

  if (discord?.dm?.agent && !agentIds.has(discord.dm.agent)) {
    errors.push(
      `Component "discord" dm references unknown agent "${discord.dm.agent}"`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function getComponentConfig(
  config: GatewayConfig,
  extension: Extension
): unknown {
  // multiUser lives at config.extensions.multiUser
  if (extension.id === "multiUser") {
    return config.extensions?.multiUser;
  }
  return config.extensions?.[
    extension.id as keyof NonNullable<GatewayConfig["extensions"]>
  ];
}

function validateComponentConfigs(
  config: GatewayConfig,
  extensions: Extension[]
): ValidationResult {
  const errors: string[] = [];

  for (const extension of extensions) {
    const rawConfig = getComponentConfig(config, extension);
    const result = extension.validateConfig(rawConfig);
    if (!result.valid) {
      for (const error of result.errors) {
        errors.push(`Component "${extension.id}" config invalid: ${error}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function validateStartupConfig(
  config: GatewayConfig,
  extensions: Extension[]
): Promise<{ loaded: string[]; skipped: string[] }> {
  const prepared = await prepareStartupConfig(config, extensions);
  return prepared.summary;
}

export async function prepareStartupConfig(
  config: GatewayConfig,
  extensions: Extension[],
  options?: {
    resolvedConfig?: GatewayConfig;
    skipConnectorInitialization?: boolean;
  }
): Promise<{
  resolvedConfig: GatewayConfig;
  summary: { loaded: string[]; skipped: string[] };
}> {
  const resolvedConfig =
    options?.resolvedConfig ??
    (await resolveConfigSecrets(config));

  if (!options?.skipConnectorInitialization) {
    await initializeConnectors(resolvedConfig);
  }

  const checks = [
    uniqueAgentIdValidation(resolvedConfig),
    validateComponentConfigs(resolvedConfig, extensions),
    validateComponentAgentReferences(resolvedConfig),
  ];

  const errors = checks.flatMap((check) => check.errors);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const loaded = extensions.map((extension) => extension.id);
  const skipped = Object.keys(resolvedConfig.extensions ?? {}).filter(
    (id) => !loaded.includes(id)
  );

  return {
    resolvedConfig,
    summary: { loaded, skipped },
  };
}

export async function resolveStartupConfig(
  config: GatewayConfig
): Promise<GatewayConfig> {
  return resolveConfigSecrets(config);
}

export function logComponentSummary(summary: {
  loaded: string[];
  skipped: string[];
}): void {
  console.log(
    `[components] loaded: ${summary.loaded.length > 0 ? summary.loaded.join(", ") : "none"}`
  );
  console.log(
    `[components] skipped: ${summary.skipped.length > 0 ? summary.skipped.join(", ") : "none"}`
  );
}
