import type {
  Component,
  GatewayConfig,
  ValidationResult,
} from "@aihub/shared";
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
  const discord = config.components?.discord;

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

function validateComponentConfigs(
  config: GatewayConfig,
  components: Component[]
): ValidationResult {
  const errors: string[] = [];

  for (const component of components) {
    const rawConfig = config.components?.[
      component.id as keyof NonNullable<GatewayConfig["components"]>
    ];
    const result = component.validateConfig(rawConfig);
    if (!result.valid) {
      for (const error of result.errors) {
        errors.push(`Component "${component.id}" config invalid: ${error}`);
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
  components: Component[]
): Promise<{ loaded: string[]; skipped: string[] }> {
  const prepared = await prepareStartupConfig(config, components);
  return prepared.summary;
}

export async function prepareStartupConfig(
  config: GatewayConfig,
  components: Component[]
): Promise<{
  resolvedConfig: GatewayConfig;
  summary: { loaded: string[]; skipped: string[] };
}> {
  const resolvedConfig = await resolveConfigSecrets(config, config.secrets);

  const checks = [
    uniqueAgentIdValidation(resolvedConfig),
    { valid: true, errors: [] },
    validateComponentConfigs(resolvedConfig, components),
    validateComponentAgentReferences(resolvedConfig),
  ];

  const errors = checks.flatMap((check) => check.errors);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  const loaded = components.map((component) => component.id);
  const skipped = Object.keys(resolvedConfig.components ?? {}).filter(
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
  return resolveConfigSecrets(config, config.secrets);
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
