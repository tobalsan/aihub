import os from "node:os";
import path from "node:path";
import type { AgentConfig, GatewayConfig } from "@aihub/shared";
import {
  clearConnectors,
  discoverExternalConnectors,
  getConnector,
  loadConnectorTools,
  resolveConnectorConfig,
  type ConnectorTool,
} from "@aihub/shared";

const DEFAULT_CONNECTORS_PATH = path.join(os.homedir(), ".aihub", "connectors");

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveConnectorsPath(config: GatewayConfig): string {
  const configuredPath = config.connectors?.path;
  if (!configuredPath) {
    return DEFAULT_CONNECTORS_PATH;
  }
  if (configuredPath.startsWith("~")) {
    return path.join(os.homedir(), configuredPath.slice(1));
  }
  return path.resolve(configuredPath);
}

function registerBuiltInConnectors(): void {
  // Built-in connectors land in follow-up work.
}

export async function initializeConnectors(
  config: GatewayConfig
): Promise<void> {
  clearConnectors();
  registerBuiltInConnectors();
  await discoverExternalConnectors(resolveConnectorsPath(config));

  const validation = validateConfiguredConnectors(config);
  for (const warning of validation.warnings) {
    console.warn(`[connectors] ${warning}`);
  }
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.join("\n"));
  }
}

export function validateConfiguredConnectors(config: GatewayConfig): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const globalConnectorsConfig = toRecord(config.connectors);

  for (const agent of config.agents) {
    const agentConnectorsConfig = toRecord(agent.connectors);

    for (const [connectorId, rawAgentEntry] of Object.entries(
      agentConnectorsConfig
    )) {
      const agentEntry = toRecord(rawAgentEntry);
      if (agentEntry.enabled === false) {
        continue;
      }

      const connector = getConnector(connectorId);
      if (!connector) {
        warnings.push(
          `agent "${agent.id}" references unknown connector "${connectorId}"`
        );
        continue;
      }

      const { enabled: _enabled, ...agentConfig } = agentEntry;
      void _enabled;

      try {
        if (connector.agentConfigSchema) {
          connector.agentConfigSchema.parse(agentConfig);
        }

        const globalConfig = toRecord(globalConnectorsConfig[connectorId]);
        const resolvedConfig = resolveConnectorConfig(
          connectorId,
          globalConfig,
          agentConfig
        );

        connector.configSchema.parse(resolvedConfig.merged);

        for (const secretName of connector.requiredSecrets) {
          const value = resolvedConfig.merged[secretName];
          if (typeof value !== "string" || value.length === 0) {
            errors.push(
              `Connector "${connectorId}" for agent "${agent.id}" missing required secret "${secretName}"`
            );
          }
        }
      } catch (error) {
        errors.push(
          `Connector "${connectorId}" for agent "${agent.id}" config invalid: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  return { errors, warnings };
}

export function getConnectorToolsForAgent(
  agentConfig: AgentConfig,
  gatewayConfig: GatewayConfig
): ConnectorTool[] {
  const globalConnectorsConfig = toRecord(gatewayConfig.connectors);
  const agentConnectorsConfig = toRecord(agentConfig.connectors);

  return Object.entries(agentConnectorsConfig).flatMap(
    ([connectorId, rawAgentEntry]) => {
      const agentEntry = toRecord(rawAgentEntry);
      if (agentEntry.enabled === false) {
        return [];
      }
      if (!getConnector(connectorId)) {
        return [];
      }
      return loadConnectorTools(
        connectorId,
        globalConnectorsConfig,
        agentConnectorsConfig
      );
    }
  );
}

export function getConnectorPromptsForAgent(
  agentConfig: AgentConfig,
  gatewayConfig: GatewayConfig
): string[] {
  const agentConnectorsConfig = toRecord(agentConfig.connectors);
  void gatewayConfig;

  return Object.entries(agentConnectorsConfig).flatMap(
    ([connectorId, rawAgentEntry]) => {
      const agentEntry = toRecord(rawAgentEntry);
      if (agentEntry.enabled === false) {
        return [];
      }

      const connector = getConnector(connectorId);
      if (
        !connector?.systemPrompt ||
        connector.systemPrompt.trim().length === 0
      ) {
        return [];
      }

      return [connector.systemPrompt];
    }
  );
}
