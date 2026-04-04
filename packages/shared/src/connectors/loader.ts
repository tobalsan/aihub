import type { ConnectorTool, ResolvedConnectorConfig } from "./types.js";
import { getConnector } from "./registry.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toConfigRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function resolveEnvRefs(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("$env:")) {
    const envName = value.slice("$env:".length);
    const envValue = process.env[envName];
    if (envValue === undefined) {
      throw new Error(`Env var "${envName}" not set (referenced in connector config)`);
    }
    return envValue;
  }
  if (Array.isArray(value)) {
    return value.map(resolveEnvRefs);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveEnvRefs(v)])
    );
  }
  return value;
}

export function resolveConnectorConfig(
  connectorId: string,
  globalConfig: Record<string, unknown>,
  agentConfig: Record<string, unknown>
): ResolvedConnectorConfig {
  void connectorId;
  const resolvedGlobal = resolveEnvRefs({ ...globalConfig }) as Record<string, unknown>;
  const resolvedAgent = resolveEnvRefs({ ...agentConfig }) as Record<string, unknown>;

  return {
    global: resolvedGlobal,
    agent: resolvedAgent,
    merged: {
      ...resolvedGlobal,
      ...resolvedAgent,
    },
  };
}

export function loadConnectorTools(
  connectorId: string,
  globalConnectorsConfig: Record<string, unknown>,
  agentConnectorsConfig: Record<string, unknown>
): ConnectorTool[] {
  const connector = getConnector(connectorId);
  if (!connector) {
    return [];
  }

  const agentEntry = toConfigRecord(agentConnectorsConfig[connectorId]);
  if (agentEntry.enabled === false || !agentConnectorsConfig[connectorId]) {
    return [];
  }

  const { enabled: _enabled, ...agentConfig } = agentEntry;
  void _enabled;

  const globalConfig = toConfigRecord(globalConnectorsConfig[connectorId]);
  if (connector.agentConfigSchema) {
    connector.agentConfigSchema.parse(agentConfig);
  }

  const resolvedConfig = resolveConnectorConfig(
    connectorId,
    globalConfig,
    agentConfig
  );
  connector.configSchema.parse(resolvedConfig.merged);

  return connector.createTools(resolvedConfig).map((tool) => ({
    ...tool,
    name: tool.name.startsWith(`${connectorId}.`)
      ? tool.name
      : `${connectorId}.${tool.name}`,
  }));
}
