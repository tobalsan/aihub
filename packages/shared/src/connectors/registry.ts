import type { ConnectorDefinition } from "./types.js";

const connectors = new Map<string, ConnectorDefinition>();

export function registerConnector(definition: ConnectorDefinition): void {
  connectors.set(definition.id, definition);
}

export function getConnector(id: string): ConnectorDefinition | undefined {
  return connectors.get(id);
}

export function listConnectors(): ConnectorDefinition[] {
  return Array.from(connectors.values());
}

export function clearConnectors(): void {
  connectors.clear();
}
